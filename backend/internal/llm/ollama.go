package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// ollamaProvider talks to a local Ollama runtime: GET /api/tags for models,
// POST /api/chat with "stream": true (newline-delimited JSON).
type ollamaProvider struct{}

func (ollamaProvider) Kind() ProviderKind { return ProviderOllama }
func (ollamaProvider) KeylessOK() bool    { return true }

func (ollamaProvider) ListModels(ctx context.Context, conn Connection, key string) ([]Model, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL(conn)+"/api/tags", nil)
	if err != nil {
		return nil, err
	}
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, netErr(err, nil)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, httpErr("ollama", resp)
	}
	var body struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	out := make([]Model, 0, len(body.Models))
	for _, m := range body.Models {
		out = append(out, Model{ID: m.Name})
	}
	return out, nil
}

func ollamaMessages(msgs []ChatMessage) []map[string]any {
	out := make([]map[string]any, 0, len(msgs))
	for _, m := range msgs {
		switch {
		case m.Role == "tool":
			e := map[string]any{"role": "tool", "content": m.Content}
			if m.Name != "" {
				e["tool_name"] = m.Name
			}
			out = append(out, e)
		case len(m.ToolCalls) > 0:
			calls := make([]map[string]any, len(m.ToolCalls))
			for i, c := range m.ToolCalls {
				calls[i] = map[string]any{"function": map[string]any{"name": c.Name, "arguments": c.Args}}
			}
			out = append(out, map[string]any{"role": "assistant", "content": m.Content, "tool_calls": calls})
		default:
			out = append(out, map[string]any{"role": m.Role, "content": m.Content})
		}
	}
	return out
}

func (ollamaProvider) Chat(ctx context.Context, conn Connection, key string, cr ChatRequest, out chan<- Delta) (ChatResult, error) {
	payload := map[string]any{
		"model":    cr.Model,
		"messages": ollamaMessages(cr.Messages),
		"stream":   true,
	}
	if hasTools(cr) {
		payload["tools"] = oaiTools(cr.Tools) // Ollama uses the OpenAI tool shape
	}
	opts := map[string]any{}
	if cr.Temperature != nil {
		opts["temperature"] = *cr.Temperature
	}
	if cr.MaxTokens > 0 {
		opts["num_predict"] = cr.MaxTokens
	}
	if len(opts) > 0 {
		payload["options"] = opts
	}
	raw, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL(conn)+"/api/chat", bytes.NewReader(raw))
	if err != nil {
		return ChatResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return ChatResult{}, netErr(err, nil)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ChatResult{}, httpErr("ollama", resp)
	}

	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 4<<20)
	var usage Usage
	var calls []ToolCall
	for sc.Scan() {
		line := bytes.TrimSpace(sc.Bytes())
		if len(line) == 0 {
			continue
		}
		var chunk struct {
			Message struct {
				Content   string `json:"content"`
				ToolCalls []struct {
					Function struct {
						Name      string         `json:"name"`
						Arguments map[string]any `json:"arguments"`
					} `json:"function"`
				} `json:"tool_calls"`
			} `json:"message"`
			Done            bool `json:"done"`
			PromptEvalCount int  `json:"prompt_eval_count"`
			EvalCount       int  `json:"eval_count"`
		}
		if err := json.Unmarshal(line, &chunk); err != nil {
			continue
		}
		if chunk.Message.Content != "" {
			out <- Delta{Text: chunk.Message.Content}
		}
		for i, t := range chunk.Message.ToolCalls {
			if t.Function.Name == "" {
				continue
			}
			calls = append(calls, ToolCall{
				ID:   fmt.Sprintf("call_%d", len(calls)+i),
				Name: t.Function.Name,
				Args: t.Function.Arguments,
			})
		}
		if chunk.Done {
			usage = Usage{PromptTokens: chunk.PromptEvalCount, CompletionTokens: chunk.EvalCount}
			out <- Delta{Done: true}
			return ChatResult{Usage: usage, ToolCalls: calls}, nil
		}
	}
	if err := sc.Err(); err != nil {
		if m := contextErr(ctx); m != "" {
			return ChatResult{Usage: usage}, fmt.Errorf("%s", m)
		}
		return ChatResult{Usage: usage}, err
	}
	return ChatResult{Usage: usage, ToolCalls: calls}, nil
}
