package formstore

import (
	"database/sql"
	"time"

	"github.com/infrakit/backend/internal/sharedb"
)

const shareTable, shareCol = "form_share", "form_id"

func (s *Store) ensureShareSchema() error {
	return sharedb.EnsureSchema(s.db, shareTable, shareCol)
}

func deleteForThing(db *sql.DB, id string) error {
	return sharedb.DeleteForThing(db, shareTable, shareCol, id)
}

// SharedAccess reports a viewer's share grant on a form.
func (s *Store) SharedAccess(id, viewer string) (view, edit bool) {
	return sharedb.Access(s.db, shareTable, shareCol, id, viewer)
}

// CanEdit: the owner, an unowned/single-user row, or an edit-grantee. A
// brand-new id (not yet stored) is editable by anyone (they're creating it).
func (s *Store) CanEdit(id, editor string) bool {
	if editor == "" {
		return true
	}
	o := s.owner(id)
	if o == "" || o == editor {
		return true
	}
	_, e := s.SharedAccess(id, editor)
	return e
}

// Owner is the exported owner lookup (handlers gate share management).
func (s *Store) Owner(id string) string { return s.owner(id) }

// Shares lists the grants on a form.
func (s *Store) Shares(id string) ([]sharedb.Grant, error) {
	return sharedb.List(s.db, shareTable, shareCol, id)
}

// Grant / Revoke manage one grant.
func (s *Store) Grant(id, grantee, by string, canEdit bool) error {
	return sharedb.Set(s.db, shareTable, shareCol, id, grantee, by, canEdit)
}
func (s *Store) Revoke(id, grantee string) error {
	return sharedb.Revoke(s.db, shareTable, shareCol, id, grantee)
}

// SetOwner reassigns a form (admin, audited). Caller checks existence.
func (s *Store) SetOwner(id, newOwner string) error {
	_, err := s.db.Exec(`UPDATE form SET owner = ?, updated_at = ? WHERE id = ?`,
		newOwner, time.Now().UnixMilli(), id)
	return err
}

// PurgeGranteeShares drops every grant made to a user.
func (s *Store) PurgeGranteeShares(userID string) error {
	return sharedb.DeleteForGrantee(s.db, shareTable, userID)
}
