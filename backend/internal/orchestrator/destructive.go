package orchestrator

import (
	"regexp"
	"strings"
)

// DestructiveMatch is one flagged line in a script.
type DestructiveMatch struct {
	Line    int    `json:"line"`
	Text    string `json:"text"`
	Pattern string `json:"pattern"`
	Note    string `json:"note"`
}

type destructiveRule struct {
	re   *regexp.Regexp
	name string
	note string
}

var destructiveRules = []destructiveRule{
	{regexp.MustCompile(`\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+`), "rm -rf", "recursive/forced delete"},
	{regexp.MustCompile(`\bRemove-Item\b.*-Recurse`), "Remove-Item -Recurse", "recursive delete"},
	{regexp.MustCompile(`\b(rd|rmdir)\s+/s\b`), "rmdir /s", "recursive delete"},
	{regexp.MustCompile(`\bmkfs(\.\w+)?\b`), "mkfs", "formats a filesystem"},
	{regexp.MustCompile(`\bdd\s+.*\bof=`), "dd of=", "raw disk write"},
	{regexp.MustCompile(`\b(shutdown|reboot|halt|poweroff)\b`), "shutdown/reboot", "restarts or powers off the host"},
	{regexp.MustCompile(`\bStop-Computer\b|\bRestart-Computer\b`), "Stop/Restart-Computer", "restarts or powers off the host"},
	{regexp.MustCompile(`(?i)\bDROP\s+(TABLE|DATABASE|SCHEMA)\b`), "DROP TABLE/DATABASE", "drops a database object"},
	{regexp.MustCompile(`(?i)\bTRUNCATE\s+TABLE\b`), "TRUNCATE TABLE", "empties a table"},
	{regexp.MustCompile(`\bgit\s+push\b.*(--force|-f)\b`), "git push --force", "rewrites remote history"},
	{regexp.MustCompile(`\bgit\s+reset\s+--hard\b`), "git reset --hard", "discards local changes"},
	{regexp.MustCompile(`\bkubectl\s+delete\b`), "kubectl delete", "deletes cluster resources"},
	{regexp.MustCompile(`\b(iptables|nft)\b.*(-F|flush)\b`), "firewall flush", "clears firewall rules"},
	{regexp.MustCompile(`\bchmod\s+-R\s+0?777\b`), "chmod -R 777", "world-writable recursively"},
	{regexp.MustCompile(`:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;`), "fork bomb", "fork bomb"},
	{regexp.MustCompile(`\b(curl|wget)\b.*\|\s*(sudo\s+)?(sh|bash)\b`), "curl | sh", "pipes a download straight to a shell"},
}

var (
	reDeleteFrom = regexp.MustCompile(`(?i)\bDELETE\s+FROM\b`)
	reWhere      = regexp.MustCompile(`(?i)\bWHERE\b`)
)

// ScanDestructive flags lines in a rendered script that match a destructive
// pattern. Best-effort — a heuristic, not a sandbox.
func ScanDestructive(script string) []DestructiveMatch {
	var out []DestructiveMatch
	for i, line := range strings.Split(script, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "//") {
			continue
		}
		for _, r := range destructiveRules {
			if r.re.MatchString(line) {
				out = append(out, DestructiveMatch{Line: i + 1, Text: trimmed, Pattern: r.name, Note: r.note})
			}
		}
		// RE2 has no lookahead — flag "DELETE FROM" without a "WHERE" here.
		if reDeleteFrom.MatchString(line) && !reWhere.MatchString(line) {
			out = append(out, DestructiveMatch{Line: i + 1, Text: trimmed, Pattern: "DELETE without WHERE", Note: "deletes every row"})
		}
	}
	return out
}
