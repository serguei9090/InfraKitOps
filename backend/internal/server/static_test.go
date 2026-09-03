package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func staticDir(t *testing.T) string {
	t.Helper()
	d := t.TempDir()
	must := func(rel, body string) {
		p := filepath.Join(d, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	must("index.html", "<!doctype html><title>app</title>")
	must("assets/app-abc123.js", "console.log(1)")
	must("favicon.svg", "<svg/>")
	must(".env", "SECRET=1")
	return d
}

func newStatic(t *testing.T) *httptest.Server {
	t.Helper()
	api := NewRouter(Options{Token: testToken})
	srv := httptest.NewServer(StaticHandler(staticDir(t), api))
	t.Cleanup(srv.Close)
	return srv
}

func TestStaticServesFile(t *testing.T) {
	srv := newStatic(t)
	resp := get(t, srv.URL+"/assets/app-abc123.js", "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("asset: got %d", resp.StatusCode)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Fatalf("asset cache header = %q", cc)
	}
	b, _ := io.ReadAll(resp.Body)
	if string(b) != "console.log(1)" {
		t.Fatalf("asset body = %q", b)
	}
}

func TestStaticSPAFallback(t *testing.T) {
	srv := newStatic(t)
	// A client-router route with no file extension → index.html.
	resp := get(t, srv.URL+"/tools/prompt-library", "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("spa route: got %d", resp.StatusCode)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "no-cache" {
		t.Fatalf("index cache header = %q", cc)
	}
	b, _ := io.ReadAll(resp.Body)
	if want := "<!doctype html><title>app</title>"; string(b) != want {
		t.Fatalf("spa body = %q", b)
	}
}

func TestStaticMissingAssetIs404(t *testing.T) {
	srv := newStatic(t)
	resp := get(t, srv.URL+"/assets/nope-000000.js", "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("missing asset: got %d, want 404", resp.StatusCode)
	}
}

func TestStaticBlocksDotfiles(t *testing.T) {
	srv := newStatic(t)
	resp := get(t, srv.URL+"/.env", "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf(".env: got %d, want 404", resp.StatusCode)
	}
}

func TestStaticAPIPassthrough(t *testing.T) {
	srv := newStatic(t)
	// /api/* still reaches the router → still needs the token.
	resp := get(t, srv.URL+"/api/v1/health", "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("api no token: got %d, want 401", resp.StatusCode)
	}
	resp = get(t, srv.URL+"/api/v1/health", testToken)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("api with token: got %d, want 200", resp.StatusCode)
	}
}

func TestStaticPostFallsThroughToAPI(t *testing.T) {
	srv := newStatic(t)
	// A non-GET to a non-/api path is not a static resource — hand to the API,
	// which answers 404 (not a silent index.html).
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/whatever", nil)
	req.Header.Set("Authorization", "Bearer "+testToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("post non-api: got %d, want 404", resp.StatusCode)
	}
}

func TestHasDotSegment(t *testing.T) {
	for _, c := range []struct {
		p    string
		want bool
	}{
		{"/index.html", false},
		{"/assets/app.js", false},
		{"/.env", true},
		{"/foo/.git/config", true},
		{"/.", false},
	} {
		if got := hasDotSegment(c.p); got != c.want {
			t.Errorf("hasDotSegment(%q) = %v, want %v", c.p, got, c.want)
		}
	}
}
