package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/envelope"
	"github.com/infrakit/backend/internal/tools/iperf"
)

type iperfRequest struct {
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Duration  int    `json:"duration"`
	Reverse   bool   `json:"reverse"`
	Bidir     bool   `json:"bidir"`
	UDP       bool   `json:"udp"`
	Parallel  int    `json:"parallel"`
	Omit      int    `json:"omit"`
	MSS       int    `json:"mss"`
	Length    int    `json:"length"`
	Window    int    `json:"window"`
	Bitrate   string `json:"bitrate"`
	ExtraArgs string `json:"extraArgs"`
}

// Iperf3: POST /iperf3 — throughput test. resultShape "scalar_series" (per-interval Mbps).
func Iperf3(w http.ResponseWriter, r *http.Request) {
	var req iperfRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	if strings.TrimSpace(req.Host) == "" {
		apierr.Write(w, apierr.Validation("a server host is required"))
		return
	}

	started := time.Now()
	result, err := iperf.Run(r.Context(), iperf.Options{
		Host: strings.TrimSpace(req.Host), Port: req.Port, Duration: req.Duration,
		Reverse: req.Reverse, Bidir: req.Bidir, UDP: req.UDP,
		Parallel: req.Parallel, Omit: req.Omit,
		MSS: req.MSS, Length: req.Length, Window: req.Window, Bitrate: req.Bitrate,
		ExtraArgs: strings.Fields(req.ExtraArgs),
	})
	if errors.Is(err, iperf.ErrNotInstalled) {
		WriteJSON(w, http.StatusServiceUnavailable, map[string]any{"error": err.Error(), "notInstalled": true})
		return
	}

	status := envelope.StatusOK
	if !result.OK {
		status = envelope.StatusError
	}
	avgMbps := result.Stats.Avg
	env := envelope.Envelope{
		Tool:       "iperf3",
		Target:     strings.TrimSpace(req.Host),
		StartedAt:  started.UnixMilli(),
		FinishedAt: time.Now().UnixMilli(),
		Status:     status,
		Params: map[string]any{
			"host": req.Host, "reverse": req.Reverse, "udp": req.UDP,
			"mss": req.MSS, "length": req.Length,
		},
		ResultShape: envelope.ShapeScalarSeries,
		Result: map[string]any{
			"v": 1, "unit": "Mbit/s", "samples": result.Samples,
			"stats": map[string]any{
				"min": result.Stats.Min, "avg": result.Stats.Avg, "p50": result.Stats.P50,
				"p95": result.Stats.P95, "max": result.Stats.Max,
			},
			"detail": result,
		},
		Summary: map[string]any{"avgMbps": avgMbps, "protocol": result.Protocol, "reverse": result.Reverse},
	}
	WriteJSON(w, http.StatusOK, map[string]any{"envelope": env})
}

// Iperf3Server: GET returns { running, port }; POST { running: bool, port? }
// starts / stops the managed local `iperf3 -s`.
func Iperf3Server(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		running, port := iperf.ServerStatus()
		WriteJSON(w, http.StatusOK, map[string]any{"running": running, "port": port})
		return
	}
	var body struct {
		Running bool `json:"running"`
		Port    int  `json:"port"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Running {
		if err := iperf.StartServer(body.Port); err != nil {
			if errors.Is(err, iperf.ErrNotInstalled) {
				WriteJSON(w, http.StatusServiceUnavailable, map[string]any{"error": err.Error(), "notInstalled": true})
				return
			}
			apierr.Write(w, apierr.Internal(err.Error()))
			return
		}
	} else {
		iperf.StopServer()
	}
	running, port := iperf.ServerStatus()
	WriteJSON(w, http.StatusOK, map[string]any{"running": running, "port": port})
}
