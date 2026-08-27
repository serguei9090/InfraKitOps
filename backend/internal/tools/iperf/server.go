package iperf

import (
	"context"
	"fmt"
	"os/exec"
	"sync"

	"github.com/infrakit/backend/internal/cmdtool"
)

// A single managed `iperf3 -s` process, so a user can benchmark against this
// machine without a terminal. Killed when the backend exits.
var (
	srvMu   sync.Mutex
	srvCmd  *exec.Cmd
	srvPort int
)

// ServerStatus reports whether the managed server is running.
func ServerStatus() (running bool, port int) {
	srvMu.Lock()
	defer srvMu.Unlock()
	return srvCmd != nil && srvCmd.Process != nil, srvPort
}

// StartServer launches `iperf3 -s -p <port>` if not already running.
func StartServer(port int) error {
	if port <= 0 {
		port = 5201
	}
	bin, ok := resolveBin()
	if !ok {
		return ErrNotInstalled
	}
	srvMu.Lock()
	defer srvMu.Unlock()
	if srvCmd != nil {
		return nil // already running
	}
	cmd := exec.Command(bin, "-s", "-p", fmt.Sprint(port))
	cmdtool.HideConsole(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	srvCmd, srvPort = cmd, port
	go func() {
		_ = cmd.Wait()
		srvMu.Lock()
		if srvCmd == cmd {
			srvCmd, srvPort = nil, 0
		}
		srvMu.Unlock()
	}()
	return nil
}

// StopServer terminates the managed server.
func StopServer() {
	srvMu.Lock()
	defer srvMu.Unlock()
	if srvCmd != nil && srvCmd.Process != nil {
		_ = srvCmd.Process.Kill()
	}
	srvCmd, srvPort = nil, 0
}

// ShutdownServer is called from the backend's graceful shutdown.
func ShutdownServer(context.Context) { StopServer() }
