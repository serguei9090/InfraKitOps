package orchestrator

import (
	"time"

	"github.com/infrakit/backend/internal/sharedb"
)

const shareTable, shareCol = "runbook_share", "runbook_id"

// ensureShareSchema is called from Open.
func (s *Store) ensureShareSchema() error {
	return sharedb.EnsureSchema(s.db, shareTable, shareCol)
}

// SharedAccess reports what `viewer` may do with a runbook via a share grant.
func (s *Store) SharedAccess(id, viewer string) (view, edit bool) {
	return sharedb.Access(s.db, shareTable, shareCol, id, viewer)
}

// CanView reports whether `viewer` may see runbook `id` — its owner, a
// published runbook, an orphan/single-user row, or a share grantee. A missing
// runbook returns false.
func (s *Store) CanView(id, viewer string) bool {
	if viewer == "" {
		return true
	}
	var owner string
	var pub int
	if s.db.QueryRow(`SELECT owner, published FROM runbook WHERE id = ?`, id).Scan(&owner, &pub) != nil {
		return false
	}
	if owner == "" || owner == viewer || pub == 1 {
		return true
	}
	v, _ := s.SharedAccess(id, viewer)
	return v
}

// CanEdit reports whether `editor` may mutate runbook `id` — its owner, an
// orphan/single-user row, or an edit-grantee.
func (s *Store) CanEdit(id, editor string) bool {
	if editor == "" {
		return true
	}
	owner := s.RunbookOwner(id)
	if owner == "" || owner == editor {
		return true
	}
	_, e := s.SharedAccess(id, editor)
	return e
}

// Shares lists the grants on a runbook.
func (s *Store) Shares(id string) ([]sharedb.Grant, error) {
	return sharedb.List(s.db, shareTable, shareCol, id)
}

// Grant shares a runbook with a user (view, or view+edit).
func (s *Store) Grant(id, grantee, by string, canEdit bool) error {
	if _, err := s.GetRunbook(id); err != nil {
		return err
	}
	return sharedb.Set(s.db, shareTable, shareCol, id, grantee, by, canEdit)
}

// Revoke removes a user's grant on a runbook.
func (s *Store) Revoke(id, grantee string) error {
	return sharedb.Revoke(s.db, shareTable, shareCol, id, grantee)
}

// SetOwner reassigns a runbook (admin, audited — SHARING_PLAN.md SH4).
func (s *Store) SetOwner(id, newOwner string) error {
	res, err := s.db.Exec(`UPDATE runbook SET owner = ?, updated_at = ? WHERE id = ?`,
		newOwner, time.Now().UnixMilli(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// PurgeGranteeShares drops every grant made to a user (user deleted).
func (s *Store) PurgeGranteeShares(userID string) error {
	return sharedb.DeleteForGrantee(s.db, shareTable, userID)
}
