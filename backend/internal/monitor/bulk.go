package monitor

import (
	"fmt"
	"strings"
)

// M5 — bulk import + templates. Both produce Monitor drafts; the API layer
// persists them and reloads the engine.

// BulkError is one line that could not be turned into a monitor.
type BulkError struct {
	Line int    `json:"line"`
	Text string `json:"text"`
	Err  string `json:"error"`
}

// ParseBulk turns `name,kind,target[,tags]` lines into monitor drafts. Blank
// lines and `#` comments are skipped; an optional header row (name,kind,target)
// is ignored. Nothing is persisted.
func ParseBulk(text string) ([]Monitor, []BulkError) {
	var out []Monitor
	var errs []BulkError
	for i, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(strings.TrimSuffix(raw, "\r"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		f := strings.Split(line, ",")
		for j := range f {
			f[j] = strings.TrimSpace(strings.Trim(strings.TrimSpace(f[j]), `"`))
		}
		if len(f) >= 3 && strings.EqualFold(f[0], "name") && strings.EqualFold(f[1], "kind") {
			continue // header row
		}
		if len(f) < 3 || f[0] == "" || f[2] == "" {
			errs = append(errs, BulkError{i + 1, line, "expected name,kind,target"})
			continue
		}
		kind := strings.ToLower(f[1])
		if !KnownKind(kind) {
			errs = append(errs, BulkError{i + 1, line, "unknown kind: " + kind})
			continue
		}
		m := Monitor{Name: f[0], Kind: kind, Target: f[2], Enabled: true}
		if len(f) >= 4 {
			m.Tags = f[3]
		}
		out = append(out, m)
	}
	return out, errs
}

// TemplateIDs lists the available monitor templates.
func TemplateIDs() []string { return []string{"web-service"} }

// BuildTemplate expands a template into a tagged group of monitor drafts for
// one hostname.
func BuildTemplate(id, hostname, extraTags string) ([]Monitor, error) {
	hostname = strings.TrimSpace(hostname)
	hostname = strings.TrimPrefix(strings.TrimPrefix(hostname, "https://"), "http://")
	hostname = strings.TrimSuffix(hostname, "/")
	if hostname == "" {
		return nil, fmt.Errorf("hostname is required")
	}
	tags := hostname
	if t := strings.TrimSpace(extraTags); t != "" {
		tags += ", " + t
	}

	switch id {
	case "web-service":
		return []Monitor{
			{
				Name: hostname + " · HTTP", Kind: KindHTTP, Target: "https://" + hostname,
				Enabled: true, Tags: tags,
			},
			{
				Name: hostname + " · TLS cert", Kind: KindTLS, Target: hostname + ":443",
				Enabled: true, Tags: tags, IntervalSec: kindDefaultInterval(KindTLS),
			},
			{
				Name: hostname + " · DNS", Kind: KindDNS, Target: hostname,
				Enabled: true, Tags: tags, Config: map[string]any{"recordType": "A"},
			},
			{
				Name: registrableDomain(hostname) + " · domain", Kind: KindDomain, Target: registrableDomain(hostname),
				Enabled: true, Tags: tags, IntervalSec: kindDefaultInterval(KindDomain),
			},
		}, nil
	default:
		return nil, fmt.Errorf("unknown template: %s", id)
	}
}

// registrableDomain is a naive eTLD+1: the last two dot-labels. Good enough for
// common cases; the user can fix multi-part TLDs (example.co.uk) after.
func registrableDomain(host string) string {
	labels := strings.Split(host, ".")
	if len(labels) <= 2 {
		return host
	}
	return strings.Join(labels[len(labels)-2:], ".")
}
