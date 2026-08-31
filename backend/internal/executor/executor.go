// Package executor runs one runbook step. Each executor kind (shell, ssh, http)
// is an adapter; the run engine (internal/orchestrator) picks one per step,
// hands it the fully-resolved script, and streams stdout/stderr to the client.
// See RUNBOOK_MODULE_PLAN.md §6.1.
package executor

import (
	"context"
	"io"
	"runtime"
)

// Kind identifies an executor.
type Kind string

const (
	KindPowerShell Kind = "powershell"
	KindCmd        Kind = "cmd"
	KindBash       Kind = "bash"
	KindSSH        Kind = "ssh"
	KindHTTP       Kind = "http"
)

// Step is the resolved unit an executor runs: the script already has every
// {{VAR}} / {{secret:…}} / {{steps.N.…}} substituted in.
type Step struct {
	Kind    Kind
	Script  string
	Env     map[string]string
	// SSH holds the connection for ssh steps (R2 — nil for R0/R1).
	SSH *SSHTarget
	// HTTP holds the request for http steps (R2 — nil for R0/R1).
	HTTP *HTTPRequest
}

// SSHTarget — populated in R2.
type SSHTarget struct {
	Host       string
	Port       int
	User       string
	Password   string // resolved from the vault
	PrivateKey string // resolved from the vault
	Sudo       bool
	HostKeyFP  string
}

// HTTPRequest is one resolved request an http step performs.
type HTTPRequest struct {
	Method       string
	URL          string
	Headers      map[string]string
	Body         string
	ExpectStatus []int
	Assert       []HTTPAssertion
}

// HTTPAssertion checks a dot-path in the JSON response body.
type HTTPAssertion struct {
	JSONPath string
	Equals   string
}

// Result is what a finished step reports.
type Result struct {
	ExitCode int    `json:"exitCode"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	// Err is a transport/spawn failure (not a non-zero exit).
	Err string `json:"error,omitempty"`
	// SSH only: the host key learned/seen this connection, and whether it
	// mismatched a pinned one. The engine persists a newly-learned key.
	HostKeyFP       string `json:"-"`
	HostKeyMismatch bool   `json:"-"`
	HostKeyLearned  bool   `json:"-"`
}

// Executor runs a resolved step, streaming output as it arrives.
type Executor interface {
	Run(ctx context.Context, step Step, stdout, stderr io.Writer) Result
}

// For returns the executor for a kind, or nil if unknown / unsupported here.
func For(k Kind) Executor {
	switch k {
	case KindPowerShell, KindCmd:
		if runtime.GOOS != "windows" {
			return nil
		}
		return shellExecutor{}
	case KindBash:
		return shellExecutor{}
	case KindSSH:
		return sshExecutor{}
	case KindHTTP:
		return httpExecutor{}
	default:
		return nil
	}
}

// AvailableKinds reports which executor kinds this host can run — feeds the
// `runbook.executors` capability so the UI greys out the rest.
func AvailableKinds() map[Kind]bool {
	m := map[Kind]bool{
		KindBash: true,
		KindSSH:  true, // pure-Go client, always available
		KindHTTP: true,
	}
	if runtime.GOOS == "windows" {
		m[KindPowerShell] = true
		m[KindCmd] = true
	}
	return m
}
