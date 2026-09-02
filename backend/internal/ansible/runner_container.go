package ansible

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const defaultImage = "infrakit-ansible:local"

// pinnedAnsibleCore is baked into the default image so runs are reproducible.
const pinnedAnsibleCore = "ansible-core"

// containerRunner runs ansible* inside `docker run` / `podman run`. This is the
// path that makes the module usable from a Windows host (Docker Desktop / a
// Podman machine is a Linux VM). See ANSIBLE_RUNTIME_PLAN.md §3.2.
type containerRunner struct {
	cfgDir   string
	image    string
	settings map[string]string
}

func (c *containerRunner) Name() RuntimeMode { return RuntimeMode("container") }

func (c *containerRunner) tmpDir() string { return filepath.Join(c.cfgDir, "ansible-runtmp") }
func (c *containerRunner) TempDir() string {
	_ = os.MkdirAll(c.tmpDir(), 0o755)
	return c.tmpDir()
}

// containerEngineName returns "docker" | "podman" if one is on PATH (no daemon
// check — fast, used on the hot path).
func containerEngineName() string {
	for _, e := range []string{"docker", "podman"} {
		if _, err := exec.LookPath(e); err == nil {
			return e
		}
	}
	return ""
}

// containerEngine also reports the version and whether the daemon answers —
// used by Probe / Setup, not the exec hot path.
func containerEngine(ctx context.Context) (string, string, bool) {
	e := containerEngineName()
	if e == "" {
		return "", "", false
	}
	ver := ""
	if out, err := exec.CommandContext(ctx, e, "--version").Output(); err == nil {
		ver = strings.TrimSpace(string(out))
	}
	c, cancel := context.WithTimeout(ctx, 12*time.Second)
	running := exec.CommandContext(c, e, "version", "--format", "{{.Server.Version}}").Run() == nil
	cancel()
	return e, ver, running
}

func (c *containerRunner) Probe(ctx context.Context) RunnerStatus {
	s := RunnerStatus{Mode: c.Name(), Image: c.image}
	eng, ver, running := containerEngine(ctx)
	s.Engine, s.EngineVersion, s.DaemonRunning = eng, ver, running
	if eng == "" {
		s.Reason = "no docker or podman on PATH"
		return s
	}
	if !running {
		s.Reason = eng + " is installed but its daemon isn't running"
		return s
	}
	// image present?
	if exec.CommandContext(ctx, eng, "image", "inspect", c.image).Run() == nil {
		s.ImageBuilt = true
		s.Ready = true
		if out, err := exec.CommandContext(ctx, eng, "run", "--rm", c.image, "ansible", "--version").Output(); err == nil {
			s.AnsibleVersion = firstLine(string(out))
		}
	} else {
		s.Reason = "image " + c.image + " not built — use “Build image”"
	}
	return s
}

