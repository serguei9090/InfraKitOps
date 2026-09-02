package ansible

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// VaultOp is one ansible-vault action on a project file.
type VaultOp struct {
	ProjectID string `json:"projectId"`
	Path      string `json:"path"` // project-relative
	Op        string `json:"op"`   // encrypt | decrypt | view | rekey
}

// VaultResult carries the outcome. Content is set only for "view".
type VaultResult struct {
	Op      string `json:"op"`
	OK      bool   `json:"ok"`
	Content string `json:"content,omitempty"`
	Output  string `json:"output,omitempty"`
}

// writePwFile drops a secret into a 0600 temp file for --vault-password-file.
func writePwFile(secret string) (string, func(), error) {
	f, err := os.CreateTemp("", "infrakit-vault-pw-*")
	if err != nil {
		return "", func() {}, err
	}
	_ = f.Chmod(0o600)
	if _, err := f.WriteString(strings.TrimRight(secret, "\r\n") + "\n"); err != nil {
		_ = f.Close()
		_ = os.Remove(f.Name())
		return "", func() {}, err
	}
	_ = f.Close()
	return f.Name(), func() { _ = os.Remove(f.Name()) }, nil
}

// Vault runs one ansible-vault op. `password` is the resolved vault password
// (from the InfraKit Vault); `newPassword` is used only for rekey. The
// encrypted file always stays in the project directory.
func (e *Engine) Vault(ctx context.Context, owner string, mode RuntimeMode, spec VaultOp, password, newPassword string) (*VaultResult, error) {
	proj, err := e.store.GetProject(owner, spec.ProjectID)
	if err != nil {
		return nil, err
	}
	abs, err := safeJoin(proj.Path, spec.Path)
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(abs); err != nil {
		return nil, fmt.Errorf("file not found: %s", spec.Path)
	}
	bin := e.rt.Bin(ctx, mode, "ansible-vault")
	if bin == "" {
		return nil, fmt.Errorf("ansible-vault not available — check the Ansible runtime")
	}
	if strings.TrimSpace(password) == "" {
		return nil, fmt.Errorf("a vault password is required")
	}

	pwFile, cleanup, err := writePwFile(password)
	if err != nil {
		return nil, err
	}
	defer cleanup()

	var args []string
	switch spec.Op {
	case "encrypt", "decrypt", "view":
		args = []string{spec.Op, "--vault-password-file", pwFile, abs}
	case "rekey":
		if strings.TrimSpace(newPassword) == "" {
			return nil, fmt.Errorf("a new password is required to rekey")
		}
		newFile, newCleanup, nerr := writePwFile(newPassword)
		if nerr != nil {
			return nil, nerr
		}
		defer newCleanup()
		args = []string{"rekey", "--vault-password-file", pwFile, "--new-vault-password-file", newFile, abs}
	default:
		return nil, fmt.Errorf("unknown vault op %q", spec.Op)
	}

	c, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(c, bin, args...)
	cmd.Dir = proj.Path
	cmd.Env = baseEnv()
	out, runErr := cmd.CombinedOutput()

	res := &VaultResult{Op: spec.Op, OK: runErr == nil}
	if spec.Op == "view" && runErr == nil {
		res.Content = string(out)
	} else {
		res.Output = strings.TrimSpace(string(out))
	}
	if runErr != nil {
		return res, fmt.Errorf("ansible-vault %s: %s", spec.Op, strings.TrimSpace(string(out)))
	}
	return res, nil
}
