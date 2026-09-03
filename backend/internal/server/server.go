// Package server builds the HTTP router for the network backend and the idle
// watchdog that shuts it down when the desktop app goes away. Transport choice
// (localhost HTTP + JSON, SSE for streams) is documented in
// NETWORK_MODULE_PLAN.md §2.1.
package server

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/infrakit/backend/internal/ansible"
	"github.com/infrakit/backend/internal/api"
	"github.com/infrakit/backend/internal/auth"
	"github.com/infrakit/backend/internal/history"
	"github.com/infrakit/backend/internal/llm"
	"github.com/infrakit/backend/internal/mcp"
	"github.com/infrakit/backend/internal/orchestrator"
	"github.com/infrakit/backend/internal/promptstore"
	"github.com/infrakit/backend/internal/vault"
)

// Options configures the router.
type Options struct {
	// Token is the per-launch bearer token required on every request in
	// single-user mode (Auth == nil).
	Token string
	// Auth, when set, switches the service into multi-user mode: session
	// tokens instead of the static Token, plus /auth + /users + /audit.
	Auth *auth.Service
	// CORSOrigins are extra browser origins allowed in addition to the
	// built-in localhost / tauri set (U6, for a hosted web deployment).
	CORSOrigins []string
	// OnActivity, if set, is called once per request so an idle watchdog can
	// reset its timer.
	OnActivity func()
	// History is the run-history store. Nil is allowed — the /history
	// endpoints then return 503 and the tools still work.
	History *history.Store
	// AppVersion is stamped onto every stored run.
	AppVersion string
	// HistoryPolicy is the default prune policy (per-request overridable).
	HistoryPolicy history.PrunePolicy
	// Orchestrator is the Runbooks store. Nil → the /runbook* endpoints 503.
	Orchestrator *orchestrator.Store
	// RunbookEngine executes runbooks. Nil → running is unavailable.
	RunbookEngine *orchestrator.Engine
	// Vault is the secret store. Nil → /vault* endpoints 503.
	Vault *vault.Registry
	// LLM is the AI-layer store. Nil → /llm* endpoints 503.
	LLM *llm.Store
	// LLMEngine runs model listing + chat. Nil → the same.
	LLMEngine *llm.Engine
	// MCP is the Model Context Protocol client manager. Nil → /mcp* endpoints 503.
	MCP *mcp.Manager
	// LLMHistory persists saved conversations (A3b). Nil → /llm/conversations* 503.
	LLMHistory *llm.History
	// LLMUsage aggregates token counts (A3c). Nil → /llm/usage 503.
	LLMUsage *llm.UsageStore
	// Prompts is the server-side Prompt Library store (U4). Only set in
	// multi-user mode; nil → /prompts* 503 and the client keeps its local repo.
	Prompts *promptstore.Store
	// AnsibleStore / AnsibleEngine / AnsibleRuntime back the Ansible Manager
	// module (ANSIBLE_MODULE_PLAN.md). Nil → /ansible* endpoints 503.
	AnsibleStore   *ansible.Store
	AnsibleEngine  *ansible.Engine
	AnsibleRuntime *ansible.Runtime
}

