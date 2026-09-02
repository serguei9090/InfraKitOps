package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/infrakit/backend/internal/ansible"
	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/sse"
	"github.com/infrakit/backend/internal/userctx"
)

// nz returns s, or def when s is blank.
func nz(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}

// AnsibleHandlers wires /ansible*. Nil Store/Engine → every endpoint 503.
// See ANSIBLE_MODULE_PLAN.md.
type AnsibleHandlers struct {
	Store   *ansible.Store
	Engine  *ansible.Engine
	Runtime *ansible.Runtime
}

func (h *AnsibleHandlers) ok() bool {
	return h != nil && h.Store != nil && h.Engine != nil && h.Runtime != nil
}

func (h *AnsibleHandlers) guard(w http.ResponseWriter) bool {
	if !h.ok() {
		apierr.Write(w, apierr.Unavailable("the Ansible module"))
		return false
	}
	return true
}

func ansibleErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ansible.ErrNotFound):
		apierr.Write(w, apierr.NotFound("not found"))
	case errors.Is(err, ansible.ErrOutsideRoot):
		apierr.Write(w, apierr.Validation("that path is outside the project"))
	case errors.Is(err, ansible.ErrNoWorkspace):
		apierr.Write(w, apierr.Validation("set the Ansible workspace folder first (Settings → Ansible)"))
	default:
		apierr.Write(w, apierr.Validation(err.Error()))
	}
}

func (h *AnsibleHandlers) mode() ansible.RuntimeMode {
	return ansible.RuntimeMode(h.Store.GetSettings()["ansibleRuntime"])
}

func (h *AnsibleHandlers) workspace() string {
	return h.Store.GetSettings()["workspaceDir"]
}

// --- settings ------------------------------------------------------

// GetSettings: GET /ansible/settings
func (h *AnsibleHandlers) GetSettings(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	s := h.Store.GetSettings()
	WriteJSON(w, http.StatusOK, map[string]any{
		"workspaceDir":     s["workspaceDir"],
		"runtime":          nz(s["ansibleRuntime"], "auto"),
		"defaultWorkspace": ansible.DefaultWorkspace(),
		"capabilities":     h.Runtime.Detect(ctx, h.mode()),
	})
}

