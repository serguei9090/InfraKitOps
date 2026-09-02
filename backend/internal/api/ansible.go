package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/infrakit/backend/internal/ansible"
	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/orchestrator"
	"github.com/infrakit/backend/internal/sse"
	"github.com/infrakit/backend/internal/userctx"
	"github.com/infrakit/backend/internal/vault"
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
	Vault   *vault.Registry // for ansible-vault password resolution (AN4)
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
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	s := h.Store.GetSettings()
	caps := h.Runtime.Detect(ctx, h.mode())
	WriteJSON(w, http.StatusOK, map[string]any{
		"workspaceDir":           s["workspaceDir"],
		"runtime":                nz(s["ansibleRuntime"], "auto"),
		"defaultWorkspace":       ansible.DefaultWorkspace(),
		"containerImage":         nz(s["containerImage"], "infrakit-ansible:local"),
		"controlNodePipPackages": s["controlNodePipPackages"],
		"controlNodeCollections": s["controlNodeCollections"],
		"wslDistro":              s["wslDistro"],
		"wslSource":              nz(s["wslSource"], "import:"),
		"os":                     runtime.GOOS,
		"install":                ansible.InstallLinks,
		"runners":                h.Engine.Runners(ctx),
		"capabilities":           caps,
	})
}

// PutSettings: PUT /ansible/settings { workspaceDir?, runtime? } — admin.
func (h *AnsibleHandlers) PutSettings(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) || !requireAdmin(w, r) {
		return
	}
	var b struct {
		WorkspaceDir           *string `json:"workspaceDir"`
		Runtime                *string `json:"runtime"`
		ContainerImage         *string `json:"containerImage"`
		ControlNodePipPackages *string `json:"controlNodePipPackages"`
		ControlNodeCollections *string `json:"controlNodeCollections"`
		WslDistro              *string `json:"wslDistro"`
		WslSource              *string `json:"wslSource"`
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
		case "auto", "system", "managed", "container", "wsl", "":
			_ = h.Store.PutSetting("ansibleRuntime", *b.Runtime)
		default:
			apierr.Write(w, apierr.Validation(`runtime must be auto | system | managed | container | wsl`))
			return
		}
	}
	for k, v := range map[string]*string{
		"containerImage":         b.ContainerImage,
		"controlNodePipPackages": b.ControlNodePipPackages,
		"controlNodeCollections": b.ControlNodeCollections,
		"wslDistro":              b.WslDistro,
		"wslSource":              b.WslSource,
	} {
		if v != nil {
			_ = h.Store.PutSetting(k, strings.TrimSpace(*v))
		}
	}
	h.GetSettings(w, r)
}

