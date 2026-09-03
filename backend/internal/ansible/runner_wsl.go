package ansible

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// dedicatedDistro is the name InfraKit provisions so it never mutates a distro
// the user relies on.
const dedicatedDistro = "InfraKit-Ansible"

// wslRunner runs ansible inside a WSL2 distro — the no-Docker path on Windows.
// See ANSIBLE_RUNTIME_PLAN.md §3.3.
type wslRunner struct {
	cfgDir   string
	settings map[string]string
	persist  func(key, value string) error // Store.PutSetting — records a provisioned distro name
}

func (w *wslRunner) Name() RuntimeMode { return RuntimeMode("wsl") }

// TempDir stays on the Windows filesystem — WSL reads it via /mnt/c, and Go
// tails the NDJSON event file natively.
func (w *wslRunner) TempDir() string { return os.TempDir() }

func (w *wslRunner) distro() string { return nz(w.settings["wslDistro"], dedicatedDistro) }

// wslText decodes wsl.exe's UTF-16LE output to plain lines.
func wslText(b []byte) []string {
	s := strings.ReplaceAll(string(b), "\x00", "")
	s = strings.TrimPrefix(s, "\ufeff")
	var out []string
	for _, l := range strings.Split(s, "\n") {
		if l = strings.TrimSpace(strings.Trim(l, "\r")); l != "" {
			out = append(out, l)
		}
	}
	return out
}

func wslList(ctx context.Context, args ...string) []string {
	c, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(c, "wsl.exe", args...).Output()
	if err != nil {
		return nil
	}
	return wslText(out)
}

func wslInstalled(ctx context.Context) bool {
	if runtime.GOOS != "windows" {
		return false
	}
	if _, err := exec.LookPath("wsl.exe"); err != nil {
		return false
	}
	c, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	return exec.CommandContext(c, "wsl.exe", "--status").Run() == nil
}

func (w *wslRunner) Probe(ctx context.Context) RunnerStatus {
	s := RunnerStatus{Mode: w.Name(), Distro: w.distro()}
	if runtime.GOOS != "windows" {
		s.Reason = "WSL is Windows-only"
		return s
	}
	s.WslInstalled = wslInstalled(ctx)
	if !s.WslInstalled {
		s.Reason = "WSL is not installed"
		return s
	}
	s.Distros = wslList(ctx, "-l", "-q")
	// `wsl -l -o` first column is the Name; keep the whole line for the UI.
	for _, l := range wslList(ctx, "-l", "-o") {
		if f := strings.Fields(l); len(f) > 0 && !strings.EqualFold(f[0], "NAME") {
			s.OnlineDistros = append(s.OnlineDistros, f[0])
		}
	}

	s.DistroReady = containsFold(s.Distros, w.distro())
	if !s.DistroReady {
		s.Reason = fmt.Sprintf("distro %q not set up — use “Set up WSL”", w.distro())
		return s
	}
	// ansible present in the distro?
	c, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(c, "wsl.exe", "-d", w.distro(), "--", "ansible", "--version").Output()
	if err != nil {
		s.Reason = fmt.Sprintf("ansible not installed in %q — use “Set up WSL”", w.distro())
		return s
	}
	s.Ready = true
	s.AnsibleVersion = firstLine(string(out))
	return s
}

// winToWSL maps C:\X\Y → /mnt/c/X/Y (and normalises separators otherwise).
func winToWSL(p string) string {
	if len(p) >= 2 && p[1] == ':' {
		return "/mnt/" + strings.ToLower(p[:1]) + strings.ReplaceAll(p[2:], "\\", "/")
	}
	return strings.ReplaceAll(p, "\\", "/")
}

func (w *wslRunner) Stream(ctx context.Context, req RunReq, onOut, onErr func(string)) error {
	return streamVia(func() (*exec.Cmd, error) { return w.buildCmd(ctx, req) }, onOut, onErr)
}
func (w *wslRunner) Capture(ctx context.Context, req RunReq) ([]byte, error) {
	return captureVia(func() (*exec.Cmd, error) { return w.buildCmd(ctx, req) }, req.Combined)
}

func (w *wslRunner) buildCmd(ctx context.Context, req RunReq) (*exec.Cmd, error) {
	tool, dir, argv, env := req.Tool, req.Dir, req.Argv, req.Env
	if runtime.GOOS != "windows" {
		return nil, fmt.Errorf("WSL is Windows-only")
	}
	if _, err := exec.LookPath("wsl.exe"); err != nil {
		return nil, fmt.Errorf("WSL is not installed")
	}
	rewrite := func(s string) string {
		// replace any Windows absolute path token (also after an @ or =)
		for _, drv := range []string{"C:\\", "c:\\", "D:\\", "d:\\", "E:\\", "e:\\"} {
			if i := strings.Index(s, drv); i >= 0 {
				return s[:i] + winToWSL(s[i:])
			}
		}
		return s
	}

	full := []string{"-d", w.distro()}
	if dir != "" {
		full = append(full, "--cd", winToWSL(dir))
	}
	full = append(full, "--", "env")
	for _, kv := range env {
		full = append(full, rewrite(kv))
	}
	// bind mounts show as world-writable in WSL, so ansible ignores ./ansible.cfg
	// unless it's named explicitly.
	if dir != "" {
		if _, err := os.Stat(filepath.Join(dir, "ansible.cfg")); err == nil {
			full = append(full, "ANSIBLE_CONFIG="+winToWSL(dir)+"/ansible.cfg")
		}
	}
	full = append(full, tool)
	for _, a := range argv {
		full = append(full, rewrite(a))
	}
	cmd := exec.CommandContext(ctx, "wsl.exe", full...)
	cmd.Env = os.Environ()
	return cmd, nil
}

