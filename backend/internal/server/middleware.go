package server

import (
	"crypto/subtle"
	"net/http"
	"strings"
)

// allowedOrigins are the exact browser origins permitted to call the API. The
// Tauri webview reports one of the tauri.* origins; a dev web build runs on the
// Vite port. Anything else (a random web page probing localhost) is refused.
var allowedOrigins = map[string]bool{
	"http://tauri.localhost":  true,
	"https://tauri.localhost": true,
	"tauri://localhost":       true,
	"http://localhost:1420":   true,
	"http://127.0.0.1:1420":   true,
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
		if origin != "" && allowedOrigins[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
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
