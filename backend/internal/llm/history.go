package llm

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// A3b — opt-in conversation history. Nothing is written unless the client
// explicitly saves a conversation (or has auto-save on). Shares llm.db.

const historySchema = `
CREATE TABLE IF NOT EXISTS llm_conversation (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  conn_id           TEXT,
  model             TEXT,
  task_id           TEXT,
  pinned            INTEGER NOT NULL DEFAULT 0,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_message (
  conv_id           TEXT NOT NULL REFERENCES llm_conversation(id) ON DELETE CASCADE,
  idx               INTEGER NOT NULL,
  role              TEXT NOT NULL,
  content           TEXT NOT NULL,
  steps             TEXT,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  PRIMARY KEY (conv_id, idx)
);
`

// Conversation is a saved chat (metadata only; messages loaded separately).
type Conversation struct {
	ID               string `json:"id"`
	Title            string `json:"title"`
	ConnID           string `json:"connId,omitempty"`
	Model            string `json:"model,omitempty"`
	TaskID           string `json:"taskId,omitempty"`
	Pinned           bool   `json:"pinned"`
	PromptTokens     int    `json:"promptTokens"`
	CompletionTokens int    `json:"completionTokens"`
	CreatedAt        int64  `json:"createdAt"`
	UpdatedAt        int64  `json:"updatedAt"`
}

// StoredMessage is one turn of a saved conversation. Steps is opaque JSON
// (the frontend's ChatToolStep[]) round-tripped as-is.
type StoredMessage struct {
	Role             string          `json:"role"`
	Content          string          `json:"content"`
	Steps            json.RawMessage `json:"steps,omitempty"`
	PromptTokens     int             `json:"promptTokens,omitempty"`
	CompletionTokens int             `json:"completionTokens,omitempty"`
}

// History is the conversation store.
type History struct{ db *sql.DB }

// historyMigrations are `ALTER TABLE ADD COLUMN` statements for DBs created by
// an older build. Each is run best-effort; "duplicate column" is expected and
// ignored.
var historyMigrations = []string{
	`ALTER TABLE llm_conversation ADD COLUMN prompt_tokens INTEGER NOT NULL DEFAULT 0`,
	`ALTER TABLE llm_conversation ADD COLUMN completion_tokens INTEGER NOT NULL DEFAULT 0`,
	`ALTER TABLE llm_message ADD COLUMN prompt_tokens INTEGER`,
	`ALTER TABLE llm_message ADD COLUMN completion_tokens INTEGER`,
}

// NewHistory applies the history schema on the shared llm.db handle.
func NewHistory(db *sql.DB) (*History, error) {
	if _, err := db.Exec(historySchema); err != nil {
		return nil, fmt.Errorf("apply history schema: %w", err)
	}
	for _, m := range historyMigrations {
		if _, err := db.Exec(m); err != nil && !strings.Contains(err.Error(), "duplicate column") {
			return nil, fmt.Errorf("history migration %q: %w", m, err)
		}
	}
	return &History{db: db}, nil
}