// PutSettings: PUT /ansible/settings { workspaceDir?, runtime? } — admin.
func (h *AnsibleHandlers) PutSettings(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) || !requireAdmin(w, r) {
		return
	}
	var b struct {
		WorkspaceDir *string `json:"workspaceDir"`
		Runtime      *string `json:"runtime"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	if b.WorkspaceDir != nil {
		dir := strings.TrimSpace(*b.WorkspaceDir)
		if dir != "" {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				apierr.Write(w, apierr.Validation("can't use that folder: "+err.Error()))
				return
			}
		}
		_ = h.Store.PutSetting("workspaceDir", dir)
	}
	if b.Runtime != nil {
		switch *b.Runtime {
		case "auto", "system", "managed", "":
			_ = h.Store.PutSetting("ansibleRuntime", *b.Runtime)
		default:
			apierr.Write(w, apierr.Validation(`runtime must be "auto", "system" or "managed"`))
			return
		}
	}
	h.GetSettings(w, r)
}

// RuntimeSetup: GET /ansible/runtime/setup/stream?version= (SSE) — admin.
func (h *AnsibleHandlers) RuntimeSetup(w http.ResponseWriter, r *http.Request) {
	if !h.ok() {
		sse.RejectCoded(w, string(apierr.CodeInternal), "the Ansible module is not available", "")
		return
	}
	if !userctx.IsAdmin(r.Context()) {
		sse.RejectCoded(w, string(apierr.CodePermission), "admin only", "")
		return
	}
	sw, err := sse.New(w)
	if err != nil {
		return
	}
	ch := make(chan sse.Message, 64)
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()
	go func() {
		defer close(ch)
		err := h.Runtime.EnsureManaged(ctx, r.URL.Query().Get("version"), func(line string) {
			select {
			case ch <- sse.Message{Event: "stdout", Data: map[string]string{"text": line}}:
			case <-ctx.Done():
			}
		})
		ev := "done"
		data := map[string]any{"ok": true}
		if err != nil {
			ev, data = "error", map[string]any{"ok": false, "error": err.Error()}
		}
		select {
		case ch <- sse.Message{Event: ev, Data: data}:
		case <-ctx.Done():
		}
	}()
	sw.Pump(ctx, ch)
}

// --- projects -----------------------------------------------------

// ListProjects: GET /ansible/projects
func (h *AnsibleHandlers) ListProjects(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	list, err := h.Store.ListProjects(owner(r))
	if err != nil {
		ansibleErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"projects": list})
}

// CreateProject: POST /ansible/projects
//
//	{ name, mode: "new"|"existing", path? }
//
// "new"  → scaffold <workspace>/<slug(name)>
// "existing" → register an absolute `path` that already holds an ansible layout
func (h *AnsibleHandlers) CreateProject(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var b struct {
		Name string `json:"name"`
		Mode string `json:"mode"`
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	b.Name = strings.TrimSpace(b.Name)
	if b.Name == "" {
		apierr.Write(w, apierr.Validation("a name is required"))
		return
	}

	var path string
	switch b.Mode {
	case "existing":
		path = filepath.Clean(strings.TrimSpace(b.Path))
		if !filepath.IsAbs(path) {
			apierr.Write(w, apierr.Validation("an absolute path is required"))
			return
		}
		if fi, err := os.Stat(path); err != nil || !fi.IsDir() {
			apierr.Write(w, apierr.Validation("that folder doesn't exist"))
			return
		}
	default: // "new"
		ws := h.workspace()
		if ws == "" {
			ws = ansible.DefaultWorkspace()
			_ = h.Store.PutSetting("workspaceDir", ws)
		}
		path = filepath.Join(ws, slug(b.Name))
		if err := ansible.Scaffold(path); err != nil {
			apierr.Write(w, apierr.Conflict(err.Error()))
			return
		}
	}

	saved, err := h.Store.PutProject(owner(r), ansible.Project{Name: b.Name, Path: path, Source: "local"})
	if err != nil {
		ansibleErr(w, err)
		return
	}
	audit(r, "ansible_project_create", saved.Name, map[string]string{"path": path})
	WriteJSON(w, http.StatusOK, map[string]any{"project": saved})
}

// DeleteProject: DELETE /ansible/projects/{id} — unregisters; never deletes files.
func (h *AnsibleHandlers) DeleteProject(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	if err := h.Store.DeleteProject(owner(r), chi.URLParam(r, "id")); err != nil {
		ansibleErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ProjectTree: GET /ansible/projects/{id}/tree
func (h *AnsibleHandlers) ProjectTree(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	p, err := h.Store.GetProject(owner(r), chi.URLParam(r, "id"))
	if err != nil {
		ansibleErr(w, err)
		return
	}
	tree, err := ansible.ScanTree(p.Path)
	if err != nil {
		ansibleErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"tree": tree})
}

// --- project files -----------------------------------------------

const maxProjectFile = 1 << 20 // 1 MiB — inventory / playbook / ansible.cfg

// ProjectFile: GET|PUT /ansible/projects/{id}/file?path=<rel> — path-jailed to
// the project directory. Text files only.
func (h *AnsibleHandlers) ProjectFile(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	p, err := h.Store.GetProject(owner(r), chi.URLParam(r, "id"))
	if err != nil {
		ansibleErr(w, err)
		return
	}
	rel := r.URL.Query().Get("path")
	if strings.TrimSpace(rel) == "" {
		apierr.Write(w, apierr.Validation("a path is required"))
		return
	}
	abs, err := ansible.SafeJoin(p.Path, rel)
	if err != nil {
		ansibleErr(w, err)
		return
	}

	if r.Method == http.MethodPut {
		var b struct {
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			apierr.Write(w, apierr.Validation(err.Error()))
			return
		}
		if len(b.Content) > maxProjectFile {
			apierr.Write(w, apierr.Validation("file too large"))
			return
		}
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			apierr.Write(w, apierr.Validation(err.Error()))
			return
		}
		if err := os.WriteFile(abs, []byte(b.Content), 0o644); err != nil {
			apierr.Write(w, apierr.Validation(err.Error()))
			return
		}
		audit(r, "ansible_project_file_write", rel, map[string]string{"project": p.ID})
		WriteJSON(w, http.StatusOK, map[string]string{"status": "saved"})
		return
	}

	data, err := os.ReadFile(abs)
	if err != nil {
		apierr.Write(w, apierr.NotFound("file not found"))
		return
	}
	if len(data) > maxProjectFile {
		apierr.Write(w, apierr.Validation("file too large to edit"))
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"path": filepath.ToSlash(rel), "content": string(data)})
}

// Inventory: GET /ansible/projects/{id}/inventory?src=<rel-or-hostlist>
func (h *AnsibleHandlers) Inventory(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	res, err := h.Engine.Inventory(r.Context(), owner(r), h.mode(), chi.URLParam(r, "id"), r.URL.Query().Get("src"))
	if err != nil {
		ansibleErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"inventory": res})
}

// --- jobs -------------------------------------------------------

// ListJobs: GET /ansible/jobs?projectId=
func (h *AnsibleHandlers) ListJobs(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	jobs, err := h.Store.ListJobs(owner(r), r.URL.Query().Get("projectId"))
	if err != nil {
		ansibleErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"jobs": jobs})
}

// PutJob: POST /ansible/jobs  ·  PUT /ansible/jobs/{id}
func (h *AnsibleHandlers) PutJob(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var job ansible.Job
	if err := json.NewDecoder(r.Body).Decode(&job); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	if id := chi.URLParam(r, "id"); id != "" {
		job.ID = id
	}
	if strings.TrimSpace(job.Name) == "" || strings.TrimSpace(job.ProjectID) == "" || strings.TrimSpace(job.Playbook) == "" {
		apierr.Write(w, apierr.Validation("name, projectId and playbook are required"))
		return
	}
	saved, err := h.Store.PutJob(owner(r), job)
	if err != nil {
		ansibleErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"job": saved})
}

// DeleteJob: DELETE /ansible/jobs/{id}
func (h *AnsibleHandlers) DeleteJob(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	if err := h.Store.DeleteJob(owner(r), chi.URLParam(r, "id")); err != nil {
		ansibleErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// JobRunStream: GET /ansible/jobs/{id}/run/stream
func (h *AnsibleHandlers) JobRunStream(w http.ResponseWriter, r *http.Request) {
	if !h.ok() {
		sse.RejectCoded(w, string(apierr.CodeInternal), "the Ansible module is not available", "")
		return
	}
	job, err := h.Store.GetJob(owner(r), chi.URLParam(r, "id"))
	if err != nil {
		sse.RejectCoded(w, string(apierr.CodeNotFound), "job not found", "")
		return
	}
	audit(r, "ansible_job_run", job.Name, map[string]string{"job": job.ID})
	h.streamRun(w, r, job.Spec(), "job")
}

// --- run --------------------------------------------------------

// RunStream: GET /ansible/projects/{id}/run/stream?playbook=&inventory=&limit=&tags=&skipTags=&check=&diff=&become=&verbosity=&extraVars=
func (h *AnsibleHandlers) RunStream(w http.ResponseWriter, r *http.Request) {
	if !h.ok() {
		sse.RejectCoded(w, string(apierr.CodeInternal), "the Ansible module is not available", "")
		return
	}
	q := r.URL.Query()
	spec := ansible.RunSpec{
		ProjectID: chi.URLParam(r, "id"),
		Playbook:  q.Get("playbook"),
		Inventory: q.Get("inventory"),
		Limit:     q.Get("limit"),
		Tags:      q.Get("tags"),
		SkipTags:  q.Get("skipTags"),
		ExtraVars: q.Get("extraVars"),
		Check:     q.Get("check") == "1" || q.Get("check") == "true",
		Diff:      q.Get("diff") == "1" || q.Get("diff") == "true",
		Become:    q.Get("become") == "1" || q.Get("become") == "true",
		Verbosity: atoiOr(q.Get("verbosity"), 0),
		Forks:     atoiOr(q.Get("forks"), 0),
	}
	if strings.TrimSpace(spec.Playbook) == "" {
		sse.RejectCoded(w, string(apierr.CodeValidation), "a playbook is required", "")
		return
	}
	audit(r, "ansible_run", spec.Playbook, nil)
	h.streamRun(w, r, spec, "local")
}

// AdhocStream: GET /ansible/adhoc/stream?projectId=&pattern=&module=&args=&inventory=&become=
func (h *AnsibleHandlers) AdhocStream(w http.ResponseWriter, r *http.Request) {
	if !h.ok() {
		sse.RejectCoded(w, string(apierr.CodeInternal), "the Ansible module is not available", "")
		return
	}
	q := r.URL.Query()
	spec := ansible.AdhocSpec{
		ProjectID: q.Get("projectId"),
		Pattern:   q.Get("pattern"),
		Module:    q.Get("module"),
		Args:      q.Get("args"),
		Inventory: q.Get("inventory"),
		Become:    q.Get("become") == "1" || q.Get("become") == "true",
		OneLine:   q.Get("oneLine") == "1",
	}
	if strings.TrimSpace(spec.ProjectID) == "" {
		sse.RejectCoded(w, string(apierr.CodeValidation), "a projectId is required", "")
		return
	}
	audit(r, "ansible_adhoc", nz(spec.Module, "command"), map[string]string{"pattern": spec.Pattern})

	sw, err := sse.New(w)
	if err != nil {
		return
	}
	ch := make(chan sse.Message, 256)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go func() {
		h.Engine.RunAdhoc(ctx, owner(r), h.mode(), spec, ch)
		close(ch)
	}()
	sw.Pump(ctx, ch)
}

// GalaxySearch: GET /ansible/galaxy/search?type=collection|role&q=
func (h *AnsibleHandlers) GalaxySearch(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	items, err := ansible.GalaxySearch(r.Context(), r.URL.Query().Get("type"), r.URL.Query().Get("q"))
	if err != nil {
		apierr.Write(w, apierr.ClassifyNet(err))
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"items": items})
}

// GalaxyInstallStream: GET /ansible/projects/{id}/galaxy/install/stream?type=&name=
// name="" installs everything in the project's requirements.yml.
func (h *AnsibleHandlers) GalaxyInstallStream(w http.ResponseWriter, r *http.Request) {
	if !h.ok() {
		sse.RejectCoded(w, string(apierr.CodeInternal), "the Ansible module is not available", "")
		return
	}
	q := r.URL.Query()
	audit(r, "ansible_galaxy_install", nz(q.Get("name"), "requirements.yml"), nil)

	sw, err := sse.New(w)
	if err != nil {
		return
	}
	ch := make(chan sse.Message, 128)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go func() {
		h.Engine.GalaxyInstall(ctx, owner(r), h.mode(), chi.URLParam(r, "id"), q.Get("type"), q.Get("name"), ch)
		close(ch)
	}()
	sw.Pump(ctx, ch)
}

// Doc: GET /ansible/doc?module=
func (h *AnsibleHandlers) Doc(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	doc, err := h.Engine.Doc(r.Context(), h.mode(), r.URL.Query().Get("module"))
	if err != nil {
		ansibleErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"doc": doc})
}

// SyntaxCheck: POST /ansible/projects/{id}/syntax-check { playbook }
func (h *AnsibleHandlers) SyntaxCheck(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var b struct {
		Playbook string `json:"playbook"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	res, err := h.Engine.SyntaxCheck(r.Context(), owner(r), h.mode(), chi.URLParam(r, "id"), b.Playbook)
	if err != nil {
		ansibleErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"result": res})
}

