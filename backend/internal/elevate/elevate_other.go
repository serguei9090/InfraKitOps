//go:build !windows

package elevate

import (
	"context"
	"fmt"
	"os/exec"
	"time"
)

// runElevated launches the helper via pkexec (polkit graphical prompt). sudo is
// avoided because it needs a controlling TTY. On systems without polkit this
// fails and the caller surfaces "needs elevation".
func runElevated(helper, reqFile, respFile string) error {
	if _, err := exec.LookPath("pkexec"); err != nil {
		return fmt.Errorf("pkexec (polkit) not available — cannot elevate")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "pkexec", helper, reqFile, respFile)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("pkexec: %w", err)
	}
	return nil
}
