package obs

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/userctx"
)

// Recoverer catches a panic in a downstream handler, logs it with the request
// id + stack, and returns a coded 500. Replaces chi's middleware.Recoverer so
// the report goes through slog.
func Recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				if rec == http.ErrAbortHandler { //nolint:errorlint // sentinel compare per net/http
					panic(rec)
				}
				slog.Error("panic in handler",
					"err", rec,
					"req_id", chimw.GetReqID(r.Context()),
					"method", r.Method,
					"path", r.URL.Path,
					"stack", string(debug.Stack()),
				)
				reportWebhook("error", "panic in handler", r, rec)
				if !headerWritten(w) {
					apierr.Write(w, apierr.Internal("panic"))
				}
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// AccessLog logs one line per request. trustProxy → believe X-Forwarded-For
// for the client ip.
func AccessLog(trustProxy bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)
			inFlight.Add(1)
			defer inFlight.Add(-1)

			stream := strings.HasSuffix(r.URL.Path, "/stream")
			if stream {
				slog.Info("request:stream-open",
					"req_id", chimw.GetReqID(r.Context()),
					"method", r.Method, "path", r.URL.Path,
					"ip", clientIP(r, trustProxy),
				)
			}

			next.ServeHTTP(ww, r)

			dur := time.Since(start)
			status := ww.Status()
			if status == 0 {
				status = http.StatusOK
			}
			recordRequest(r.Method, status, dur)

			lvl := slog.LevelInfo
			if status >= 500 {
				lvl = slog.LevelError
			} else if status >= 400 {
				lvl = slog.LevelWarn
			}
			slog.LogAttrs(context.Background(), lvl, "request",
				slog.String("req_id", chimw.GetReqID(r.Context())),
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", status),
				slog.Int("bytes", ww.BytesWritten()),
				slog.Int64("dur_ms", dur.Milliseconds()),
				slog.String("ip", clientIP(r, trustProxy)),
				slog.String("user", userctx.From(r.Context())),
			)
		})
	}
}

func clientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			return strings.TrimSpace(strings.SplitN(xff, ",", 2)[0])
		}
		if xrip := r.Header.Get("X-Real-Ip"); xrip != "" {
			return xrip
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// headerWritten reports whether the response already committed a status —
// chi's wrapped writer exposes this; a bare ResponseWriter does not, so we
// conservatively say false (write the 500).
func headerWritten(w http.ResponseWriter) bool {
	if ww, ok := w.(interface{ Status() int }); ok {
		return ww.Status() != 0
	}
	return false
}
