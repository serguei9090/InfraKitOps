// Package configcheck runs a config file through the matching OS validator in
// check-only mode (nginx -t, sshd -t, ssh -G, nft -c, fail2ban-client -t,
// sysctl --dry-run). It never applies anything and never needs root. When the
// validator is not installed it returns Available=false so the UI can say so.
// See TOOL_STRATEGY_REVIEW.md bucket 2.
package configcheck

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/cmdtool"
)

// Kind identifies which validator to use.
type Kind string

const (
	Nginx    Kind = "nginx"
	SSHD     Kind = "sshd"
	SSHConf  Kind = "ssh"
	NFTables Kind = "nftables"
	Fail2ban Kind = "fail2ban"
	Sysctl   Kind = "sysctl"
)

// Message is one diagnostic line from the validator.
type Message struct {
	Level string `json:"level"` // "error" | "warning" | "info"
	Line  int    `json:"line,omitempty"`
	Text  string `json:"text"`
}

// Result is what the endpoint returns.
type Result struct {
	Kind      Kind      `json:"kind"`
	Validator string    `json:"validator"`
	Available bool      `json:"available"`
	OK        bool      `json:"ok"`
	Messages  []Message `json:"messages"`
	Raw       string    `json:"raw,omitempty"`
}

type spec struct {
	// bins are candidate executable names / paths, tried in order.
	bins []string
	// build returns (bin, args, cleanup) for a given input written to dir.
	build func(dir, file string) (string, []string)
	// wrapExt is the extension for the written temp file.
	fileName string
	// linuxOnly validators are reported unavailable on other platforms even
	// if a same-named binary exists.
	linuxOnly bool
}

var specs = map[Kind]spec{
	Nginx: {
		bins:     []string{"nginx"},
		fileName: "snippet.conf",
		build: func(dir, file string) (string, []string) {
			// nginx -t needs a complete config; wrap the server-block snippet.
			wrapper := filepath.Join(dir, "nginx.conf")
			_ = os.WriteFile(wrapper, []byte(
				"events {}\nhttp {\n  include "+file+";\n}\n"), 0o600)
			return "nginx", []string{"-t", "-c", wrapper,
				"-g", "pid " + filepath.Join(dir, "n.pid") + "; error_log stderr;"}
		},
	},
	SSHD: {
		bins:     []string{"sshd", "/usr/sbin/sshd", "/usr/local/sbin/sshd"},
		fileName: "sshd_config",
		build: func(_, file string) (string, []string) {
			return "sshd", []string{"-t", "-f", file}
		},
	},
	SSHConf: {
		bins:     []string{"ssh"},
		fileName: "ssh_config",
		build: func(_, file string) (string, []string) {
			return "ssh", []string{"-G", "-F", file, "configcheck.invalid"}
		},
	},
	NFTables: {
		bins:      []string{"nft", "/usr/sbin/nft"},
		fileName:  "ruleset.nft",
		linuxOnly: true,
		build: func(_, file string) (string, []string) {
			return "nft", []string{"-c", "-f", file}
		},
	},
	Fail2ban: {
		bins:      []string{"fail2ban-client"},
		fileName:  "jail.local",
		linuxOnly: true,
		build: func(dir, _ string) (string, []string) {
			return "fail2ban-client", []string{"-t", "-c", dir}
		},
	},
	Sysctl: {
		bins:      []string{"sysctl", "/usr/sbin/sysctl"},
		fileName:  "99-tuning.conf",
		linuxOnly: true,
		build: func(_, file string) (string, []string) {
			return "sysctl", []string{"--dry-run", "-p", file}
		},
	},
}

// SupportedKinds lists the validator kinds the endpoint accepts.
func SupportedKinds() []Kind {
	return []Kind{Nginx, SSHD, SSHConf, NFTables, Fail2ban, Sysctl}
}

func resolveBin(candidates []string) (string, bool) {
	for _, c := range candidates {
		if strings.ContainsRune(c, filepath.Separator) {
			if fi, err := os.Stat(c); err == nil && !fi.IsDir() {
				return c, true
			}
			continue
		}
		if p, err := exec.LookPath(c); err == nil {
			return p, true
		}
	}
	return "", false
}

