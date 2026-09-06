package monitor

import (
	"context"
	"testing"
)

func TestParseBulk(t *testing.T) {
	text := `name,kind,target
# a comment
gw,icmp,1.1.1.1
api,http,https://example.com/health,prod
bad line
svc,bogus,x
`
	drafts, errs := ParseBulk(text)
	if len(drafts) != 2 {
		t.Fatalf("drafts = %d (%+v)", len(drafts), drafts)
	}
	if drafts[0].Name != "gw" || drafts[0].Kind != "icmp" {
		t.Fatalf("draft0 = %+v", drafts[0])
	}
	if drafts[1].Tags != "prod" {
		t.Fatalf("draft1 tags = %q", drafts[1].Tags)
	}
	if len(errs) != 2 {
		t.Fatalf("errs = %+v", errs)
	}
}

func TestBuildTemplateWebService(t *testing.T) {
	ms, err := BuildTemplate("web-service", "https://api.example.com/", "team-x")
	if err != nil {
		t.Fatal(err)
	}
	if len(ms) != 4 {
		t.Fatalf("want 4 monitors, got %d", len(ms))
	}
	kinds := map[string]bool{}
	for _, m := range ms {
		kinds[m.Kind] = true
		if m.Tags != "api.example.com, team-x" {
			t.Fatalf("tags = %q", m.Tags)
		}
	}
	for _, k := range []string{KindHTTP, KindTLS, KindDNS, KindDomain} {
		if !kinds[k] {
			t.Fatalf("missing kind %s", k)
		}
	}
	// domain monitor targets the registrable domain
	for _, m := range ms {
		if m.Kind == KindDomain && m.Target != "example.com" {
			t.Fatalf("domain target = %q", m.Target)
		}
	}
	if _, err := BuildTemplate("nope", "x", ""); err == nil {
		t.Fatal("unknown template should error")
	}
}

func TestDependencySuppressesNotify(t *testing.T) {
	f := withFakeProbe(t)
	s := newStore(t)
	e := NewEngine(s)

	parent, _ := s.Put("alice", Monitor{Name: "host", Kind: "fake", Target: "h", Enabled: true, FailThreshold: 1})
	child, _ := s.Put("alice", Monitor{Name: "app", Kind: "fake", Target: "a", Enabled: true, FailThreshold: 1, DependsOn: parent.ID})

	// parent goes down
	f.ok.Store(false)
	e.tick(context.Background(), parent.ID, &loopState{})
	if g, _ := s.Get("alice", parent.ID); g.Status != StatusDown {
		t.Fatalf("parent status = %s", g.Status)
	}
	// child goes down while parent is down → incident suppressed
	e.tick(context.Background(), child.ID, &loopState{})
	inc, _ := s.Incidents("alice", child.ID, 0, 10)
	if len(inc) != 1 || !inc[0].Suppressed {
		t.Fatalf("child incident = %+v", inc)
	}
}
