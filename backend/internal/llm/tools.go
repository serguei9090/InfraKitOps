package llm

import (
	"encoding/json"
	"strings"
)

// hasTools reports whether the request offers any tools.
func hasTools(req ChatRequest) bool { return len(req.Tools) > 0 }

// argString renders tool-call arguments as a compact JSON string (the wire
// form OpenAI / Ollama expect for `function.arguments`).
func argString(args map[string]any) string {
	if len(args) == 0 {
		return "{}"
	}
	b, err := json.Marshal(args)
	if err != nil {
		return "{}"
	}
	return string(b)
}

// parseArgs turns a JSON argument string into a map (best-effort — a partial /
// malformed string yields an empty map so the tool call still fires).
func parseArgs(s string) map[string]any {
	s = strings.TrimSpace(s)
	if s == "" {
		return map[string]any{}
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		return map[string]any{}
	}
	return m
}

type toolCallFrag struct{ id, name, args string }

// toolCallAccum reassembles OpenAI/Ollama streamed tool-call fragments, which
// arrive split across chunks and keyed by `index`.
type toolCallAccum struct {
	order []int
	byIdx map[int]*toolCallFrag
}

func newToolCallAccum() *toolCallAccum {
	return &toolCallAccum{byIdx: map[int]*toolCallFrag{}}
}

func (a *toolCallAccum) add(index int, id, name, argFragment string) {
	e := a.byIdx[index]
	if e == nil {
		e = &toolCallFrag{}
		a.byIdx[index] = e
		a.order = append(a.order, index)
	}
	if id != "" {
		e.id = id
	}
	if name != "" {
		e.name = name
	}
	e.args += argFragment
}

func (a *toolCallAccum) calls() []ToolCall {
	if len(a.order) == 0 {
		return nil
	}
	out := make([]ToolCall, 0, len(a.order))
	for _, idx := range a.order {
		e := a.byIdx[idx]
		if e.name == "" {
			continue
		}
		out = append(out, ToolCall{ID: e.id, Name: e.name, Args: parseArgs(e.args)})
	}
	return out
}
