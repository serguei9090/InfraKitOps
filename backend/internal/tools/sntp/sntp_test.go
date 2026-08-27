package sntp

import (
	"testing"
	"time"
)

func TestMedian(t *testing.T) {
	cases := []struct {
		in   []float64
		want float64
	}{
		{nil, 0},
		{[]float64{1}, 1},
		{[]float64{3, 1, 2}, 2},
		{[]float64{4, 1, 3, 2}, 2.5},
	}
	for _, c := range cases {
		if got := median(c.in); got != c.want {
			t.Errorf("median(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestQueryReportsPerServerErrors(t *testing.T) {
	// An unroutable TEST-NET-1 address fails fast; no external dependency.
	res := Query(Options{Servers: []string{"192.0.2.1"}, Timeout: 300 * time.Millisecond})
	if res.OKCount != 0 {
		t.Fatalf("expected 0 ok, got %d", res.OKCount)
	}
	if len(res.Servers) != 1 || res.Servers[0].OK || res.Servers[0].Error == "" {
		t.Fatalf("expected a populated error row, got %+v", res.Servers)
	}
}

func TestQueryLive(t *testing.T) {
	if testing.Short() {
		t.Skip("needs network")
	}
	res := Query(Options{Servers: []string{"pool.ntp.org"}, Timeout: 5 * time.Second})
	if res.OKCount != 1 {
		t.Skipf("pool.ntp.org unreachable in this environment: %+v", res.Servers)
	}
	if res.Servers[0].RTTMillis <= 0 {
		t.Errorf("expected a positive RTT, got %v", res.Servers[0].RTTMillis)
	}
}
