package ansible

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/executor"
)

// sshRunner runs ansible on a remote Linux host — "InfraKit is a thin client,
// a real Linux box is the control node" (ANSIBLE_RUNTIME_PLAN.md §3.4). Reuses
// the runbook SSH executor's x/crypto/ssh + host-key pinning; no new dep.
type sshRunner struct {
	cfgDir   string
	settings map[string]string
	resolve  NodeResolver
}

func (s *sshRunner) Name() RuntimeMode { return RuntimeMode("remote") }

// TempDir is local — extra-vars / vault-pw temp files are read here and shipped
// in the project tar; the NDJSON event file is written here by Stream from the
// marked remote output.
func (s *sshRunner) TempDir() string { return os.TempDir() }

func (s *sshRunner) nodeID() string { return s.settings["remoteNodeId"] }

func (s *sshRunner) target(ctx context.Context) (RemoteTarget, error) {
	if s.resolve == nil || s.nodeID() == "" {
		return RemoteTarget{}, fmt.Errorf("pick an SSH node as the control node")
	}
	return s.resolve(ctx, s.nodeID())
}

func sshTarget(t RemoteTarget) *executor.SSHTarget {
	return &executor.SSHTarget{
		Host: t.Host, Port: t.Port, User: t.User,
		Password: t.Password, PrivateKey: t.PrivateKey, HostKeyFP: t.HostKeyFP,
	}
}

func (s *sshRunner) Probe(ctx context.Context) RunnerStatus {
	st := RunnerStatus{Mode: s.Name(), NodeID: s.nodeID()}
	t, err := s.target(ctx)
	if err != nil {
		st.Reason = err.Error()
		return st
	}
	st.NodeName, st.Remote = t.Name, t.User+"@"+t.Host
	c, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	var out bytes.Buffer
	res, hk := executor.SSHRun(c, sshTarget(t), "command -v ansible >/dev/null && ansible --version 2>&1 | head -1 || echo __NO_ANSIBLE__", &out, &out)
	if hk.Mismatch {
		st.Reason = "host-key mismatch — re-test the node in Runbooks → Nodes"
		return st
	}
	if res.ExitCode != 0 && res.Err != "" {
		st.Reason = "can't reach " + st.Remote + ": " + res.Err
		return st
	}
	if strings.Contains(out.String(), "__NO_ANSIBLE__") || !strings.Contains(out.String(), "ansible") {
		st.Reason = "ansible not installed on " + st.Remote + " — use “Set up control node”"
		return st
	}
	st.Ready = true
	st.AnsibleVersion = strings.TrimSpace(out.String())
	return st
}

// remoteWorkdir is where the project is unpacked + the run happens.
func (s *sshRunner) remoteWorkdir(dir string) string {
	base := "project"
	if dir != "" {
		base = filepath.Base(dir)
	}
	root := nz(s.settings["remoteWorkdir"], "~/.infrakit-ansible")
	return root + "/" + base
}

// shipProject tars `dir` (+ the callback plugin) and unpacks it into the remote
// workdir. No-op when the project is declared to already live on the remote.
func (s *sshRunner) shipProject(ctx context.Context, t RemoteTarget, dir string) (string, error) {
	wd := s.remoteWorkdir(dir)
	if s.settings["remoteProjectPath"] != "" {
		return s.settings["remoteProjectPath"], nil
	}
	if dir == "" {
		var eb bytes.Buffer
		executor.SSHRun(ctx, sshTarget(t), "mkdir -p "+wd, &eb, &eb)
		return wd, nil
	}

	pr, pw := io.Pipe()
	go func() { pw.CloseWithError(s.writeTar(pw, dir)) }()

	var eb bytes.Buffer
	script := "set -e; rm -rf " + wd + "; mkdir -p " + wd + "; tar xzf - -C " + wd
	res, hk := executor.SSHRunStdin(ctx, sshTarget(t), script, pr, io.Discard, &eb)
	if hk.Mismatch {
		return "", fmt.Errorf("host-key mismatch")
	}
	if res.ExitCode != 0 {
		return "", fmt.Errorf("sync project: %s", strings.TrimSpace(eb.String()))
	}
	return wd, nil
}

func (s *sshRunner) writeTar(w io.Writer, dir string) error {
	gz := gzip.NewWriter(w)
	tw := tar.NewWriter(gz)
	add := func(name string, r io.Reader, size int64, mode int64) error {
		if err := tw.WriteHeader(&tar.Header{Name: name, Mode: mode, Size: size}); err != nil {
			return err
		}
		_, err := io.Copy(tw, r)
		return err
	}
	// the shipped callback plugin
	add(".infrakit-cb/infrakit_events.py", bytes.NewReader(callbackPy), int64(len(callbackPy)), 0o644)

	err := filepath.Walk(dir, func(p string, fi os.FileInfo, err error) error {
		if err != nil || fi.IsDir() || fi.Size() > 8<<20 {
			return nil
		}
		rel, _ := filepath.Rel(dir, p)
		rel = filepath.ToSlash(rel)
		if strings.HasPrefix(rel, ".git/") || strings.HasPrefix(rel, "collections/") {
			return nil
		}
		f, oerr := os.Open(p)
		if oerr != nil {
			return nil
		}
		defer f.Close()
		return add(rel, f, fi.Size(), 0o644)
	})
	if err != nil {
		return err
	}
	if err := tw.Close(); err != nil {
		return err
	}
	return gz.Close()
}

