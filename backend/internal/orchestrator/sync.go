package orchestrator

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/userctx"
)

// exportFile is one runbook on disk. Secrets are never here — only `{{VAR}}` /
// `{{secret:NAME}}` refs, which is already the case in a Spec.
type exportFile struct {
	Format   string `json:"format"`
	V        int    `json:"v"`
	Slug     string `json:"slug"`
	Spec     Spec   `json:"spec"`
	Exported int64  `json:"exportedAt"`
}

const exportFormat = "infrakit-runbook"

// ExportLibrary writes one `<slug>.runbook.json` per runbook into dir. When
// gitCommit is set and dir is a git repo, it also stages + commits (and pushes
// when gitPush). Returns a human-readable report.
func (s *Store) ExportLibrary(ctx context.Context, dir string, gitCommit, gitPush bool) (string, error) {
	if strings.TrimSpace(dir) == "" {
		return "", fmt.Errorf("a target directory is required")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	rbs, err := s.ListRunbooks(userctx.From(ctx))
	if err != nil {
		return "", err
	}
	written := 0
	for _, rb := range rbs {
		sp := rb.currentSpec()
		if sp == nil {
			continue
		}
		f := exportFile{Format: exportFormat, V: 1, Slug: rb.Slug, Spec: *sp, Exported: time.Now().UnixMilli()}
		raw, _ := json.MarshalIndent(f, "", "  ")
		name := filepath.Join(dir, safeName(rb.Slug)+".runbook.json")
		if err := os.WriteFile(name, raw, 0o644); err != nil {
			return "", err
		}
		written++
	}
	report := fmt.Sprintf("wrote %d runbook file(s) to %s", written, dir)

	if gitCommit {
		if _, err := exec.LookPath("git"); err != nil {
			return report, fmt.Errorf("git not found on PATH")
		}
		if out, err := git(ctx, dir, "add", "-A"); err != nil {
			return report, fmt.Errorf("git add: %s", out)
		}
		msg := fmt.Sprintf("Runbooks export — %d runbook(s)", written)
		out, err := git(ctx, dir, "commit", "-m", msg)
		if err != nil && !strings.Contains(out, "nothing to commit") {
			return report, fmt.Errorf("git commit: %s", out)
		}
		report += "\n" + strings.TrimSpace(out)
		if gitPush {
			out, err := git(ctx, dir, "push")
			if err != nil {
				return report, fmt.Errorf("git push: %s", out)
			}
			report += "\n" + strings.TrimSpace(out)
		}
	}
	return report, nil
}

// ImportLibrary reads every `*.runbook.json` under dir and creates a runbook
// for each (new ids; a name that collides with an existing runbook gets
// " (imported)"). Returns how many landed.
func (s *Store) ImportLibrary(owner, dir string) (int, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, err
	}
	existing, _ := s.ListRunbooks(owner)
	taken := map[string]bool{}
	for _, rb := range existing {
		if sp := rb.currentSpec(); sp != nil {
			taken[sp.Name] = true
		}
	}

	added := 0
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".runbook.json") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			return added, err
		}
		var f exportFile
		if err := json.Unmarshal(raw, &f); err != nil || f.Format != exportFormat {
			continue
		}
		spec := f.Spec
		for i := range spec.Steps {
			spec.Steps[i].ID = newID("step")
		}
		if taken[spec.Name] {
			spec.Name += " (imported)"
		}
		taken[spec.Name] = true
		if _, err := s.CreateRunbook(owner, spec); err != nil {
			return added, err
		}
		added++
	}
	return added, nil
}

func git(ctx context.Context, dir string, args ...string) (string, error) {
	c := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	b, err := c.CombinedOutput()
	return string(b), err
}

func safeName(s string) string {
	s = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '-'
	}, strings.ToLower(s))
	if s == "" {
		return "runbook"
	}
	return s
}
