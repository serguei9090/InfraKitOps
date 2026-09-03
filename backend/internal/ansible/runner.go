package ansible

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"time"
)

// RunReq is one ansible* invocation, in host terms — the runner translates
// paths for its own execution context.
type RunReq struct {
	Tool     string   // "ansible-playbook" | "ansible" | "ansible-doc" | …
	Dir      string   // project root ("" = none)
	Argv     []string // already validated
	Env      []string // extra KEY=VALUE (callback vars etc.)
	Combined bool     // Capture: merge stderr into the returned bytes
}

// Runner executes ansible* commands for one RuntimeMode. AN6: the module's
// single spawn point, so ansible can run in a container / WSL / a remote host
// instead of only on the local PATH. See ANSIBLE_RUNTIME_PLAN.md.
type Runner interface {
	Name() RuntimeMode
	Probe(ctx context.Context) RunnerStatus
	// Stream runs the request, calling onStdout / onStderr per line, blocking
	// until the process exits.
	Stream(ctx context.Context, req RunReq, onStdout, onStderr func(string)) error
	// Capture runs the request and returns its output (stdout, or combined when
	// req.Combined).
	Capture(ctx context.Context, req RunReq) ([]byte, error)
	// TempDir is a directory whose contents are visible to the execution
	// context — for extra-vars, vault-password, and the NDJSON event file.
	TempDir() string
	// Setup provisions the runner (build image, install ansible, …), streaming
	// progress. ApplyDeps installs just the control-node deps; Teardown removes
	// what Setup created.
	Setup(ctx context.Context, emit func(string)) error
	ApplyDeps(ctx context.Context, emit func(string)) error
	Teardown(ctx context.Context) error
}

// streamVia / captureVia run an *exec.Cmd for the local-ish runners.
func streamVia(build func() (*exec.Cmd, error), onOut, onErr func(string)) error {
	cmd, err := build()
	if err != nil {
		return err
	}
	return runStreaming(cmd, onOut, onErr)
}

func captureVia(build func() (*exec.Cmd, error), combined bool) ([]byte, error) {
	cmd, err := build()
	if err != nil {
		return nil, err
	}
	if combined {
		return cmd.CombinedOutput()
	}
	return cmd.Output()
}

// depLists parses the shared control-node dependency settings.
func depLists(settings map[string]string) (pip, collections []string) {
	return splitList(settings["controlNodePipPackages"]), splitList(settings["controlNodeCollections"])
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

	// wsl
	WslInstalled  bool     `json:"wslInstalled,omitempty"`
	Distro        string   `json:"distro,omitempty"`
	Distros       []string `json:"distros,omitempty"`
	OnlineDistros []string `json:"onlineDistros,omitempty"`
	DistroReady   bool     `json:"distroReady,omitempty"`

	// remote (ssh)
	NodeID   string `json:"nodeId,omitempty"`
	NodeName string `json:"nodeName,omitempty"`
	Remote   string `json:"remote,omitempty"` // user@host
}

// InstallLinks are shown when a runtime the user might want isn't present.
var InstallLinks = map[string]string{
	"docker": "https://docs.docker.com/get-started/get-docker/",
	"podman": "https://podman.io/docs/installation",
	"wsl":    "https://learn.microsoft.com/windows/wsl/install",
	"uv":     "https://docs.astral.sh/uv/",
}

// NodeResolver returns a remote control-node target for a node id — host/user/
// port from the SSH-node registry, credential already resolved from the
// caller's vault. Nil → the ssh runner is unavailable.
type NodeResolver func(ctx context.Context, nodeID string) (RemoteTarget, error)

// RemoteTarget is what the ssh runner needs to reach a control node.
type RemoteTarget struct {
	Name       string
	Host       string
	Port       int
	User       string
	Password   string // resolved
	PrivateKey string // resolved
	HostKeyFP  string
}

func (e *Engine) allRunners(settings map[string]string) []Runner {
	rs := []Runner{
		&localRunner{rt: e.rt, mode: RuntimeSystem, settings: settings},
		&localRunner{rt: e.rt, mode: RuntimeManaged, settings: settings},
		&containerRunner{cfgDir: e.cfgDir, image: nz(settings["containerImage"], defaultImage), settings: settings},
		&wslRunner{cfgDir: e.cfgDir, settings: settings, persist: e.store.PutSetting},
	}
	if e.nodeResolver != nil {
		rs = append(rs, &sshRunner{cfgDir: e.cfgDir, settings: settings, resolve: e.nodeResolver})
	}
	return rs
}

