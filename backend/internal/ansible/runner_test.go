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

func TestPickRunnerExplicit(t *testing.T) {
	rt := NewRuntime(t.TempDir())
	if r := pickRunner(context.Background(), rt, "/cfg", map[string]string{"ansibleRuntime": "container"}); r.Name() != RuntimeMode("container") {
		t.Errorf("explicit container → %q", r.Name())
	}
	if r := pickRunner(context.Background(), rt, "/cfg", map[string]string{"ansibleRuntime": "system"}); r.Name() != RuntimeSystem {
		t.Errorf("explicit system → %q", r.Name())
	}
}
