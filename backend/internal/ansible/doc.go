package ansible

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// ModuleDoc is a trimmed `ansible-doc -j <module>` result.
type ModuleDoc struct {
	Module      string               `json:"module"`
	ShortDesc   string               `json:"shortDescription"`
	Description []string             `json:"description"`
	Options     map[string]DocOption `json:"options"`
	Examples    string               `json:"examples"`
}

type DocOption struct {
	Description []string `json:"description"`
	Type        string   `json:"type,omitempty"`
	Required    bool     `json:"required,omitempty"`
	Default     any      `json:"default,omitempty"`
	Choices     any      `json:"choices,omitempty"`
}

// Doc resolves module documentation via `ansible-doc -j`.
func (e *Engine) Doc(ctx context.Context, mode RuntimeMode, module string) (*ModuleDoc, error) {
	module = strings.TrimSpace(module)
	if module == "" {
		return nil, fmt.Errorf("a module name is required")
	}
	c, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	out, err := e.activeRunner(c).Capture(c, RunReq{Tool: "ansible-doc", Argv: []string{"-j", module}})
	if err != nil {
		return nil, fmt.Errorf("ansible-doc %s: %w", module, trimExecErr(err))
	}

	// { "<module>": { doc: {...}, examples: "...", ... } }
	var raw map[string]struct {
		Doc struct {
			ShortDescription string `json:"short_description"`
			Description      any    `json:"description"`
			Options          map[string]struct {
				Description any    `json:"description"`
				Type        string `json:"type"`
				Required    bool   `json:"required"`
				Default     any    `json:"default"`
				Choices     any    `json:"choices"`
			} `json:"options"`
		} `json:"doc"`
		Examples string `json:"examples"`
	}
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, fmt.Errorf("parse ansible-doc: %w", err)
	}
	entry, ok := raw[module]
	if !ok {
		for k := range raw {
			module = k
			entry = raw[k]
			ok = true
			break
		}
	}
	if !ok {
		return nil, fmt.Errorf("no documentation for %q", module)
	}

	d := &ModuleDoc{
		Module:      module,
		ShortDesc:   entry.Doc.ShortDescription,
		Description: toStrings(entry.Doc.Description),
		Options:     map[string]DocOption{},
		Examples:    entry.Examples,
	}
	for name, o := range entry.Doc.Options {
		d.Options[name] = DocOption{
			Description: toStrings(o.Description),
			Type:        o.Type,
			Required:    o.Required,
			Default:     o.Default,
			Choices:     o.Choices,
		}
	}
	return d, nil
}

// toStrings coerces ansible-doc's "string or []string" description fields.
func toStrings(v any) []string {
	switch t := v.(type) {
	case string:
		return []string{t}
	case []any:
		out := make([]string, 0, len(t))
		for _, x := range t {
			if s, ok := x.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}
