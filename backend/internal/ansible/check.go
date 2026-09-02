package ansible

import (
	"context"
	"encoding/json"
	"os/exec"
	"strings"
	"time"
)

// CheckResult is the outcome of --syntax-check or ansible-lint on a file.
type CheckResult struct {
	Kind   string      `json:"kind"` // "syntax" | "lint"
	OK     bool        `json:"ok"`
	Output string      `json:"output,omitempty"` // raw text (syntax-check, or lint fallback)
	Issues []LintIssue `json:"issues,omitempty"`
	Ran    bool        `json:"ran"` // false when the tool isn't installed
	Reason string      `json:"reason,omitempty"`
}

type LintIssue struct {
	Rule     string `json:"rule"`
	Message  string `json:"message"`
	Severity string `json:"severity"`
	Line     int    `json:"line"`
	Path     string `json:"path"`
}

// SyntaxCheck runs `ansible-playbook --syntax-check` on a project playbook.
func (e *Engine) SyntaxCheck(ctx context.Context, owner string, mode RuntimeMode, projectID, playbook string) (*CheckResult, error) {
	proj, err := e.store.GetProject(owner, projectID)
	if err != nil {
		return nil, err
	}
	abs, err := safeJoin(proj.Path, playbook)
	if err != nil {
		return nil, err
	}
	bin := e.rt.Bin(ctx, mode, "ansible-playbook")
	if bin == "" {
		return &CheckResult{Kind: "syntax", Ran: false, Reason: "ansible-playbook not available"}, nil
	}
	c, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(c, bin, "--syntax-check", abs)
	cmd.Dir = proj.Path
	cmd.Env = baseEnv()
	out, err := cmd.CombinedOutput()
	return &CheckResult{
		Kind:   "syntax",
		Ran:    true,
		OK:     err == nil,
		Output: strings.TrimSpace(string(out)),
	}, nil
}

// Lint runs `ansible-lint -f json` on a project path. Gated on ansible-lint
// being installed (it isn't part of ansible-core).
func (e *Engine) Lint(ctx context.Context, owner string, mode RuntimeMode, projectID, path string) (*CheckResult, error) {
	proj, err := e.store.GetProject(owner, projectID)
	if err != nil {
		return nil, err
	}
	abs, err := safeJoin(proj.Path, nz(path, "."))
	if err != nil {
		return nil, err
	}
	bin := e.rt.Bin(ctx, mode, "ansible-lint")
	if bin == "" {
		return &CheckResult{Kind: "lint", Ran: false, Reason: "ansible-lint is not installed (pip install ansible-lint)"}, nil
	}
	c, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	cmd := exec.CommandContext(c, bin, "-f", "json", abs)
	cmd.Dir = proj.Path
	cmd.Env = baseEnv()
	out, _ := cmd.Output() // non-zero exit == findings; parse anyway

	res := &CheckResult{Kind: "lint", Ran: true}
	var rows []struct {
		CheckName string `json:"check_name"`
		Severity  string `json:"severity"`
		Location  struct {
			Path  string `json:"path"`
			Lines struct {
				Begin int `json:"begin"`
			} `json:"lines"`
		} `json:"location"`
		Description string `json:"description"`
	}
	if json.Unmarshal(out, &rows) == nil && len(rows) > 0 {
		for _, r := range rows {
			res.Issues = append(res.Issues, LintIssue{
				Rule:     r.CheckName,
				Message:  r.Description,
				Severity: r.Severity,
				Line:     r.Location.Lines.Begin,
				Path:     r.Location.Path,
			})
		}
	} else {
		res.Output = strings.TrimSpace(string(out))
	}
	res.OK = len(res.Issues) == 0
	return res, nil
}