// shipTempRefs copies local temp files referenced in argv (extra-vars,
// vault-password) to the remote tmp dir, preserving 0600.
func (s *sshRunner) shipTempRefs(ctx context.Context, t RemoteTarget, argv []string, remoteTmp string) error {
	seen := map[string]bool{}
	for _, a := range argv {
		p := strings.TrimPrefix(a, "@")
		if !strings.HasPrefix(p, s.TempDir()) || seen[p] {
			continue
		}
		seen[p] = true
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		remote := remoteTmp + "/" + filepath.Base(p)
		var eb bytes.Buffer
		res, _ := executor.SSHRunStdin(ctx, sshTarget(t),
			"mkdir -p "+remoteTmp+" && umask 077 && cat > "+remote, bytes.NewReader(b), io.Discard, &eb)
		if res.ExitCode != 0 {
			return fmt.Errorf("ship %s: %s", filepath.Base(p), strings.TrimSpace(eb.String()))
		}
	}
	return nil
}

// rewriteRemote maps local paths in an argv/env token to the remote workdir /
// remote tmp.
func rewriteRemote(s string, localDir, remoteWD, localTmp, remoteTmp string) string {
	if localDir != "" && strings.Contains(s, localDir) {
		return strings.ReplaceAll(strings.ReplaceAll(s, localDir, remoteWD), "\\", "/")
	}
	if localTmp != "" && strings.Contains(s, localTmp) {
		return strings.ReplaceAll(strings.ReplaceAll(s, localTmp, remoteTmp), "\\", "/")
	}
	return s
}

const eventMarker = "\x01EVT\x01"

func (s *sshRunner) Stream(ctx context.Context, req RunReq, onOut, onErr func(string)) error {
	t, err := s.target(ctx)
	if err != nil {
		return err
	}
	wd, err := s.shipProject(ctx, t, req.Dir)
	if err != nil {
		return err
	}
	localEv := envValue(req.Env, "INFRAKIT_EVENT_FILE")
	remoteTmp := wd + "/.tmp"
	remoteEv := remoteTmp + "/events.ndjson"

	// translate env + argv, force the callback + event paths onto the remote
	var env []string
	for _, kv := range req.Env {
		k, _, _ := strings.Cut(kv, "=")
		switch k {
		case "ANSIBLE_CALLBACK_PLUGINS":
			env = append(env, "ANSIBLE_CALLBACK_PLUGINS="+wd+"/.infrakit-cb")
		case "INFRAKIT_EVENT_FILE":
			env = append(env, "INFRAKIT_EVENT_FILE="+remoteEv)
		default:
			env = append(env, rewriteRemote(kv, req.Dir, wd, s.TempDir(), remoteTmp))
		}
	}
	var argv []string
	for _, a := range req.Argv {
		argv = append(argv, shSingle(rewriteRemote(a, req.Dir, wd, s.TempDir(), remoteTmp)))
	}
	// ship any `-e @<tmp>` / `--vault-password-file <tmp>` files (they live in
	// TempDir, not the project) onto the remote tmp dir.
	if err := s.shipTempRefs(ctx, t, req.Argv, remoteTmp); err != nil {
		return err
	}

	script := "set -o pipefail; cd " + wd + " && mkdir -p " + remoteTmp + " && : > " + remoteEv + "\n" +
		strings.Join(prefixEnv(env), " ") + " " + shSingle(req.Tool) + " " + strings.Join(argv, " ") + " &\n" +
		"AP=$!\n" +
		"( tail -n +1 -F " + remoteEv + " 2>/dev/null | sed -u 's/^/" + eventMarker + "/' ) &\n" +
		"TL=$!\n" +
		"wait $AP; RC=$?\n" +
		"sleep 1; kill $TL 2>/dev/null; exit $RC\n"

	var evOut *os.File
	if localEv != "" {
		evOut, _ = os.OpenFile(localEv, os.O_WRONLY|os.O_APPEND, 0o644)
		if evOut != nil {
			defer evOut.Close()
		}
	}
	stdout := lineWriter(func(l string) {
		if strings.HasPrefix(l, eventMarker) {
			if evOut != nil {
				fmt.Fprintln(evOut, strings.TrimPrefix(l, eventMarker))
			}
			return
		}
		onOut(l)
	})
	stderr := lineWriter(onErr)

	res, hk := executor.SSHRun(ctx, sshTarget(t), script, stdout, stderr)
	stdout.Flush()
	stderr.Flush()
	if hk.Mismatch {
		return fmt.Errorf("host-key mismatch for %s", t.Host)
	}
	// best-effort cleanup
	if s.settings["remoteProjectPath"] == "" {
		var eb bytes.Buffer
		executor.SSHRun(context.Background(), sshTarget(t), "rm -rf "+wd, &eb, &eb)
	}
	if res.ExitCode != 0 && res.Err != "" {
		return fmt.Errorf("%s", res.Err)
	}
	if res.ExitCode != 0 {
		return &exitCodeErr{res.ExitCode}
	}
	return nil
}

