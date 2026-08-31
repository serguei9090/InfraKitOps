package orchestrator

import (
	"testing"
	"time"
)

func TestParseCronErrors(t *testing.T) {
	for _, bad := range []string{"", "* * *", "60 * * * *", "* 24 * * *", "*/0 * * * *", "a * * * *", "1-70 * * * *"} {
		if _, err := ParseCron(bad); err == nil {
			t.Errorf("expected error for %q", bad)
		}
	}
}

func TestCronNext(t *testing.T) {
	base := time.Date(2026, 8, 31, 10, 15, 0, 0, time.UTC) // a Monday

	cases := []struct {
		expr string
		want time.Time
	}{
		{"*/15 * * * *", time.Date(2026, 8, 31, 10, 30, 0, 0, time.UTC)},
		{"0 * * * *", time.Date(2026, 8, 31, 11, 0, 0, 0, time.UTC)},
		{"30 2 * * *", time.Date(2026, 9, 1, 2, 30, 0, 0, time.UTC)},
		{"@daily", time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)},
		{"0 9 * * 1", time.Date(2026, 9, 7, 9, 0, 0, 0, time.UTC)}, // next Monday 09:00
		{"0 0 1 * *", time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)},
	}
	for _, c := range cases {
		expr, err := ParseCron(c.expr)
		if err != nil {
			t.Fatalf("%q: %v", c.expr, err)
		}
		got := expr.Next(base)
		if !got.Equal(c.want) {
			t.Errorf("%q: Next = %v, want %v", c.expr, got, c.want)
		}
	}
}

func TestCronDowOrDom(t *testing.T) {
	// Vixie semantics: both day fields restricted → union.
	expr, err := ParseCron("0 0 13 * 5") // the 13th OR any Friday
	if err != nil {
		t.Fatal(err)
	}
	// 2026-09-01 is a Tuesday; first match should be Friday 2026-09-04.
	base := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	got := expr.Next(base)
	want := time.Date(2026, 9, 4, 0, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("Next = %v, want %v", got, want)
	}
}
