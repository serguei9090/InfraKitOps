package traceroute

import (
	"math"
	"testing"
	"time"
)

func ms(n float64) HopProbe {
	return HopProbe{RTT: time.Duration(n * float64(time.Millisecond)), Addr: "10.0.0.1"}
}

func TestHopAggStats(t *testing.T) {
	a := &hopAgg{ttl: 1}
	a.add(ms(10))
	a.add(ms(20))
	a.add(HopProbe{TimedOut: true})
	a.add(ms(30))

	s := a.stat()
	if s.Sent != 4 || s.Recv != 3 {
		t.Fatalf("sent/recv = %d/%d, want 4/3", s.Sent, s.Recv)
	}
	if s.LossPct != 25 {
		t.Errorf("lossPct = %v, want 25", s.LossPct)
	}
	if s.BestMs != 10 || s.WorstMs != 30 || s.LastMs != 30 {
		t.Errorf("best/worst/last = %v/%v/%v, want 10/30/30", s.BestMs, s.WorstMs, s.LastMs)
	}
	if s.AvgMs != 20 {
		t.Errorf("avg = %v, want 20", s.AvgMs)
	}
	// population-corrected stdev of {10,20,30} = 10
	if math.Abs(s.StdevMs-10) > 0.001 {
		t.Errorf("stdev = %v, want 10", s.StdevMs)
	}
	if s.Addr != "10.0.0.1" || len(s.Addrs) != 1 {
		t.Errorf("addrs = %v", s.Addrs)
	}
}

func TestHopAggAllTimeouts(t *testing.T) {
	a := &hopAgg{ttl: 5}
	for i := 0; i < 3; i++ {
		a.add(HopProbe{TimedOut: true})
	}
	s := a.stat()
	if s.LossPct != 100 {
		t.Errorf("lossPct = %v, want 100", s.LossPct)
	}
	if s.Recent == nil || s.Addrs == nil {
		t.Error("Recent/Addrs must marshal as [] not null")
	}
	if s.AvgMs != 0 || s.StdevMs != 0 {
		t.Errorf("no samples → avg/stdev must be 0, got %v/%v", s.AvgMs, s.StdevMs)
	}
}

func TestHopAggECMP(t *testing.T) {
	a := &hopAgg{ttl: 2}
	a.add(HopProbe{RTT: time.Millisecond, Addr: "10.0.0.1"})
	a.add(HopProbe{RTT: time.Millisecond, Addr: "10.0.0.2"})
	a.add(HopProbe{RTT: time.Millisecond, Addr: "10.0.0.1"})
	s := a.stat()
	if len(s.Addrs) != 2 {
		t.Fatalf("ECMP: want 2 distinct addrs, got %v", s.Addrs)
	}
	if s.Addr != "10.0.0.1" {
		t.Errorf("primary addr = %q, want last responder 10.0.0.1", s.Addr)
	}
}

func TestRecentRingBounded(t *testing.T) {
	a := &hopAgg{ttl: 1}
	for i := 0; i < recentCap+15; i++ {
		a.add(ms(float64(i)))
	}
	if len(a.recent) != recentCap {
		t.Errorf("recent len = %d, want %d", len(a.recent), recentCap)
	}
	if a.recent[len(a.recent)-1] != float64(recentCap+14) {
		t.Errorf("ring did not keep the newest sample: %v", a.recent[len(a.recent)-1])
	}
}

func TestLegacyHop(t *testing.T) {
	h := legacyHop(3, []HopProbe{
		{RTT: 5 * time.Millisecond, Addr: "1.2.3.4"},
		{TimedOut: true},
		{RTT: 7 * time.Millisecond, Addr: "1.2.3.4", Reached: true},
	}, "host.example")
	if h.TTL != 3 || h.Addr != "1.2.3.4" || h.Timeouts != 1 || !h.Reached {
		t.Fatalf("legacyHop = %+v", h)
	}
	if len(h.RTTsMs) != 2 {
		t.Errorf("rttsMs = %v, want 2 entries", h.RTTsMs)
	}
	if h.Hostname != "host.example" {
		t.Errorf("hostname = %q", h.Hostname)
	}
}
