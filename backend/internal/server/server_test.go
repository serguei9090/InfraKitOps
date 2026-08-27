package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

const testToken = "test-token-123"

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(NewRouter(Options{Token: testToken}))
	t.Cleanup(srv.Close)
	return srv
}

func get(t *testing.T, url, token string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func TestHealthRequiresToken(t *testing.T) {
	srv := newTestServer(t)

	resp := get(t, srv.URL+"/api/v1/health", "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no token: got %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()

	resp = get(t, srv.URL+"/api/v1/health", "wrong")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("wrong token: got %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestHealthOK(t *testing.T) {
	srv := newTestServer(t)
	resp := get(t, srv.URL+"/api/v1/health", testToken)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("got %d, want 200", resp.StatusCode)
	}
	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["status"] != "ok" {
		t.Fatalf("status = %v, want ok", body["status"])
	}
	if _, ok := body["os"]; !ok {
		t.Fatal("health response missing os field")
	}
}

func TestInterfacesListsAtLeastLoopback(t *testing.T) {
	srv := newTestServer(t)
	resp := get(t, srv.URL+"/api/v1/interfaces", testToken)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("got %d, want 200", resp.StatusCode)
	}
	var body struct {
		Interfaces []struct {
			Name     string `json:"name"`
			MTU      int    `json:"mtu"`
			Loopback bool   `json:"loopback"`
		} `json:"interfaces"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Interfaces) == 0 {
		t.Fatal("no interfaces returned")
	}
	sawLoopback := false
	for _, ifi := range body.Interfaces {
		if ifi.Loopback {
			sawLoopback = true
		}
	}
	if !sawLoopback {
		t.Fatal("expected a loopback interface in the list")
	}
}

func TestCapabilitiesShapesResponse(t *testing.T) {
	srv := newTestServer(t)
	resp := get(t, srv.URL+"/api/v1/capabilities", testToken)
	defer resp.Body.Close()
	var body struct {
		Capabilities map[string]struct {
			Available bool `json:"available"`
		} `json:"capabilities"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if !body.Capabilities["subnet-calculator"].Available {
		t.Fatal("subnet-calculator should always be available")
	}
	if body.Capabilities["dns-lookup"].Available {
		t.Fatal("dns-lookup is not implemented yet in N0")
	}
}

func TestWatchdogIdleTimeoutFires(t *testing.T) {
	wd := NewWatchdog(60*time.Millisecond, 0)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	done := make(chan struct{})
	go func() { wd.Run(ctx); close(done) }()

	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("watchdog did not fire on idle timeout")
	}
}

func TestWatchdogTouchKeepsAlive(t *testing.T) {
	wd := NewWatchdog(120*time.Millisecond, 0)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan struct{})
	go func() { wd.Run(ctx); close(done) }()

	// Keep touching for longer than the timeout; Run must not return.
	deadline := time.After(400 * time.Millisecond)
	tick := time.NewTicker(40 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-done:
			t.Fatal("watchdog fired despite regular activity")
		case <-tick.C:
			wd.Touch()
		case <-deadline:
			return
		}
	}
}

func TestActivityCallbackInvoked(t *testing.T) {
	calls := 0
	h := NewRouter(Options{Token: testToken, OnActivity: func() { calls++ }})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	req.Header.Set("Authorization", "Bearer "+testToken)
	h.ServeHTTP(rec, req)
	if calls != 1 {
		t.Fatalf("OnActivity called %d times, want 1", calls)
	}
}
