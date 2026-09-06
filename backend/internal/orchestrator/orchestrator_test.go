package orchestrator

import (
	"context"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"

	"github.com/infrakit/backend/internal/executor"
)

func TestMarkRunningInterrupted(t *testing.T) {
	s := newStore(t)
	running, _ := s.InsertRun(&Run{RunbookID: "rb1", Status: StatusRunning, StartedAt: 1})
	parked, _ := s.InsertRun(&Run{RunbookID: "rb1", Status: StatusAwaitingApproval, StartedAt: 2})
	ok, _ := s.InsertRun(&Run{RunbookID: "rb1", Status: StatusOK, StartedAt: 3})

	n, err := s.MarkRunningInterrupted()
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("fixed %d rows, want 2", n)
	}
	for _, id := range []int64{running, parked} {
		r, _ := s.GetRun("", id)
		if r.Status != StatusInterrupted || r.FinishedAt == 0 {
			t.Errorf("run %d = %+v, want interrupted + finished_at", id, r)
		}
	}
	if r, _ := s.GetRun("", ok); r.Status != StatusOK {
		t.Errorf("finished run touched: %q", r.Status)
	}
	if n, _ := s.MarkRunningInterrupted(); n != 0 {
		t.Errorf("second call fixed %d, want 0", n)
	}
}

func TestExtractAndRender(t *testing.T) {
	script := "deploy {{APP}} to {{ENV}}, token {{secret:TOK}}, prev {{steps.1.stdout}}"
	if got := ExtractVars(script); len(got) != 4 {
		t.Fatalf("ExtractVars = %v", got)
	}
	spec := &Spec{Steps: []StepSpec{{Script: script}, {Script: "{{APP}} again"}}}
	if got := ExtractSpecArgs(spec); strings.Join(got, ",") != "APP,ENV" {
		t.Fatalf("ExtractSpecArgs = %v", got)
	}

	out, secrets := Render(script, Values{
		Args:  map[string]string{"APP": "web", "ENV": "prod"},
		Steps: []RunStep{{Stdout: "OK"}},
		ResolveSecret: func(name string) (string, error) {
			if name == "TOK" {
				return "s3cret", nil
			}
			return "", ErrNotFound
		},
	})
	if out != "deploy web to prod, token s3cret, prev OK" {
		t.Fatalf("Render = %q", out)
	}
	if !secrets["TOK"] {
		t.Fatalf("secrets = %v", secrets)
	}
	if got := Redact(out, map[string]string{"TOK": "s3cret"}); !strings.Contains(got, "‹secret:TOK›") {
		t.Fatalf("Redact = %q", got)
	}
}

func TestScanDestructive(t *testing.T) {
	hits := ScanDestructive("echo ok\nrm -rf /tmp/x\nDROP TABLE users;\n# rm -rf commented")
	if len(hits) != 2 {
		t.Fatalf("hits = %+v", hits)
	}
	if hits[0].Pattern != "rm -rf" || hits[1].Pattern != "DROP TABLE/DATABASE" {
		t.Fatalf("patterns = %+v", hits)
	}
}

func newStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open("file:" + filepath.Join(t.TempDir(), "o.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestRunbookCRUDAndVersions(t *testing.T) {
	s := newStore(t)
	rb, err := s.CreateRunbook("", Spec{Name: "Restart svc", DefaultTimeoutSec: 30, Steps: []StepSpec{{Executor: executor.KindBash, Script: "systemctl restart {{SVC}}"}}})
	if err != nil {
		t.Fatal(err)
	}
	if rb.Draft == nil || len(rb.Versions) != 0 {
		t.Fatal("fresh runbook should be draft-only")
	}

	if _, err := s.SaveVersion(rb.ID, "first"); err != nil {
		t.Fatal(err)
	}
	rb, _ = s.GetRunbook(rb.ID)
	if len(rb.Versions) != 1 || rb.Versions[0].Version != 1 || rb.Draft != nil {
		t.Fatalf("after save: %+v", rb)
	}

	// edit -> draft -> v2
	sp := rb.Versions[0].Spec
	sp.Steps[0].Script = "systemctl restart {{SVC}} --now"
	if err := s.SaveDraft(rb.ID, sp); err != nil {
		t.Fatal(err)
	}
	rb, _ = s.SaveVersion(rb.ID, "")
	if len(rb.Versions) != 2 {
		t.Fatalf("versions = %d", len(rb.Versions))
	}

	// delete latest is blocked; delete v1 works
	if err := s.DeleteVersion(rb.ID, 2); err == nil {
		t.Fatal("deleting latest should fail")
	}
	if err := s.DeleteVersion(rb.ID, 1); err != nil {
		t.Fatalf("delete v1: %v", err)
	}

	list, _ := s.ListRunbooks("")
	if len(list) != 1 {
		t.Fatalf("list = %d", len(list))
	}
}

func TestEnginePreviewValidation(t *testing.T) {
	s := newStore(t)
	rb, _ := s.CreateRunbook("", Spec{
		Name: "P", DefaultTimeoutSec: 5,
		Args:  []ArgSpec{{Name: "PORT", Type: ArgNumber, Required: true, ValidationPreset: "port"}},
		Steps: []StepSpec{{Executor: executor.KindBash, Script: "echo {{PORT}}"}},
	})
	rb, _ = s.SaveVersion(rb.ID, "")
	eng := NewEngine(s, nil, 4)

	p, _, _, err := eng.BuildPreview(context.Background(), rb, 0, map[string]string{})
	if err != nil {
		t.Fatal(err)
	}
	if p.Valid {
		t.Fatal("missing required PORT should be invalid")
	}
	p, _, _, _ = eng.BuildPreview(context.Background(), rb, 0, map[string]string{"PORT": "8080"})
	if !p.Valid || len(p.Steps) != 1 || !strings.Contains(p.Steps[0].Command, "8080") {
		t.Fatalf("preview = %+v", p)
	}
}

func TestEngineRunBash(t *testing.T) {
	if executor.For(executor.KindBash) == nil {
		t.Skip("no bash")
	}
	if runtime.GOOS == "windows" {
		t.Skip("bash path unreliable on windows CI")
	}
	s := newStore(t)
	rb, _ := s.CreateRunbook("", Spec{
		Name: "Two step", DefaultTimeoutSec: 5,
		Args: []ArgSpec{{Name: "MSG", Type: ArgString, Required: true}},
		Steps: []StepSpec{
			{Name: "say", Executor: executor.KindBash, Script: "echo hi-{{MSG}}"},
			{Name: "use prev", Executor: executor.KindBash, Script: "echo got:{{steps.1.stdout}}"},
		},
	})
	rb, _ = s.SaveVersion(rb.ID, "")
	eng := NewEngine(s, nil, 4)

	var mu sync.Mutex
	var events []string
	emit := func(ev string, _ any) { mu.Lock(); events = append(events, ev); mu.Unlock() }
	done := make(chan int64, 1)
	go func() {
		done <- eng.Run(context.Background(), rb, 0, map[string]string{"MSG": "there"}, false, "local", emit)
	}()
	runID := <-done

	if runID == 0 {
		t.Fatal("run id 0")
	}
	mu.Lock()
	sawEnd := false
	for _, ev := range events {
		if ev == "run-end" {
			sawEnd = true
		}
	}
	mu.Unlock()
	if !sawEnd {
		t.Fatalf("no run-end event; got %v", events)
	}
	run, err := s.GetRun("", runID)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != StatusOK || len(run.Steps) != 2 {
		t.Fatalf("run = %+v", run)
	}
	if !strings.Contains(run.Steps[0].Stdout, "hi-there") {
		t.Fatalf("step1 stdout = %q", run.Steps[0].Stdout)
	}
	if !strings.Contains(run.Steps[1].Stdout, "got:hi-there") {
		t.Fatalf("step2 stdout = %q (chaining broken)", run.Steps[1].Stdout)
	}
}
