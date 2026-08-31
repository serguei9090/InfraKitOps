package server

import (
	"crypto/subtle"
	"net/http"
	"net/url"
	"strings"
)

// tauriOrigins are the exact browser origins the desktop webview reports.
var tauriOrigins = map[string]bool{
	"http://tauri.localhost":  true,
	"https://tauri.localhost": true,
	"tauri://localhost":       true,
}

// originAllowed permits the Tauri webview origins and any loopback origin (a
// dev Vite server on any port). The service binds 127.0.0.1 and every request
// still needs the bearer token, so loopback pages are not a real exposure.
func originAllowed(origin string) bool {
	if origin == "" {
		return true // non-browser / same-origin caller
	}
	if tauriOrigins[origin] {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	host := u.Hostname()
	return host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "::1"
}

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

// cors allows the known app origins (and same-origin / non-browser callers that
// send no Origin header) and answers preflight requests.
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && originAllowed(origin) {
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