func (c *containerRunner) Command(ctx context.Context, tool, dir string, argv, env []string) (*exec.Cmd, error) {
	eng := containerEngineName()
	if eng == "" {
		return nil, fmt.Errorf("no container engine (docker / podman) available")
	}

	const projMount = "/infra-project"
	const tmpMount = "/infra-tmp"
	const cbMount = "/infra-cb"
	cbHost := filepath.Join(c.cfgDir, "ansible-callback")

	// map a host path (possibly Windows, backslashes) to its Linux path inside
	// the container, then normalise separators for the mapped portion.
	rewrite := func(s string) string {
		mapped := false
		if dir != "" && strings.Contains(s, dir) {
			s, mapped = strings.ReplaceAll(s, dir, projMount), true
		}
		if strings.Contains(s, c.tmpDir()) {
			s, mapped = strings.ReplaceAll(s, c.tmpDir(), tmpMount), true
		}
		if strings.Contains(s, cbHost) {
			s, mapped = strings.ReplaceAll(s, cbHost, cbMount), true
		}
		if mapped {
			s = strings.ReplaceAll(s, "\\", "/")
		}
		return s
	}

	run := []string{"run", "--rm", "--network", "host", "-w", projMount}
	if dir != "" {
		run = append(run, "-v", dir+":"+projMount)
		// bypass ansible's "world-writable dir" refusal to read ./ansible.cfg
		// (bind mounts show as 0777) by pointing at it explicitly.
		if _, err := os.Stat(filepath.Join(dir, "ansible.cfg")); err == nil {
			run = append(run, "-e", "ANSIBLE_CONFIG="+projMount+"/ansible.cfg")
		}
	}
	run = append(run, "-v", c.tmpDir()+":"+tmpMount)
	run = append(run, "-v", cbHost+":"+cbMount+":ro")
	// mount the user's ssh dir read-only so ansible can reach targets
	if home, err := os.UserHomeDir(); err == nil {
		if ssh := filepath.Join(home, ".ssh"); dirExists(ssh) {
			run = append(run, "-v", ssh+":/root/.ssh:ro")
		}
	}
	for _, kv := range env {
		run = append(run, "-e", rewrite(kv))
	}
	run = append(run, c.image, tool)
	for _, a := range argv {
		run = append(run, rewrite(a))
	}

	_ = os.MkdirAll(c.tmpDir(), 0o755)
	cmd := exec.CommandContext(ctx, eng, run...)
	cmd.Env = os.Environ()
	return cmd, nil
}

// Setup builds infrakit-ansible:local from a generated Dockerfile, or pulls an
// override image, streaming the engine output.
func (c *containerRunner) Setup(ctx context.Context, emit func(string)) error {
	eng, _, running := containerEngine(ctx)
	if eng == "" {
		return fmt.Errorf("install docker or podman first")
	}
	if !running {
		return fmt.Errorf("start the %s daemon first", eng)
	}

	// A non-default image is a user-supplied ref → just pull it.
	if c.image != defaultImage {
		emit("$ " + eng + " pull " + c.image)
		return runStreaming(exec.CommandContext(ctx, eng, "pull", c.image), emit, emit)
	}

	pip, colls := depLists(c.settings)
	df := buildDockerfile(pip, colls)

	buildDir, err := os.MkdirTemp("", "infrakit-ansible-img-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(buildDir)
	if err := os.WriteFile(filepath.Join(buildDir, "Dockerfile"), []byte(df), 0o644); err != nil {
		return err
	}
	emit("Building " + defaultImage + " …")
	for _, l := range strings.Split(df, "\n") {
		emit("  " + l)
	}
	cmd := exec.CommandContext(ctx, eng, "build", "-t", defaultImage, buildDir)
	return runStreaming(cmd, emit, emit)
}

// ApplyDeps rebuilds the image (docker's layer cache keeps it fast). A
// user-supplied override image can't be modified — no-op with a note.
func (c *containerRunner) ApplyDeps(ctx context.Context, emit func(string)) error {
	if c.image != defaultImage {
		emit("override image " + c.image + " — add deps to that image yourself")
		return nil
	}
	return c.Setup(ctx, emit)
}

func (c *containerRunner) Teardown(ctx context.Context) error {
	eng, _, _ := containerEngine(ctx)
	if eng == "" {
		return nil
	}
	return exec.CommandContext(ctx, eng, "rmi", "-f", defaultImage).Run()
}

func buildDockerfile(pip, collections []string) string {
	var b strings.Builder
	b.WriteString("FROM python:3.12-slim\n")
	b.WriteString("RUN pip install --no-cache-dir " + pinnedAnsibleCore + " ansible-lint\n")
	if len(pip) > 0 {
		b.WriteString("RUN pip install --no-cache-dir " + strings.Join(pip, " ") + "\n")
	}
	for _, coll := range collections {
		b.WriteString("RUN ansible-galaxy collection install " + shellQuote(coll) + " || true\n")
	}
	b.WriteString("RUN useradd -m runner\n")
	b.WriteString("WORKDIR /infra-project\n")
	return b.String()
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == '\n' || r == ' ' }) {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func shellQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

func dirExists(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && fi.IsDir()
}
