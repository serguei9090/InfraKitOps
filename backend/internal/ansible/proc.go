package ansible

import (
	"bufio"
	"io"
	"os/exec"
	"sync"
)

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
