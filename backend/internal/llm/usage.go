package llm

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/infrakit/backend/internal/userctx"
)

// A3c — token-usage accounting. One row per completed stream. No message
// content, no pricing/cost — token counts only. Shares llm.db.

const usageSchema = `
CREATE TABLE IF NOT EXISTS llm_usage (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  conn_id           TEXT,
  task_id           TEXT,
  model             TEXT,
  prompt_tokens     INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  at                INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_llm_usage_at ON llm_usage(at);
`

var usageMigrations = []string{
	`ALTER TABLE llm_usage ADD COLUMN owner TEXT NOT NULL DEFAULT ''`, // U2
}

// UsageGroup is one aggregated bucket.
type UsageGroup struct {
	Key              string `json:"key"`
	Calls            int    `json:"calls"`
	PromptTokens     int    `json:"promptTokens"`
	CompletionTokens int    `json:"completionTokens"`
}

// UsageStore records + aggregates token usage.
type UsageStore struct {
	db *sql.DB

	mu    sync.Mutex
	cache map[string]usageCacheEntry
}

type usageCacheEntry struct {
	groups []UsageGroup
	at     time.Time
}

const usageCacheTTL = 30 * time.Second

// NewUsageStore applies the usage schema on the shared llm.db handle.
func NewUsageStore(db *sql.DB) (*UsageStore, error) {
	if _, err := db.Exec(usageSchema); err != nil {
		return nil, fmt.Errorf("apply usage schema: %w", err)
	}
	for _, m := range usageMigrations {
		if _, err := db.Exec(m); err != nil && !strings.Contains(err.Error(), "duplicate column") {
			return nil, fmt.Errorf("usage migration %q: %w", m, err)
		}
	}
	return &UsageStore{db: db, cache: map[string]usageCacheEntry{}}, nil
}

// ClaimOrphans assigns unowned usage rows to owner (first-admin bootstrap).
func (u *UsageStore) ClaimOrphans(owner string) error {
	if owner == "" {
		return nil
	}
	_, err := u.db.Exec(`UPDATE llm_usage SET owner = ? WHERE owner = ''`, owner)
	return err
}

// Record satisfies the engine's UsageRecorder. Best-effort: a write error is
// swallowed (usage accounting must never break a chat). The owner comes from
// the context (userctx).
func (u *UsageStore) Record(ctx context.Context, connID, taskID, model string, prompt, completion int) {
	if prompt == 0 && completion == 0 {
		return
	}
	_, _ = u.db.Exec(
		`INSERT INTO llm_usage (conn_id,task_id,model,prompt_tokens,completion_tokens,at,owner)
		 VALUES (?,?,?,?,?,?,?)`,
		connID, taskID, model, prompt, completion, time.Now().UnixMilli(), userctx.From(ctx),
	)
	u.mu.Lock()
	u.cache = map[string]usageCacheEntry{}
	u.mu.Unlock()
}

// Aggregate returns usage grouped by "day", "model" or "task" (anything else
// → "model"), over the window [sinceMillis, now]. Cached ~30s.
func (u *UsageStore) Aggregate(owner string, sinceMillis int64, groupBy string) ([]UsageGroup, error) {
	col := "model"
	switch groupBy {
	case "day":
		col = "day"
	case "task":
		col = "COALESCE(NULLIF(task_id,''),'(playground)')"
	}
	key := fmt.Sprintf("%s|%d|%s", owner, sinceMillis, groupBy)

	u.mu.Lock()
	if e, ok := u.cache[key]; ok && time.Since(e.at) < usageCacheTTL {
		u.mu.Unlock()
		return e.groups, nil
	}
	u.mu.Unlock()

	sel := col
	if col == "day" {
		sel = `strftime('%Y-%m-%d', at/1000, 'unixepoch', 'localtime')`
	}
	where, wargs := "", []any{sinceMillis}
	if owner != "" {
		where = " AND (owner = ? OR owner = '')"
		wargs = append(wargs, owner)
	}
	q := fmt.Sprintf(
		`SELECT %s AS k, COUNT(*), COALESCE(SUM(prompt_tokens),0), COALESCE(SUM(completion_tokens),0)
		 FROM llm_usage WHERE at >= ?%s GROUP BY k ORDER BY (SUM(prompt_tokens)+SUM(completion_tokens)) DESC`,
		sel, where,
	)
	rows, err := u.db.Query(q, wargs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []UsageGroup{}
	for rows.Next() {
		var g UsageGroup
		var k sql.NullString
		if err := rows.Scan(&k, &g.Calls, &g.PromptTokens, &g.CompletionTokens); err != nil {
			return nil, err
		}
		g.Key = k.String
		if g.Key == "" {
			g.Key = "(unknown)"
		}
		out = append(out, g)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	u.mu.Lock()
	u.cache[key] = usageCacheEntry{groups: out, at: time.Now()}
	u.mu.Unlock()
	return out, nil
}
