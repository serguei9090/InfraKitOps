package ping

import (
	"context"
	"testing"
	"time"
)

func TestPercentileAndJitter(t *testing.T) {
	sorted := []float64{1, 2, 3, 4, 5, 6, 7, 8, 9, 10}
	if p := percentile(sorted, 95); p != 10 {
		t.Errorf("p95 = %v, want 10", p)
	}
	if p := percentile(sorted, 50); p != 5 {
		t.Errorf("p50 = %v, want 5", p)
	}
	if j := meanAbsDelta([]float64{10, 12, 10, 14}); j != (2+2+4)/3.0 {
		t.Errorf("jitter = %v", j)
	}
}

func TestSnapshotLossAndStatus(t *testing.T) {
	st := &hostState{}
	// 3 sent, 2 received
	st.sent, st.recv = 3, 2
	st.rtts = []float64{20, 40}
	s := st.snapshot("h")
	if s.LossPct != round(1.0/3*100) {
		t.Errorf("loss = %v", s.LossPct)
	}
	if s.MinMs != 20 || s.MaxMs != 40 || s.AvgMs != 30 {
		t.Errorf("stats = %+v", s)
	}
}

func TestMonitorFlapThresholds(t *testing.T) {
	// An unroutable address: every probe fails; status flips to "down" only
	// after DownThreshold consecutive failures.
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	statuses := []string{}
	final := Monitor(ctx, Options{
		Hosts:         []string{"192.0.2.1"},
		Interval:      150 * time.Millisecond,
		Timeout:       120 * time.Millisecond,
		DownThreshold: 3,
	}, func(ev string, p any) {
		if ev == "status" {
			statuses = append(statuses, p.(Stats).Status)
		}
	})

	fs := final["192.0.2.1"]
	if fs.Stats.Received != 0 {
		t.Fatalf("expected no replies, got %+v", fs.Stats)
	}
	if fs.Stats.Sent < 3 {
		t.Skipf("only %d probes completed in the window", fs.Stats.Sent)
	}
	if fs.Stats.Status != "down" {
		t.Fatalf("after %d failed sends status = %q, want down (status events: %v)", fs.Stats.Sent, fs.Stats.Status, statuses)
	}
	if len(statuses) != 1 || statuses[0] != "down" {
		t.Fatalf("expected exactly one status transition to down, got %v", statuses)
	}
}

func TestMonitorLive(t *testing.T) {
	if testing.Short() {
		t.Skip("needs network / ICMP")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2500*time.Millisecond)
	defer cancel()
	final := Monitor(ctx, Options{Hosts: []string{"1.1.1.1"}, Interval: 700 * time.Millisecond, Timeout: 2 * time.Second}, func(string, any) {})
	fs := final["1.1.1.1"]
	if fs.Stats.Received == 0 {
		t.Skipf("1.1.1.1 unreachable / ICMP blocked here: %+v", fs.Stats)
	}
	if fs.Stats.AvgMs <= 0 {
		t.Fatalf("expected a positive avg RTT: %+v", fs.Stats)
	}
}