// Save inserts a new conversation (id generated) or replaces an existing one's
// messages (when meta.ID is set). Returns the id.
func (h *History) Save(meta Conversation, msgs []StoredMessage) (string, error) {
	now := time.Now().UnixMilli()
	tx, err := h.db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback() //nolint:errcheck

	if meta.ID == "" {
		meta.ID = newID("conv")
		meta.CreatedAt = now
	}
	if meta.Title == "" {
		meta.Title = "Untitled"
	}
	meta.UpdatedAt = now

	meta.PromptTokens, meta.CompletionTokens = 0, 0
	for _, m := range msgs {
		meta.PromptTokens += m.PromptTokens
		meta.CompletionTokens += m.CompletionTokens
	}

	_, err = tx.Exec(
		`INSERT INTO llm_conversation
		   (id,title,conn_id,model,task_id,pinned,prompt_tokens,completion_tokens,created_at,updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?)
		 ON CONFLICT(id) DO UPDATE SET
		   title=excluded.title, model=excluded.model,
		   prompt_tokens=excluded.prompt_tokens, completion_tokens=excluded.completion_tokens,
		   updated_at=excluded.updated_at`,
		meta.ID, meta.Title, meta.ConnID, meta.Model, meta.TaskID, b2i(meta.Pinned),
		meta.PromptTokens, meta.CompletionTokens, meta.CreatedAt, meta.UpdatedAt,
	)
	if err != nil {
		return "", err
	}
	if _, err = tx.Exec(`DELETE FROM llm_message WHERE conv_id = ?`, meta.ID); err != nil {
		return "", err
	}
	for i, m := range msgs {
		var steps any
		if len(m.Steps) > 0 {
			steps = string(m.Steps)
		}
		var pt, ct any
		if m.PromptTokens > 0 {
			pt = m.PromptTokens
		}
		if m.CompletionTokens > 0 {
			ct = m.CompletionTokens
		}
		if _, err = tx.Exec(
			`INSERT INTO llm_message (conv_id,idx,role,content,steps,prompt_tokens,completion_tokens)
			 VALUES (?,?,?,?,?,?,?)`,
			meta.ID, i, m.Role, m.Content, steps, pt, ct,
		); err != nil {
			return "", err
		}
	}
	return meta.ID, tx.Commit()
}

// List returns conversation metadata, pinned first then newest.
func (h *History) List() ([]Conversation, error) {
	rows, err := h.db.Query(
		`SELECT id,title,conn_id,model,task_id,pinned,prompt_tokens,completion_tokens,created_at,updated_at
		 FROM llm_conversation ORDER BY pinned DESC, updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Conversation{}
	for rows.Next() {
		var c Conversation
		var pinned int
		if err := rows.Scan(&c.ID, &c.Title, &c.ConnID, &c.Model, &c.TaskID, &pinned,
			&c.PromptTokens, &c.CompletionTokens, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		c.Pinned = pinned != 0
		out = append(out, c)
	}
	return out, rows.Err()
}

// Get loads a conversation and its messages.
func (h *History) Get(id string) (*Conversation, []StoredMessage, error) {
	var c Conversation
	var pinned int
	err := h.db.QueryRow(
		`SELECT id,title,conn_id,model,task_id,pinned,prompt_tokens,completion_tokens,created_at,updated_at
		 FROM llm_conversation WHERE id = ?`, id,
	).Scan(&c.ID, &c.Title, &c.ConnID, &c.Model, &c.TaskID, &pinned,
		&c.PromptTokens, &c.CompletionTokens, &c.CreatedAt, &c.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil, ErrNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	c.Pinned = pinned != 0

	rows, err := h.db.Query(
		`SELECT role,content,steps,prompt_tokens,completion_tokens
		 FROM llm_message WHERE conv_id = ? ORDER BY idx`, id)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var msgs []StoredMessage
	for rows.Next() {
		var m StoredMessage
		var steps sql.NullString
		var pt, ct sql.NullInt64
		if err := rows.Scan(&m.Role, &m.Content, &steps, &pt, &ct); err != nil {
			return nil, nil, err
		}
		if steps.Valid && steps.String != "" {
			m.Steps = json.RawMessage(steps.String)
		}
		m.PromptTokens = int(pt.Int64)
		m.CompletionTokens = int(ct.Int64)
		msgs = append(msgs, m)
	}
	return &c, msgs, rows.Err()
}

// Patch updates the title and/or pinned flag.
func (h *History) Patch(id string, title *string, pinned *bool) error {
	sets, args := []string{}, []any{}
	if title != nil {
		sets = append(sets, "title = ?")
		args = append(args, *title)
	}
	if pinned != nil {
		sets = append(sets, "pinned = ?")
		args = append(args, b2i(*pinned))
	}
	if len(sets) == 0 {
		return nil
	}
	sets = append(sets, "updated_at = ?")
	args = append(args, time.Now().UnixMilli(), id)
	res, err := h.db.Exec(`UPDATE llm_conversation SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// Delete removes a conversation and its messages.
func (h *History) Delete(id string) error {
	if _, err := h.db.Exec(`DELETE FROM llm_message WHERE conv_id = ?`, id); err != nil {
		return err
	}
	res, err := h.db.Exec(`DELETE FROM llm_conversation WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}
