package server

import (
	"net/http"
	"testing"
)

func TestSameOrigin(t *testing.T) {
	defer SetTrustProxy(false)

	r := &http.Request{Host: "studio.example.com", Header: http.Header{}}
	if !sameOrigin("https://studio.example.com", r) {
		t.Error("same host should match")
	}
	if sameOrigin("https://evil.example.com", r) {
		t.Error("different host must not match")
	}
	if sameOrigin("not a url", r) {
		t.Error("garbage origin must not match")
	}

	// X-Forwarded-Host is ignored unless a trusted proxy is declared.
	r.Header.Set("X-Forwarded-Host", "studio.example.com")
	r.Host = "127.0.0.1:8080"
	if sameOrigin("https://studio.example.com", r) {
		t.Error("must not trust X-Forwarded-Host without --behind-proxy")
	}
	SetTrustProxy(true)
	if !sameOrigin("https://studio.example.com", r) {
		t.Error("should trust X-Forwarded-Host with --behind-proxy")
	}
}

func TestCORSAllowsSameOrigin(t *testing.T) {
	srv := newTestServer(t)
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/v1/health", nil)
	req.Header.Set("Authorization", "Bearer "+testToken)
	// Pretend the browser is on the same origin it's calling.
	req.Host = req.URL.Host
	req.Header.Set("Origin", "http://"+req.URL.Host)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.Header.Get("Access-Control-Allow-Origin") == "" {
		t.Error("same-origin request should get an ACAO header")
	}
}
