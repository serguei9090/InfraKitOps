// Package sharedb is the per-user "share this item with that user" layer
// shared by the runbooks, prompt-library and formflow stores
// (SHARING_PLAN.md §2). Each store owns a `<thing>_share` table with the
// same shape; this package is the CRUD + access helpers over it.
//
// It is intentionally tiny and dependency-free. The `table` argument is
// always a compile-time constant from the calling store — it is still
// validated here so a typo can't become SQL injection.
package sharedb

import (
	"database/sql"
	"fmt"
	"regexp"
	"time"
)

var tableRe = regexp.MustCompile(`^[a-z][a-z_]*_share$`)

// Grant is one row: user `GranteeID` may see (and, if CanEdit, mutate) the item.
type Grant struct {
	GranteeID string `json:"granteeId"`
	CanEdit   bool   `json:"canEdit"`
	GrantedBy string `json:"grantedBy"`
	GrantedAt int64  `json:"grantedAt"`
}

func check(table string) error {
	if !tableRe.MatchString(table) {
		return fmt.Errorf("sharedb: bad table name %q", table)
	}
	return nil
}

// EnsureSchema creates the share table if it is missing. `idCol` is the
// item-id column name (e.g. "runbook_id").
func EnsureSchema(db *sql.DB, table, idCol string) error {
	if err := check(table); err != nil {
		return err
	}
	_, err := db.Exec(fmt.Sprintf(`
CREATE TABLE IF NOT EXISTS %s (
  %s          TEXT    NOT NULL,
  grantee_id  TEXT    NOT NULL,
  can_edit    INTEGER NOT NULL DEFAULT 0,
  granted_by  TEXT    NOT NULL,
  granted_at  INTEGER NOT NULL,
  PRIMARY KEY (%s, grantee_id)
);
CREATE INDEX IF NOT EXISTS %s_grantee ON %s(grantee_id);`,
		table, idCol, idCol, table, table))
	return err
}

// Set upserts a grant.
func Set(db *sql.DB, table, idCol, thingID, grantee, by string, canEdit bool) error {
	if err := check(table); err != nil {
		return err
	}
	ce := 0
	if canEdit {
		ce = 1
	}
	_, err := db.Exec(fmt.Sprintf(
		`INSERT INTO %s (%s, grantee_id, can_edit, granted_by, granted_at) VALUES (?,?,?,?,?)
		 ON CONFLICT(%s, grantee_id) DO UPDATE SET can_edit = excluded.can_edit`,
		table, idCol, idCol),
		thingID, grantee, ce, by, time.Now().UnixMilli())
	return err
}

// Revoke drops one grant. A no-op if it wasn't there.
func Revoke(db *sql.DB, table, idCol, thingID, grantee string) error {
	if err := check(table); err != nil {
		return err
	}
	_, err := db.Exec(fmt.Sprintf(`DELETE FROM %s WHERE %s = ? AND grantee_id = ?`, table, idCol), thingID, grantee)
	return err
}

// List returns every grant on one item.
func List(db *sql.DB, table, idCol, thingID string) ([]Grant, error) {
	if err := check(table); err != nil {
		return nil, err
	}
	rows, err := db.Query(fmt.Sprintf(
		`SELECT grantee_id, can_edit, granted_by, granted_at FROM %s WHERE %s = ? ORDER BY granted_at`,
		table, idCol), thingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Grant
	for rows.Next() {
		var g Grant
		var ce int
		if err := rows.Scan(&g.GranteeID, &ce, &g.GrantedBy, &g.GrantedAt); err != nil {
			return nil, err
		}
		g.CanEdit = ce == 1
		out = append(out, g)
	}
	return out, rows.Err()
}

// Access reports what `viewer` may do with `thingID` via a share row:
// (sharedView, sharedEdit). Both false when there is no grant.
func Access(db *sql.DB, table, idCol, thingID, viewer string) (view, edit bool) {
	if viewer == "" || check(table) != nil {
		return false, false
	}
	var ce int
	err := db.QueryRow(fmt.Sprintf(
		`SELECT can_edit FROM %s WHERE %s = ? AND grantee_id = ?`, table, idCol),
		thingID, viewer).Scan(&ce)
	if err != nil {
		return false, false
	}
	return true, ce == 1
}

// DeleteForThing removes all grants on an item (item deleted).
func DeleteForThing(db *sql.DB, table, idCol, thingID string) error {
	if err := check(table); err != nil {
		return err
	}
	_, err := db.Exec(fmt.Sprintf(`DELETE FROM %s WHERE %s = ?`, table, idCol), thingID)
	return err
}

// DeleteForGrantee removes all grants to a user (user deleted).
func DeleteForGrantee(db *sql.DB, table, grantee string) error {
	if err := check(table); err != nil {
		return err
	}
	_, err := db.Exec(fmt.Sprintf(`DELETE FROM %s WHERE grantee_id = ?`, table), grantee)
	return err
}
