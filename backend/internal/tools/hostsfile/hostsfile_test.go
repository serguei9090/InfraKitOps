package hostsfile

import (
	"reflect"
	"strings"
	"testing"
)

func TestClassifyAndRenderRoundTrip(t *testing.T) {
	src := strings.Join([]string{
		"# a comment",
		"127.0.0.1       localhost",
		"# 10.0.0.5 disabled.example  # was staging",
		"::1             localhost ip6-localhost",
		"",
		"192.168.1.10  nas.local nas  # storage box",
	}, "\n")

	var lines []Line
	for _, raw := range strings.Split(src, "\n") {
		lines = append(lines, classify(raw))
	}

	if lines[1].Kind != "mapping" || !lines[1].Enabled || lines[1].IP != "127.0.0.1" {
		t.Fatalf("line 1: %+v", lines[1])
	}
	if lines[2].Kind != "mapping" || lines[2].Enabled || lines[2].IP != "10.0.0.5" {
		t.Fatalf("disabled mapping misparsed: %+v", lines[2])
	}
	if lines[2].Comment != "was staging" {
		t.Fatalf("comment = %q", lines[2].Comment)
	}
	if !reflect.DeepEqual(lines[3].Hostnames, []string{"localhost", "ip6-localhost"}) {
		t.Fatalf("v6 hostnames: %+v", lines[3].Hostnames)
	}
	if lines[5].Comment != "storage box" || lines[5].Hostnames[0] != "nas.local" {
		t.Fatalf("line 5: %+v", lines[5])
	}

	out := Render(lines)
	if !strings.Contains(out, "# 10.0.0.5 disabled.example  # was staging") {
		t.Fatalf("disabled line not re-rendered commented:\n%s", out)
	}
	if !strings.Contains(out, "127.0.0.1 localhost") {
		t.Fatalf("enabled line lost:\n%s", out)
	}
	if !strings.Contains(out, "# a comment") {
		t.Fatalf("free comment lost:\n%s", out)
	}
}

func TestToggleEnable(t *testing.T) {
	l := classify("127.0.0.1 localhost")
	l.Enabled = false
	if got := Render([]Line{l}); strings.TrimSpace(got) != "# 127.0.0.1 localhost" {
		t.Fatalf("toggle-off render = %q", got)
	}
}

func TestPathIsPlatformAppropriate(t *testing.T) {
	p := Path()
	if p == "" || (!strings.Contains(p, "etc") && !strings.Contains(p, "drivers")) {
		t.Fatalf("unexpected hosts path %q", p)
	}
}
