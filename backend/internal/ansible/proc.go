package ansible

import (
	"bufio"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
)

// trimExecErr turns an *exec.ExitError into its stderr text when present.
func trimExecErr(err error) error {
	var ee *exec.ExitError
	if asExit(err, &ee) && len(ee.Stderr) > 0 {
		return fmt.Errorf("%s", strings.TrimSpace(string(ee.Stderr)))
	}
	return err
}

// runStreaming starts cmd, scans stdout and stderr line-by-line into their
// handlers, and blocks until the process exits. ctx cancellation should be
// wired via exec.CommandContext by the caller. Either handler may be nil.
func runStreaming(cmd *exec.Cmd, onStdout, onStderr func(string)) error {
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	var wg sync.WaitGroup
	scan := func(r io.Reader, h func(string)) {
		defer wg.Done()
		sc := bufio.NewScanner(r)
		sc.Buffer(make([]byte, 64<<10), 4<<20)
		for sc.Scan() {
			if h != nil {
				h(sc.Text())
			}
		}
	}
	wg.Add(2)
	go scan(stdout, onStdout)
	go scan(stderr, onStderr)
	wg.Wait()
	return cmd.Wait()
}
