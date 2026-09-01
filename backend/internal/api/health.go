// Package api holds the HTTP handlers for each backend endpoint. Handlers are
// grouped by concern and wired into the router by internal/server.
package api

import (
	"encoding/json"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"time"

	"github.com/infrakit/backend/internal/privilege"
)

// Version is the backend build version, overridden at build time via
// -ldflags "-X github.com/infrakit/backend/internal/api.Version=...".
var Version = "dev"

// AuthMode is "off" (single-user, static bearer token) or "on" (multi-user
// sessions). Set once by internal/server at startup. The frontend reads it
// from /health to decide whether to show the login layer.
var AuthMode = "off"

var startedAt = time.Now()

// hostname is this machine's name, used as the history "target" for
// host-scoped tools (connections, interfaces).
func hostname() string {
	if h, err := os.Hostname(); err == nil {
		return h
	}
	return "localhost"
}

// atoiOr parses s as an int, returning def on any failure.
func atoiOr(s string, def int) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}

// WriteJSON is the shared JSON responder used by every handler in this package.
func WriteJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

type healthResponse struct {
	Status    string `json:"status"`
	Version   string `json:"version"`
	PID       int    `json:"pid"`
	UptimeSec int64  `json:"uptimeSec"`
	Elevated  bool   `json:"elevated"`
	OS        string `json:"os"`
	AuthMode  string `json:"authMode"`
}

// Health reports liveness plus the facts the frontend needs to decide which
// tools to enable (privilege level, platform).
func Health(w http.ResponseWriter, _ *http.Request) {
	WriteJSON(w, http.StatusOK, healthResponse{
		Status:    "ok",
		Version:   Version,
		PID:       os.Getpid(),
		UptimeSec: int64(time.Since(startedAt).Seconds()),
		Elevated:  privilege.IsElevated(),
		OS:        runtime.GOOS,
		AuthMode:  AuthMode,
	})
}
