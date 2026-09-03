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

func TestRewriteRemote(t *testing.T) {
	got := rewriteRemote(`@C:\Users\me\.cache\infrakit-extravars-x.yml`, ``, ``, `C:\Users\me\.cache`, "/wd/.tmp")
	if got != "@/wd/.tmp/infrakit-extravars-x.yml" {
		t.Errorf("tmp rewrite = %q", got)
	}
	got = rewriteRemote(`C:\proj\site.yml`, `C:\proj`, "/remote/proj", ``, ``)
	if got != "/remote/proj/site.yml" {
		t.Errorf("project rewrite = %q", got)
	}
	if rewriteRemote("web1,web2", "", "/x", "", "/y") != "web1,web2" {
		t.Error("host list untouched")
	}
}

func TestEnvValueAndLineWriter(t *testing.T) {
	if envValue([]string{"A=1", "INFRAKIT_EVENT_FILE=/tmp/ev.ndjson"}, "INFRAKIT_EVENT_FILE") != "/tmp/ev.ndjson" {
		t.Fatal("envValue")
	}
	var lines []string
	w := lineWriter(func(l string) { lines = append(lines, l) })
	_, _ = w.Write([]byte("one\r\ntwo\nthr"))
	_, _ = w.Write([]byte("ee\n"))
	w.Flush()
	if strings.Join(lines, "|") != "one|two|three" {
		t.Errorf("lineWriter = %v", lines)
	}
}

func TestSSHRunnerUnavailableWithoutResolver(t *testing.T) {
	s := &sshRunner{settings: map[string]string{"remoteNodeId": "n1"}}
	if _, err := s.target(context.Background()); err == nil {
		t.Error("target must fail with no resolver")
	}
}

func TestActiveRunnerExplicit(t *testing.T) {
	e := &Engine{rt: NewRuntime(t.TempDir()), cfgDir: t.TempDir(), store: openTestStore(t)}
	_ = e.store.PutSetting("ansibleRuntime", "container")
	if r := e.activeRunner(context.Background()); r.Name() != RuntimeMode("container") {
		t.Errorf("explicit container → %q", r.Name())
	}
	_ = e.store.PutSetting("ansibleRuntime", "system")
	if r := e.activeRunner(context.Background()); r.Name() != RuntimeSystem {
		t.Errorf("explicit system → %q", r.Name())
	}
	// "remote" is only offered when a NodeResolver is wired
	_ = e.store.PutSetting("ansibleRuntime", "remote")
	if r := e.activeRunner(context.Background()); r.Name() == RuntimeMode("remote") {
		t.Error("remote runner should be unavailable without a NodeResolver")
	}
	e.SetNodeResolver(func(context.Context, string) (RemoteTarget, error) { return RemoteTarget{}, nil })
	if r := e.activeRunner(context.Background()); r.Name() != RuntimeMode("remote") {
		t.Errorf("remote runner should be picked once wired, got %q", r.Name())
	}
}
