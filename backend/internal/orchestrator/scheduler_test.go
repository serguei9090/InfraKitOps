package orchestrator

import (
	"context"
	"testing"
	"time"

	"github.com/infrakit/backend/internal/executor"
)

func TestSchedulePutValidatesAndAnchors(t *testing.T) {
	s := newStore(t)
	rb, _ := s.CreateRunbook("", Spec{Name: "S", Steps: []StepSpec{{Executor: executor.KindBash, Script: "echo hi"}}})
	s.SaveVersion(rb.ID, "")

	if _, err := s.PutSchedule("", RunSchedule{RunbookID: rb.ID, Cron: "not a cron", Enabled: true}); err == nil {
		t.Fatal("expected cron parse error")
	}
	if _, err := s.PutSchedule("", RunSchedule{RunbookID: "rb_missing", Cron: "@daily", Enabled: true}); err == nil {
		t.Fatal("expected missing-runbook error")
	}

	sc, err := s.PutSchedule("", RunSchedule{RunbookID: rb.ID, Cron: "*/5 * * * *", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if sc.NextRunAt == 0 || time.UnixMilli(sc.NextRunAt).Before(time.Now()) {
		t.Fatalf("NextRunAt not anchored in the future: %d", sc.NextRunAt)
	}

	// disabling clears NextRunAt
	sc.Enabled = false
	sc, _ = s.PutSchedule("", sc)
	if sc.NextRunAt != 0 {
		t.Fatalf("disabled schedule keeps NextRunAt = %d", sc.NextRunAt)
	}

	list, _ := s.ListSchedules("")
	if len(list) != 1 {
		t.Fatalf("list = %d", len(list))
	}
	if err := s.DeleteSchedule("", sc.ID); err != nil {
		t.Fatal(err)
	}
	if list, _ := s.ListSchedules(""); len(list) != 0 {
		t.Fatalf("after delete list = %d", len(list))
	}
}

func TestSchedulerFiresDueRun(t *testing.T) {
	if executor.For(executor.KindBash) == nil {
		t.Skip("no bash")
	}
	s := newStore(t)
	rb, _ := s.CreateRunbook("", Spec{Name: "Due", DefaultTimeoutSec: 5, Steps: []StepSpec{{Executor: executor.KindBash, Script: "echo scheduled-ok"}}})
	s.SaveVersion(rb.ID, "")
	s.SetPublished(rb.ID, true)

	sc, _ := s.PutSchedule("", RunSchedule{RunbookID: rb.ID, Cron: "@daily", Enabled: true})
	// force it due
	sc.NextRunAt = time.Now().Add(-time.Minute).UnixMilli()
	s.saveScheduleRaw(sc)

	sched := &Scheduler{store: s, engine: NewEngine(s, nil, 4), interval: time.Hour, running: map[string]bool{}}
	sched.tick(context.Background(), time.Now())

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		runs, _ := s.ListRuns("", rb.ID, 10)
		if len(runs) == 1 && runs[0].Status != StatusRunning {
			if runs[0].TriggeredBy != "schedule" {
				t.Fatalf("triggeredBy = %q", runs[0].TriggeredBy)
			}
			got, _ := s.GetSchedule("", sc.ID)
			if got.LastStatus != StatusOK || got.NextRunAt <= time.Now().UnixMilli() {
				// NextRunAt should have advanced to tomorrow
				if got.NextRunAt <= time.Now().UnixMilli() {
					t.Fatalf("NextRunAt not advanced: %d", got.NextRunAt)
				}
			}
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("scheduled run did not complete in time")
}
