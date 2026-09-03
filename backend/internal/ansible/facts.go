package ansible

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// HostFacts is one host's cached facts + when they were gathered.
type HostFacts struct {
	Host       string         `json:"host"`
	GatheredAt int64          `json:"gatheredAt"`
	Facts      map[string]any `json:"facts"`
}

// Facts reads the jsonfile fact cache under <project>/.facts. Every playbook /
// ad-hoc run writes it (factCacheEnv). AN6f.
func (e *Engine) Facts(owner, projectID string) ([]HostFacts, error) {
	proj, err := e.store.GetProject(owner, projectID)
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(proj.Path, ".facts")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return []HostFacts{}, nil // no runs yet → empty, not an error
	}
	out := make([]HostFacts, 0, len(entries))
	for _, en := range entries {
		if en.IsDir() || strings.HasPrefix(en.Name(), ".") {
			continue
		}
		b, rerr := os.ReadFile(filepath.Join(dir, en.Name()))
		if rerr != nil || len(b) > 4<<20 {
			continue
		}
		var f map[string]any
		if json.Unmarshal(b, &f) != nil {
			continue
		}
		info, _ := en.Info()
		hf := HostFacts{Host: en.Name(), Facts: f}
		if info != nil {
			hf.GatheredAt = info.ModTime().UnixMilli()
		}
		out = append(out, hf)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Host < out[j].Host })
	return out, nil
}

// GatherFacts runs `ansible <pattern> -m setup` to (re)populate the cache, then
// returns the fresh facts. Blocking (no SSE) — the setup output is discarded.
func (e *Engine) GatherFacts(ctx context.Context, owner, projectID, pattern, inventory string) ([]HostFacts, error) {
	proj, err := e.store.GetProject(owner, projectID)
	if err != nil {
		return nil, err
	}
	c, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()

	args := []string{nz(pattern, "all"), "-m", "setup"}
	if inv := strings.TrimSpace(inventory); inv != "" {
		if strings.Contains(inv, ",") {
			args = append(args, "-i", inv)
		} else if p, jerr := safeJoin(proj.Path, inv); jerr == nil {
			args = append(args, "-i", p)
		}
	}
	_, _ = e.activeRunner(c).Capture(c, RunReq{
		Tool: "ansible", Dir: proj.Path, Argv: args, Env: factCacheEnv(proj.Path), Combined: true,
	})
	return e.Facts(owner, projectID)
}
