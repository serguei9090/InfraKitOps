# Shared error handling — Design Proposal & Roadmap

Status: **proposal, not started (2026-08-31).** Core decisions resolved (§2).
Cross-cutting: one way to classify and present backend/transport errors so a
user understands *what* is wrong (bad API key, endpoint not listening, vault
locked, …) and *what to do*, across every module and every future one.

Reference: today each module does its own thing — `backendGet` throws a bare
`Error("backend /x: 404 Not Found")` (doesn't even read the JSON body),
`backendRequest` throws the `error` string, `vault.go` maps errors to status
codes, `TestConnection` returns `{ok,error}`, the Network `BackendUnavailable`
component is reused ad hoc by Runbooks + AI. No toaster, no shared model.

---

## 1. Concept

| Piece | Where | Job |
|---|---|---|
| **`apierr.Error`** | backend `internal/apierr` | a coded error (`code` + `message` + `hint` + HTTP status). Constructors + `Write(w, err)` + `Classify*` for wrapping raw transport/HTTP errors. |
| **error envelope** | every handler | `{ "error": "<human>", "code": "<slug>", "hint": "<optional>" }` — `error` unchanged from today, `code`/`hint` additive. |
| **`AppError`** | frontend `core/errors` (framework-free) | `{ code, title, detail, hint, retryable, source }`. `classify(raw, source)` turns a thrown `Error` / parsed envelope / `BackendUnavailableError` / `TypeError "Failed to fetch"` / `AbortError` into one. |
| **`errorStore`** | `stores/errorStore.ts` | a queue: `report(raw, source)` (classify + enqueue, dedup, drop `aborted`), `dismiss(id)`. |
| **`<ErrorToaster/>`** | mounted once in `AppShellScaffold` | renders the queue as stacked toasts (icon by code, title, hint, Dismiss/Details). Hand-rolled, no new dependency. |
| **`<InlineError/>`** | any module pane | `error={AppError \| null}` + optional `onRetry` — a shadcn `Alert` with title + hint + Retry. |

**Flow (hybrid, decided):** `backendClient` / `sseClient` always throw / emit a
typed `AppError`. Module **stores** call `errorStore.report(e, '<Module>')` on
**mutation** failures. **Reads / probes stay silent** — the existing
`backendStore.status` + `BackendUnavailable` gate already covers "no backend".
A new module opts in with one line: `report(e, 'My Module')` in its store, or
`<InlineError error={…}/>` in its pane.

---

## 2. Decisions (resolved 2026-08-31)

| # | Resolution |
|---|-----------|
| Presentation | **Toasts + inline, one shared component.** Hand-rolled toaster (bottom-right, stacked, auto-dismiss the non-critical, Dismiss + Details) mounted once in the shell; `<InlineError>` for panes. Both read one `errorStore`. **No new dependency.** |
| Flow | **Hybrid.** Layer classifies + throws `AppError`; stores `report()` on mutations; reads/probes silent. |
| Envelope | **Extend `{error}`** with optional `code` + `hint`. Backwards compatible — untouched endpoints keep returning a plain string, `classify` handles both. Migrate handlers incrementally. |
| First pass scope | **User-facing action endpoints.** `internal/apierr` + the ~20 sites users hit with bad input/creds: llm (connections/tasks/chat), vault (unlock/secrets), runbook (run/save/nodes), network write (firewall/hosts). The other ~70 keep the plain string (still shown, just not coded). |
| Retry | Toasts: **Dismiss + Details** only in v1 (a toast has no handle on the action that failed). `<InlineError onRetry>` gets a real retry. Retry-from-toast → E3. |
| `BackendUnavailable` | **Kept as-is** for the whole-module "no backend" state. This plan is about *action-level* errors within a connected backend. |

---

## 3. Error codes

One closed set, shared backend ↔ frontend:

| code | meaning | default hint |
|---|---|---|
| `auth_failed` | wrong API key / token / master password | "Check the API key or token for this connection." |
| `unreachable` | endpoint refused / DNS / not listening | "The service isn't answering at that address. Is it running, and is the URL right?" |
| `timeout` | request exceeded its deadline | "The service took too long. Try again, or raise the timeout." |
| `rate_limited` | provider 429 | "The provider is rate-limiting. Wait a moment and retry." |
| `not_found` | unknown id / route | — |
| `conflict` | already exists / concurrent edit | — |
| `validation` | bad user input | (the message says which field) |
| `locked` | vault is locked | "Unlock the Vault, then try again." |
| `permission` | needs elevation / SSH host-key mismatch / published gate | (message-specific) |
| `upstream` | provider returned an error we can't classify | "The provider rejected the request." |
| `internal` | unhandled backend error | "Something went wrong on the backend. Check its log." |
| `backend_down` | no backend configured / connected *(frontend-only)* | (points at Settings → Backend) |
| `aborted` | client cancelled *(frontend-only, never surfaced)* | — |
| `unknown` | anything unclassified | — |

---

## 4. Backend — `internal/apierr`

```go
package apierr

type Code string

type Error struct {
	Code    Code   `json:"code"`
	Message string `json:"error"`          // same JSON key as today
	Hint    string `json:"hint,omitempty"`
	Status  int    `json:"-"`
}
func (e *Error) Error() string { return e.Message }

// Constructors — each sets Code + Status + a default Hint.
func Auth(msg string) *Error         // 401
func Unreachable(msg string) *Error  // 502
func Timeout(msg string) *Error      // 504
func RateLimited(msg string) *Error  // 429
func NotFound(msg string) *Error     // 404
func Conflict(msg string) *Error     // 409
func Validation(msg string) *Error   // 400
func Locked(msg string) *Error       // 403
func Permission(msg string) *Error   // 403
func Upstream(msg string) *Error     // 502
func Internal(msg string) *Error     // 500

// Write serializes err (wrapping a non-*Error as Internal) with its status.
func Write(w http.ResponseWriter, err error)

// Classify wraps a raw provider failure.
func ClassifyHTTP(status int, body string) *Error   // 401→Auth 403→Permission 404→NotFound 429→RateLimited 5xx→Upstream
func ClassifyNet(err error) *Error                  // "connection refused"/"no such host"→Unreachable, deadline→Timeout, ctx.Canceled→(nil, skip)
```

- `api.WriteJSON` stays for success bodies; error sites switch to
  `apierr.Write(w, apierr.Validation("port must be 1-65535"))` etc.
- **LLM adapters** (`ollama/openai/anthropic/gemini.go`): after
  `httpClient.Do` → `apierr.ClassifyNet(err)`; non-200 →
  `apierr.ClassifyHTTP(resp.StatusCode, body)`. (`gemini.scrubKey` still runs
  first.) These `*apierr.Error` values ride through `Engine.stream` → the SSE
  `error` event, which now also carries `code` + `hint`.
- `Engine.stream`'s `error` event: if `errors.As(chatErr, &apiErr)` emit
  `{error, code, hint}`, else `{error}`.

No new Go deps.

---

## 5. Frontend

### 5.1 `src/core/errors/appError.ts` (framework-free)

```ts
export type ErrorCode = /* the §3 set */
export interface AppError {
  code: ErrorCode
  title: string
  detail: string          // the raw backend / transport message
  hint?: string
  retryable: boolean
  source?: string          // "AI Hub" | "Runbooks" | ...
}
export function classify(raw: unknown, source?: string): AppError
export function isAborted(raw: unknown): boolean
```

`classify` handles, in order: an `AppError` (pass through, set `source`) ·
`BackendUnavailableError` → `backend_down` · `AbortError` / `isAborted` →
`aborted` · `TypeError` "Failed to fetch" / "NetworkError" → `unreachable` ·
`{ code, error, hint }` (parsed envelope or SSE `error` event) → map `code`
to a preset `{title, retryable}`, `detail = error`, `hint = hint ?? preset` ·
`Error` → `unknown`, `detail = message` · `string` → `unknown`.

### 5.2 `src/stores/errorStore.ts` (Zustand, not persisted)

```ts
interface Surfaced extends AppError { id: string; at: number }
report(raw: unknown, source?: string): void   // classify; ignore `aborted`;
                                              // dedup same code+detail within 4s
dismiss(id: string): void
clear(): void
```

### 5.3 `src/adapters/ui/errors/`

- **`ErrorToaster.tsx`** — mounted once in `AppShellScaffold` next to the
  `<Outlet/>`. Bottom-right stack, max ~4 visible, `role="status"`. Per toast:
  a `lucide` icon keyed by `code`, `title`, `hint` (muted), a Details
  disclosure showing `detail` + `source`, Dismiss. `auto-dismiss` after 6s
  for `retryable`/`validation`; sticky for `auth_failed` / `internal` /
  `backend_down` until dismissed.
- **`InlineError.tsx`** — `<InlineError error onRetry?>` over shadcn `Alert`
  (`variant="destructive"`): `title`, `hint`, `detail` small, an optional
  Retry button. Replaces the scattered `<p className="text-destructive">`.

### 5.4 Wiring the layer

- **`backendClient.ts`** — `backendGet` currently ignores the JSON body; fix it
  to parse `{ error, code, hint }` like `backendRequest` does, then every
  failure `throw classify(parsed)` (or `throw classify(new Error(...))`).
  `BackendUnavailableError` stays a thrown type (`classify` knows it).
- **`sseClient.ts`** — the in-band `error` **event** payload
  (`{ error, code, hint }`) flows through `onEvent('error', data)` unchanged;
  consumers pass `data` to `report` / `classify`. The transport `onError`
  (connection dropped) — consumers `report` it as `unreachable` /
  `backend_down`.

### 5.5 Wiring the modules (hybrid)

- `llmStore`, `runbookStore`, `vaultStore`, network stores: mutation actions
  swap `set({ error: msg(e) })` for
  `useErrorStore.getState().report(e, '<Module>')`. Keep a local `error` field
  only where a pane already renders it inline as validation feedback.
- `useLlm` / `AiPanel`: the `error` SSE event → `report(data, 'AI Hub')` for a
  run failure; `AiPanel` also keeps its own `error` for the inline case.
- `ConnectionDialog` "Test": `TestConnection` already returns `{ok, error}`;
  surface it as `<InlineError>` in the dialog, classified.

---

## 6. Phasing

### E0 — Plumbing
- `internal/apierr` (types, constructors, `Write`, `Classify*`) — used nowhere
  yet. `core/errors/appError.ts` + `classify` + tests. `errorStore`.
  `<ErrorToaster/>` in the shell. `<InlineError/>`.
- `backendClient` throws `AppError`; `backendGet` reads the body.
- **DoD**: force a 404 / a dead endpoint from any module → a classified toast
  with the right title + hint. `classify` unit tests cover every branch.

### E1 — LLM path (highest value — "wrong key / endpoint down")
- `apierr` in the 4 LLM adapters + the `/llm/*` endpoints; `stream` error
  event carries `code`+`hint`.
- `llmStore` + `useLlm` `report()`; `ConnectionDialog` / `AiSettings` inline.
- **DoD**: a connection with a bad key → "Authentication failed — check the API
  key" (not a raw 401 body); a wrong base URL → "Service not reachable — is it
  running?"; both from Test and from a live run.

### E2 — Vault + Runbooks + Network write
- `apierr` in `vault.go` (`Locked`, `Auth` for wrong master password),
  `orchestrator` run/save/nodes, `firewall`/`hosts` write endpoints.
- Their stores `report()`.
- **DoD**: unlock with a wrong password → `auth_failed`; run a step that needs
  the vault while locked → `locked` with "Unlock the Vault"; SSH host-key
  mismatch → `permission`.

### E3 — Deferred
Retry-from-toast (needs an action registry) · an error-history drawer ·
migrate the remaining ~70 endpoints · message wording pass / i18n ·
per-source rate-limit on toasts.

---

## 7. How a new module plugs in

1. Let `backendClient` throw — its failures are already `AppError`.
2. In the module store, on a mutation failure: `report(e, 'My Module')`.
3. In a pane that has its own error surface: `<InlineError error={appErr} onRetry={…}/>`.
4. If the module adds backend endpoints, return `apierr.Write(w, apierr.Validation("…"))` instead of a bare `{error}` string.

Nothing in `ErrorToaster`, `errorStore`, or `classify` changes.

---

## 8. Reused / touched

| Need | Reuse |
|------|-------|
| Envelope key | keep `"error"` — every current client read still works |
| No-backend state | `backendStore.status` + `BackendUnavailable` — untouched |
| Inline alert | shadcn `alert.tsx` (already present) |
| Store pattern | Zustand, non-persisted, like `backendStore` |
| Shell mount point | `AppShellScaffold` (already wraps the `<Outlet/>`) |
| gemini key scrub | `llm.scrubKey` runs before `apierr.ClassifyNet` |