// RuntimeSetup: GET /ansible/runtime/setup/stream?mode= (SSE) — admin.
// mode "managed" builds the uv venv; "container" builds/pulls the image.
func (h *AnsibleHandlers) RuntimeSetup(w http.ResponseWriter, r *http.Request) {
	if !h.ok() {
		sse.RejectCoded(w, string(apierr.CodeInternal), "the Ansible module is not available", "")
		return
	}
	if !userctx.IsAdmin(r.Context()) {
		sse.RejectCoded(w, string(apierr.CodePermission), "admin only", "")
		return
	}
	mode := nz(r.URL.Query().Get("mode"), "managed")
	sw, err := sse.New(w)
	if err != nil {
		return
	}
	ch := make(chan sse.Message, 64)
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Minute)
	defer cancel()
	go func() {
		defer close(ch)
		err := h.Engine.SetupRuntime(ctx, mode, func(line string) {
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

// RuntimeApplyDeps: GET /ansible/runtime/deps/apply/stream?mode= (SSE) — admin.
// Installs just the control-node pip packages + collections into an existing
// runtime — no full rebuild.
func (h *AnsibleHandlers) RuntimeApplyDeps(w http.ResponseWriter, r *http.Request) {
	if !h.ok() {
		sse.RejectCoded(w, string(apierr.CodeInternal), "the Ansible module is not available", "")
		return
	}
	if !userctx.IsAdmin(r.Context()) {
		sse.RejectCoded(w, string(apierr.CodePermission), "admin only", "")
		return
	}
	mode := nz(r.URL.Query().Get("mode"), "managed")
	sw, err := sse.New(w)
	if err != nil {
		return
	}
	ch := make(chan sse.Message, 64)
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()
	go func() {
		defer close(ch)
		err := h.Engine.ApplyRuntimeDeps(ctx, mode, func(line string) {
			select {
			case ch <- sse.Message{Event: "stdout", Data: map[string]string{"text": line}}:
			case <-ctx.Done():
			}
		})
		ev, data := "done", map[string]any{"ok": true}
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

// RuntimeTeardown: POST /ansible/runtime/teardown { mode } — admin.
func (h *AnsibleHandlers) RuntimeTeardown(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) || !requireAdmin(w, r) {
		return
	}
	var b struct {
		Mode string `json:"mode"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	if err := h.Engine.TeardownRuntime(r.Context(), nz(b.Mode, "managed")); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"status": "removed"})
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
		Name      string `json:"name"`
		Mode      string `json:"mode"` // "new" | "existing" | "git"
		Path      string `json:"path"`
		GitURL    string `json:"gitUrl"`
		GitRef    string `json:"gitRef"`
		GitSecret string `json:"gitSecret"` // InfraKit Vault secret id (https token)
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

	project := ansible.Project{Name: b.Name, Source: "local"}
	switch b.Mode {
	case "existing":
		project.Path = filepath.Clean(strings.TrimSpace(b.Path))
		if !filepath.IsAbs(project.Path) {
			apierr.Write(w, apierr.Validation("an absolute path is required"))
			return
		}
		if fi, err := os.Stat(project.Path); err != nil || !fi.IsDir() {
			apierr.Write(w, apierr.Validation("that folder doesn't exist"))
			return
		}
	case "git":
		if strings.TrimSpace(b.GitURL) == "" {
			apierr.Write(w, apierr.Validation("a git URL is required"))
			return
		}
		ws := h.workspaceOrDefault()
		project.Path = filepath.Join(ws, slug(b.Name))
		token := ""
		if b.GitSecret != "" && h.Vault != nil {
			token, _ = h.vaultSecret(r, b.GitSecret)
		}
		if err := ansible.CloneRepo(r.Context(), project.Path, b.GitURL, b.GitRef, token); err != nil {
			apierr.Write(w, apierr.Validation(err.Error()))
			return
		}
		project.Source = "git"
		project.Git = &ansible.GitConfig{URL: b.GitURL, Ref: b.GitRef, Secret: b.GitSecret, LastSync: nowMillis()}
	default: // "new"
		project.Path = filepath.Join(h.workspaceOrDefault(), slug(b.Name))
		if err := ansible.Scaffold(project.Path); err != nil {
			apierr.Write(w, apierr.Conflict(err.Error()))
			return
		}
	}

	saved, err := h.Store.PutProject(owner(r), project)
	if err != nil {
		ansibleErr(w, err)
		return
	}
	audit(r, "ansible_project_create", saved.Name, map[string]string{"path": saved.Path})
	WriteJSON(w, http.StatusOK, map[string]any{"project": saved})
}

func (h *AnsibleHandlers) workspaceOrDefault() string {
	if ws := h.workspace(); ws != "" {
		return ws
	}
	ws := ansible.DefaultWorkspace()
	_ = h.Store.PutSetting("workspaceDir", ws)
	return ws
}

func nowMillis() int64 { return time.Now().UnixMilli() }

// vaultSecret resolves an InfraKit Vault secret by id then name for the request
// user; "" on any failure (caller decides whether that is fatal).
func (h *AnsibleHandlers) vaultSecret(r *http.Request, ref string) (string, error) {
	if h.Vault == nil || ref == "" {
		return "", nil
	}
	v := h.Vault.For(userctx.From(r.Context()))
	if s, err := v.Resolve(ref); err == nil {
		return s, nil
	}
	return v.ResolveByName(ref)
}

// PullProject: POST /ansible/projects/{id}/pull — git projects only.
func (h *AnsibleHandlers) PullProject(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	p, err := h.Store.GetProject(owner(r), chi.URLParam(r, "id"))
	if err != nil {
		ansibleErr(w, err)
		return
	}
	if p.Source != "git" || p.Git == nil {
		apierr.Write(w, apierr.Validation("not a git project"))
		return
	}
	token := ""
	if p.Git.Secret != "" {
		token, _ = h.vaultSecret(r, p.Git.Secret)
	}
	out, err := ansible.PullRepo(r.Context(), p.Path, p.Git.URL, p.Git.Ref, token)
	if err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	p.Git.LastSync = nowMillis()
	if _, err := h.Store.PutProject(owner(r), *p); err != nil {
		ansibleErr(w, err)
		return
	}
	audit(r, "ansible_project_pull", p.Name, nil)
	WriteJSON(w, http.StatusOK, map[string]any{"output": out, "project": p})
}

// PublishProject: POST /ansible/projects/{id}/publish { published }
func (h *AnsibleHandlers) PublishProject(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	p, err := h.Store.GetProject(owner(r), chi.URLParam(r, "id"))
	if err != nil {
		ansibleErr(w, err)
		return
	}
	var b struct {
		Published bool `json:"published"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	p.Published = b.Published
	saved, err := h.Store.PutProject(owner(r), *p)
	if err != nil {
		ansibleErr(w, err)
		return
	}
	audit(r, "ansible_project_publish", p.Name, map[string]any{"published": b.Published})
	WriteJSON(w, http.StatusOK, map[string]any{"project": saved})
}

// PublishJob: POST /ansible/jobs/{id}/publish { published }
func (h *AnsibleHandlers) PublishJob(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	job, err := h.Store.GetJob(owner(r), chi.URLParam(r, "id"))
	if err != nil {
		ansibleErr(w, err)
		return
	}
	var b struct {
		Published bool `json:"published"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	job.Published = b.Published
	saved, err := h.Store.PutJob(owner(r), *job)
	if err != nil {
		ansibleErr(w, err)
		return
	}
	audit(r, "ansible_job_publish", job.Name, map[string]any{"published": b.Published})
	WriteJSON(w, http.StatusOK, map[string]any{"job": saved})
}

// PendingApprovals: GET /ansible/runs/pending-approvals
func (h *AnsibleHandlers) PendingApprovals(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	runs, err := h.Store.ListPendingApprovals()
	if err != nil {
		ansibleErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"runs": runs})
}

// ApproveRun: POST /ansible/runs/{id}/approve { approved }
func (h *AnsibleHandlers) ApproveRun(w http.ResponseWriter, r *http.Request) {
	if !h.ok() {
		apierr.Write(w, apierr.Unavailable("the Ansible module"))
		return
	}
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	var b struct {
		Approved bool `json:"approved"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	err := h.Engine.ResumeRun(id, owner(r), b.Approved)
	switch {
	case err == nil:
		audit(r, "ansible_run_approve", chi.URLParam(r, "id"), map[string]any{"approved": b.Approved})
		WriteJSON(w, http.StatusOK, map[string]any{"status": "ok", "approved": b.Approved})
	case errors.Is(err, ansible.ErrApproveSelf()):
		apierr.Write(w, apierr.Permission("a run must be approved by a different operator"))
	default:
		apierr.Write(w, apierr.NotFound("no run is waiting for that approval"))
	}
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
		mode := os.FileMode(0o644)
		// a dynamic-inventory script (shebang, under inventory/) must stay executable
		if strings.HasPrefix(filepath.ToSlash(filepath.Clean(rel)), "inventory/") &&
			strings.HasPrefix(b.Content, "#!") {
			mode = 0o755
		}
		if err := os.WriteFile(abs, []byte(b.Content), mode); err != nil {
			apierr.Write(w, apierr.Validation(err.Error()))
			return
		}
		_ = os.Chmod(abs, mode)
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

// --- schedules --------------------------------------------------

// ListSchedules: GET /ansible/schedules
func (h *AnsibleHandlers) ListSchedules(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	list, err := h.Store.ListSchedules(owner(r))
	if err != nil {
		ansibleErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"schedules": list})
}

// PutSchedule: POST /ansible/schedules · PUT /ansible/schedules/{id}
func (h *AnsibleHandlers) PutSchedule(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var sc ansible.Schedule
	if err := json.NewDecoder(r.Body).Decode(&sc); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	if id := chi.URLParam(r, "id"); id != "" {
		sc.ID = id
	}
	if strings.TrimSpace(sc.JobID) == "" {
		apierr.Write(w, apierr.Validation("a jobId is required"))
		return
	}
	expr, err := orchestrator.ParseCron(sc.Cron)
	if err != nil {
		apierr.Write(w, apierr.Validation("bad cron expression: "+err.Error()))
		return
	}
	if sc.Enabled {
		if n := expr.Next(time.Now()); !n.IsZero() {
			sc.NextRunAt = n.UnixMilli()
		}
	} else {
		sc.NextRunAt = 0
	}
	saved, err := h.Store.PutSchedule(owner(r), sc)
	if err != nil {
		ansibleErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"schedule": saved})
}

// DeleteSchedule: DELETE /ansible/schedules/{id}
func (h *AnsibleHandlers) DeleteSchedule(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	if err := h.Store.DeleteSchedule(owner(r), chi.URLParam(r, "id")); err != nil {
		ansibleErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
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
	spec := job.Spec()
	// A survey-driven run passes the merged extra-vars YAML (job vars +
	// answers) as ?extraVars=, overriding the job's stored blob.
	if ev := r.URL.Query().Get("extraVars"); ev != "" {
		spec.ExtraVars = ev
	}
	h.streamRun(w, r, spec, "job")
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

// VaultAction: POST /ansible/projects/{id}/vault
//
//	{ path, op: "encrypt"|"decrypt"|"view"|"rekey", secret, newSecret? }
//
// `secret` / `newSecret` are InfraKit Vault secret ids (or names).
func (h *AnsibleHandlers) VaultAction(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	if h.Vault == nil {
		apierr.Write(w, apierr.Unavailable("the vault"))
		return
	}
	var b struct {
		Path      string `json:"path"`
		Op        string `json:"op"`
		Secret    string `json:"secret"`
		NewSecret string `json:"newSecret"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	v := h.Vault.For(userctx.From(r.Context()))
	resolve := func(ref string) (string, error) {
		if ref == "" {
			return "", nil
		}
		if s, err := v.Resolve(ref); err == nil {
			return s, nil
		}
		return v.ResolveByName(ref)
	}
	pw, err := resolve(b.Secret)
	if err != nil || pw == "" {
		apierr.Write(w, apierr.Locked("can't read the vault password — is the InfraKit Vault unlocked?"))
		return
	}
	newPw, _ := resolve(b.NewSecret)

	audit(r, "ansible_vault_"+b.Op, b.Path, map[string]string{"project": chi.URLParam(r, "id")})
	res, err := h.Engine.Vault(r.Context(), owner(r), h.mode(),
		ansible.VaultOp{ProjectID: chi.URLParam(r, "id"), Path: b.Path, Op: b.Op}, pw, newPw)
	if err != nil {
		if res != nil {
			WriteJSON(w, http.StatusOK, map[string]any{"result": res})
			return
		}
		ansibleErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"result": res})
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
