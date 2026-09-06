package monitor

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/executor"
	"github.com/infrakit/backend/internal/userctx"
)

func init() { register(sshProbe{}) }

// NodeResolver resolves an ssh_node id to a connection target — wired from
// main.go against the orchestrator ssh_node registry + the Vault.
type NodeResolver func(ctx context.Context, nodeID string) (executor.SSHTarget, error)

var nodeResolver NodeResolver

// SetNodeResolver enables the `ssh` probe kind (host resolution + auth).
func SetNodeResolver(r NodeResolver) { nodeResolver = r }

// SSHResolverReady reports whether the ssh probe can resolve registered nodes.
func SSHResolverReady() bool { return nodeResolver != nil }

// sshProbe runs a command over SSH and asserts its result. config:
//
//	nodeId — an ssh_node id (auth + host from the registry)   OR
//	target = host, config.user (+ config.port) — agent auth only.
//	command — the shell command.
//	assert  — "exit0" (default) | "contains:<text>" | "matches:<regex>" |
//	          "num:<op><n>"  (op ∈ < <= > >= == != ; first number in stdout).
//
// value = the parsed number for a `num` assert, else the command's ms.
type sshProbe struct{}

func (sshProbe) Kind() string { return KindSSH }

func (sshProbe) Probe(ctx context.Context, m Monitor) Sample {
	command := strings.TrimSpace(m.cfgString("command"))
	if command == "" {
		return Sample{OK: false, Detail: "no command configured"}
	}

	var tgt executor.SSHTarget
	if nodeID := strings.TrimSpace(m.cfgString("nodeId")); nodeID != "" {
		if nodeResolver == nil {
			return Sample{OK: false, Detail: "ssh-node registry not available"}
		}
		t, err := nodeResolver(userctx.With(ctx, m.Owner), nodeID)
		if err != nil {
			return Sample{OK: false, Detail: errDetail("resolve node", err)}
		}
		tgt = t
	} else {
		tgt = executor.SSHTarget{
			Host: strings.TrimSpace(m.Target),
			User: m.cfgString("user"),
			Port: int(m.cfgFloat("port", 0)),
		}
	}
	if tgt.Host == "" || tgt.User == "" {
		return Sample{OK: false, Detail: "set nodeId, or target + user"}
	}

	start := time.Now()
	var out, errb bytes.Buffer
	res, _ := executor.SSHRun(ctx, &tgt, command, &out, &errb)
	elapsed := ms(time.Since(start))
	stdout := strings.TrimSpace(out.String())

	if res.Err != "" {
		return Sample{OK: false, Value: elapsed, Detail: errDetail("ssh", errors.New(res.Err))}
	}

	ok, val, detail := evalSSHAssert(nz(m.cfgString("assert"), "exit0"), res.ExitCode, stdout, elapsed)
	if detail == "" {
		detail = fmt.Sprintf("exit %d · %s", res.ExitCode, truncate(stdout, 80))
	}
	return Sample{OK: ok, Value: val, Detail: detail}
}

var numAssertRe = regexp.MustCompile(`^(<=|>=|==|!=|<|>)\s*(-?[0-9.]+)$`)
var firstNumRe = regexp.MustCompile(`-?[0-9]+(\.[0-9]+)?`)

func evalSSHAssert(spec string, exit int, stdout string, elapsedMs float64) (ok bool, value float64, detail string) {
	spec = strings.TrimSpace(spec)
	kind, arg, _ := strings.Cut(spec, ":")

	switch kind {
	case "", "exit0":
		return exit == 0, elapsedMs, ""
	case "contains":
		hit := strings.Contains(stdout, arg)
		if hit {
			return true, elapsedMs, ""
		}
		return false, elapsedMs, "output missing: " + arg
	case "matches":
		re, err := regexp.Compile(arg)
		if err != nil {
			return false, elapsedMs, "bad regex: " + arg
		}
		if re.MatchString(stdout) {
			return true, elapsedMs, ""
		}
		return false, elapsedMs, "output doesn't match /" + arg + "/"
	case "num":
		mm := numAssertRe.FindStringSubmatch(strings.TrimSpace(arg))
		if mm == nil {
			return false, 0, "bad num assert: " + arg
		}
		want, _ := strconv.ParseFloat(mm[2], 64)
		gotStr := firstNumRe.FindString(stdout)
		if gotStr == "" {
			return false, 0, "no number in output"
		}
		got, _ := strconv.ParseFloat(gotStr, 64)
		pass := false
		switch mm[1] {
		case "<":
			pass = got < want
		case "<=":
			pass = got <= want
		case ">":
			pass = got > want
		case ">=":
			pass = got >= want
		case "==":
			pass = got == want
		case "!=":
			pass = got != want
		}
		if pass {
			return true, got, fmt.Sprintf("%g %s %g", got, mm[1], want)
		}
		return false, got, fmt.Sprintf("%g not %s %g", got, mm[1], want)
	default:
		return exit == 0, elapsedMs, ""
	}
}

func truncate(s string, n int) string {
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
