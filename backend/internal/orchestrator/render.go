package orchestrator

import (
	"fmt"
	"regexp"
	"strings"
)

// varRe matches {{ NAME }} where NAME is [A-Za-z0-9_.:] (allows secret:FOO and
// steps.1.stdout).
var varRe = regexp.MustCompile(`\{\{\s*([A-Za-z0-9_.:]+)\s*\}\}`)

// ExtractVars returns every {{TOKEN}} in the text, first-appearance order,
// de-duplicated.
func ExtractVars(text string) []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range varRe.FindAllStringSubmatch(text, -1) {
		if !seen[m[1]] {
			seen[m[1]] = true
			out = append(out, m[1])
		}
	}
	return out
}

// ExtractSpecArgs returns the user-facing arg tokens across every step script:
// plain names only — `secret:*` and `steps.*` are excluded.
func ExtractSpecArgs(spec *Spec) []string {
	seen := map[string]bool{}
	var out []string
	for _, st := range spec.Steps {
		for _, v := range ExtractVars(st.Script) {
			if strings.Contains(v, ":") || strings.HasPrefix(v, "steps.") {
				continue
			}
			if !seen[v] {
				seen[v] = true
				out = append(out, v)
			}
		}
	}
	return out
}

// Values a run is executed with.
type Values struct {
	Args      map[string]string // user-supplied arg values
	Steps     []RunStep         // prior step results (for {{steps.N.stdout}})
	ResolveSecret func(name string) (string, error)
}

// Render substitutes every {{TOKEN}} in script. Unknown tokens are left as-is.
// Returns the rendered string plus the set of secret names that were injected
// (so the caller can redact them from the output).
func Render(script string, v Values) (string, map[string]bool) {
	secrets := map[string]bool{}
	out := varRe.ReplaceAllStringFunc(script, func(match string) string {
		name := varRe.FindStringSubmatch(match)[1]
		switch {
		case strings.HasPrefix(name, "secret:"):
			if v.ResolveSecret == nil {
				return match
			}
			val, err := v.ResolveSecret(strings.TrimPrefix(name, "secret:"))
			if err != nil {
				return match
			}
			secrets[strings.TrimPrefix(name, "secret:")] = true
			return val
		case strings.HasPrefix(name, "steps."):
			return resolveStepRef(name, v.Steps)
		default:
			if val, ok := v.Args[name]; ok {
				return val
			}
			return match
		}
	})
	return out, secrets
}

// resolveStepRef handles steps.<1-based index>.<stdout|stderr|exitCode>.
func resolveStepRef(token string, steps []RunStep) string {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "{{" + token + "}}"
	}
	var idx int
	if _, err := fmt.Sscanf(parts[1], "%d", &idx); err != nil || idx < 1 || idx > len(steps) {
		return "{{" + token + "}}"
	}
	s := steps[idx-1]
	switch parts[2] {
	case "stdout":
		return s.Stdout
	case "stderr":
		return s.Stderr
	case "exitCode":
		return fmt.Sprintf("%d", s.ExitCode)
	default:
		return "{{" + token + "}}"
	}
}

// Redact replaces each raw secret value in text with ‹secret:NAME›.
func Redact(text string, secretValues map[string]string) string {
	for name, val := range secretValues {
		if val == "" {
			continue
		}
		text = strings.ReplaceAll(text, val, "‹secret:"+name+"›")
	}
	return text
}