// Setup provisions the distro (if it's the dedicated one and missing) and
// installs ansible + the control-node deps, streamed.
func (w *wslRunner) Setup(ctx context.Context, emit func(string)) error {
	if runtime.GOOS != "windows" {
		return fmt.Errorf("WSL is Windows-only")
	}
	if !wslInstalled(ctx) {
		return fmt.Errorf("install WSL first (wsl --install)")
	}
	target := w.distro()
	existing := wslList(ctx, "-l", "-q")

	if !containsFold(existing, target) {
		if target != dedicatedDistro {
			return fmt.Errorf("distro %q does not exist", target)
		}
		if err := w.provision(ctx, emit); err != nil {
			return err
		}
	}

	pipList, colls := depLists(w.settings)
	pip := strings.Join(pipList, " ")
	script := "set -e\n" +
		"export DEBIAN_FRONTEND=noninteractive\n" +
		"apt-get update -qq\n" +
		"apt-get install -y -qq python3 python3-pip openssh-client git ca-certificates >/dev/null\n" +
		"pip3 install --break-system-packages -q ansible-core ansible-lint " + pip + "\n"
	for _, coll := range colls {
		script += "ansible-galaxy collection install " + shellQuote(coll) + " || true\n"
	}
	script += "ansible --version | head -1\n"

	emit("Installing ansible in " + target + " …")
	cmd := exec.CommandContext(ctx, "wsl.exe", "-d", target, "-u", "root", "--", "bash", "-lc", script)
	return runStreaming(cmd, emit, emit)
}

// ApplyDeps re-runs just pip3 + ansible-galaxy in the distro (no apt).
func (w *wslRunner) ApplyDeps(ctx context.Context, emit func(string)) error {
	if runtime.GOOS != "windows" {
		return fmt.Errorf("WSL is Windows-only")
	}
	target := w.distro()
	if !containsFold(wslList(ctx, "-l", "-q"), target) {
		return fmt.Errorf("distro %q not set up", target)
	}
	pipList, colls := depLists(w.settings)
	script := "set -e\n"
	if len(pipList) > 0 {
		script += "pip3 install --break-system-packages -q " + strings.Join(pipList, " ") + "\n"
	}
	for _, coll := range colls {
		script += "ansible-galaxy collection install " + shellQuote(coll) + " || true\n"
	}
	emit("Applying deps to " + target + " …")
	return runStreaming(exec.CommandContext(ctx, "wsl.exe", "-d", target, "-u", "root", "--", "bash", "-lc", script), emit, emit)
}

// provision creates the dedicated distro from settings["wslSource"]:
//
//	"official:<name>"  → wsl --install --no-launch -d <name>  (then run there)
//	"import:<path>"    → wsl --import InfraKit-Ansible <dir> <local .tar>
//	"" (default)       → import a pinned Ubuntu WSL rootfs (downloaded)
func (w *wslRunner) provision(ctx context.Context, emit func(string)) error {
	src := strings.TrimSpace(w.settings["wslSource"])
	installDir := filepath.Join(w.cfgDir, "wsl", dedicatedDistro)
	_ = os.MkdirAll(installDir, 0o755)

	switch {
	case strings.HasPrefix(src, "official:"):
		name := strings.TrimPrefix(src, "official:")
		emit("$ wsl --install --no-launch -d " + name)
		if err := runStreaming(exec.CommandContext(ctx, "wsl.exe", "--install", "--no-launch", "-d", name), emit, emit); err != nil {
			return err
		}
		// the installed distro is named <name>; persist it so later runs/probes
		// target it instead of falling back to the (non-existent) default.
		w.settings["wslDistro"] = name
		if w.persist != nil {
			_ = w.persist("wslDistro", name)
		}
		return nil

	case strings.HasPrefix(src, "import:"):
		tar := strings.TrimPrefix(src, "import:")
		if strings.HasPrefix(tar, "http") {
			var derr error
			if tar, derr = downloadTemp(ctx, tar, emit); derr != nil {
				return derr
			}
			defer os.Remove(tar)
		}
		emit("$ wsl --import " + dedicatedDistro + " " + installDir + " " + tar)
		return runStreaming(exec.CommandContext(ctx, "wsl.exe", "--import", dedicatedDistro, installDir, tar), emit, emit)

	default:
		tarPath, derr := downloadTemp(ctx, pinnedUbuntuWSLRootfs, emit)
		if derr != nil {
			return derr
		}
		defer os.Remove(tarPath)
		emit("$ wsl --import " + dedicatedDistro + " " + installDir + " " + tarPath)
		return runStreaming(exec.CommandContext(ctx, "wsl.exe", "--import", dedicatedDistro, installDir, tarPath), emit, emit)
	}
}

func (w *wslRunner) Teardown(ctx context.Context) error {
	if w.distro() != dedicatedDistro {
		return fmt.Errorf("refusing to unregister %q — it isn't the InfraKit-managed distro", w.distro())
	}
	return exec.CommandContext(ctx, "wsl.exe", "--unregister", dedicatedDistro).Run()
}

func containsFold(list []string, s string) bool {
	for _, x := range list {
		if strings.EqualFold(x, s) {
			return true
		}
	}
	return false
}
