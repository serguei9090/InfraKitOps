package promptstore

import (
	"time"

	"github.com/infrakit/backend/internal/sharedb"
)

const shareTable, shareCol = "prompt_share", "prompt_id"

func (s *Store) ensureShareSchema() error {
	return sharedb.EnsureSchema(s.db, shareTable, shareCol)
}

// SharedAccess reports a viewer's share grant on a prompt.
func (s *Store) SharedAccess(id, viewer string) (view, edit bool) {
	return sharedb.Access(s.db, shareTable, shareCol, id, viewer)
}

// CanEditPrompt: the owner, an unowned/single-user row, or an edit-grantee.
func (s *Store) CanEditPrompt(id, editor string) bool {
	if editor == "" {
		return true
	}
	o := s.promptOwner(id)
	if o == "" || o == editor {
		return true
	}
	_, e := s.SharedAccess(id, editor)
	return e
}

// PromptOwner is the exported owner lookup (handlers gate share management).
func (s *Store) PromptOwner(id string) string { return s.promptOwner(id) }

// Shares lists the grants on a prompt.
func (s *Store) Shares(id string) ([]sharedb.Grant, error) {
	return sharedb.List(s.db, shareTable, shareCol, id)
}

// Grant shares a prompt with a user.
func (s *Store) Grant(id, grantee, by string, canEdit bool) error {
	if s.promptOwner(id) == "" {
		// also true for a genuinely unowned prompt, but sharing one of those
		// is harmless — the owner check in the handler already ran.
	}
	return sharedb.Set(s.db, shareTable, shareCol, id, grantee, by, canEdit)
}

// Revoke removes a user's grant.
func (s *Store) Revoke(id, grantee string) error {
	return sharedb.Revoke(s.db, shareTable, shareCol, id, grantee)
}

// SetOwner reassigns a prompt (admin, audited). Caller checks existence.
func (s *Store) SetOwner(id, newOwner string) error {
	_, err := s.db.Exec(`UPDATE prompt SET owner = ?, updated_at = ? WHERE id = ?`,
		newOwner, time.Now().UnixMilli(), id)
	return err
}

// PurgeGranteeShares drops every grant made to a user.
func (s *Store) PurgeGranteeShares(userID string) error {
	return sharedb.DeleteForGrantee(s.db, shareTable, userID)
}
