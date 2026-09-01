package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// anthropicProvider talks to the Anthropic Messages API: GET /v1/models,
// POST /v1/messages with "stream": true. `system` is a top-level field, not a
// message role; `max_tokens` is required.
type anthropicProvider struct{}

const anthropicVersion = "2023-06-01"

func (anthropicProvider) Kind() ProviderKind { return ProviderAnthropic }
func (anthropicProvider) KeylessOK() bool    { return false }

func (anthropicProvider) headers(req *http.Request, key string) {
	req.Header.Set("x-api-key", key)
	req.Header.Set("anthropic-version", anthropicVersion)
	req.Header.Set("content-type", "application/json")
}

func (p anthropicProvider) ListModels(ctx context.Context, conn Connection, key string) ([]Model, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL(conn)+"/v1/models", nil)
	if err != nil {
		return nil, err
	}
	p.headers(req, key)
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, netErr(err, nil)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, httpErr("anthropic", resp)
	}
	var body struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	out := make([]Model, 0, len(body.Data))
	for _, m := range body.Data {
		out = append(out, Model{ID: m.ID})
	}
	return out, nil
}

// anthropicMessages splits the system prompt out (top-level field) and maps
// the rest, using content-block arrays for tool_use / tool_result turns.
func anthropicMessages(all []ChatMessage) (system string, msgs []map[string]any) {
	for _, m := range all {
		switch {
		case m.Role == "system":
			if system != "" {
				system += "\n\n"
			}
			system += m.Content

		case m.Role == "tool":
			msgs = append(msgs, map[string]any{
				"role": "user",
				"content": []map[string]any{
					{"type": "tool_result", "tool_use_id": m.ToolCallID, "content": m.Content},
				},
			})

		case len(m.ToolCalls) > 0:
			blocks := []map[string]any{}
			if m.Content != "" {
				blocks = append(blocks, map[string]any{"type": "text", "text": m.Content})
			}
			for _, c := range m.ToolCalls {
				args := c.Args
				if args == nil {
					args = map[string]any{}
				}
				blocks = append(blocks, map[string]any{"type": "tool_use", "id": c.ID, "name": c.Name, "input": args})
			}
			msgs = append(msgs, map[string]any{"role": "assistant", "content": blocks})

		default:
			msgs = append(msgs, map[string]any{"role": m.Role, "content": m.Content})
		}
	}
	return system, msgs
}

func anthropicTools(defs []ToolDef) []map[string]any {
	out := make([]map[string]any, len(defs))
	for i, d := range defs {
		schema := d.Parameters
		if schema == nil {
			schema = map[string]any{"type": "object", "properties": map[string]any{}}
		}
		out[i] = map[string]any{"name": d.Name, "description": d.Description, "input_schema": schema}
	}
	return out
}

func (p anthropicProvider) Chat(ctx context.Context, conn Connection, key string, cr ChatRequest, out chan<- Delta) (ChatResult, error) {
	system, msgs := anthropicMessages(cr.Messages)

	maxTokens := cr.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 4096
	}
	payload := map[string]any{
		"model":      cr.Model,
		"messages":   msgs,
		"max_tokens": maxTokens,
		"stream":     true,
	}
	if system != "" {
		// A3e: cache the system block for a long task template — Anthropic
		// prompt caching cuts latency/cost on repeated runs. Only worth it past
		// ~1k tokens (~4k chars); a short prompt stays a plain string.
		if len(system) >= 4000 {
			payload["system"] = []map[string]any{
				{"type": "text", "text": system, "cache_control": map[string]any{"type": "ephemeral"}},
			}
		} else {
			payload["system"] = system
		}
	}
	if cr.Temperature != nil {
		payload["temperature"] = *cr.Temperature
	}
	if hasTools(cr) {
		payload["tools"] = anthropicTools(cr.Tools)
	}
	raw, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL(conn)+"/v1/messages", bytes.NewReader(raw))
	if err != nil {
		return ChatResult{}, err
	}
	p.headers(req, key)
	req.Header.Set("accept", "text/event-stream")
	resp, err := httpClient.Do(req)
	if err != nil {
		return ChatResult{}, netErr(err, nil)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ChatResult{}, httpErr("anthropic", resp)
	}

	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 4<<20)
	var usage Usage
	var calls []ToolCall
	// tool_use blocks arrive as start(id,name) → input_json_delta(partial) … → stop
	cur := struct {
		active     bool
		id, name   string
		argBuilder strings.Builder
	}{}
	flush := func() {
		if cur.active && cur.name != "" {
			calls = append(calls, ToolCall{ID: cur.id, Name: cur.name, Args: parseArgs(cur.argBuilder.String())})
		}
		cur.active, cur.id, cur.name = false, "", ""
		cur.argBuilder.Reset()
	}

	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		var ev struct {
			Type         string `json:"type"`
			ContentBlock struct {
				Type string `json:"type"`
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"content_block"`
			Delta struct {
				Type        string `json:"type"`
				Text        string `json:"text"`
				PartialJSON string `json:"partial_json"`
			} `json:"delta"`
			Message struct {
				Usage struct {
					InputTokens  int `json:"input_tokens"`
					OutputTokens int `json:"output_tokens"`
				} `json:"usage"`
			} `json:"message"`
			Usage struct {
				OutputTokens int `json:"output_tokens"`
			} `json:"usage"`
		}
		if err := json.Unmarshal([]byte(data), &ev); err != nil {
			continue
		}
		switch ev.Type {
		case "content_block_start":
			if ev.ContentBlock.Type == "tool_use" {
				flush()
				cur.active, cur.id, cur.name = true, ev.ContentBlock.ID, ev.ContentBlock.Name
			}
		case "content_block_delta":
			if ev.Delta.Text != "" {
				out <- Delta{Text: ev.Delta.Text}
			}
			if ev.Delta.Type == "input_json_delta" {
				cur.argBuilder.WriteString(ev.Delta.PartialJSON)
			}
		case "content_block_stop":
			flush()
		case "message_start":
			usage.PromptTokens = ev.Message.Usage.InputTokens
		case "message_delta":
			if ev.Usage.OutputTokens > 0 {
				usage.CompletionTokens = ev.Usage.OutputTokens
			}
		case "message_stop":
			flush()
			out <- Delta{Done: true}
			return ChatResult{Usage: usage, ToolCalls: calls}, nil
		}
	}
	flush()
	if err := sc.Err(); err != nil {
		if m := contextErr(ctx); m != "" {
			return ChatResult{Usage: usage}, fmt.Errorf("%s", m)
		}
		return ChatResult{Usage: usage}, err
	}
	return ChatResult{Usage: usage, ToolCalls: calls}, nil
}
