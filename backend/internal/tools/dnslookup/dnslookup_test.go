package dnslookup

import (
	"testing"
	"time"
)

func TestEnsurePort(t *testing.T) {
	cases := map[string]string{
		"":            "",
		"1.1.1.1":     "1.1.1.1:53",
		"1.1.1.1:853": "1.1.1.1:853",
		"dns.google":  "dns.google:53",
	}
	for in, want := range cases {
		if got := ensurePort(in); got != want {
			t.Errorf("ensurePort(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestQueryRejectsEmptyName(t *testing.T) {
	if _, err := Query(Options{}); err == nil {
		t.Fatal("expected an error for an empty name")
	}
}

func TestQueryReportsUnknownType(t *testing.T) {
	res, err := Query(Options{Name: "example.com", Types: []string{"BOGUS"}, Resolver: "127.0.0.1:59", Timeout: 200 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Errors) == 0 {
		t.Fatal("expected an error entry for the unknown type")
	}
}

func TestQueryLive(t *testing.T) {
	if testing.Short() {
		t.Skip("needs network")
	}
	res, err := Query(Options{Name: "one.one.one.one", Types: []string{"A"}, Resolver: "1.1.1.1", Recursion: true, Timeout: 4 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Records) == 0 {
		t.Skipf("resolver unreachable here: %+v", res.Errors)
	}
	if res.Records[0].Type != "A" {
		t.Fatalf("got %+v", res.Records[0])
	}
}
