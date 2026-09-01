// Package server builds the HTTP router for the network backend and the idle
// watchdog that shuts it down when the desktop app goes away. Transport choice
// (localhost HTTP + JSON, SSE for streams) is documented in
// NETWORK_MODULE_PLAN.md §2.1.
package server

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/infrakit/backend/internal/api"
	"github.com/infrakit/backend/internal/history"
	"github.com/infrakit/backend/internal/llm"
	"github.com/infrakit/backend/internal/mcp"
	"github.com/infrakit/backend/internal/orchestrator"
	"github.com/infrakit/backend/internal/vault"
)

// Options configures the router.
type Options struct {
	// Token is the per-launch bearer token required on every request.
	Token string
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
	Vault *vault.Vault
	// LLM is the AI-layer store. Nil → /llm* endpoints 503.
	LLM *llm.Store
	// LLMEngine runs model listing + chat. Nil → the same.
	LLMEngine *llm.Engine
	// MCP is the Model Context Protocol client manager. Nil → /mcp* endpoints 503.
	MCP *mcp.Manager
}

// NewRouter returns the fully wired API handler.
func NewRouter(opts Options) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(cors)
	r.Use(activity(opts.OnActivity))
	r.Use(bearerAuth(opts.Token))

	hist := &api.HistoryHandlers{
		Store:         opts.History,
		AppVersion:    opts.AppVersion,
		DefaultPolicy: opts.HistoryPolicy,
	}
	rbh := &api.RunbookHandlers{Store: opts.Orchestrator, Engine: opts.RunbookEngine, Vault: opts.Vault}
	vh := &api.VaultHandlers{Vault: opts.Vault}
	lh := &api.LLMHandlers{Store: opts.LLM, Engine: opts.LLMEngine, MCP: opts.MCP}
	mh := &api.MCPHandlers{Manager: opts.MCP}

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/health", api.Health)
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
