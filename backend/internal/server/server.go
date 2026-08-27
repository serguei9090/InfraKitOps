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
		r.Post("/iperf3", api.Iperf3)
		r.Get("/iperf3/server", api.Iperf3Server)
		r.Post("/iperf3/server", api.Iperf3Server)

		// Utility-tool "power mode" endpoints (not history-tracked).
		r.Post("/ssh-keygen", api.SSHKeygen)
		r.Post("/pdf/inspect", api.PDFInspect)
		r.Post("/pdf/transform", api.PDFTransform)
		r.Post("/config/validate", api.ConfigValidate)

		r.Route("/history", func(r chi.Router) {
			r.Get("/", hist.List)
			r.Post("/", hist.Save)
			r.Get("/{id}", hist.Get)
			r.Patch("/{id}", hist.Patch)
			r.Delete("/{id}", hist.Delete)
		})
	})

	return r
}
