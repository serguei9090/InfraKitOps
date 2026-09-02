// Package ansible is the backend for the Ansible Manager module (AN).
// See ANSIBLE_MODULE_PLAN.md. It shells out to the user's own `ansible*`
// binaries (Tier 1) or an InfraKit-managed `uv` venv (Tier 2) — no new Go
// dependency, same doctrine as the network tools.
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

// RuntimeMode picks which ansible install the module uses.
type RuntimeMode string

const (
	RuntimeAuto    RuntimeMode = "auto"    // system if on PATH, else managed
	RuntimeSystem  RuntimeMode = "system"  // always the PATH binaries
	RuntimeManaged RuntimeMode = "managed" // always the uv venv
)

// managedPkg is what EnsureManaged installs. Pinned so a run is reproducible.
const managedPkg = "ansible-core"

// bin is one resolved ansible executable + its version ("" = not found).
type bin struct {
	Path    string `json:"path,omitempty"`
	Found   bool   `json:"found"`
	Version string `json:"version,omitempty"`
}

// Capabilities is the /capabilities payload for the module.
type Capabilities struct {
	Runtime RuntimeMode `json:"runtime"`
	// Active is the resolved binary set actually in use.
	Active   map[string]bin `json:"active"`
	System   map[string]bin `json:"system"`
	Managed  map[string]bin `json:"managed"`
	UV       bin            `json:"uv"`
	VenvPath string         `json:"venvPath"`
	// Ready is true when the active runtime has at least ansible-playbook.
	Ready  bool   `json:"ready"`
	Reason string `json:"reason,omitempty"`
}

// the executables the module cares about; ansible-playbook is the only required one
var wantBins = []string{"ansible", "ansible-playbook", "ansible-galaxy", "ansible-vault", "ansible-doc", "ansible-lint", "ansible-inventory"}

// Runtime resolves the active ansible toolchain for a config directory.
type Runtime struct {
	cfgDir string
}

func NewRuntime(cfgDir string) *Runtime { return &Runtime{cfgDir: cfgDir} }

func (r *Runtime) venvDir() string { return filepath.Join(r.cfgDir, "ansible-venv") }
func (r *Runtime) venvBinDir() string {
	if runtime.GOOS == "windows" {
		return filepath.Join(r.venvDir(), "Scripts")
	}
	return filepath.Join(r.venvDir(), "bin")
}

func exeName(name string) string {
	if runtime.GOOS == "windows" {
		return name + ".exe"
	}
	return name
}

// probe returns a bin for `name` at `dir` ("" dir = search PATH).
func probe(ctx context.Context, dir, name string) bin {
	var path string
	if dir == "" {
		p, err := exec.LookPath(name)
		if err != nil {
			return bin{}
		}
		path = p
	} else {
		p := filepath.Join(dir, exeName(name))
		if _, err := os.Stat(p); err != nil {
			return bin{}
		}
		path = p
	}
	b := bin{Path: path, Found: true}
	c, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(c, path, "--version").Output()
	if err == nil {
		b.Version = firstLine(string(out))
	}
	return b
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s)
}

// Detect builds the full capability picture for `mode`.
func (r *Runtime) Detect(ctx context.Context, mode RuntimeMode) Capabilities {
	if mode == "" {
		mode = RuntimeAuto
	}
	caps := Capabilities{
		Runtime: mode, System: map[string]bin{}, Managed: map[string]bin{}, Active: map[string]bin{},
		VenvPath: r.venvDir(), UV: probe(ctx, "", "uv"),
	}
	for _, n := range wantBins {
		caps.System[n] = probe(ctx, "", n)
		caps.Managed[n] = probe(ctx, r.venvBinDir(), n)
	}

	useManaged := mode == RuntimeManaged ||
		(mode == RuntimeAuto && !caps.System["ansible-playbook"].Found && caps.Managed["ansible-playbook"].Found)
	src := caps.System
	if useManaged {
		src = caps.Managed
	}
	for _, n := range wantBins {
		caps.Active[n] = src[n]
	}
	caps.Ready = caps.Active["ansible-playbook"].Found
	if !caps.Ready {
		switch {
		case mode == RuntimeSystem:
			caps.Reason = "ansible-playbook not found on PATH"
		case !caps.UV.Found:
			caps.Reason = "no system ansible, and `uv` isn't installed to build a managed one"
		default:
			caps.Reason = "ansible isn't set up — use “Set up managed ansible”"
		}
	}
	return caps
}

// Bin returns the path to one executable under the active runtime, or "".
func (r *Runtime) Bin(ctx context.Context, mode RuntimeMode, name string) string {
	return r.Detect(ctx, mode).Active[name].Path
}

// EnsureManaged creates/updates the uv venv with ansible-core, streaming uv's
// output line-by-line to `emit`. `version` "" = latest.
func (r *Runtime) EnsureManaged(ctx context.Context, version string, emit func(line string)) error {
	if _, err := exec.LookPath("uv"); err != nil {
		return fmt.Errorf("`uv` is not on PATH — install it first (https://docs.astral.sh/uv/)")
	}
	if err := os.MkdirAll(r.cfgDir, 0o755); err != nil {
		return err
	}
	spec := managedPkg
	if v := strings.TrimSpace(version); v != "" {
		spec = managedPkg + "==" + v
	}
	steps := [][]string{
		{"venv", r.venvDir()},
		{"pip", "install", "--python", filepath.Join(r.venvBinDir(), exeName("python")), spec},
	}
	for _, args := range steps {
		emit("$ uv " + strings.Join(args, " "))
		cmd := exec.CommandContext(ctx, "uv", args...)
		if err := runStreaming(cmd, emit, emit); err != nil {
			return fmt.Errorf("uv %s: %w", args[0], err)
		}
	}
	emit("✓ managed ansible ready")
	return nil
}

// RemoveManaged deletes the venv.
func (r *Runtime) RemoveManaged() error { return os.RemoveAll(r.venvDir()) }

// DefaultWorkspace is the suggested workspace folder when the user hasn't
// picked one: <user home>/InfraKit/ansible.
func DefaultWorkspace() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return filepath.Join(os.TempDir(), "infrakit-ansible")
	}
	return filepath.Join(home, "InfraKit", "ansible")
}
