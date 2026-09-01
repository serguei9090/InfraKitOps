package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/infrakit/backend/internal/apierr"
	"github.com/infrakit/backend/internal/mcp"
)

// MCPHandlers wires /mcp*. Nil Manager → every endpoint 503.
type MCPHandlers struct {
	Manager *mcp.Manager
}

func (h *MCPHandlers) guard(w http.ResponseWriter) bool {
	if h == nil || h.Manager == nil {
		WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "mcp layer unavailable"})
		return false
	}
	return true
}

func mcpErr(w http.ResponseWriter, err error) {
	var ae *apierr.Error
	switch {
	case errors.As(err, &ae):
		apierr.Write(w, ae)
	case errors.Is(err, mcp.ErrNotFound):
		apierr.Write(w, apierr.NotFound("no such MCP server"))
	default:
		apierr.Write(w, apierr.Validation(err.Error()))
	}
}

// ListServers: GET /mcp/servers
func (h *MCPHandlers) ListServers(w http.ResponseWriter, _ *http.Request) {
	if !h.guard(w) {
		return
	}
	list, err := h.Manager.Store().List()
	if err != nil {
		mcpErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"servers": list})
}

// PutServer: POST /mcp/servers  or  PUT /mcp/servers/{id}
func (h *MCPHandlers) PutServer(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	var c mcp.ServerConfig
	if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
		apierr.Write(w, apierr.Validation(err.Error()))
		return
	}
	if id := chi.URLParam(r, "id"); id != "" {
		c.ID = id
	}
	prevID := c.ID
	id, err := h.Manager.Store().Put(c)
	if err != nil {
		mcpErr(w, err)
		return
	}
	// drop any live session so the next connect picks up the new config
	if prevID != "" {
		h.Manager.Disconnect(prevID)
	}
	WriteJSON(w, http.StatusOK, map[string]string{"id": id})
}

// DeleteServer: DELETE /mcp/servers/{id}
func (h *MCPHandlers) DeleteServer(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	id := chi.URLParam(r, "id")
	h.Manager.Disconnect(id)
	if err := h.Manager.Store().Delete(id); err != nil {
		mcpErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// TestServer: POST /mcp/servers/{id}/test — connect and return the tool list.
func (h *MCPHandlers) TestServer(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 75*time.Second)
	defer cancel()
	h.Manager.Disconnect(chi.URLParam(r, "id")) // force a fresh connect
	tools, err := h.Manager.Connect(ctx, chi.URLParam(r, "id"))
	if err != nil {
		var ae *apierr.Error
		if errors.As(err, &ae) {
			WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": ae.Message, "code": ae.Code, "hint": ae.Hint})
			return
		}
		WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "tools": tools})
}

// ListTools: GET /mcp/tools — aggregated across enabled servers.
func (h *MCPHandlers) ListTools(w http.ResponseWriter, r *http.Request) {
	if !h.guard(w) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 75*time.Second)
	defer cancel()
	tools, err := h.Manager.AggregateTools(ctx)
	if err != nil {
		mcpErr(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"tools": tools})
}
