package obs

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	chimw "github.com/go-chi/chi/v5/middleware"
)

func TestSetupJSONAndLevel(t *testing.T) {
	var buf bytes.Buffer
	Setup(&buf, "json", "warn")

	// info is below warn → dropped; warn kept.
	Infof("hidden %d", 1)
	Warnf("shown %d", 2)

	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	if len(lines) != 1 {
		t.Fatalf("want 1 line, got %d: %q", len(lines), buf.String())
	}
	var rec map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &rec); err != nil {
		t.Fatalf("not json: %v", err)
	}
	if rec["level"] != "WARN" || rec["msg"] != "shown 2" {
		t.Fatalf("bad record: %v", rec)
	}
}

func TestAccessLogAndRecoverer(t *testing.T) {
	var buf bytes.Buffer
	Setup(&buf, "json", "info")

	h := chimw.RequestID(Recoverer(AccessLog(false)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/boom" {
			panic("kaboom")
		}
		w.WriteHeader(204)
	}))))

	srv := httptest.NewServer(h)
	defer srv.Close()

	resp, _ := http.Get(srv.URL + "/ok")
	resp.Body.Close()
	if resp.StatusCode != 204 {
		t.Fatalf("ok: %d", resp.StatusCode)
	}
	resp, _ = http.Get(srv.URL + "/boom")
	resp.Body.Close()
	if resp.StatusCode != 500 {
		t.Fatalf("boom: %d, want 500", resp.StatusCode)
	}

	out := buf.String()
	if !strings.Contains(out, `"path":"/ok"`) || !strings.Contains(out, `"status":204`) {
		t.Fatalf("access log missing ok line: %s", out)
	}
	if !strings.Contains(out, `"msg":"panic in handler"`) {
		t.Fatalf("recoverer did not log the panic: %s", out)
	}
}

func TestMetricsHandler(t *testing.T) {
	SetBuildVersion("1.2.3")
	recordRequest("GET", 200, 0)
	recordRequest("GET", 500, 0)

	rr := httptest.NewRecorder()
	MetricsHandler()(rr, httptest.NewRequest("GET", "/metrics", nil))
	body := rr.Body.String()

	for _, want := range []string{
		`infrakit_build_info{version="1.2.3"} 1`,
		`infrakit_http_requests_total{method="GET",code="200"}`,
		`infrakit_http_requests_total{method="GET",code="500"}`,
		"infrakit_http_request_duration_seconds_bucket",
		"infrakit_goroutines",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("metrics output missing %q\n---\n%s", want, body)
		}
	}
}
