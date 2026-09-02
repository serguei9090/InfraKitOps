package ansible

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/infrakit/backend/internal/sse"
)

// GalaxyItem is one search hit (a role or a collection).
type GalaxyItem struct {
	Type        string `json:"type"` // "role" | "collection"
	Name        string `json:"name"` // "namespace.name"
	Description string `json:"description,omitempty"`
	Version     string `json:"version,omitempty"`
	Downloads   int64  `json:"downloads,omitempty"`
}

var galaxyHTTP = &http.Client{Timeout: 20 * time.Second}

// GalaxySearch queries galaxy.ansible.com for roles or collections.
func GalaxySearch(ctx context.Context, kind, query string) ([]GalaxyItem, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("a search term is required")
	}
	switch kind {
	case "collection":
		return searchCollections(ctx, query)
	case "role":
		return searchRoles(ctx, query)
	default:
		c, err := searchCollections(ctx, query)
		if err != nil {
			return nil, err
		}
		r, _ := searchRoles(ctx, query)
		return append(c, r...), nil
	}
}

func getJSON(ctx context.Context, u string, v any) error {
	c, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(c, http.MethodGet, u, nil)
	req.Header.Set("Accept", "application/json")
	resp, err := galaxyHTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("galaxy: %s", resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(v)
}

type collVersionResp struct {
	Data []struct {
		CollectionVersion struct {
			Namespace   string `json:"namespace"`
			Name        string `json:"name"`
			Version     string `json:"version"`
			Description string `json:"description"`
		} `json:"collection_version"`
	} `json:"data"`
}

func searchCollections(ctx context.Context, q string) ([]GalaxyItem, error) {
	base := "https://galaxy.ansible.com/api/v3/plugin/ansible/search/collection-versions/?limit=15&"
	// `name=` is a near-exact match (best hits); `keywords=` is fuzzier. Merge,
	// name-matches first, dedupe on namespace.name keeping the highest version.
	var out []GalaxyItem
	seen := map[string]int{} // name -> index in out
	var firstErr error
	for _, param := range []string{"name=", "keywords="} {
		var body collVersionResp
		if err := getJSON(ctx, base+param+url.QueryEscape(q), &body); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		for _, d := range body.Data {
			cv := d.CollectionVersion
			name := cv.Namespace + "." + cv.Name
			if i, ok := seen[name]; ok {
				if cv.Version > out[i].Version {
					out[i].Version = cv.Version
				}
				continue
			}
			seen[name] = len(out)
			out = append(out, GalaxyItem{
				Type: "collection", Name: name, Version: cv.Version, Description: cv.Description,
			})
		}
	}
	if len(out) == 0 && firstErr != nil {
		return nil, firstErr
	}
	if len(out) > 15 {
		out = out[:15]
	}
	return out, nil
}

func searchRoles(ctx context.Context, q string) ([]GalaxyItem, error) {
	u := "https://galaxy.ansible.com/api/v1/roles/?order_by=-download_count&page_size=100&keyword=" + url.QueryEscape(q)
	var body struct {
		Results []struct {
			Name          string `json:"name"`
			Username      string `json:"username"`
			Description   string `json:"description"`
			DownloadCount int64  `json:"download_count"`
			SummaryFields struct {
				Namespace struct {
					Name string `json:"name"`
				} `json:"namespace"`
			} `json:"summary_fields"`
		} `json:"results"`
	}
	if err := getJSON(ctx, u, &body); err != nil {
		return nil, err
	}
	// galaxy's legacy v1 roles API ignores keyword/search server-side, so
	// filter here.
	ql := strings.ToLower(q)
	out := make([]GalaxyItem, 0, len(body.Results))
	for _, r := range body.Results {
		ns := r.SummaryFields.Namespace.Name
		if ns == "" {
			ns = r.Username
		}
		if ns == "" || r.Name == "" {
			continue
		}
		full := ns + "." + r.Name
		if !strings.Contains(strings.ToLower(full), ql) && !strings.Contains(strings.ToLower(r.Description), ql) {
			continue
		}
		out = append(out, GalaxyItem{
			Type: "role", Name: full, Description: r.Description, Downloads: r.DownloadCount,
		})
		if len(out) >= 15 {
			break
		}
	}
	return out, nil
}

// GalaxyInstall installs a single role/collection, or everything in
// requirements.yml when name is "", into the project (project-local paths).
func (e *Engine) GalaxyInstall(ctx context.Context, owner string, mode RuntimeMode, projectID, kind, name string, out chan<- sse.Message) {
	send := func(ev string, data any) {
		select {
		case out <- sse.Message{Event: ev, Data: data}:
		case <-ctx.Done():
		}
	}
	proj, err := e.store.GetProject(owner, projectID)
	if err != nil {
		send("error", map[string]string{"error": "project not found"})
		return
	}
	runner := e.activeRunner(ctx)

	type step struct {
		label string
		args  []string
	}
	var steps []step
	fromReqs := strings.TrimSpace(name) == ""

	if fromReqs {
		reqs := "requirements.yml"
		if _, statErr := os.Stat(filepath.Join(proj.Path, "requirements.yaml")); statErr == nil {
			reqs = "requirements.yaml"
		}
		steps = []step{
			{"roles", []string{"role", "install", "-r", reqs, "-p", "roles", "--force"}},
			{"collections", []string{"collection", "install", "-r", reqs, "-p", "collections", "--force"}},
		}
	} else if kind == "role" {
		steps = []step{{"role", []string{"role", "install", name, "-p", "roles", "--force"}}}
	} else {
		steps = []step{{"collection", []string{"collection", "install", name, "-p", "collections", "--force"}}}
	}

	send("run-start", map[string]any{"target": nz(name, "requirements.yml")})
	failed := false
	for _, s := range steps {
		send("stdout", map[string]string{"text": "$ ansible-galaxy " + strings.Join(s.args, " ")})
		cmd, cerr := runner.Command(ctx, "ansible-galaxy", proj.Path, s.args, nil)
		if cerr != nil {
			send("error", map[string]string{"error": cerr.Error()})
			send("run-end", map[string]string{"status": "failed"})
			return
		}
		err := runStreaming(cmd,
			func(l string) { send("stdout", map[string]string{"text": l}) },
			func(l string) { send("stderr", map[string]string{"text": l}) },
		)
		if err != nil {
			// installing roles from a collection-only requirements.yml (or vice
			// versa) is a benign "no <kind> in requirements" — only hard-fail a
			// single explicit install.
			if !fromReqs {
				failed = true
			}
			send("stderr", map[string]string{"text": fmt.Sprintf("(%s: %v)", s.label, err)})
		}
	}
	status := "ok"
	if failed {
		status = "failed"
	}
	send("run-end", map[string]string{"status": status})
}