func (s *sshRunner) Capture(ctx context.Context, req RunReq) ([]byte, error) {
	t, err := s.target(ctx)
	if err != nil {
		return nil, err
	}
	pre := ""
	if req.Dir != "" {
		wd, serr := s.shipProject(ctx, t, req.Dir)
		if serr != nil {
			return nil, serr
		}
		pre = "cd " + wd + " && "
		for i, a := range req.Argv {
			req.Argv[i] = rewriteRemote(a, req.Dir, wd, s.TempDir(), wd+"/.tmp")
		}
	}
	parts := make([]string, 0, len(req.Argv)+1)
	parts = append(parts, shSingle(req.Tool))
	for _, a := range req.Argv {
		parts = append(parts, shSingle(a))
	}
	var buf bytes.Buffer
	errW := io.Writer(io.Discard)
	if req.Combined {
		errW = &buf
	}
	res, _ := executor.SSHRun(ctx, sshTarget(t), pre+strings.Join(parts, " "), &buf, errW)
	if res.ExitCode != 0 && buf.Len() == 0 {
		return nil, fmt.Errorf("%s", nz(res.Err, "remote command failed"))
	}
	return buf.Bytes(), nil
}

// Setup installs ansible on the control node.
func (s *sshRunner) Setup(ctx context.Context, emit func(string)) error {
	t, err := s.target(ctx)
	if err != nil {
		return err
	}
	pip, colls := depLists(s.settings)
	script := "set -e\n" +
		"if ! command -v ansible-playbook >/dev/null; then\n" +
		"  (command -v pipx >/dev/null && pipx install ansible-core) || pip3 install --user --break-system-packages ansible-core ansible-lint\n" +
		"fi\n"
	if len(pip) > 0 {
		script += "pip3 install --user --break-system-packages " + strings.Join(pip, " ") + "\n"
	}
	for _, c := range colls {
		script += "ansible-galaxy collection install " + shSingle(c) + " || true\n"
	}
	script += "ansible --version | head -1\n"
	emit("Setting up ansible on " + t.User + "@" + t.Host + " …")
	res, _ := executor.SSHRun(ctx, sshTarget(t), script, lineWriter(emit), lineWriter(emit))
	if res.ExitCode != 0 {
		return fmt.Errorf("remote setup failed (exit %d)", res.ExitCode)
	}
	return nil
}

func (s *sshRunner) ApplyDeps(ctx context.Context, emit func(string)) error {
	return s.Setup(ctx, emit)
}

func (s *sshRunner) Teardown(ctx context.Context) error {
	t, err := s.target(ctx)
	if err != nil {
		return err
	}
	var eb bytes.Buffer
	executor.SSHRun(ctx, sshTarget(t), "rm -rf "+nz(s.settings["remoteWorkdir"], "~/.infrakit-ansible"), &eb, &eb)
	return nil
}

// --- small helpers -------------------------------------------------

type exitCodeErr struct{ code int }

func (e *exitCodeErr) Error() string { return fmt.Sprintf("exit status %d", e.code) }

func envValue(env []string, key string) string {
	for _, kv := range env {
		if k, v, ok := strings.Cut(kv, "="); ok && k == key {
			return v
		}
	}
	return ""
}

func prefixEnv(env []string) []string {
	out := make([]string, len(env))
	for i, kv := range env {
		if k, v, ok := strings.Cut(kv, "="); ok {
			out[i] = k + "=" + shSingle(v)
		} else {
			out[i] = kv
		}
	}
	return out
}

func shSingle(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

// lineWriter turns an io.Writer into a per-line callback.
type lw struct {
	buf []byte
	fn  func(string)
}

func lineWriter(fn func(string)) *lw { return &lw{fn: fn} }

func (l *lw) Write(p []byte) (int, error) {
	l.buf = append(l.buf, p...)
	for {
		i := bytesIndexByte(l.buf, '\n')
		if i < 0 {
			break
		}
		l.fn(strings.TrimRight(string(l.buf[:i]), "\r"))
		l.buf = l.buf[i+1:]
	}
	return len(p), nil
}

func (l *lw) Flush() {
	if len(l.buf) > 0 {
		l.fn(strings.TrimRight(string(l.buf), "\r"))
		l.buf = nil
	}
}

func bytesIndexByte(b []byte, c byte) int {
	for i := range b {
		if b[i] == c {
			return i
		}
	}
	return -1
}