// activeRunner resolves the Runner for the configured RuntimeMode.
func (e *Engine) activeRunner(ctx context.Context) Runner {
	settings := e.store.GetSettings()
	mode := settings["ansibleRuntime"]
	all := e.allRunners(settings)
	byName := map[string]Runner{}
	for _, r := range all {
		byName[string(r.Name())] = r
	}
	if r, ok := byName[mode]; ok {
		return r
	}
	if mode == "" || mode == "auto" {
		// A miss here probes docker/wsl/ssh (each multi-second); activeRunner is
		// called on every Capture and Inventory calls it twice. Cache the winner
		// briefly so Doc/Inventory/Lint don't each pay the full probe cost.
		e.arMu.Lock()
		if e.arRunner != nil && time.Since(e.arAt) < 20*time.Second {
			r := e.arRunner
			e.arMu.Unlock()
			return r
		}
		e.arMu.Unlock()
		for _, r := range all {
			if r.Probe(ctx).Ready {
				e.arMu.Lock()
				e.arRunner, e.arAt = r, time.Now()
				e.arMu.Unlock()
				return r
			}
		}
	}
	return all[0] // system — reports its reason
}

func (e *Engine) runnerFor(mode string) Runner {
	byName := map[string]Runner{}
	for _, r := range e.allRunners(e.store.GetSettings()) {
		byName[string(r.Name())] = r
	}
	if r, ok := byName[mode]; ok {
		return r
	}
	return byName["system"]
}

// Runners probes every runner for capabilities.ansible.
func (e *Engine) Runners(ctx context.Context) map[string]RunnerStatus {
	c, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	out := map[string]RunnerStatus{}
	for _, r := range e.allRunners(e.store.GetSettings()) {
		out[string(r.Name())] = r.Probe(c)
	}
	return out
}

// SetupRuntime / ApplyRuntimeDeps / TeardownRuntime dispatch to one runner.
func (e *Engine) SetupRuntime(ctx context.Context, mode string, emit func(string)) error {
	return e.runnerFor(mode).Setup(ctx, emit)
}
func (e *Engine) ApplyRuntimeDeps(ctx context.Context, mode string, emit func(string)) error {
	return e.runnerFor(mode).ApplyDeps(ctx, emit)
}
func (e *Engine) TeardownRuntime(ctx context.Context, mode string) error {
	return e.runnerFor(mode).Teardown(ctx)
}

// --- localRunner: system / managed (today's behaviour) ------------

type localRunner struct {
	rt       *Runtime
	mode     RuntimeMode
	settings map[string]string
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

func (l *localRunner) buildCmd(ctx context.Context, req RunReq) (*exec.Cmd, error) {
	bin := l.rt.Bin(ctx, l.mode, req.Tool)
	if bin == "" {
		return nil, fmt.Errorf("%s not available — check the Ansible runtime", req.Tool)
	}
	cmd := exec.CommandContext(ctx, bin, req.Argv...)
	if req.Dir != "" {
		cmd.Dir = req.Dir
	}
	cmd.Env = append(baseEnv(), req.Env...)
	return cmd, nil
}

func (l *localRunner) Stream(ctx context.Context, req RunReq, onOut, onErr func(string)) error {
	return streamVia(func() (*exec.Cmd, error) { return l.buildCmd(ctx, req) }, onOut, onErr)
}
func (l *localRunner) Capture(ctx context.Context, req RunReq) ([]byte, error) {
	return captureVia(func() (*exec.Cmd, error) { return l.buildCmd(ctx, req) }, req.Combined)
}

func (l *localRunner) Setup(ctx context.Context, emit func(string)) error {
	if l.mode != RuntimeManaged {
		return fmt.Errorf("the system runtime uses ansible on your PATH — nothing to set up")
	}
	pip, colls := depLists(l.settings)
	return l.rt.EnsureManaged(ctx, pip, colls, emit)
}
func (l *localRunner) ApplyDeps(ctx context.Context, emit func(string)) error {
	if l.mode != RuntimeManaged {
		return fmt.Errorf("the system runtime uses ansible on your PATH — install deps there yourself")
	}
	pip, colls := depLists(l.settings)
	return l.rt.ApplyManagedDeps(ctx, pip, colls, emit)
}
func (l *localRunner) Teardown(context.Context) error {
	if l.mode == RuntimeManaged {
		return l.rt.RemoveManaged()
	}
	return nil
}
