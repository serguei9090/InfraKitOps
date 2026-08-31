package executor

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHTTPExecutor(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok123" {
			w.WriteHeader(401)
			return
		}
		if r.URL.Path == "/health" {
			_, _ = io.WriteString(w, `{"status":"ok","checks":{"db":true}}`)
			return
		}
		w.WriteHeader(404)
	}))
	defer srv.Close()

	ex := For(KindHTTP)

	// happy path + assertion
	res := ex.Run(context.Background(), Step{
		Kind: KindHTTP,
		HTTP: &HTTPRequest{
			Method:       "GET",
			URL:          srv.URL + "/health",
			Headers:      map[string]string{"Authorization": "Bearer tok123"},
			ExpectStatus: []int{200},
			Assert:       []HTTPAssertion{{JSONPath: "status", Equals: "ok"}, {JSONPath: "checks.db", Equals: "true"}},
		},
	}, io.Discard, io.Discard)
	if res.ExitCode != 0 {
		t.Fatalf("exit %d stderr %q", res.ExitCode, res.Stderr)
	}
	if !strings.Contains(res.Stdout, `"status":"ok"`) {
		t.Fatalf("stdout %q", res.Stdout)
	}

	// failed assertion
	res = ex.Run(context.Background(), Step{
		Kind: KindHTTP,
		HTTP: &HTTPRequest{
			Method: "GET", URL: srv.URL + "/health",
			Headers: map[string]string{"Authorization": "Bearer tok123"},
			Assert:  []HTTPAssertion{{JSONPath: "status", Equals: "degraded"}},
		},
	}, io.Discard, io.Discard)
	if res.ExitCode == 0 {
		t.Fatal("expected assertion failure")
	}

	// wrong status
	res = ex.Run(context.Background(), Step{
		Kind: KindHTTP,
		HTTP: &HTTPRequest{Method: "GET", URL: srv.URL + "/nope", Headers: map[string]string{"Authorization": "Bearer tok123"}, ExpectStatus: []int{200}},
	}, io.Discard, io.Discard)
	if res.ExitCode == 0 {
		t.Fatal("expected status-mismatch failure")
	}
}

func TestEvalDotPath(t *testing.T) {
	body := `{"a":{"b":[{"c":"hit"},{"c":"miss"}]},"n":42,"ok":true}`
	cases := map[string]string{"a.b.0.c": "hit", "a.b.1.c": "miss", "n": "42", "ok": "true"}
	for path, want := range cases {
		got, ok := EvalDotPath(body, path)
		if !ok || got != want {
			t.Errorf("%s = %q,%v want %q", path, got, ok, want)
		}
	}
	if _, ok := EvalDotPath(body, "a.z"); ok {
		t.Error("missing path should be !ok")
	}
}

func TestBasicAuthHeader(t *testing.T) {
	if got := BasicAuthHeader("u", "p"); got != "Basic dTpw" {
		t.Fatalf("got %q", got)
	}
}
