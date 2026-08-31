// Package packages detects whether a CLI tool is installed and, when it is
// not, offers the one command to install it via whichever package manager the
// host has. It is a "is kubectl here, and if not here's how" helper — not a
// package manager. See RUNBOOK_MODULE_PLAN.md §6.5.
package packages

import (
	"bufio"
	"context"
	"io"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// Tool is the detection result for one CLI.
type Tool struct {
	Name      string `json:"name"`
	Present   bool   `json:"present"`
	Path      string `json:"path,omitempty"`
	Version   string `json:"version,omitempty"`
	// Manager + InstallCmd are filled when the tool is missing and a package
	// manager that knows it is available.
	Manager    string `json:"manager,omitempty"`
	InstallCmd string `json:"installCmd,omitempty"`
	NeedsSudo  bool   `json:"needsSudo,omitempty"`
}

// curated is the set shown by default. Arbitrary names can still be looked up.
var curated = []string{
	"git", "uv", "python3", "python", "node", "docker", "kubectl", "helm",
	"ansible", "terraform", "jq", "curl", "rsync", "ssh",
}

// pkgSpec maps a tool to its package name per manager (blank = same as tool).
var pkgSpec = map[string]map[string]string{
	"uv":        {"winget": "astral-sh.uv", "brew": "uv", "scoop": "uv"},
	"python3":   {"winget": "Python.Python.3.12", "apt": "python3", "dnf": "python3", "brew": "python@3.12"},
	"kubectl":   {"winget": "Kubernetes.kubectl", "brew": "kubectl", "scoop": "kubectl"},
	"node":      {"winget": "OpenJS.NodeJS.LTS", "brew": "node", "apt": "nodejs", "dnf": "nodejs"},
	"docker":    {"winget": "Docker.DockerDesktop", "brew": "docker"},
	"terraform": {"winget": "HashiCorp.Terraform", "brew": "terraform"},
	"helm":      {"winget": "Helm.Helm", "brew": "helm"},
	"jq":        {"winget": "jqlang.jq", "brew": "jq", "apt": "jq", "dnf": "jq"},
	"git":       {"winget": "Git.Git", "brew": "git", "apt": "git", "dnf": "git"},
	"ansible":   {"brew": "ansible", "apt": "ansible", "dnf": "ansible"},
}

// Detect returns the state of the curated tools plus any extra names asked for.
func Detect(ctx context.Context, extra []string) []Tool {
	names := append([]string{}, curated...)
	seen := map[string]bool{}
	for _, n := range names {
		seen[n] = true
	}
	for _, n := range extra {
		if n = strings.TrimSpace(n); n != "" && !seen[n] {
			names = append(names, n)
			seen[n] = true
		}
	}
	mgr, mgrSudo := detectManager(ctx)
	out := make([]Tool, 0, len(names))
	for _, n := range names {
		t := lookup(ctx, n)
		if !t.Present && mgr != "" {
			t.Manager = mgr
			t.InstallCmd = installCommand(mgr, n)
			t.NeedsSudo = mgrSudo
		}
		out = append(out, t)
	}
	return out
}

func lookup(ctx context.Context, name string) Tool {
	t := Tool{Name: name}
	path, err := exec.LookPath(name)
	if err != nil {
		return t
	}
	t.Present = true
	t.Path = path
	// best-effort version
	c, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	cmd := exec.CommandContext(c, name, "--version")
	if b, err := cmd.CombinedOutput(); err == nil {
		line := strings.SplitN(strings.TrimSpace(string(b)), "\n", 2)[0]
		t.Version = strings.TrimSpace(line)
	}
	return t
}

// detectManager returns the first package manager present, and whether it
// typically needs sudo.
func detectManager(ctx context.Context) (string, bool) {
	type m struct {
		name string
		sudo bool
	}
	var order []m
	if runtime.GOOS == "windows" {
		order = []m{{"winget", false}, {"choco", true}, {"scoop", false}}
	} else if runtime.GOOS == "darwin" {
		order = []m{{"brew", false}}
	} else {
		order = []m{{"apt", true}, {"dnf", true}, {"pacman", true}, {"apk", true}, {"brew", false}}
	}
	for _, x := range order {
		bin := x.name
		if bin == "apt" {
			bin = "apt-get"
		}
		if _, err := exec.LookPath(bin); err == nil {
			return x.name, x.sudo
		}
	}
	return "", false
}

func installCommand(mgr, tool string) string {
	pkg := tool
	if m, ok := pkgSpec[tool]; ok {
		if p, ok := m[mgr]; ok && p != "" {
			pkg = p
		}
	}
	switch mgr {
	case "winget":
		return "winget install --id " + pkg + " -e --accept-package-agreements --accept-source-agreements"
	case "choco":
		return "choco install " + pkg + " -y"
	case "scoop":
		return "scoop install " + pkg
	case "brew":
		return "brew install " + pkg
	case "apt":
		return "sudo apt-get update && sudo apt-get install -y " + pkg
	case "dnf":
		return "sudo dnf install -y " + pkg
	case "pacman":
		return "sudo pacman -S --noconfirm " + pkg
	case "apk":
		return "sudo apk add " + pkg
	default:
		return ""
	}
}

// RunInstall executes an install command, streaming its combined output line by
// line to `w`. The command is exactly what Detect reported for the tool (the
// caller has shown it and got confirmation).
func RunInstall(ctx context.Context, mgr, tool string, w io.Writer) error {
	cmdStr := installCommand(mgr, tool)
	if cmdStr == "" {
		return exec.ErrNotFound
	}
	var c *exec.Cmd
	if runtime.GOOS == "windows" {
		c = exec.CommandContext(ctx, "powershell", "-NoProfile", "-Command", cmdStr)
	} else {
		c = exec.CommandContext(ctx, "sh", "-c", cmdStr)
	}
	stdout, _ := c.StdoutPipe()
	c.Stderr = c.Stdout
	if err := c.Start(); err != nil {
		return err
	}
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		_, _ = io.WriteString(w, sc.Text()+"\n")
	}
	return c.Wait()
}
