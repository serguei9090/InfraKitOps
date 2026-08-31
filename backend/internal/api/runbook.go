package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/infrakit/backend/internal/executor"
	"github.com/infrakit/backend/internal/orchestrator"
	"github.com/infrakit/backend/internal/packages"
	"github.com/infrakit/backend/internal/sse"
	"github.com/infrakit/backend/internal/vault"
)

// RunbookHandlers wires the /runbook* endpoints. Nil Store → every endpoint 503.
type RunbookHandlers struct {
	Store  *orchestrator.Store
	Engine *orchestrator.Engine
	Vault  *vault.Vault // for applying vault-autolock from module settings
}

// ApplyRunbookSettings pushes the settings that map onto live objects — the
// concurrency cap and the vault idle timeout. Called at startup and after every
// settings write. Missing / unparseable keys are left at their current value.
func ApplyRunbookSettings(st map[string]string, engine *orchestrator.Engine, vlt *vault.Vault) {
	if engine != nil {
		if v := st["maxConcurrentRuns"]; v != "" {
			if n, err := strconv.Atoi(v); err == nil {
				engine.SetMaxConcurrent(n)
			}
		}
	}
	if vlt != nil {
		if v := st["vaultAutoLockMinutes"]; v != "" {
			if n, err := strconv.Atoi(v); err == nil && n >= 0 {
				vlt.SetAutoLock(time.Duration(n) * time.Minute)
			}
		}
	}
}

func (h *RunbookHandlers) ok() bool { return h != nil && h.Store != nil && h.Engine != nil }

func (h *RunbookHandlers) guard(w http.ResponseWriter) bool {
	if !h.ok() {
		WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "runbooks store unavailable"})
		return false
	}
	return true
}

func writeStoreErr(w http.ResponseWriter, err error) {
	if errors.Is(err, orchestrator.ErrNotFound) {
		WriteJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
}

// ListRunbooks: GET /runbooks
func (h *RunbookHandlers) List(w http.ResponseWriter, _ *http.Request) {
	if !h.guard(w) {
		return
	}
	list, err := h.Store.ListRunbooks()
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"runbooks": list})
}

