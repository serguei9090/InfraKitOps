// Package sse writes Server-Sent Event streams for the long-running Network
// Toolkit tools (ping monitor, traceroute, scans). See NETWORK_MODULE_PLAN.md
// §2.1. Events are funnelled through a channel to a single writer so tool code
// can emit from many goroutines safely.
package sse

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Message is one SSE event: a name and a JSON-serialisable payload.
type Message struct {
	Event string
	Data  any
}

// Writer holds a flushable HTTP response set up for text/event-stream.
type Writer struct {
	w       http.ResponseWriter
	flusher http.Flusher
}

// New sets the SSE headers and returns a Writer, or an error (already written to
// the client) if streaming is unsupported.
func New(w http.ResponseWriter) (*Writer, error) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return nil, fmt.Errorf("response writer is not a Flusher")
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()
	return &Writer{w: w, flusher: flusher}, nil
}

// Reject sends a one-line SSE `error` event and closes — for validation errors
// discovered before the stream proper begins. Falls back to a plain 400 if the
// stream can't be opened.
func Reject(w http.ResponseWriter, msg string) {
	RejectCoded(w, "", msg, "")
}

// RejectCoded is Reject with a classification code + hint (see internal/apierr).
func RejectCoded(w http.ResponseWriter, code, msg, hint string) {
	sw, err := New(w)
	if err != nil {
		http.Error(w, msg, http.StatusBadRequest)
		return
	}
	d := map[string]string{"error": msg}
	if code != "" {
		d["code"] = code
	}
	if hint != "" {
		d["hint"] = hint
	}
	_ = sw.send(Message{Event: "error", Data: d})
}

// Pump drains msgs, writing each as an SSE event, until the channel closes or
// ctx is cancelled (client disconnected). Sends a keep-alive comment every 15s.
func (s *Writer) Pump(ctx context.Context, msgs <-chan Message) {
	ka := time.NewTicker(15 * time.Second)
	defer ka.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case m, ok := <-msgs:
			if !ok {
				return
			}
			if err := s.send(m); err != nil {
				return
			}
		case <-ka.C:
			if _, err := fmt.Fprint(s.w, ": keep-alive\n\n"); err != nil {
				return
			}
			s.flusher.Flush()
		}
	}
}

func (s *Writer) send(m Message) error {
	payload, err := json.Marshal(m.Data)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(s.w, "event: %s\ndata: %s\n\n", m.Event, payload); err != nil {
		return err
	}
	s.flusher.Flush()
	return nil
}
