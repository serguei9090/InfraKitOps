package server

import (
	"context"
	"crypto/subtle"
	"net/http"
	"net/url"
	"strings"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/auth"
	"github.com/infrakit/backend/internal/userctx"
)

// tauriOrigins are the exact browser origins the desktop webview reports.
var tauriOrigins = map[string]bool{
	"http://tauri.localhost":  true,
	"https://tauri.localhost": true,
	"tauri://localhost":       true,
}

// originAllowed permits the Tauri webview origins, any loopback origin (a dev
// Vite server on any port), and any explicitly configured extra origin (U6).
func originAllowed(origin string, extra []string) bool {
	if origin == "" {
		return true // non-browser / same-origin caller
	}
	if tauriOrigins[origin] {
		return true
	}
	for _, e := range extra {
		if strings.EqualFold(strings.TrimRight(e, "/"), strings.TrimRight(origin, "/")) {
			return true
		}
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	host := u.Hostname()
	return host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "::1"
}

// sameOrigin reports whether the Origin header names the same host the request
// arrived on — the frontend served from the same container as the API (D0).
// Honours X-Forwarded-* only when a trusted proxy set them (behind-proxy, D1).
func sameOrigin(origin string, r *http.Request) bool {
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return false
	}
	host := r.Host
	if fh := r.Header.Get("X-Forwarded-Host"); fh != "" && trustProxyHeaders {
		host = fh
	}
	return strings.EqualFold(u.Host, host)
}

// trustProxyHeaders is set by main.go when --behind-proxy is given (D1):
// the immediate peer is a trusted reverse proxy, so X-Forwarded-* may be
// believed for same-origin and secure-cookie decisions.
var trustProxyHeaders bool

// SetTrustProxy tells the server an authenticated reverse proxy sits in front
// (DEPLOY_PLAN.md D1). Call once at startup, before serving.
func SetTrustProxy(v bool) { trustProxyHeaders = v }

// bearerAuth rejects any request whose bearer token (Authorization header, or
// `?token=` query param for EventSource which cannot set headers) does not match
// the per-launch token. Uses a constant-time compare.
func bearerAuth(token string) func(http.Handler) http.Handler {
	want := []byte(token)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			got := ""
			if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
				got = strings.TrimPrefix(h, "Bearer ")
			} else if q := r.URL.Query().Get("token"); q != "" {
				got = q
			}
			if subtle.ConstantTimeCompare([]byte(got), want) != 1 {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// --- multi-user mode (USER_MANAGEMENT_PLAN.md U0) --------------------

type ctxKey int

const userKey ctxKey = 0

// UserFrom returns the authenticated user attached by sessionAuth, or nil in
// single-user mode.
func UserFrom(ctx context.Context) *auth.User {
	u, _ := ctx.Value(userKey).(*auth.User)
	return u
}

// bearerToken pulls the credential from the Authorization header or the
// ?token= query param (EventSource can't set headers).
func bearerToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	return r.URL.Query().Get("token")
}

// authExempt is the set of paths reachable without a session.
func authExempt(p string) bool {
	switch p {
	case "/api/v1/health", "/api/v1/auth/login", "/api/v1/auth/bootstrap", "/api/v1/auth/setup-status":
		return true
	}
	return false
}

// sessionAuth replaces bearerAuth when --auth on: every request outside
// authExempt needs a valid session token; the user is put on the context.
func sessionAuth(svc *auth.Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodOptions || authExempt(r.URL.Path) {
				next.ServeHTTP(w, r)
				return
			}
			u, err := svc.Validate(bearerToken(r))
			if err != nil || u == nil {
				apierr.Write(w, apierr.Auth("session invalid or expired"))
				return
			}
			ctx := context.WithValue(r.Context(), userKey, u)
			ctx = userctx.With(ctx, u.ID) // low-level packages scope per user off this
			ctx = userctx.WithRole(ctx, string(u.Role))
			ctx = userctx.WithName(ctx, u.Username)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// moduleOf maps a request path to the rail module that owns it, or "" for
// cross-cutting / ungated endpoints.
func moduleOf(path string) string {
	p := strings.TrimPrefix(path, "/api/v1")
	switch {
	case strings.HasPrefix(p, "/llm") || strings.HasPrefix(p, "/mcp"):
		return "ai"
	case strings.HasPrefix(p, "/prompts"):
		return "prompt"
	case strings.HasPrefix(p, "/ansible"):
		return "ansible"
	case strings.HasPrefix(p, "/runbooks") || strings.HasPrefix(p, "/runs") ||
		strings.HasPrefix(p, "/ssh-nodes") || strings.HasPrefix(p, "/runbook-") ||
		strings.HasPrefix(p, "/packages") || strings.HasPrefix(p, "/library"):
		return "runbook"
	case strings.HasPrefix(p, "/sntp"), strings.HasPrefix(p, "/whois"), strings.HasPrefix(p, "/dns-lookup"),
		strings.HasPrefix(p, "/ip-geolocation"), strings.HasPrefix(p, "/connections"),
		strings.HasPrefix(p, "/wake-on-lan"), strings.HasPrefix(p, "/port-scanner"),
		strings.HasPrefix(p, "/ping-monitor"), strings.HasPrefix(p, "/traceroute"),
		strings.HasPrefix(p, "/network-scanner"), strings.HasPrefix(p, "/snmp"),
		strings.HasPrefix(p, "/neighbor-table"), strings.HasPrefix(p, "/hosts"),
		strings.HasPrefix(p, "/firewall"), strings.HasPrefix(p, "/iperf3"),
		strings.HasPrefix(p, "/discovery"), strings.HasPrefix(p, "/interfaces"):
		return "network"
	}
	return ""
}

// accessGuard enforces role write-access and per-user module access. It runs
// after sessionAuth, so a nil user here means single-user mode → allow.
func accessGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := UserFrom(r.Context())
		if u == nil {
			next.ServeHTTP(w, r)
			return
		}
		writing := r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions
		if writing && !u.Role.CanWrite() &&
			!strings.HasPrefix(r.URL.Path, "/api/v1/auth/") &&
			r.URL.Path != "/api/v1/settings/user" {
			apierr.Write(w, apierr.Permission("your role is read-only"))
			return
		}
		if mod := moduleOf(r.URL.Path); mod != "" && u.AllowedModules != nil {
			allowed := false
			for _, m := range u.AllowedModules {
				if m == mod {
					allowed = true
					break
				}
			}
			if !allowed {
				apierr.Write(w, apierr.Permission("the "+mod+" module is not enabled for your account"))
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// cors allows the known app origins (and same-origin / non-browser callers that
// send no Origin header) and answers preflight requests. `extra` are additional
// origins configured with --cors-origin.
func cors(extra []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" && (sameOrigin(origin, r) || originAllowed(origin, extra)) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Expose-Headers", "X-Pdf-Bytes-In, X-Pdf-Bytes-Out")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// activity calls onActivity once per request so the caller's idle watchdog can
// reset its timer. A nil callback is a no-op.
func activity(onActivity func()) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if onActivity != nil {
				onActivity()
			}
			next.ServeHTTP(w, r)
		})
	}
}
