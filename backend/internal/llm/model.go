// Package llm is the central LLM layer every module uses instead of wiring its
// own AI. A0 scope: provider adapters (ollama, openai-compatible), a Connection
// registry in llm.db, live model listing, and a streamed chat engine. Grounded
// Tasks land in A1. See AI_MODULE_PLAN.md.
package llm

// ProviderKind identifies an API shape.
type ProviderKind string

const (
	ProviderOllama           ProviderKind = "ollama"
	ProviderOpenAICompatible ProviderKind = "openai-compatible"
	ProviderAnthropic        ProviderKind = "anthropic" // A2
	ProviderGemini           ProviderKind = "gemini"    // A2
)

// Connection is a configured endpoint the user sets up once. It carries no
// secret material — only a reference to a Vault secret id for the API key.
type Connection struct {
	ID           string       `json:"id"`
	Name         string       `json:"name"`
	Provider     ProviderKind `json:"provider"`
	BaseURL      string       `json:"baseUrl"`               // "" → provider default
	AuthSecretID string       `json:"authSecretId,omitempty"` // Vault secret id; blank for keyless local providers
	DefaultModel string       `json:"defaultModel,omitempty"`
	CreatedAt    int64        `json:"createdAt"`
}

// Model is one model id available at a connection.
type Model struct {
	ID string `json:"id"`
}

// ChatMessage is one turn.
type ChatMessage struct {
	Role    string `json:"role"` // "system" | "user" | "assistant" | "tool"
	Content string `json:"content"`

	// Tool use (A4b). ToolCalls is set on an assistant turn that requested
	// tools; ToolCallID + Name identify which call a "tool" turn answers.
	ToolCalls  []ToolCall `json:"toolCalls,omitempty"`
	ToolCallID string     `json:"toolCallId,omitempty"`
	Name       string     `json:"name,omitempty"`
}

// ToolDef is a tool offered to the model. Name is the qualified MCP name
// ("<serverId>__<tool>"); Parameters is a JSON-Schema object.
type ToolDef struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Parameters  any    `json:"parameters"`
	// ReadOnly mirrors the MCP annotations.readOnlyHint — a read-only tool
	// runs without asking; anything else pauses for approval (A4c).
	ReadOnly bool `json:"readOnly"`
}

// ToolCall is a tool invocation the model asked for.
type ToolCall struct {
	ID   string         `json:"id"`
	Name string         `json:"name"`
	Args map[string]any `json:"args"`
}

// ChatRequest is a resolved completion request (connection + key already picked).
type ChatRequest struct {
	Model       string        `json:"model"`
	Messages    []ChatMessage `json:"messages"`
	Temperature *float64      `json:"temperature,omitempty"`
	MaxTokens   int           `json:"maxTokens,omitempty"`
	Tools       []ToolDef     `json:"tools,omitempty"`
}

// Delta is one streamed chunk from a provider.
type Delta struct {
	Text string
	Done bool
}

// ChatResult is what a provider's Chat returns after the stream ends.
type ChatResult struct {
	Usage Usage
	// ToolCalls is non-empty when the model stopped to call tools rather than
	// finishing its answer — the engine runs them and calls Chat again.
	ToolCalls []ToolCall
}

// Usage is the token accounting a provider reports at the end of a stream.
type Usage struct {
	PromptTokens     int `json:"promptTokens"`
	CompletionTokens int `json:"completionTokens"`
}

// defaultBaseURL for a provider when the connection leaves BaseURL blank.
func defaultBaseURL(k ProviderKind) string {
	switch k {
	case ProviderOllama:
		return "http://localhost:11434"
	case ProviderOpenAICompatible:
		return "https://api.openai.com"
	case ProviderAnthropic:
		return "https://api.anthropic.com"
	case ProviderGemini:
		return "https://generativelanguage.googleapis.com"
	default:
		return ""
	}
}
