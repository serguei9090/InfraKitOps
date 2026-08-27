package x509fetch

import (
	"context"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestFetchFromLocalTLSServer(t *testing.T) {
	srv := httptest.NewTLSServer(nil)
	defer srv.Close()
	u, _ := url.Parse(srv.URL)

	res, err := Fetch(context.Background(), u.Host)
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if res.CertCount < 1 || !strings.Contains(res.PEM, "BEGIN CERTIFICATE") {
		t.Errorf("no chain returned: %+v", res)
	}
	// httptest's cert is self-signed and not in the system store.
	if res.Trusted {
		t.Error("httptest self-signed cert should not verify as trusted")
	}
	if res.VerifyError == "" {
		t.Error("expected a verify error for the self-signed cert")
	}
	if res.TLSVersion == "" {
		t.Error("TLS version not reported")
	}
}

func TestFetchRejectsEmpty(t *testing.T) {
	if _, err := Fetch(context.Background(), "   "); err == nil {
		t.Error("expected an error for an empty host")
	}
}

func TestFetchUnreachable(t *testing.T) {
	if _, err := Fetch(context.Background(), "127.0.0.1:1"); err == nil {
		t.Error("expected a connection error")
	}
}
