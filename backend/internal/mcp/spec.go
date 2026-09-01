// Package mcp is InfraKit's Model Context Protocol client layer: a registry of
// user-configured MCP servers and a manager that connects to them (stdio or
// streamable HTTP), lists their tools, and calls them. The LLM engine uses it
// in A4b to let a model call tools mid-answer. See AI_MCP_PLAN.md.
package mcp

import (
	"context"
	"errors"
)

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

// --- resources & prompts (A4f) ------------------------------------------
// See MCP_RESOURCES_PROMPTS_PLAN.md. Resources are user-attached context;
// prompts are server-authored templates. Neither is model-invoked.

// ResourceSpec is a concrete resource discovered on a server.
type ResourceSpec struct {
	Server      string `json:"server"`
	ServerName  string `json:"serverName"`
	URI         string `json:"uri"`
	Name        string `json:"name"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	MIMEType    string `json:"mimeType,omitempty"`
	Size        int64  `json:"size,omitempty"`
}

// ResourceTemplateSpec is a URI-templated resource (e.g. file:///{path}).
type ResourceTemplateSpec struct {
	Server      string `json:"server"`
	ServerName  string `json:"serverName"`
	URITemplate string `json:"uriTemplate"`
	Name        string `json:"name"`
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	MIMEType    string `json:"mimeType,omitempty"`
}

// ResourceContent is one sub-resource returned by resources/read (text only).
type ResourceContent struct {
	URI      string `json:"uri"`
	MIMEType string `json:"mimeType,omitempty"`
	Text     string `json:"text"`
}

// ResourceRead is the flattened outcome of resources/read.
type ResourceRead struct {
	Contents  []ResourceContent `json:"contents"`
	Truncated bool              `json:"truncated,omitempty"`
}

// PromptArgSpec describes one templated argument of a prompt.
type PromptArgSpec struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Required    bool   `json:"required,omitempty"`
}

// PromptSpec is a prompt template discovered on a server.
type PromptSpec struct {
	Server      string          `json:"server"`
	ServerName  string          `json:"serverName"`
	Name        string          `json:"name"`
	Title       string          `json:"title,omitempty"`
	Description string          `json:"description,omitempty"`
	Arguments   []PromptArgSpec `json:"arguments,omitempty"`
}

// PromptMessage is one message of a rendered prompt (text flattened).
type PromptMessage struct {
	Role string `json:"role"`
	Text string `json:"text"`
}

// PromptResult is the flattened outcome of prompts/get.
type PromptResult struct {
	Description string          `json:"description,omitempty"`
	Messages    []PromptMessage `json:"messages"`
}

// maxResultBytes caps a tool result so a chatty tool can't blow the model
// context or the SSE. See AI_MCP_PLAN.md §3.1.
const maxResultBytes = 32 << 10

// SecretResolver pulls secret material from the calling user's Vault (the
// user is carried on ctx — see internal/userctx). *vault.Registry.Resolver()
// satisfies it.
type SecretResolver interface {
	Resolve(ctx context.Context, id string) (string, error)
	ResolveByName(ctx context.Context, name string) (string, error)
}
