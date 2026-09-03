package executor

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// sshExecutor runs a step's script on a remote host over SSH. The connection
// details (already resolved from the SSH Nodes registry + Vault by the run
// engine) are on step.SSH. Host keys are pinned: the first connection records
// the fingerprint on the node, a later mismatch aborts the run.
// See RUNBOOK_MODULE_PLAN.md §3.1 / §8.
type sshExecutor struct{}

// HostKeyResult is filled after a connection so the engine can persist a
// newly-learned fingerprint or surface a mismatch.
type HostKeyResult struct {
	Fingerprint string
	Mismatch    bool
	Learned     bool
}

func (sshExecutor) Run(ctx context.Context, step Step, stdout, stderr io.Writer) Result {
	t := step.SSH
	if t == nil || t.Host == "" || t.User == "" {
		return Result{ExitCode: -1, Err: "ssh step is missing host/user"}
	}
	res, hk := runSSH(ctx, t, step.Script, stdout, stderr)
	res.HostKeyFP = hk.Fingerprint
	res.HostKeyMismatch = hk.Mismatch
	res.HostKeyLearned = hk.Learned
	if hk.Mismatch {
		res.Err = fmt.Sprintf("host key mismatch for %s (got %s) — connection refused", t.Host, hk.Fingerprint)
		res.ExitCode = -1
	}
	return res
}

// Connect just opens (and closes) a session — used by the "Test connection"
// endpoint. Returns the host-key outcome.
func SSHTest(ctx context.Context, t *SSHTarget) (HostKeyResult, error) {
	cfg, hkCh, err := clientConfig(t)
	if err != nil {
		return HostKeyResult{}, err
	}
	d := net.Dialer{Timeout: 10 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort(t.Host, portOr(t.Port)))
	if err != nil {
		return HostKeyResult{}, err
	}
	defer conn.Close()
	c, chans, reqs, err := ssh.NewClientConn(conn, net.JoinHostPort(t.Host, portOr(t.Port)), cfg)
	hk := drainHostKey(hkCh)
	if err != nil {
		if hk.Mismatch {
			return hk, fmt.Errorf("host key mismatch")
		}
		return hk, err
	}
	cl := ssh.NewClient(c, chans, reqs)
	defer cl.Close()
	sess, err := cl.NewSession()
	if err != nil {
		return hk, err
	}
	_ = sess.Close()
	return hk, nil
}

// SSHRun opens a session to `t`, runs `script` under bash, and streams its
// stdout/stderr to the writers, blocking until it exits. Host keys are pinned
// exactly as a runbook SSH step. Exported for the Ansible module's remote
// execution backend (AN6d) — same code path, no new dep.
func SSHRun(ctx context.Context, t *SSHTarget, script string, stdout, stderr io.Writer) (Result, HostKeyResult) {
	return runSSHIO(ctx, t, script, nil, stdout, stderr)
}

// SSHRunStdin is SSHRun with `stdin` piped to the remote command — used to
// stream a tar archive of the project onto the control node.
func SSHRunStdin(ctx context.Context, t *SSHTarget, script string, stdin io.Reader, stdout, stderr io.Writer) (Result, HostKeyResult) {
	return runSSHIO(ctx, t, script, stdin, stdout, stderr)
}

func runSSH(ctx context.Context, t *SSHTarget, script string, stdout, stderr io.Writer) (Result, HostKeyResult) {
	return runSSHIO(ctx, t, script, nil, stdout, stderr)
}

