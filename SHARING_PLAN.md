# SHARING_PLAN.md — targeted item sharing (multi-user)

Give **Runbooks**, **Prompt Library** and **FormFlow** a user→user share
model on top of the existing owner / publish scheme (`USER_MANAGEMENT_PLAN.md`
U3). Only relevant under `--auth on`; solo/desktop unaffected.

Decisions locked (2026-09-03):

| | |
|---|---|
| Scope | Runbooks **+** Prompt Library **+** FormFlow (FormFlow gets a new backend store) |
| Admin access | **None ambient** — an admin never sees another user's private items. Admin gets an **audited `PATCH /{id}/owner`** to hand an item to someone (departures, handover). |
| Share management | **Owner only.** Not admin, not edit-grantees. |
| `publish` | Kept — the "everyone, read-only" shortcut. Share = a named subset, and a share may grant edit. |
| Ownership | A share never transfers it. Only the owner deletes / unshares / publishes. |

## 1. Model

Every shareable store gets a `<thing>_share` table:

```sql
CREATE TABLE <thing>_share (
  <thing>_id  TEXT    NOT NULL,
  grantee_id  TEXT    NOT NULL,
  can_edit    INTEGER NOT NULL DEFAULT 0,
  granted_by  TEXT    NOT NULL,
  granted_at  INTEGER NOT NULL,
  PRIMARY KEY (<thing>_id, grantee_id)
);
```

Access rules (viewer `v`, owner `o`, published `p`):

```
canView = v=="" || o=="" || p || o==v || share(thing, v) exists
canEdit = v=="" || o=="" || o==v || share(thing, v).can_edit
```

Rows are deleted with their item and when the grantee user is deleted.

## 2. `internal/sharedb` — one helper, three callers

A tiny dependency-free package taking `*sql.DB` + table name:

```go
func EnsureSchema(db *sql.DB, table string) error      // CREATE TABLE IF NOT EXISTS
func Grant(db, table, thingID, grantee, by string, canEdit bool) error
func Revoke(db, table, thingID, grantee string) error
func List(db, table, thingID string) ([]Grant, error)  // {GranteeID, CanEdit, GrantedBy, GrantedAt}
func SharedTo(db, table, grantee string) ([]string, error)   // thing ids
func CanView(db, table, thingID, viewer string) (bool, error) // share-row existence
func CanEdit(db, table, thingID, viewer string) (bool, error)
func DeleteForThing(db, table, thingID string) error
func DeleteForGrantee(db, table, grantee string) error
```

Each store keeps its own owner/publish logic and folds a `sharedb` check into
its `canView` / `canEdit`.

## 3. Phases

### SH1 — Runbooks + shared plumbing (`internal/sharedb`, `/users/pick`, `<ShareDialog>`)

- `internal/sharedb` package + tests.
- `orchestrator`: `runbook_share` table (schema + ALTER), fold `sharedb` into
  `ListRunbooks` / `GetRunbook` gate + `canEditRunbook`; `Shares(id)` /
  `Grant` / `Revoke` / `SetOwner`; delete-cascade on runbook + user delete.
- API: `GET /runbooks/{id}/shares`, `PUT /runbooks/{id}/shares/{userId}
  {canEdit}`, `DELETE /runbooks/{id}/shares/{userId}` — owner-only, audited.
- API: `GET /users/pick` → `[{id, username}]` (any authed user, non-disabled).
- FE: `adapters/backend/shareClient.ts`, `adapters/ui/share/ShareDialog.tsx`
  (reusable: `resource` label + `list/grant/revoke` callbacks + a user
  picker), wired into the Runbooks editor header.

### SH2 — Prompt Library

- `promptstore`: `prompt_share` table, fold into `Library` + `promptOwner`
  edit gate; `Shares`/`Grant`/`Revoke`/`SetOwner`; cascades.
- API under `/prompts`: `{id}/shares` GET/PUT/DELETE.
- FE: Share button on a prompt (tree row context or the inspector).

### SH3 — FormFlow backend (`internal/formstore`) + sharing

- **New** `internal/formstore` on `llm.db` (mirrors `promptstore`): `form`
  table `(id, form_json, owner, published, updated_at)` + `form_share`.
  `New(db)`, `List(owner)`, `Save(owner,id,blob)`, `Delete(owner,id)`,
  `SetPublished`, `ClaimOrphans`, share methods.
- main.go: build it next to `promptStore` when `--auth on`; `OnBootstrap`
  claim; router wiring.
- API: `/forms` GET/PUT/{id} DELETE + `/forms/{id}/{publish,shares,owner}`.
- FE: make `schemaRepository.ts` mode-aware (localStorage vs backend, like
  `promptRepository.ts`'s `ModeAware*`); `formsClient.ts`; Share button in
  `FormFlowBuilderScreen`.

### SH4 — audited owner-reassign (admin)

- Each store already gains `SetOwner` in its phase. This phase adds the
  admin-only endpoints + audit + FE:
  `PATCH /runbooks/{id}/owner`, `/prompts/{id}/owner`, `/forms/{id}/owner`
  — `requireAdmin`, body `{ownerId}`, `svc.Audit(actor,"reassign_owner",…)`.
- FE: an admin-only "Reassign owner" action (Settings → a new "Content"
  admin panel listing items by owner, or a per-item menu shown only to
  admins). Minimal: a small admin panel.

### SH5 — polish

- `ShareDialog`: show current grants, inline can-edit toggle, "shared with N"
  badge on list rows, revoke-all.
- Audit entries surfaced in the existing audit log view.
- Docs: `USER_MANAGEMENT_PLAN.md` + `CLAUDE.md` note.

## 4. Non-goals

- Group / team objects (share is per-user).
- Link sharing / anonymous access.
- Cross-instance sharing.
- Share of **runs** / execution history (owner-only stays).
- Notifying a user they've been shared something (no notification system).
