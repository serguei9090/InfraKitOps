// Package obs is the backend's observability layer (OBSERVABILITY_PLAN.md):
// structured logging via log/slog, an access-log + panic-recovery middleware,
// and a dependency-free Prometheus /metrics endpoint.
//
// Nothing here pulls a new dependency — slog is stdlib, chi is already
// vendored, and the metrics are hand-rolled text exposition.
package obs

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
)

// Setup configures the process-wide slog default logger and returns it.
//
//	format: "text" (default, human-readable) or "json"
//	level:  "debug" | "info" (default) | "warn" | "error"
func Setup(w io.Writer, format, level string) *slog.Logger {
	if w == nil {
		w = os.Stderr
	}
	opts := &slog.HandlerOptions{Level: parseLevel(level)}
	var h slog.Handler
	if strings.EqualFold(format, "json") {
		h = slog.NewJSONHandler(w, opts)
	} else {
		h = slog.NewTextHandler(w, opts)
	}
	l := slog.New(h)
	slog.SetDefault(l)
	return l
}

func parseLevel(s string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// printf-style bridges over slog — a drop-in for the stdlib `log` calls that
// were scattered through main.go. Prefer slog's structured form for new code.

func Infof(format string, args ...any)  { slog.Info(fmt.Sprintf(format, args...)) }
func Warnf(format string, args ...any)  { slog.Warn(fmt.Sprintf(format, args...)) }
func Errorf(format string, args ...any) { slog.Error(fmt.Sprintf(format, args...)) }

// Fatal / Fatalf log at error level and exit non-zero (replace log.Fatal[f]).
func Fatal(args ...any) {
	slog.Error(fmt.Sprint(args...))
	os.Exit(1)
}
func Fatalf(format string, args ...any) {
	slog.Error(fmt.Sprintf(format, args...))
	os.Exit(1)
}
