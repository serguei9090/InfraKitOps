package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/infrakit/backend/internal/auth"
)

func newMultiUserServer(t *testing.T) (*httptest.Server, string) {
	t.Helper()
	store, err := auth.Open("file:" + filepath.Join(t.TempDir(), "auth.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	svc, err := auth.NewService(store)
	if err != nil {
		t.Fatal(err)
	}
	tok, _, err := svc.Bootstrap(svc.SetupToken(), "admin", "correct horse battery staple", "test")
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(NewRouter(Options{Auth: svc}))
	t.Cleanup(srv.Close)
	return srv, tok
}

func TestUserSettingsEndpoint(t *testing.T) {
	srv, tok := newMultiUserServer(t)

	// No session → 401.
	resp := get(t, srv.URL+"/api/v1/settings/user", "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no session: %d", resp.StatusCode)
	}
	resp.Body.Close()

	// Empty blob to start.
	resp = get(t, srv.URL+"/api/v1/settings/user", tok)
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !strings.Contains(string(body), `"data":{}`) {
		t.Fatalf("initial: %s", body)
	}

	// Write a patch, read it back.
	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/v1/settings/user",
		strings.NewReader(`{"theme":"light"}`))
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")
	if resp, err := http.DefaultClient.Do(req); err != nil {
		t.Fatal(err)
	} else {
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("put: %d", resp.StatusCode)
		}
	}

	resp = get(t, srv.URL+"/api/v1/settings/user", tok)
	body, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	var out struct {
		Data map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatal(err)
	}
	if string(out.Data["theme"]) != `"light"` {
		t.Fatalf("round-trip: %s", body)
	}
}
