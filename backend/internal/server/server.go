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
)

// Options configures the router.
type Options struct {
	// Token is the per-launch bearer token required on every request.
	Token string
	// OnActivity, if set, is called once per request so an idle watchdog can
	// reset its timer.
	OnActivity func()
}

// NewRouter returns the fully wired API handler.
func NewRouter(opts Options) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(cors)
	r.Use(activity(opts.OnActivity))
	r.Use(bearerAuth(opts.Token))

	r.Route("/api/v1", func(r chi.Router) {
		r.Get("/health", api.Health)
		r.Get("/capabilities", api.Capabilities)
		r.Get("/interfaces", api.Interfaces)
	})

	return r
}
