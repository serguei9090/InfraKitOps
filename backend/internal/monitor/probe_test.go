package monitor

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func mon(kind, target string, cfg map[string]any) Monitor {
	m := Monitor{Kind: kind, Target: target, TimeoutSec: 5, Config: cfg}
	m.normalize()
	return m
}

func TestStatusAllowed(t *testing.T) {
	cases := []struct {
		code int
		spec string
		want bool
	}{
		{200, "", true}, {399, "", true}, {400, "", false},
		{204, "200,204", true}, {201, "200,204", false},
		{250, "200-299", true}, {300, "200-299", false},
		{302, "200,300-399", true},
	}
	for _, c := range cases {
		if got := statusAllowed(c.code, c.spec); got != c.want {
			t.Errorf("statusAllowed(%d, %q) = %v, want %v", c.code, c.spec, got, c.want)
		}
	}
}

func TestParseExpiry(t *testing.T) {
	for _, s := range []string{"2027-01-02T15:04:05Z", "2027-01-02", "02-Jan-2027", "2027.01.02"} {
		if _, err := parseExpiry(s); err != nil {
			t.Errorf("parseExpiry(%q): %v", s, err)
		}
	}
	if _, err := parseExpiry("not a date"); err == nil {
		t.Error("parseExpiry should reject garbage")
	}
}

func TestHTTPProbe(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ok":
			w.Write([]byte("all good"))
		case "/json":
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"status":"ok","db":{"up":true}}`))
		case "/bad":
			w.WriteHeader(503)
		case "/slow":
			time.Sleep(120 * time.Millisecond)
			w.Write([]byte("late"))
		}
	}))
	defer srv.Close()

	p := httpProbe{}
	check := func(path string, cfg map[string]any, wantOK bool, detailHas string) {
		t.Helper()
		s := p.Probe(context.Background(), mon(KindHTTP, srv.URL+path, cfg))
		if s.OK != wantOK {
			t.Fatalf("%s: OK=%v want %v (detail %q)", path, s.OK, wantOK, s.Detail)
		}
		if detailHas != "" && !strings.Contains(s.Detail, detailHas) {
			t.Fatalf("%s: detail %q missing %q", path, s.Detail, detailHas)
		}
	}

	check("/ok", nil, true, "")
	check("/ok", map[string]any{"assertBodyContains": "all good"}, true, "")
	check("/ok", map[string]any{"assertBodyContains": "missing"}, false, "body missing")
	check("/ok", map[string]any{"assertBodyAbsent": "good"}, false, "body contains")
	check("/bad", nil, false, "status 503")
	check("/bad", map[string]any{"expectStatus": "500-599"}, true, "")
	check("/json", map[string]any{"assertJsonPath": "status", "assertJsonEquals": "ok"}, true, "")
	check("/json", map[string]any{"assertJsonPath": "db.up", "assertJsonEquals": "true"}, true, "")
	check("/json", map[string]any{"assertJsonPath": "status", "assertJsonEquals": "bad"}, false, "want")
	check("/slow", map[string]any{"maxLatencyMs": 40.0}, false, "slow")
}

func TestTLSProbe(t *testing.T) {
	srv := httptest.NewTLSServer(nil)
	defer srv.Close()
	addr := strings.TrimPrefix(srv.URL, "https://")

	s := tlsProbe{}.Probe(context.Background(), mon(KindTLS, addr, nil))
	// httptest's cert is valid for ~a year but self-signed → not trusted.
	if s.OK {
		t.Fatalf("self-signed cert should not be OK: %+v", s)
	}
	if s.Value <= 0 {
		t.Fatalf("expected a positive days-left value, got %v (detail %q)", s.Value, s.Detail)
	}
}

func TestDNSProbe(t *testing.T) {
	base := dnsProbe{}.Probe(context.Background(), mon(KindDNS, "one.one.one.one", nil))
	if !base.OK {
		t.Skipf("no network / resolver: %s", base.Detail)
	}
	ok := dnsProbe{}.Probe(context.Background(), mon(KindDNS, "one.one.one.one", map[string]any{"expected": "1.1.1.1"}))
	if !ok.OK {
		t.Errorf("expected 1.1.1.1 in the answer, got %s", ok.Detail)
	}
	bad := dnsProbe{}.Probe(context.Background(), mon(KindDNS, "one.one.one.one", map[string]any{"expected": "9.9.9.9"}))
	if bad.OK {
		t.Errorf("9.9.9.9 should not be an answer for one.one.one.one")
	}
}