// Create: POST /runbooks   { spec }
func (h *RunbookHandlers) Create(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var body struct {
		Spec orchestrator.Spec `json:"spec"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if body.Spec.Name == "" {
		body.Spec.Name = "Untitled runbook"
	}
	rb, err := h.Store.CreateRunbook(body.Spec)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"runbook": rb})
}

// Get: GET /runbooks/{id}
func (h *RunbookHandlers) Get(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	rb, err := h.Store.GetRunbook(chi.URLParam(r, "id"))
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"runbook": rb})
}

// SaveDraft: PUT /runbooks/{id}/draft   { spec }
func (h *RunbookHandlers) SaveDraft(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var body struct {
		Spec orchestrator.Spec `json:"spec"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := h.Store.SaveDraft(chi.URLParam(r, "id"), body.Spec); err != nil {
		writeStoreErr(w, err)
		return
	}
	h.Get(w, r)
}

// DiscardDraft: DELETE /runbooks/{id}/draft
func (h *RunbookHandlers) DiscardDraft(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	if err := h.Store.DiscardDraft(chi.URLParam(r, "id")); err != nil {
		writeStoreErr(w, err)
		return
	}
	h.Get(w, r)
}

// SaveVersion: POST /runbooks/{id}/versions   { note }
func (h *RunbookHandlers) SaveVersion(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var body struct {
		Note string `json:"note"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	rb, err := h.Store.SaveVersion(chi.URLParam(r, "id"), body.Note)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"runbook": rb})
}

// VersionAction: POST /runbooks/{id}/versions/{n}/{action}  (restore | pin | unpin)
// DeleteVersion: DELETE /runbooks/{id}/versions/{n}
func (h *RunbookHandlers) VersionAction(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	id := chi.URLParam(r, "id")
	n, _ := strconv.Atoi(chi.URLParam(r, "n"))
	var err error
	switch chi.URLParam(r, "action") {
	case "restore":
		err = h.Store.RestoreVersion(id, n)
	case "pin":
		err = h.Store.PinVersion(id, n, true)
	case "unpin":
		err = h.Store.PinVersion(id, n, false)
	default:
		err = errors.New("unknown action")
	}
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	h.Get(w, r)
}

func (h *RunbookHandlers) DeleteVersion(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	n, _ := strconv.Atoi(chi.URLParam(r, "n"))
	if err := h.Store.DeleteVersion(chi.URLParam(r, "id"), n); err != nil {
		writeStoreErr(w, err)
		return
	}
	h.Get(w, r)
}

// Publish: POST /runbooks/{id}/publish  { published }
func (h *RunbookHandlers) Publish(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var body struct {
		Published bool `json:"published"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if err := h.Store.SetPublished(chi.URLParam(r, "id"), body.Published); err != nil {
		writeStoreErr(w, err)
		return
	}
	h.Get(w, r)
}

// Delete: DELETE /runbooks/{id}
func (h *RunbookHandlers) Delete(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	if err := h.Store.DeleteRunbook(chi.URLParam(r, "id")); err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// Preview: POST /runbooks/{id}/preview   { version?, args }
func (h *RunbookHandlers) Preview(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	rb, err := h.Store.GetRunbook(chi.URLParam(r, "id"))
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	var body struct {
		Version int               `json:"version"`
		Args    map[string]string `json:"args"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	p, _, _, err := h.Engine.BuildPreview(rb, body.Version, body.Args)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, p)
}

// RunStream: GET /runbooks/{id}/run/stream?version=&dryRun=&args=<url-encoded json>
func (h *RunbookHandlers) RunStream(w http.ResponseWriter, r *http.Request) {
	if !h.ok() {
		sse.Reject(w, "runbooks store unavailable")
		return
	}
	rb, err := h.Store.GetRunbook(chi.URLParam(r, "id"))
	if err != nil {
		sse.Reject(w, "runbook not found")
		return
	}
	q := r.URL.Query()
	version, _ := strconv.Atoi(q.Get("version"))
	dryRun := q.Get("dryRun") == "1" || q.Get("dryRun") == "true"

	var args map[string]string
	if raw := q.Get("args"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &args); err != nil {
			sse.Reject(w, "bad args json")
			return
		}
	}

	// Published gate: a non-author (no ?author=1) may only run a published runbook.
	if !rb.Published && q.Get("author") != "1" && !dryRun {
		sse.Reject(w, "this runbook is a draft — publish it before running")
		return
	}

	sw, err := sse.New(w)
	if err != nil {
		return
	}
	ch := make(chan sse.Message, 128)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go func() {
		h.Engine.Run(ctx, rb, version, args, dryRun, "local", ch)
		close(ch)
	}()
	sw.Pump(ctx, ch)
}

// ListRuns: GET /runs?runbookId=&limit=
func (h *RunbookHandlers) ListRuns(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	runs, err := h.Store.ListRuns(r.URL.Query().Get("runbookId"), limit)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"runs": runs})
}

// GetRun: GET /runs/{id}
func (h *RunbookHandlers) GetRun(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	run, err := h.Store.GetRun(id)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"run": run})
}

// --- ssh nodes ---------------------------------------------------------

func (h *RunbookHandlers) ListNodes(w http.ResponseWriter, _ *http.Request) {
	if !h.guard(w) {
		return
	}
	nodes, err := h.Store.ListNodes()
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"nodes": nodes})
}

func (h *RunbookHandlers) PutNode(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var n orchestrator.SSHNode
	if err := json.NewDecoder(r.Body).Decode(&n); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if id := chi.URLParam(r, "id"); id != "" {
		n.ID = id
	}
	saved, err := h.Store.PutNode(n)
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"node": saved})
}

func (h *RunbookHandlers) DeleteNode(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	if err := h.Store.DeleteNode(chi.URLParam(r, "id")); err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// TestNode: POST /ssh-nodes/{id}/test — opens an SSH session, learns/verifies
// the host key, reports the outcome.
func (h *RunbookHandlers) TestNode(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	n, err := h.Store.GetNode(chi.URLParam(r, "id"))
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	t := &executor.SSHTarget{Host: n.Host, Port: n.Port, User: n.User, HostKeyFP: n.HostKeyFP}
	if n.AuthSecret != "" && h.Engine != nil && h.Engine.Secrets != nil {
		v, serr := h.Engine.Secrets.Resolve(n.AuthSecret)
		if serr != nil {
			WriteJSON(w, http.StatusForbidden, map[string]string{"error": "cannot read the node's auth secret — is the vault unlocked?"})
			return
		}
		if n.AuthKind == "key" {
			t.PrivateKey = v
		} else {
			t.Password = v
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	hk, terr := executor.SSHTest(ctx, t)

	if hk.Learned && hk.Fingerprint != "" && n.HostKeyFP == "" {
		n.HostKeyFP = hk.Fingerprint
		_, _ = h.Store.PutNode(*n)
	}
	resp := map[string]any{
		"ok":              terr == nil && !hk.Mismatch,
		"hostKeyFp":       hk.Fingerprint,
		"hostKeyLearned":  hk.Learned,
		"hostKeyMismatch": hk.Mismatch,
	}
	if terr != nil {
		resp["error"] = terr.Error()
	}
	WriteJSON(w, http.StatusOK, resp)
}

// --- settings --------------------------------------------------------

func (h *RunbookHandlers) GetSettings(w http.ResponseWriter, _ *http.Request) {
	if !h.guard(w) {
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"settings": h.Store.GetSettings()})
}

func (h *RunbookHandlers) PutSettings(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var body map[string]string
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	for k, v := range body {
		_ = h.Store.PutSetting(k, v)
	}
	merged := h.Store.GetSettings()
	ApplyRunbookSettings(merged, h.Engine, h.Vault)
	WriteJSON(w, http.StatusOK, map[string]any{"settings": merged})
}

// --- packages -------------------------------------------------------

// Packages: GET /packages?extra=a,b
func (h *RunbookHandlers) Packages(w http.ResponseWriter, r *http.Request) {
	var extra []string
	if e := r.URL.Query().Get("extra"); e != "" {
		for _, s := range strings.Split(e, ",") {
			extra = append(extra, strings.TrimSpace(s))
		}
	}
	tools := packages.Detect(r.Context(), extra)
	WriteJSON(w, http.StatusOK, map[string]any{"tools": tools})
}

// PackagesInstall: GET /packages/install/stream?tool=&manager=
func (h *RunbookHandlers) PackagesInstall(w http.ResponseWriter, r *http.Request) {
	tool := r.URL.Query().Get("tool")
	mgr := r.URL.Query().Get("manager")
	if tool == "" || mgr == "" {
		sse.Reject(w, "tool and manager are required")
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
		lw := &lineToSSE{ch: ch}
		if err := packages.RunInstall(ctx, mgr, tool, lw); err != nil {
			ch <- sse.Message{Event: "error", Data: map[string]string{"error": err.Error()}}
			return
		}
		ch <- sse.Message{Event: "done", Data: map[string]string{"status": "ok"}}
	}()
	sw.Pump(ctx, ch)
}

type lineToSSE struct{ ch chan sse.Message }

func (l *lineToSSE) Write(p []byte) (int, error) {
	l.ch <- sse.Message{Event: "line", Data: map[string]string{"text": string(p)}}
	return len(p), nil
}

// --- library git / file sync ---------------------------------------

// LibraryExport: POST /library/export  { dir, gitCommit, gitPush }
func (h *RunbookHandlers) LibraryExport(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var b struct {
		Dir       string `json:"dir"`
		GitCommit bool   `json:"gitCommit"`
		GitPush   bool   `json:"gitPush"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	report, err := h.Store.ExportLibrary(r.Context(), b.Dir, b.GitCommit, b.GitPush)
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error(), "report": report})
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"report": report})
}

