package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
)

// geminiProvider talks to the Google Generative Language API. The API key is a
// query parameter — assembled here, server-side, so it never lands in a client
// URL. Roles are user/model; the system prompt is `systemInstruction`.
type geminiProvider struct{}

func (geminiProvider) Kind() ProviderKind { return ProviderGemini }
func (geminiProvider) KeylessOK() bool    { return false }

// scrubKey removes the API key from an error string — Go's *url.Error embeds
// the full request URL, and Gemini carries the key as a query param, so a raw
// transport error would otherwise leak the key to the client.
func scrubKey(err error, key string) error {
	if err == nil || key == "" {
		return err
	}
	s := err.Error()
	s = strings.ReplaceAll(s, url.QueryEscape(key), "***")
	s = strings.ReplaceAll(s, key, "***")
	if s == err.Error() {
		return err
	}
	return fmt.Errorf("%s", s)
}

func (geminiProvider) ListModels(ctx context.Context, conn Connection, key string) ([]Model, error) {
	u := baseURL(conn) + "/v1beta/models?key=" + url.QueryEscape(key)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, scrubKey(err, key)
	}
	scrub := func(e error) error { return scrubKey(e, key) }
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, netErr(err, scrub)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, httpErr("gemini", resp)
	}
	var body struct {
		Models []struct {
			Name                       string   `json:"name"`
			SupportedGenerationMethods []string `json:"supportedGenerationMethods"`
		} `json:"models"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	out := make([]Model, 0, len(body.Models))
	for _, m := range body.Models {
		if !slices.Contains(m.SupportedGenerationMethods, "generateContent") {
			continue
		}
		out = append(out, Model{ID: strings.TrimPrefix(m.Name, "models/")})
	}
	return out, nil
}

// geminiUnsupportedSchemaKeys are JSON-Schema fields the Gemini
// `functionDeclarations[].parameters` grammar rejects (it takes a restricted
// OpenAPI 3.0 subset). MCP servers routinely emit `$schema` /
// `additionalProperties`, so strip them recursively.
var geminiUnsupportedSchemaKeys = map[string]bool{
	"$schema": true, "$id": true, "$ref": true, "$defs": true,
	"definitions": true, "additionalProperties": true, "patternProperties": true,
	"unevaluatedProperties": true, "$comment": true, "examples": true,
}

// geminiSchema deep-copies a JSON-Schema value, dropping keys Gemini rejects.
func geminiSchema(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, val := range t {
			if geminiUnsupportedSchemaKeys[k] {
				continue
			}
			out[k] = geminiSchema(val)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, val := range t {
			out[i] = geminiSchema(val)
		}
		return out
	default:
		return v
	}
}

func (geminiProvider) Chat(ctx context.Context, conn Connection, key string, cr ChatRequest, out chan<- Delta) (ChatResult, error) {
	var system string
	var contents []map[string]any
	for _, m := range cr.Messages {
		switch {
		case m.Role == "system":
			if system != "" {
				system += "\n\n"
			}
			system += m.Content

		case m.Role == "tool":
			var resp any
			if err := json.Unmarshal([]byte(m.Content), &resp); err != nil {
				resp = map[string]any{"result": m.Content}
			}
			contents = append(contents, map[string]any{
				"role": "user",
				"parts": []map[string]any{
					{"functionResponse": map[string]any{"name": m.Name, "response": map[string]any{"result": resp}}},
				},
			})

		case len(m.ToolCalls) > 0:
			parts := []map[string]any{}
			if m.Content != "" {
				parts = append(parts, map[string]any{"text": m.Content})
			}
			for _, c := range m.ToolCalls {
				args := c.Args
				if args == nil {
					args = map[string]any{}
				}
				parts = append(parts, map[string]any{"functionCall": map[string]any{"name": c.Name, "args": args}})
			}
			contents = append(contents, map[string]any{"role": "model", "parts": parts})

		case m.Role == "assistant":
			contents = append(contents, map[string]any{"role": "model", "parts": []map[string]any{{"text": m.Content}}})
		default:
			contents = append(contents, map[string]any{"role": "user", "parts": []map[string]any{{"text": m.Content}}})
		}
	}

	payload := map[string]any{"contents": contents}
	if system != "" {
		payload["systemInstruction"] = map[string]any{"parts": []map[string]any{{"text": system}}}
	}
	if hasTools(cr) {
		decls := make([]map[string]any, len(cr.Tools))
		for i, d := range cr.Tools {
			params := geminiSchema(d.Parameters)
			if params == nil {
				params = map[string]any{"type": "object", "properties": map[string]any{}}
			}
			decls[i] = map[string]any{"name": d.Name, "description": d.Description, "parameters": params}
		}
		payload["tools"] = []map[string]any{{"functionDeclarations": decls}}
	}
	gc := map[string]any{}
	if cr.Temperature != nil {
		gc["temperature"] = *cr.Temperature
	}
	if cr.MaxTokens > 0 {
		gc["maxOutputTokens"] = cr.MaxTokens
	}
	if len(gc) > 0 {
		payload["generationConfig"] = gc
	}
	raw, _ := json.Marshal(payload)

	u := fmt.Sprintf("%s/v1beta/models/%s:streamGenerateContent?alt=sse&key=%s",
		baseURL(conn), url.PathEscape(cr.Model), url.QueryEscape(key))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(raw))
	if err != nil {
		return ChatResult{}, scrubKey(err, key)
	}
	req.Header.Set("content-type", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return ChatResult{}, netErr(err, func(e error) error { return scrubKey(e, key) })
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ChatResult{}, httpErr("gemini", resp)
	}

	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 4<<20)
	var usage Usage
	var calls []ToolCall
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		var chunk struct {
			Candidates []struct {
				Content struct {
					Parts []struct {
						Text         string `json:"text"`
						FunctionCall *struct {
							Name string         `json:"name"`
							Args map[string]any `json:"args"`
						} `json:"functionCall"`
					} `json:"parts"`
				} `json:"content"`
			} `json:"candidates"`
			UsageMetadata struct {
				PromptTokenCount     int `json:"promptTokenCount"`
				CandidatesTokenCount int `json:"candidatesTokenCount"`
			} `json:"usageMetadata"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		for _, c := range chunk.Candidates {
			for _, pt := range c.Content.Parts {
				if pt.Text != "" {
					out <- Delta{Text: pt.Text}
				}
				if pt.FunctionCall != nil && pt.FunctionCall.Name != "" {
					calls = append(calls, ToolCall{
						ID:   fmt.Sprintf("call_%d", len(calls)),
						Name: pt.FunctionCall.Name,
						Args: pt.FunctionCall.Args,
					})
				}
			}
		}
		if chunk.UsageMetadata.PromptTokenCount > 0 {
			usage = Usage{
				PromptTokens:     chunk.UsageMetadata.PromptTokenCount,
				CompletionTokens: chunk.UsageMetadata.CandidatesTokenCount,
			}
		}
	}
	if err := sc.Err(); err != nil {
		if m := contextErr(ctx); m != "" {
			return ChatResult{Usage: usage}, fmt.Errorf("%s", m)
		}
		return ChatResult{Usage: usage}, err
	}
	out <- Delta{Done: true}
	return ChatResult{Usage: usage, ToolCalls: calls}, nil
}
