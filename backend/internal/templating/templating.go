// Package templating is the shared `{{TOKEN}}` substitution used by the
// Runbooks engine and the AI-layer task engine. TOKEN is [A-Za-z0-9_.:] so it
// also matches namespaced refs like `secret:FOO`, `steps.1.stdout`,
// `context.selectionText`, `input`. Extracted per AI_MODULE_PLAN.md §10.
package templating

import "regexp"

// Re matches `{{ TOKEN }}` with optional surrounding whitespace.
var Re = regexp.MustCompile(`\{\{\s*([A-Za-z0-9_.:]+)\s*\}\}`)

// ExtractVars returns every TOKEN in text, first-appearance order, de-duplicated.
func ExtractVars(text string) []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range Re.FindAllStringSubmatch(text, -1) {
		if !seen[m[1]] {
			seen[m[1]] = true
			out = append(out, m[1])
		}
	}
	return out
}

// Substitute replaces each `{{TOKEN}}` using resolve. When resolve returns
// ok=false the literal `{{TOKEN}}` is left untouched.
func Substitute(text string, resolve func(name string) (value string, ok bool)) string {
	return Re.ReplaceAllStringFunc(text, func(match string) string {
		name := Re.FindStringSubmatch(match)[1]
		if v, ok := resolve(name); ok {
			return v
		}
		return match
	})
}