// LibraryImport: POST /library/import  { dir }
func (h *RunbookHandlers) LibraryImport(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var b struct {
		Dir string `json:"dir"`
	}
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	n, err := h.Store.ImportLibrary(b.Dir)
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error(), "imported": n})
		return
	}
	WriteJSON(w, http.StatusOK, map[string]int{"imported": n})
}

// --- schedules -----------------------------------------------------

// ListSchedules: GET /runbook-schedules
func (h *RunbookHandlers) ListSchedules(w http.ResponseWriter, _ *http.Request) {
	if !h.guard(w) {
		return
	}
	list, err := h.Store.ListSchedules()
	if err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"schedules": list})
}

// PutSchedule: POST /runbook-schedules  or  PUT /runbook-schedules/{id}
func (h *RunbookHandlers) PutSchedule(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var sc orchestrator.RunSchedule
	if err := json.NewDecoder(r.Body).Decode(&sc); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if id := chi.URLParam(r, "id"); id != "" {
		sc.ID = id
	}
	saved, err := h.Store.PutSchedule(sc)
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"schedule": saved})
}

// DeleteSchedule: DELETE /runbook-schedules/{id}
func (h *RunbookHandlers) DeleteSchedule(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	if err := h.Store.DeleteSchedule(chi.URLParam(r, "id")); err != nil {
		writeStoreErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// RunbookExecutors reports which executor kinds this host can run.
func RunbookExecutors() map[string]bool {
	out := map[string]bool{}
	for k, v := range executor.AvailableKinds() {
		out[string(k)] = v
	}
	return out
}