// Lint: POST /ansible/projects/{id}/lint { path }
func (h *AnsibleHandlers) Lint(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var b struct {
		Path string `json:"path"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	res, err := h.Engine.Lint(r.Context(), owner(r), h.mode(), chi.URLParam(r, "id"), b.Path)
	if err != nil {
		ansibleErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"result": res})
}

func (h *AnsibleHandlers) streamRun(w http.ResponseWriter, r *http.Request, spec ansible.RunSpec, triggeredBy string) {
	sw, err := sse.New(w)
	if err != nil {
		return
	}
	ch := make(chan sse.Message, 256)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go func() {
		h.Engine.Run(ctx, owner(r), h.mode(), triggeredBy, spec, ch)
		close(ch)
	}()
	sw.Pump(ctx, ch)
}

// ListRuns: GET /ansible/runs?projectId=&limit=
func (h *AnsibleHandlers) ListRuns(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	runs, err := h.Store.ListRuns(owner(r), r.URL.Query().Get("projectId"), atoiOr(r.URL.Query().Get("limit"), 0), false)
	if err != nil {
		ansibleErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"runs": runs})
}

// GetRun: GET /ansible/runs/{id} — includes the event blob for replay.
func (h *AnsibleHandlers) GetRun(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	run, err := h.Store.GetRun(owner(r), id)
	if err != nil {
		ansibleErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"run": run})
}

// slug lowercases + hyphenates a project name for its folder.
func slug(s string) string {
	var b strings.Builder
	prevDash := false
	for _, r := range strings.ToLower(strings.TrimSpace(s)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			prevDash = false
		default:
			if !prevDash && b.Len() > 0 {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		out = "project"
	}
	return out
}
