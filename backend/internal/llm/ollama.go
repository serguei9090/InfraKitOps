package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ollama /api/tags: %s", resp.Status)
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

func (ollamaProvider) Chat(ctx context.Context, conn Connection, key string, cr ChatRequest, out chan<- Delta) (Usage, error) {
	payload := map[string]any{
		"model":    cr.Model,
		"messages": cr.Messages,
		"stream":   true,
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
		return Usage{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return Usage{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<10))
		return Usage{}, fmt.Errorf("ollama /api/chat: %s: %s", resp.Status, bytes.TrimSpace(b))
	}

	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 4<<20)
	var usage Usage
	for sc.Scan() {
		line := bytes.TrimSpace(sc.Bytes())
		if len(line) == 0 {
			continue
		}
		var chunk struct {
			Message struct {
				Content string `json:"content"`
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
		if chunk.Done {
			usage = Usage{PromptTokens: chunk.PromptEvalCount, CompletionTokens: chunk.EvalCount}
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
