package ansible

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"time"
)

// Runner executes ansible* commands for one RuntimeMode. AN6: the module's
// single spawn point, so ansible can run in a container / WSL / a remote host
// instead of only on the local PATH. See ANSIBLE_RUNTIME_PLAN.md.
type Runner interface {
	Name() RuntimeMode
	// Probe reports whether this runner can execute right now, with detail for
	// the Settings UI.
	Probe(ctx context.Context) RunnerStatus
	// Command builds an *exec.Cmd for `tool argv…` run with `dir` as the project
	// root and `env` as extra environment (KEY=VALUE). Absolute paths in argv /
	// env that live under `dir` or under TempDir() are translated into the
	// execution context. The caller runs it (CombinedOutput / runStreaming / …).
	Command(ctx context.Context, tool, dir string, argv, env []string) (*exec.Cmd, error)
	// TempDir is a directory whose contents are visible to Command's execution
	// context — for extra-vars, vault-password, and the NDJSON event file.
	TempDir() string
	// Setup provisions the runner (build image, install ansible, …), streaming
	// progress lines. No-op for a plain PATH runner.
	Setup(ctx context.Context, emit func(string)) error
	// Teardown removes what Setup created.
	Teardown(ctx context.Context) error
}

// RunnerStatus is one entry of capabilities.ansible.runners.
type RunnerStatus struct {
	Mode           RuntimeMode `json:"mode"`
	Ready          bool        `json:"ready"`
	Reason         string      `json:"reason,omitempty"`
	AnsibleVersion string      `json:"ansibleVersion,omitempty"`

	// container
	Engine        string `json:"engine,omitempty"` // "docker" | "podman"
	EngineVersion string `json:"engineVersion,omitempty"`
	DaemonRunning bool   `json:"daemonRunning,omitempty"`
	Image         string `json:"image,omitempty"`
	ImageBuilt    bool   `json:"imageBuilt,omitempty"`
}

// InstallLinks are shown when a runtime the user might want isn't present.
var InstallLinks = map[string]string{
	"docker": "https://docs.docker.com/get-started/get-docker/",
	"podman": "https://podman.io/docs/installation",
	"wsl":    "https://learn.microsoft.com/windows/wsl/install",
	"uv":     "https://docs.astral.sh/uv/",
}

// pickRunner returns the Runner for `mode`, resolving "auto".
func pickRunner(ctx context.Context, rt *Runtime, cfgDir string, settings map[string]string) Runner {
	mode := RuntimeMode(settings["ansibleRuntime"])
	local := &localRunner{rt: rt, mode: RuntimeSystem}
	managed := &localRunner{rt: rt, mode: RuntimeManaged}
	container := &containerRunner{cfgDir: cfgDir, image: nz(settings["containerImage"], defaultImage), settings: settings}

	switch mode {
	case RuntimeSystem:
		return local
	case RuntimeManaged:
		return managed
	case RuntimeMode("container"):
		return container
	default: // auto / ""
		if local.Probe(ctx).Ready {
			return local
		}
		if managed.Probe(ctx).Ready {
			return managed
		}
		if container.Probe(ctx).Ready {
			return container
		}
		return local // report its reason
	}
}

// Runners probes every runner for capabilities.ansible.
func (e *Engine) Runners(ctx context.Context) map[string]RunnerStatus {
	return probeRunners(ctx, e.rt, e.cfgDir, e.store.GetSettings())
}

// runnerFor builds one runner by mode name ("system"|"managed"|"container"),
// ignoring the configured default.
func (e *Engine) runnerFor(mode string) Runner {
	switch mode {
	case "container":
		s := e.store.GetSettings()
		return &containerRunner{cfgDir: e.cfgDir, image: nz(s["containerImage"], defaultImage), settings: s}
	case "managed":
		return &localRunner{rt: e.rt, mode: RuntimeManaged}
	default:
		return &localRunner{rt: e.rt, mode: RuntimeSystem}
	}
}

// SetupRuntime provisions the runner for `mode` (build image / install ansible),
// streaming progress.
func (e *Engine) SetupRuntime(ctx context.Context, mode string, emit func(string)) error {
	return e.runnerFor(mode).Setup(ctx, emit)
}

// TeardownRuntime removes what SetupRuntime created for `mode`.
func (e *Engine) TeardownRuntime(ctx context.Context, mode string) error {
	return e.runnerFor(mode).Teardown(ctx)
}

// probeRunners returns the status of every runner for capabilities.ansible.
func probeRunners(ctx context.Context, rt *Runtime, cfgDir string, settings map[string]string) map[string]RunnerStatus {
	c, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	out := map[string]RunnerStatus{}
	for _, r := range []Runner{
		&localRunner{rt: rt, mode: RuntimeSystem},
		&localRunner{rt: rt, mode: RuntimeManaged},
		&containerRunner{cfgDir: cfgDir, image: nz(settings["containerImage"], defaultImage), settings: settings},
	} {
		out[string(r.Name())] = r.Probe(c)
	}
	return out
}

// --- localRunner: system / managed (today's behaviour) ------------

type localRunner struct {
	rt   *Runtime
	mode RuntimeMode
}

func (l *localRunner) Name() RuntimeMode { return l.mode }
func (l *localRunner) TempDir() string   { return os.TempDir() }

func (l *localRunner) Probe(ctx context.Context) RunnerStatus {
	s := RunnerStatus{Mode: l.mode}
	dir := ""
	if l.mode == RuntimeManaged {
		dir = l.rt.venvBinDir()
	}
	b := probe(ctx, dir, "ansible-playbook")
	s.Ready = b.Found
	s.AnsibleVersion = b.Version
	if !s.Ready {
		if l.mode == RuntimeManaged {
			s.Reason = "not set up — use “Set up managed ansible”"
		} else {
			s.Reason = "ansible-playbook not on PATH"
		}
	}
	return s
}

func (l *localRunner) Command(ctx context.Context, tool, dir string, argv, env []string) (*exec.Cmd, error) {
	bin := l.rt.Bin(ctx, l.mode, tool)
	if bin == "" {
		return nil, fmt.Errorf("%s not available — check the Ansible runtime", tool)
	}
	cmd := exec.CommandContext(ctx, bin, argv...)
	if dir != "" {
		cmd.Dir = dir
	}
	cmd.Env = append(baseEnv(), env...)
	return cmd, nil
}

func (l *localRunner) Setup(ctx context.Context, emit func(string)) error {
	if l.mode != RuntimeManaged {
		return nil
	}
	return l.rt.EnsureManaged(ctx, "", emit)
}

func (l *localRunner) Teardown(context.Context) error {
	if l.mode == RuntimeManaged {
		return l.rt.RemoveManaged()
	}
	return nil
}
