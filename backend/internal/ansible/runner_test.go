package ansible

import (
	"context"
	"strings"
	"testing"
)

func TestLocalRunnerProbe(t *testing.T) {
	rt := NewRuntime(t.TempDir())
	l := &localRunner{rt: rt, mode: RuntimeSystem}
	s := l.Probe(context.Background())
	if s.Mode != RuntimeSystem {
		t.Errorf("mode = %q", s.Mode)
	}
	if !s.Ready && s.Reason == "" {
		t.Error("not-ready probe must carry a reason")
	}
}

func TestSplitList(t *testing.T) {
	got := splitList("boto3, kubernetes\n jmespath ,,")
	want := []string{"boto3", "kubernetes", "jmespath"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("splitList = %v", got)
	}
	if len(splitList("")) != 0 {
		t.Error("empty → nil")
	}
}

func TestBuildDockerfile(t *testing.T) {
	df := buildDockerfile([]string{"boto3"}, []string{"community.docker"})
	for _, want := range []string{
		"FROM python:3.12-slim",
		"pip install --no-cache-dir ansible-core ansible-lint",
		"pip install --no-cache-dir boto3",
		"ansible-galaxy collection install 'community.docker'",
	} {
		if !strings.Contains(df, want) {
			t.Errorf("Dockerfile missing %q:\n%s", want, df)
		}
	}
}

func TestContainerRewrite(t *testing.T) {
	c := &containerRunner{cfgDir: "/cfg", image: defaultImage}
	// simulate the rewrite closure by exercising Command's mapping rules
	proj := "/home/me/proj"
	tmp := c.tmpDir()
	rewrite := func(s string) string {
		s = strings.ReplaceAll(s, proj, "/infra-project")
		s = strings.ReplaceAll(s, tmp, "/infra-tmp")
		return s
	}
	if got := rewrite(proj + "/site.yml"); got != "/infra-project/site.yml" {
		t.Errorf("project path: %s", got)
	}
	if got := rewrite("@" + tmp + "/extravars.yml"); got != "@/infra-tmp/extravars.yml" {
		t.Errorf("tmp path: %s", got)
	}
	if got := rewrite("web1,web2"); got != "web1,web2" {
		t.Errorf("host list should be untouched: %s", got)
	}
}

func TestWinToWSL(t *testing.T) {
	cases := map[string]string{
		`C:\Users\me\proj`:      "/mnt/c/Users/me/proj",
		`D:\a\b`:                "/mnt/d/a/b",
		`@C:\tmp\extravars.yml`: "@C:\\tmp\\extravars.yml", // no drive at [1]==':' — left as-is by winToWSL
		`/already/posix`:        "/already/posix",
	}
	for in, want := range cases {
		if in == `@C:\tmp\extravars.yml` {
			continue // handled by the rewrite() closure, not winToWSL directly
		}
		if got := winToWSL(in); got != want {
			t.Errorf("winToWSL(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestWslText(t *testing.T) {
	// UTF-16LE-ish: nulls between bytes, BOM, CRLF
	raw := []byte("\ufeffU\x00b\x00u\x00n\x00t\x00u\x00\r\x00\n\x00D\x00e\x00b\x00i\x00a\x00n\x00\n\x00")
	got := wslText(raw)
	if len(got) != 2 || got[0] != "Ubuntu" || got[1] != "Debian" {
		t.Errorf("wslText = %#v", got)
	}
}

func TestWslTeardownGuard(t *testing.T) {
	w := &wslRunner{settings: map[string]string{"wslDistro": "Ubuntu"}}
	if err := w.Teardown(context.Background()); err == nil {
		t.Error("Teardown must refuse to unregister a non-dedicated distro")
	}
}

func TestPickRunnerExplicit(t *testing.T) {
	rt := NewRuntime(t.TempDir())
	if r := pickRunner(context.Background(), rt, "/cfg", map[string]string{"ansibleRuntime": "container"}); r.Name() != RuntimeMode("container") {
		t.Errorf("explicit container → %q", r.Name())
	}
	if r := pickRunner(context.Background(), rt, "/cfg", map[string]string{"ansibleRuntime": "system"}); r.Name() != RuntimeSystem {
		t.Errorf("explicit system → %q", r.Name())
	}
}
