package apierr

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWrite(t *testing.T) {
	w := httptest.NewRecorder()
	Write(w, Auth("bad key"))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", w.Code)
	}
	if b := w.Body.String(); !contains(b, `"code":"auth_failed"`) || !contains(b, `"error":"bad key"`) || !contains(b, `"hint":`) {
		t.Fatalf("body = %s", b)
	}

	// a plain error → internal / 500
	w = httptest.NewRecorder()
	Write(w, errors.New("boom"))
	if w.Code != http.StatusInternalServerError || !contains(w.Body.String(), `"code":"internal"`) {
		t.Fatalf("plain: %d %s", w.Code, w.Body.String())
	}
}

func TestClassifyHTTP(t *testing.T) {
	cases := map[int]Code{401: CodeAuth, 403: CodePermission, 404: CodeNotFound, 429: CodeRateLimited, 500: CodeUpstream, 400: CodeUpstream}
	for status, want := range cases {
		if got := ClassifyHTTP("prov", status, "msg").Code; got != want {
			t.Errorf("status %d → %s, want %s", status, got, want)
		}
	}
}

func TestClassifyNet(t *testing.T) {
	if ClassifyNet(nil) != nil {
		t.Fatal("nil in nil out")
	}
	if ClassifyNet(errors.New("context canceled")) != nil {
		t.Fatal("cancelled ctx should be nil")
	}
	if ClassifyNet(errors.New("dial tcp 1.2.3.4:80: connect: connection refused")).Code != CodeUnreachable {
		t.Fatal("refused → unreachable")
	}
	if ClassifyNet(errors.New("Get x: context deadline exceeded")).Code != CodeTimeout {
		t.Fatal("deadline → timeout")
	}
	if ClassifyNet(errors.New("something weird")).Code != CodeUpstream {
		t.Fatal("unknown → upstream")
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