func runSSHIO(ctx context.Context, t *SSHTarget, script string, stdin io.Reader, stdout, stderr io.Writer) (Result, HostKeyResult) {
	cfg, hkCh, err := clientConfig(t)
	if err != nil {
		return Result{ExitCode: -1, Err: err.Error()}, HostKeyResult{}
	}
	addr := net.JoinHostPort(t.Host, portOr(t.Port))
	d := net.Dialer{Timeout: 15 * time.Second}
	netConn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return Result{ExitCode: -1, Err: err.Error()}, HostKeyResult{}
	}
	c, chans, reqs, err := ssh.NewClientConn(netConn, addr, cfg)
	hk := drainHostKey(hkCh)
	if err != nil {
		_ = netConn.Close()
		return Result{ExitCode: -1, Err: err.Error()}, hk
	}
	client := ssh.NewClient(c, chans, reqs)
	defer client.Close()

	sess, err := client.NewSession()
	if err != nil {
		return Result{ExitCode: -1, Err: err.Error()}, hk
	}
	defer sess.Close()

	var outBuf, errBuf bytes.Buffer
	sess.Stdout = io.MultiWriter(stdout, &outBuf)
	sess.Stderr = io.MultiWriter(stderr, &errBuf)
	if stdin != nil {
		sess.Stdin = stdin
	}

	cmd := script
	if t.Sudo {
		// Non-interactive sudo; the operator is expected to have NOPASSWD or a
		// cached credential. A password prompt will just fail the step.
		cmd = "sudo -n bash -c " + shSingleQuote(script)
	} else {
		cmd = "bash -c " + shSingleQuote(script)
	}

	done := make(chan error, 1)
	go func() { done <- sess.Run(cmd) }()

	select {
	case <-ctx.Done():
		_ = sess.Signal(ssh.SIGKILL)
		_ = sess.Close()
		return Result{ExitCode: -1, Stdout: outBuf.String(), Stderr: errBuf.String(), Err: "timed out"}, hk
	case runErr := <-done:
		r := Result{Stdout: outBuf.String(), Stderr: errBuf.String()}
		if runErr == nil {
			r.ExitCode = 0
		} else if ee, ok := runErr.(*ssh.ExitError); ok {
			r.ExitCode = ee.ExitStatus()
		} else {
			r.ExitCode = -1
			r.Err = runErr.Error()
		}
		return r, hk
	}
}

func clientConfig(t *SSHTarget) (*ssh.ClientConfig, chan HostKeyResult, error) {
	var auths []ssh.AuthMethod
	if t.PrivateKey != "" {
		signer, err := ssh.ParsePrivateKey([]byte(t.PrivateKey))
		if err != nil {
			return nil, nil, fmt.Errorf("parse private key: %w", err)
		}
		auths = append(auths, ssh.PublicKeys(signer))
	}
	if t.Password != "" {
		auths = append(auths, ssh.Password(t.Password))
	}
	if len(auths) == 0 {
		return nil, nil, fmt.Errorf("no ssh credentials (need a password or key secret)")
	}

	hkCh := make(chan HostKeyResult, 1)
	cb := func(_ string, _ net.Addr, key ssh.PublicKey) error {
		fp := ssh.FingerprintSHA256(key)
		if t.HostKeyFP == "" {
			hkCh <- HostKeyResult{Fingerprint: fp, Learned: true}
			return nil // trust on first use
		}
		if fp != t.HostKeyFP {
			hkCh <- HostKeyResult{Fingerprint: fp, Mismatch: true}
			return fmt.Errorf("host key mismatch")
		}
		hkCh <- HostKeyResult{Fingerprint: fp}
		return nil
	}

	return &ssh.ClientConfig{
		User:            t.User,
		Auth:            auths,
		HostKeyCallback: cb,
		Timeout:         15 * time.Second,
	}, hkCh, nil
}

func drainHostKey(ch chan HostKeyResult) HostKeyResult {
	select {
	case hk := <-ch:
		return hk
	default:
		return HostKeyResult{}
	}
}

func portOr(p int) string {
	if p == 0 {
		return "22"
	}
	return fmt.Sprintf("%d", p)
}

// shSingleQuote wraps s so it survives being passed as one bash -c argument.
func shSingleQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// FingerprintFromAuthorizedKey is a small helper for tests / node import.
func FingerprintFromAuthorizedKey(line string) (string, error) {
	key, _, _, _, err := ssh.ParseAuthorizedKey([]byte(line))
	if err != nil {
		return "", err
	}
	return ssh.FingerprintSHA256(key), nil
}
