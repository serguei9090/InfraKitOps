package orchestrator

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/infrakit/backend/internal/executor"
)

func TestExportImportLibrary(t *testing.T) {
	src := newStore(t)
	rb, _ := src.CreateRunbook("", Spec{
		Name: "Deploy", DefaultTimeoutSec: 30,
		Steps: []StepSpec{{Executor: executor.KindBash, Script: "echo deploy {{ENV}}"}},
	})
	_, _ = src.SaveVersion(rb.ID, "")

	dir := t.TempDir()
	report, err := src.ExportLibrary(context.Background(), dir, false, false)
	if err != nil {
		t.Fatalf("export: %v (%s)", err, report)
	}
	files, _ := os.ReadDir(dir)
	if len(files) != 1 || filepath.Ext(files[0].Name()) != ".json" {
		t.Fatalf("export files: %v", files)
	}

	// Import into a fresh store — should land one runbook.
	dst := newStore(t)
	n, err := dst.ImportLibrary("", dir)
	if err != nil || n != 1 {
		t.Fatalf("import: n=%d err=%v", n, err)
	}
	list, _ := dst.ListRunbooks("")
	if len(list) != 1 || list[0].currentSpec().Name != "Deploy" {
		t.Fatalf("imported: %+v", list)
	}
	// step ids regenerated
	if list[0].currentSpec().Steps[0].ID == rb.currentSpec().Steps[0].ID {
		t.Fatal("step id not regenerated on import")
	}

	// Re-import into the SAME store — name de-collides.
	n2, _ := dst.ImportLibrary("", dir)
	if n2 != 1 {
		t.Fatalf("re-import n=%d", n2)
	}
	list, _ = dst.ListRunbooks("")
	names := map[string]bool{}
	for _, r := range list {
		names[r.currentSpec().Name] = true
	}
	if !names["Deploy"] || !names["Deploy (imported)"] {
		t.Fatalf("de-collision failed: %v", names)
	}
}
