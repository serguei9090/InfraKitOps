package llm

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/infrakit/backend/internal/apierr"
)

func TestProviderClassifiesHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":{"message":"Incorrect API key"}}`))
	}))
	defer srv.Close()

	_, err := openAICompatibleProvider{}.ListModels(context.Background(), Connection{BaseURL: srv.URL}, "bad")
	var ae *apierr.Error
	if !errors.As(err, &ae) || ae.Code != apierr.CodeAuth {
		t.Fatalf("want auth_failed, got %v", err)
	}
}

func TestProviderClassifiesDialError(t *testing.T) {
	// nothing listening on this port
	_, err := ollamaProvider{}.ListModels(context.Background(), Connection{BaseURL: "http://127.0.0.1:59999"}, "")
	var ae *apierr.Error
	if !errors.As(err, &ae) || ae.Code != apierr.CodeUnreachable {
		t.Fatalf("want unreachable, got %v", err)
	}
}
