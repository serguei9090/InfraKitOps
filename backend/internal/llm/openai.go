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

// openAICompatibleProvider talks to any OpenAI-shaped API: GET /v1/models,
// POST /v1/chat/completions with "stream": true (SSE `data:` lines, `[DONE]`
// sentinel). Covers OpenAI, LM Studio, vLLM, LocalAI, OpenRouter, Groq, … —
// the differentiator is the connection's BaseURL and key.
type openAICompatibleProvider struct{}

func (openAICompatibleProvider) Kind() ProviderKind { return ProviderOpenAICompatible }
func (openAICompatibleProvider) KeylessOK() bool    { return true } // LM Studio etc. often need no key

func (openAICompatibleProvider) ListModels(ctx context.Context, conn Connection, key string) ([]Model, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL(conn)+"/v1/models", nil)
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
		return nil, httpErr("openai-compatible", resp)
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

func (openAICompatibleProvider) Chat(ctx context.Context, conn Connection, key string, cr ChatRequest, out chan<- Delta) (Usage, error) {
	payload := map[string]any{
		"model":         cr.Model,
		"messages":      cr.Messages,
		"stream":        true,
		"stream_options": map[string]any{"include_usage": true},
	}
	if cr.Temperature != nil {
		payload["temperature"] = *cr.Temperature
	}
	if cr.MaxTokens > 0 {
		payload["max_tokens"] = cr.MaxTokens
	}
	raw, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL(conn)+"/v1/chat/completions", bytes.NewReader(raw))
	if err != nil {
		return Usage{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return Usage{}, netErr(err, nil)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Usage{}, httpErr("openai-compatible", resp)
	}

	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 4<<20)
	var usage Usage
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			out <- Delta{Done: true}
			return usage, nil
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
			Usage *struct {
				PromptTokens     int `json:"prompt_tokens"`
				CompletionTokens int `json:"completion_tokens"`
			} `json:"usage"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if chunk.Usage != nil {
			usage = Usage{PromptTokens: chunk.Usage.PromptTokens, CompletionTokens: chunk.Usage.CompletionTokens}
		}
		for _, c := range chunk.Choices {
			if c.Delta.Content != "" {
				out <- Delta{Text: c.Delta.Content}
			}
		}
	}
	if err := sc.Err(); err != nil {
		if m := contextErr(ctx); m != "" {
			return usage, fmt.Errorf("%s", m)
		}
		return usage, err
	}
	return usage, nil
}
