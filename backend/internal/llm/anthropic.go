package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<10))
		return nil, fmt.Errorf("GET /v1/models: %s: %s", resp.Status, bytes.TrimSpace(b))
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

func (p anthropicProvider) Chat(ctx context.Context, conn Connection, key string, cr ChatRequest, out chan<- Delta) (Usage, error) {
	// Split the system message out; Anthropic wants it as a top-level field.
	var system string
	msgs := make([]map[string]string, 0, len(cr.Messages))
	for _, m := range cr.Messages {
		if m.Role == "system" {
			if system != "" {
				system += "\n\n"
			}
			system += m.Content
			continue
		}
		msgs = append(msgs, map[string]string{"role": m.Role, "content": m.Content})
	}

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
		payload["system"] = system
	}
	if cr.Temperature != nil {
		payload["temperature"] = *cr.Temperature
	}
	raw, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL(conn)+"/v1/messages", bytes.NewReader(raw))
	if err != nil {
		return Usage{}, err
	}
	p.headers(req, key)
	req.Header.Set("accept", "text/event-stream")
	resp, err := httpClient.Do(req)
	if err != nil {
		return Usage{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		return Usage{}, fmt.Errorf("POST /v1/messages: %s: %s", resp.Status, bytes.TrimSpace(b))
	}

	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 4<<20)
	var usage Usage
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		var ev struct {
			Type  string `json:"type"`
			Delta struct {
				Text string `json:"text"`
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
		case "content_block_delta":
			if ev.Delta.Text != "" {
				out <- Delta{Text: ev.Delta.Text}
			}
		case "message_start":
			usage.PromptTokens = ev.Message.Usage.InputTokens
		case "message_delta":
			if ev.Usage.OutputTokens > 0 {
				usage.CompletionTokens = ev.Usage.OutputTokens
			}
		case "message_stop":
			out <- Delta{Done: true}
			return usage, nil
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
