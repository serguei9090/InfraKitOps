package server

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// SSEWriter streams Server-Sent Events to a single client. Long-running tools
// (ping monitor, traceroute, scan progress) return one of these instead of a
// JSON body. See NETWORK_MODULE_PLAN.md §2.1.
type SSEWriter struct {
	w       http.ResponseWriter
	flusher http.Flusher
}

// NewSSEWriter sets the SSE headers and returns a writer, or an error if the
// underlying ResponseWriter cannot stream.
func NewSSEWriter(w http.ResponseWriter) (*SSEWriter, error) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return nil, fmt.Errorf("streaming unsupported by the response writer")
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()
	return &SSEWriter{w: w, flusher: flusher}, nil
}

// Event writes a named event with a JSON-encoded payload and flushes it.
func (s *SSEWriter) Event(name string, data any) error {
	payload, err := json.Marshal(data)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(s.w, "event: %s\ndata: %s\n\n", name, payload); err != nil {
		return err
	}
	s.flusher.Flush()
	return nil
}

// Comment writes an SSE comment line (": text"), used as a keep-alive ping.
func (s *SSEWriter) Comment(text string) error {
	if _, err := fmt.Fprintf(s.w, ": %s\n\n", text); err != nil {
		return err
	}
	s.flusher.Flush()
	return nil
}
