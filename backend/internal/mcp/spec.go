// Package mcp is InfraKit's Model Context Protocol client layer: a registry of
// user-configured MCP servers and a manager that connects to them (stdio or
// streamable HTTP), lists their tools, and calls them. The LLM engine uses it
// in A4b to let a model call tools mid-answer. See AI_MCP_PLAN.md.
package mcp

import "errors"

// ErrNotFound is returned for an unknown server id.
var ErrNotFound = errors.New("not found")

// Transport is how the backend talks to a server.
type Transport string

const (
	TransportStdio Transport = "stdio" // spawn a subprocess, talk over stdin/stdout
	TransportHTTP  Transport = "http"  // connect to a streamable-HTTP endpoint
)

// ServerConfig is one configured MCP server (persisted in mcp_server).
type ServerConfig struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Transport Transport `json:"transport"`

	// stdio
	Command string            `json:"command,omitempty"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"` // values may hold {{secret:NAME}}

	// http
	URL          string `json:"url,omitempty"`
	AuthSecretID string `json:"authSecretId,omitempty"` // vault id → Bearer

	Enabled   bool     `json:"enabled"`
	ToolAllow []string `json:"toolAllow,omitempty"` // raw tool names; empty = all
	CreatedAt int64    `json:"createdAt"`
}

// Validate checks the config is runnable.
func (c *ServerConfig) Validate() error {
	if c.Name == "" {
		return errors.New("name is required")
	}
	switch c.Transport {
	case TransportStdio:
		if c.Command == "" {
			return errors.New("a stdio server needs a command")
		}
	case TransportHTTP:
		if c.URL == "" {
			return errors.New("an http server needs a url")
		}
	default:
		return errors.New("transport must be \"stdio\" or \"http\"")
	}
	return nil
}

// allowed reports whether a raw tool name passes the server's allowlist.
func (c *ServerConfig) allowed(tool string) bool {
	if len(c.ToolAllow) == 0 {
		return true
	}
	for _, t := range c.ToolAllow {
		if t == tool {
			return true
		}
	}
	return false
}

// ToolSpec is a tool discovered on a server, namespaced across servers.
type ToolSpec struct {
	Server        string `json:"server"`        // server id
	ServerName    string `json:"serverName"`    // server display name
	Name          string `json:"name"`          // raw tool name on the server
	QualifiedName string `json:"qualifiedName"` // "<serverId>__<name>" — what the model sees
	Title         string `json:"title,omitempty"`
	Description   string `json:"description,omitempty"`
	InputSchema   any    `json:"inputSchema,omitempty"` // JSON Schema (map[string]any from the server)
	ReadOnly      bool   `json:"readOnly"`              // annotations.readOnlyHint — auto-run when true
}

// ToolResult is the outcome of a tool call, flattened for the engine + SSE.
type ToolResult struct {
	Text      string `json:"text"`
	IsError   bool   `json:"isError"`
	Truncated bool   `json:"truncated,omitempty"`
}

// maxResultBytes caps a tool result so a chatty tool can't blow the model
// context or the SSE. See AI_MCP_PLAN.md §3.1.
const maxResultBytes = 32 << 10

// SecretResolver pulls secret material from the Vault. *vault.Vault satisfies it.
type SecretResolver interface {
	Resolve(id string) (string, error)
	ResolveByName(name string) (string, error)
}
