package templating

import (
	"strings"
	"testing"
)

func TestExtractVars(t *testing.T) {
	got := ExtractVars("deploy {{APP}} to {{ENV}}, key {{secret:TOK}}, prev {{steps.1.stdout}}, {{APP}} again")
	if strings.Join(got, ",") != "APP,ENV,secret:TOK,steps.1.stdout" {
		t.Fatalf("got %v", got)
	}
}

func TestSubstitute(t *testing.T) {
	out := Substitute("hi {{name}} — {{missing}} — {{context.x}}", func(n string) (string, bool) {
		switch n {
		case "name":
			return "world", true
		case "context.x":
			return "42", true
		}
		return "", false
	})
	if out != "hi world — {{missing}} — 42" {
		t.Fatalf("got %q", out)
	}
}