// Validate writes text to a private temp file and runs the matching validator.
func Validate(ctx context.Context, kind Kind, text string) (Result, error) {
	res := Result{Kind: kind, Messages: []Message{}}
	sp, ok := specs[kind]
	if !ok {
		res.Messages = append(res.Messages, Message{Level: "error", Text: "unknown config kind"})
		return res, nil
	}
	if sp.linuxOnly && runtime.GOOS != "linux" {
		res.Validator = sp.bins[0]
		res.Available = false
		return res, nil
	}
	if _, found := resolveBin(sp.bins); !found {
		res.Validator = sp.bins[0]
		res.Available = false
		return res, nil
	}
	res.Available = true

	dir, err := os.MkdirTemp("", "cfgcheck-")
	if err != nil {
		return res, err
	}
	defer os.RemoveAll(dir)

	file := filepath.Join(dir, sp.fileName)
	if err := os.WriteFile(file, []byte(text), 0o600); err != nil {
		return res, err
	}

	bin, args := sp.build(dir, file)
	res.Validator = strings.TrimSpace(scrub(bin+" "+strings.Join(args, " "), dir))

	runCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	// These validators print their real config dump to stdout and their
	// diagnostics to stderr; exiting non-zero for an invalid config is a
	// normal result here, not a transport error.
	cmd := exec.CommandContext(runCtx, bin, args...)
	cmdtool.HideConsole(cmd)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	exitErr := cmd.Run()

	diag := strings.TrimSpace(stderr.String())
	if diag == "" && exitErr != nil {
		// Some tools (fail2ban-client) report on stdout.
		diag = strings.TrimSpace(stdout.String())
	}
	res.Raw = strings.TrimSpace(scrub(diag, dir))
	res.Messages = parseMessages(res.Raw)
	res.OK = exitErr == nil && !hasError(res.Messages)
	if res.OK {
		// The config is fine — drop validator chatter ("Pseudo-terminal will
		// not be allocated", "syntax is ok", …) and report a single line.
		res.Messages = []Message{{Level: "info", Text: "no problems reported"}}
	}
	return res, nil
}

var tmpPathRe = regexp.MustCompile(`(?i)\S*cfgcheck-\d+[/\\]?`)

// scrub removes the temp-dir path from output so users don't see it.
func scrub(s, dir string) string {
	s = strings.ReplaceAll(s, dir+string(filepath.Separator), "")
	s = strings.ReplaceAll(s, dir+"/", "")
	s = strings.ReplaceAll(s, dir, "")
	s = tmpPathRe.ReplaceAllString(s, "")
	// Tidy any leading path separator left where the dir prefix was removed.
	lines := strings.Split(s, "\n")
	for i, ln := range lines {
		lines[i] = strings.TrimLeft(ln, `/\`)
	}
	return strings.Join(lines, "\n")
}

var lineRe = regexp.MustCompile(`(?i)line (\d+)|:(\d+)(?:[:\s]|$)`)

func parseMessages(raw string) []Message {
	msgs := []Message{}
	for _, ln := range strings.Split(raw, "\n") {
		ln = strings.TrimSpace(ln)
		if ln == "" {
			continue
		}
		low := strings.ToLower(ln)
		level := "info"
		switch {
		case strings.Contains(low, "error") || strings.Contains(low, "invalid") ||
			strings.Contains(low, "unknown") || strings.Contains(low, "fail") ||
			strings.Contains(low, "unexpected") || strings.Contains(low, "bad "):
			level = "error"
		case strings.Contains(low, "warning") || strings.Contains(low, "deprecat"):
			level = "warning"
		case strings.Contains(low, "syntax is ok") || strings.Contains(low, "test is successful"):
			level = "info"
		}
		line := 0
		if m := lineRe.FindStringSubmatch(ln); m != nil {
			for _, g := range m[1:] {
				if g != "" {
					if n, err := strconv.Atoi(g); err == nil {
						line = n
						break
					}
				}
			}
		}
		msgs = append(msgs, Message{Level: level, Line: line, Text: ln})
	}
	return msgs
}

func hasError(msgs []Message) bool {
	for _, m := range msgs {
		if m.Level == "error" {
			return true
		}
	}
	return false
}
