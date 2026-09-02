package ansible

import (
	_ "embed"
	"os"
	"path/filepath"
)

//go:embed callback/infrakit_events.py
var callbackPy []byte

// callbackDir writes the bundled streaming callback plugin into
// <cfgDir>/ansible-callback/ (idempotent) and returns that directory, for
// ANSIBLE_CALLBACK_PLUGINS.
func callbackDir(cfgDir string) (string, error) {
	dir := filepath.Join(cfgDir, "ansible-callback")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	dst := filepath.Join(dir, "infrakit_events.py")
	cur, _ := os.ReadFile(dst)
	if string(cur) != string(callbackPy) {
		if err := os.WriteFile(dst, callbackPy, 0o644); err != nil {
			return "", err
		}
	}
	return dir, nil
}
