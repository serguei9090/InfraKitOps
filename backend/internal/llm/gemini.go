package llm

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, scrubKey(err, key)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<10))
		return nil, fmt.Errorf("GET /v1beta/models: %s: %s", resp.Status, bytes.TrimSpace(b))
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

func (geminiProvider) Chat(ctx context.Context, conn Connection, key string, cr ChatRequest, out chan<- Delta) (Usage, error) {
	type part struct {
		Text string `json:"text"`
	}
	type content struct {
		Role  string `json:"role"`
		Parts []part `json:"parts"`
	}
	var system string
	var contents []content
	for _, m := range cr.Messages {
		switch m.Role {
		case "system":
			if system != "" {
				system += "\n\n"
			}
			system += m.Content
		case "assistant":
			contents = append(contents, content{Role: "model", Parts: []part{{Text: m.Content}}})
		default:
			contents = append(contents, content{Role: "user", Parts: []part{{Text: m.Content}}})
		}
	}

	payload := map[string]any{"contents": contents}
	if system != "" {
		payload["systemInstruction"] = content{Parts: []part{{Text: system}}}
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
		return Usage{}, scrubKey(err, key)
	}
	req.Header.Set("content-type", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return Usage{}, scrubKey(err, key)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		return Usage{}, fmt.Errorf("streamGenerateContent: %s: %s", resp.Status, bytes.TrimSpace(b))
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
		var chunk struct {
			Candidates []struct {
				Content struct {
					Parts []part `json:"parts"`
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
			return usage, fmt.Errorf("%s", m)
		}
		return usage, err
	}
	out <- Delta{Done: true}
	return usage, nil
}
