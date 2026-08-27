// Package hostsfile reads and writes the system hosts file with an
// enable/disable convention (a disabled mapping is written commented-out).
// Writing needs elevation; a failed write returns a needs-elevation error and
// the caller surfaces it. See NETWORK_MODULE_PLAN.md tool #14.
package hostsfile

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// Line is one parsed hosts-file line.
type Line struct {
	// Kind: "mapping" (an IP → hostnames entry), "comment" (free text), "blank".
	Kind      string   `json:"kind"`
	Enabled   bool     `json:"enabled"`
	IP        string   `json:"ip,omitempty"`
	Hostnames []string `json:"hostnames,omitempty"`
	Comment   string   `json:"comment,omitempty"`
	// Raw is the verbatim original line (preserved for round-trip).
	Raw string `json:"raw"`
}

// File is the parsed hosts file.
type File struct {
	V     int    `json:"v"`
	Path  string `json:"path"`
	Lines []Line `json:"lines"`
}

// Path returns the OS hosts-file path.
func Path() string {
	if runtime.GOOS == "windows" {
		root := os.Getenv("SystemRoot")
		if root == "" {
			root = `C:\Windows`
		}
		return filepath.Join(root, "System32", "drivers", "etc", "hosts")
	}
	return "/etc/hosts"
}

var mappingRe = regexp.MustCompile(`^(\s*)(#\s*)?([0-9a-fA-F:.]+)\s+([^#]+?)\s*(?:#\s*(.*))?$`)

// Parse reads and classifies the hosts file.
func Parse() (File, error) {
	path := Path()
	raw, err := os.ReadFile(path)
	if err != nil {
		return File{}, err
	}
	f := File{V: 1, Path: path}
	for _, raw := range strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n") {
		f.Lines = append(f.Lines, classify(raw))
	}
	// drop a single trailing empty line artifact
	if n := len(f.Lines); n > 0 && f.Lines[n-1].Kind == "blank" && f.Lines[n-1].Raw == "" {
		f.Lines = f.Lines[:n-1]
	}
	return f, nil
}

func classify(raw string) Line {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return Line{Kind: "blank", Raw: raw}
	}
	if m := mappingRe.FindStringSubmatch(raw); m != nil {
		hostnames := strings.Fields(m[4])
		if len(hostnames) > 0 && looksLikeIP(m[3]) {
			return Line{
				Kind:      "mapping",
				Enabled:   m[2] == "",
				IP:        m[3],
				Hostnames: hostnames,
				Comment:   strings.TrimSpace(m[5]),
				Raw:       raw,
			}
		}
	}
	return Line{Kind: "comment", Raw: raw, Comment: strings.TrimLeft(trimmed, "# ")}
}

func looksLikeIP(s string) bool {
	if strings.Contains(s, ":") {
		return strings.Count(s, ":") >= 2
	}
	parts := strings.Split(s, ".")
	return len(parts) == 4
}

// Render turns a line list back into file text, honoring Enabled.
func Render(lines []Line) string {
	var b strings.Builder
	for _, l := range lines {
		switch l.Kind {
		case "mapping":
			if !l.Enabled {
				b.WriteString("# ")
			}
			b.WriteString(l.IP)
			b.WriteByte(' ')
			b.WriteString(strings.Join(l.Hostnames, " "))
			if l.Comment != "" {
				b.WriteString("  # ")
				b.WriteString(l.Comment)
			}
			b.WriteByte('\n')
		default:
			b.WriteString(l.Raw)
			b.WriteByte('\n')
		}
	}
	return b.String()
}

// Apply writes the given lines to the hosts file: timestamped backup first,
// then an atomic replace. Returns a needs-elevation sentinel on EACCES/EPERM.
func Apply(lines []Line) error {
	path := Path()
	current, err := os.ReadFile(path)
	if err != nil {
		return err
	}

	backupDir := filepath.Dir(path)
	backup := filepath.Join(backupDir, fmt.Sprintf("hosts.infrakit-backup-%s", time.Now().Format("20060102-150405")))
	if err := os.WriteFile(backup, current, 0o644); err != nil {
		if os.IsPermission(err) {
			return ErrNeedsElevation
		}
		return fmt.Errorf("write backup: %w", err)
	}

	tmp := filepath.Join(backupDir, ".hosts.infrakit-tmp")
	newContent := []byte(Render(lines))
	if err := os.WriteFile(tmp, newContent, 0o644); err != nil {
		if os.IsPermission(err) {
			return ErrNeedsElevation
		}
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		if os.IsPermission(err) {
			return ErrNeedsElevation
		}
		return err
	}
	return nil
}

// ErrNeedsElevation signals the caller should prompt the user to run elevated.
var ErrNeedsElevation = fmt.Errorf("writing the hosts file requires administrator / root privileges")

// Backups lists the timestamped backups this tool has made, newest first.
func Backups() ([]string, error) {
	dir := filepath.Dir(Path())
	matches, err := filepath.Glob(filepath.Join(dir, "hosts.infrakit-backup-*"))
	if err != nil {
		return nil, err
	}
	// Glob returns lexical order; timestamp format sorts correctly, reverse it.
	for i, j := 0, len(matches)-1; i < j; i, j = i+1, j-1 {
		matches[i], matches[j] = matches[j], matches[i]
	}
	return matches, nil
}

// RestoreLatest copies the newest backup back over the hosts file.
func RestoreLatest() error {
	backups, err := Backups()
	if err != nil {
		return err
	}
	if len(backups) == 0 {
		return fmt.Errorf("no backup to restore")
	}
	data, err := os.ReadFile(backups[0])
	if err != nil {
		return err
	}
	if err := os.WriteFile(Path(), data, 0o644); err != nil {
		if os.IsPermission(err) {
			return ErrNeedsElevation
		}
		return err
	}
	return nil
}
