package ipgeo

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFormatBlockOrdersKnownFieldsFirst(t *testing.T) {
	raw := map[string]any{
		"status":  "success",
		"country": "Testland",
		"isp":     "TestNet",
		"query":   "1.2.3.4",
		"zzz":     "extra",
	}
	order, text := formatBlock(raw)
	if order[0] != "country" {
		t.Fatalf("first field = %q, want country", order[0])
	}
	if order[len(order)-1] != "zzz" {
		t.Fatalf("last field = %q, want the unknown key zzz", order[len(order)-1])
	}
	if !strings.Contains(text, "country") || strings.Contains(text, "status") {
		t.Fatalf("text block wrong:\n%s", text)
	}
}

func TestLookupSurfacesAPIFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"fail","message":"invalid query"}`))
	}))
	defer srv.Close()

	// Point the package at the test server for this call.
	old := apiURLOverride
	apiURLOverride = srv.URL + "/"
	defer func() { apiURLOverride = old }()

	_, err := Lookup(context.Background(), srv.Client(), "bogus")
	if err == nil || !strings.Contains(err.Error(), "invalid query") {
		t.Fatalf("expected the API failure message, got %v", err)
	}
}