// NewRouter returns the fully wired API handler.
func NewRouter(opts Options) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(cors(opts.CORSOrigins))
	r.Use(activity(opts.OnActivity))
	if opts.Auth != nil {
		r.Use(sessionAuth(opts.Auth))
		r.Use(accessGuard)
	} else {
		r.Use(bearerAuth(opts.Token))
	}

	hist := &api.HistoryHandlers{
		Store:         opts.History,
		AppVersion:    opts.AppVersion,
		DefaultPolicy: opts.HistoryPolicy,
	}
	rbh := &api.RunbookHandlers{Store: opts.Orchestrator, Engine: opts.RunbookEngine, Vault: opts.Vault}
	vh := &api.VaultHandlers{Reg: opts.Vault}
	lh := &api.LLMHandlers{
		Store: opts.LLM, Engine: opts.LLMEngine, MCP: opts.MCP,
		History: opts.LLMHistory, Usage: opts.LLMUsage,
	}
	mh := &api.MCPHandlers{Manager: opts.MCP}
	anh := &api.AnsibleHandlers{Store: opts.AnsibleStore, Engine: opts.AnsibleEngine, Runtime: opts.AnsibleRuntime, Vault: opts.Vault}
	ph := &api.PromptHandlers{Store: opts.Prompts}
	ah := &api.AuthHandlers{
		Service: opts.Auth,
		UserOf:  func(r *http.Request) *auth.User { return UserFrom(r.Context()) },
	}
	if opts.Auth != nil {
		api.AuthMode = "on"
		api.SetAuditSink(opts.Auth.AuditRaw)
	}

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/health", api.Health)

		if opts.Auth != nil {
			r.Route("/auth", func(r chi.Router) {
				r.Get("/setup-status", ah.SetupStatus)
				r.Post("/bootstrap", ah.Bootstrap)
				r.Post("/login", ah.Login)
				r.Post("/logout", ah.Logout)
				r.Get("/me", ah.Me)
				r.Post("/change-password", ah.ChangePassword)
			})
			r.Route("/users", func(r chi.Router) {
				r.Get("/", ah.ListUsers)
				r.Post("/", ah.CreateUser)
				r.Patch("/{id}", ah.PatchUser)
				r.Delete("/{id}", ah.DeleteUser)
			})
			r.Get("/audit", ah.ListAudit)

			if opts.Prompts != nil {
				r.Route("/prompts", func(r chi.Router) {
					r.Get("/library", ph.Library)
					r.Get("/templates", ph.Templates)
					r.Put("/templates/{id}", ph.SaveTemplate)
					r.Delete("/templates/{id}", ph.DeleteTemplate)
					r.Put("/folders/{id}", ph.SaveFolder)
					r.Delete("/folders/{id}", ph.DeleteFolder)
					r.Put("/{id}", ph.SavePrompt)
					r.Delete("/{id}", ph.DeletePrompt)
					r.Post("/{id}/publish", ph.Publish)
				})
			}
		}
		r.Get("/capabilities", api.Capabilities)
		r.Get("/interfaces", api.Interfaces)

		r.Post("/sntp", api.SNTP)
		r.Post("/whois", api.Whois)
		r.Post("/dns-lookup", api.DNSLookup)
		r.Post("/ip-geolocation", api.IPGeolocation)
		r.Get("/connections", api.Connections)
		r.Post("/wake-on-lan", api.WakeOnLAN)
		r.Get("/port-scanner/stream", api.PortScanStream)
		r.Get("/ping-monitor/stream", api.PingMonitorStream)
		r.Get("/traceroute/stream", api.TracerouteStream)
		r.Get("/network-scanner/stream", api.NetScanStream)
		r.Post("/snmp", api.SNMP)
		r.Get("/neighbor-table", api.NeighborTable)
		r.Get("/hosts", api.HostsGet)
		r.Post("/hosts", api.HostsApply)
		r.Post("/hosts/restore", api.HostsRestore)
		r.Get("/firewall-viewer", api.FirewallView)
		r.Post("/firewall/change", api.FirewallChange)
		r.Post("/iperf3", api.Iperf3)
		r.Get("/iperf3/server", api.Iperf3Server)
		r.Post("/iperf3/server", api.Iperf3Server)

		// Utility-tool "power mode" endpoints (not history-tracked).
		r.Post("/ssh-keygen", api.SSHKeygen)
		r.Post("/pdf/inspect", api.PDFInspect)
		r.Post("/pdf/transform", api.PDFTransform)
		r.Post("/config/validate", api.ConfigValidate)
		r.Post("/qr/decode", api.QRDecode)
		r.Post("/x509/fetch", api.X509Fetch)

		r.Route("/history", func(r chi.Router) {
			r.Get("/", hist.List)
			r.Post("/", hist.Save)
			r.Get("/{id}", hist.Get)
			r.Patch("/{id}", hist.Patch)
			r.Delete("/{id}", hist.Delete)
		})

		// Runbooks module (RUNBOOK_MODULE_PLAN.md §6.3).
		r.Route("/runbooks", func(r chi.Router) {
			r.Get("/", rbh.List)
			r.Post("/", rbh.Create)
			r.Get("/{id}", rbh.Get)
			r.Delete("/{id}", rbh.Delete)
			r.Put("/{id}/draft", rbh.SaveDraft)
			r.Delete("/{id}/draft", rbh.DiscardDraft)
			r.Post("/{id}/versions", rbh.SaveVersion)
			r.Post("/{id}/versions/{n}/{action}", rbh.VersionAction)
			r.Delete("/{id}/versions/{n}", rbh.DeleteVersion)
			r.Post("/{id}/publish", rbh.Publish)
			r.Post("/{id}/preview", rbh.Preview)
			r.Get("/{id}/run/stream", rbh.RunStream)
		})
		r.Get("/runs", rbh.ListRuns)
		r.Get("/runs/pending-approvals", rbh.PendingApprovals)
		r.Post("/runs/{id}/approve", rbh.ApproveRun)
		r.Get("/runs/{id}", rbh.GetRun)
		r.Route("/ssh-nodes", func(r chi.Router) {
			r.Get("/", rbh.ListNodes)
			r.Post("/", rbh.PutNode)
			r.Put("/{id}", rbh.PutNode)
			r.Delete("/{id}", rbh.DeleteNode)
			r.Post("/{id}/test", rbh.TestNode)
		})
		r.Get("/runbook-settings", rbh.GetSettings)
		r.Put("/runbook-settings", rbh.PutSettings)
		r.Route("/runbook-schedules", func(r chi.Router) {
			r.Get("/", rbh.ListSchedules)
			r.Post("/", rbh.PutSchedule)
			r.Put("/{id}", rbh.PutSchedule)
			r.Delete("/{id}", rbh.DeleteSchedule)
		})
		r.Get("/packages", rbh.Packages)
		r.Get("/packages/install/stream", rbh.PackagesInstall)
		r.Post("/library/export", rbh.LibraryExport)
		r.Post("/library/import", rbh.LibraryImport)

		// AI layer (AI_MODULE_PLAN.md §6.3).
		r.Route("/llm", func(r chi.Router) {
			r.Get("/connections", lh.ListConnections)
			r.Post("/connections", lh.PutConnection)
			r.Put("/connections/{id}", lh.PutConnection)
			r.Delete("/connections/{id}", lh.DeleteConnection)
			r.Post("/connections/{id}/test", lh.TestConnection)
			r.Get("/connections/{id}/models", lh.Models)
			r.Get("/chat/stream", lh.ChatStream)
			r.Post("/tool/{id}/resume", lh.ResumeTool)
			r.Get("/usage", lh.UsageReport)
			r.Get("/conversations", lh.ListConversations)
			r.Post("/conversations", lh.SaveConversation)
			r.Get("/conversations/{id}", lh.GetConversation)
			r.Patch("/conversations/{id}", lh.PatchConversation)
			r.Delete("/conversations/{id}", lh.DeleteConversation)
			r.Get("/tasks", lh.ListTasks)
			r.Post("/tasks", lh.PutTask)
			r.Put("/tasks/{id}", lh.PutTask)
			r.Delete("/tasks/{id}", lh.DeleteTask)
			r.Get("/tasks/{id}/run/stream", lh.TaskRunStream)
			r.Get("/settings", lh.GetSettings)
			r.Put("/settings", lh.PutSettings)
		})

		r.Route("/mcp", func(r chi.Router) {
			r.Get("/servers", mh.ListServers)
			r.Post("/servers", mh.PutServer)
			r.Put("/servers/{id}", mh.PutServer)
			r.Delete("/servers/{id}", mh.DeleteServer)
			r.Post("/servers/{id}/test", mh.TestServer)
			r.Get("/tools", mh.ListTools)
			r.Get("/resources", mh.ListResources)
			r.Post("/resources/read", mh.ReadResource)
			r.Get("/prompts", mh.ListPrompts)
			r.Post("/prompts/get", mh.GetPrompt)
		})

		// Ansible Manager module (ANSIBLE_MODULE_PLAN.md §4).
		r.Route("/ansible", func(r chi.Router) {
			r.Get("/settings", anh.GetSettings)
			r.Put("/settings", anh.PutSettings)
			r.Get("/runtime/setup/stream", anh.RuntimeSetup)
			r.Get("/runtime/deps/apply/stream", anh.RuntimeApplyDeps)
			r.Post("/runtime/teardown", anh.RuntimeTeardown)
			r.Route("/projects", func(r chi.Router) {
				r.Get("/", anh.ListProjects)
				r.Post("/", anh.CreateProject)
				r.Delete("/{id}", anh.DeleteProject)
				r.Get("/{id}/tree", anh.ProjectTree)
				r.Get("/{id}/facts", anh.Facts)
				r.Post("/{id}/facts/gather", anh.GatherFacts)
				r.Get("/{id}/file", anh.ProjectFile)
				r.Put("/{id}/file", anh.ProjectFile)
				r.Get("/{id}/inventory", anh.Inventory)
				r.Post("/{id}/syntax-check", anh.SyntaxCheck)
				r.Post("/{id}/lint", anh.Lint)
				r.Post("/{id}/vault", anh.VaultAction)
				r.Post("/{id}/pull", anh.PullProject)
				r.Post("/{id}/publish", anh.PublishProject)
				r.Get("/{id}/galaxy/install/stream", anh.GalaxyInstallStream)
				r.Get("/{id}/run/stream", anh.RunStream)
			})
			r.Get("/adhoc/stream", anh.AdhocStream)
			r.Get("/doc", anh.Doc)
			r.Get("/galaxy/search", anh.GalaxySearch)
			r.Route("/jobs", func(r chi.Router) {
				r.Get("/", anh.ListJobs)
				r.Post("/", anh.PutJob)
				r.Put("/{id}", anh.PutJob)
				r.Delete("/{id}", anh.DeleteJob)
				r.Post("/{id}/publish", anh.PublishJob)
				r.Get("/{id}/run/stream", anh.JobRunStream)
			})
			r.Get("/runs/pending-approvals", anh.PendingApprovals)
			r.Post("/runs/{id}/approve", anh.ApproveRun)
			r.Route("/schedules", func(r chi.Router) {
				r.Get("/", anh.ListSchedules)
				r.Post("/", anh.PutSchedule)
				r.Put("/{id}", anh.PutSchedule)
				r.Delete("/{id}", anh.DeleteSchedule)
			})
			r.Get("/runs", anh.ListRuns)
			r.Get("/runs/{id}", anh.GetRun)
		})

		r.Route("/vault", func(r chi.Router) {
			r.Get("/status", vh.Status)
			r.Post("/init", vh.Init)
			r.Post("/unlock", vh.Unlock)
			r.Post("/unlock-keyring", vh.UnlockKeyring)
			r.Post("/remember", vh.Remember)
			r.Post("/forget", vh.Forget)
			r.Post("/lock", vh.Lock)
			r.Get("/secrets", vh.ListSecrets)
			r.Post("/secrets", vh.PutSecret)
			r.Put("/secrets/{id}", vh.PutSecret)
			r.Delete("/secrets/{id}", vh.DeleteSecret)
			r.Get("/export", vh.Export)
			r.Post("/import", vh.Import)
		})
	})

	return r
}
