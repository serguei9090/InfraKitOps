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

### E0 — Plumbing — **DONE 2026-08-31**
- `internal/apierr` — `Error{code,message,hint,status}`, 11 constructors,
  `Write`, `ClassifyHTTP`/`ClassifyNet`. 3 tests. Used nowhere yet.
- `core/errors/appError.ts` — `AppError` interface + `AppErr` class (extends
  `Error`, so `e instanceof Error ? e.message` call sites keep working until
  they move to `report()`), `classify(raw, source)`, `isAborted`, `isSticky`.
  8 tests covering every branch.
- `stores/errorStore.ts` — queue, `report(raw, source)` (classify, drop
  `aborted`, dedup same code+detail within 4s, cap 8), `dismiss`, `clear`;
  `reportError()` for non-hook call sites.
- `adapters/ui/errors/` — `<ErrorToaster/>` (mounted in `AppShellScaffold`,
  bottom-right stack, per-code icon, hint, Details disclosure; `auth_failed` /
  `internal` / `backend_down` are sticky, the rest auto-dismiss at 6s),
  `<InlineError error onRetry/>` over shadcn `Alert`, `<ErrorIcon code/>`,
  `installErrorHandlers()` (a `window` `unhandledrejection` catch-all →
  `reportError`, wired in `main.tsx`).
- `backendClient` — `doFetch` wraps `fetch` (transport error → `AppErr`),
  `throwHttpError` reads the `{error,code,hint}` body; every non-2xx and every
  transport failure now throws an `AppErr`. **Also fixes the review bug**:
  `backendGet` used to ignore the JSON body.
- **Verified in-browser**: an uncaught `backendGet` 404 popped a classified
  toast; `report({code:'auth_failed'})` → "Authentication failed — check the
  API key" with the key icon; a `TypeError('Failed to fetch')` → "Service not
  reachable". Fresh tab zero console errors. Green: build + 1307 tests + lint.

### E1 — LLM path — **DONE 2026-08-31**
- `internal/llm/provider.go` gained `netErr(err, scrub)` (→ `apierr.ClassifyNet`;
  gemini scrubs the key first) and `httpErr(label, resp)` (reads a bounded
  body → `apierr.ClassifyHTTP`). All 4 adapters (`ollama`/`openai`/`anthropic`/
  `gemini`) use them on `Do` errors + non-200. `Engine.stream`'s `error` event
  → `errData(err)` = `{error}` + `code`+`hint` when it's an `*apierr.Error`.
- `api/llm.go`: `llmErr` classifies (`*apierr.Error` → `apierr.Write`,
  `ErrNotFound` → 404, else `Validation`); decode errors → `Validation`;
  `TestConnection` returns `{ok,error,code,hint}`.
- Frontend: `useLlm` classifies the SSE `error` event + transport `onError`
  into an `AppError`; `AiPanel` renders `<InlineError onRetry={runOnce}/>`
  (was a bare `<p>`). `ConnectionDialog` Test → `<InlineError>`.
  `llmStore` mutations (`putConnection`/`removeConnection`/`putTask`/
  `resetTask`/`putSettings`) → `reportError(e, 'AI Hub')`.
- 4 new backend tests (provider classifies 401→auth, dial-refused→unreachable;
  + the 2 E0 apierr tests).
- **Verified in-browser**: a connection at a dead port → Test → 🔌 "Service not
  reachable — is it running, is the URL right?" with the raw dial error in the
  Details; API path returns `{code:"unreachable",hint:…}`. Fresh tab zero
  console errors. Green.

### E2 — Vault + Runbooks + Network write — **DONE 2026-08-31** (commit `b407525`)
- `apierr` in `vault.go` (`vaultErr` maps every `vault.Err*`; wrong master
  password → `auth_failed` + "enter the vault's master password" hint),
  `runbook.go` (`writeStoreErr`, TestNode vault-locked → `locked`, publish
  gate → coded SSE `error` event via new `sse.RejectCoded`), `hostsfile.go` +
  `firewall.go` (500 → `internal`, decode → `validation`, `ErrNeedsElevation`
  → `permission` keeping the `needsElevation` flag, firewall reject →
  `validation` + hint).
- `sse.Reject` → `RejectCoded(w, code, msg, hint)` so pre-stream rejections
  carry a code.
- FE: `vaultStore.error` is now an `AppError`, `VaultDialog` renders
  `<InlineError>`; `runbookStore` mutations `report()` through `errorStore`,
  the live-run `error` event + transport `onError` classify into
  `live.errorObj` → `<InlineError>` in `RunPanel`.
- Browser-verified: wrong master password → "Authentication failed / Enter
  the vault's master password / wrong master password". Green.

### E3 — Polish & full coverage — **planned, not started (2026-09-01)**

Phased so each part is independently shippable. Do in order; E3a/E3b are the
user-visible wins, E3c is the grind.

#### E3a — Retry-from-toast — **DONE 2026-09-01** (`e823421`)
- `errorStore` `report()` / `reportError()` take an optional `{ retry }`;
  the closure is stored on the surfaced error **only when the code is
  retryable** (`err.retryable`).
- `<ErrorToaster>` shows a **Retry** button for those. Click → drop the toast
  first (so a re-failure clears the 4 s dedup window) → run the closure; the
  closure's own action reports its failure → fresh toast.
- No global action registry — the closure travels with the report.
- Wired: `llmStore` `putConnection` / `putSettings` / `saveChat` /
  `load`·`delete`·`patchConversation` (each `retry: () => <same action>`).
  Other stores can opt in the same way.
- Verified: backend down → Save a chat → "Service not reachable" + Retry →
  backend up → Retry re-runs the save.

#### E3b — Error-history drawer — **DONE 2026-09-01** (`81f295c`)
- `errorStore` `history` ring (cap 50) — `report()` appends, `dismiss()`/
  `clear()` never touch it. `historySeenAt` + `markHistorySeen` /
  `clearHistory`.
- `ErrorHistoryButton` = a header bell (badge = errors since last open;
  opening marks seen). Drawer: newest-first rows (icon · title · source ·
  code · rel-time), expand → hint + detail; "Copy all" + "Clear".
- A drawer opened from a small indicator in `AppShellScaffold` (badge = count
  since last open). Rows: icon · title · source · relative time · Details
  expander. "Clear history" + "Copy all" (for bug reports).
- Reuses `<ErrorIcon>` / the toast row markup.
**DoD**: three different failures land in the drawer with correct sources;
survives navigation. One commit.

#### E3c — Migrate the remaining endpoints
~70 handlers still return a bare `{error: string}` string. Batch by area, one
commit per batch, each verified against its module's UI:
1. Network read tools (`dns`, `whois`, `sntp`, `ipgeo`, `portscan`,
   `traceroute`, `ping`, `netscan`, `snmp`, `neighbor`, `connections`,
   `wol`, `x509fetch`, `iperf`) — mostly `ClassifyNet` / `ClassifyHTTP` at the
   `cmdtool` / dial boundary.
2. Utility power-mode endpoints (`/ssh-keygen`, `/pdf/*`, `/config/validate`,
   `/qr/decode`) — `apierr.Validation` on bad input, `Internal` on tool crash.
3. Runbook library sync (`/library/export`, `/library/import`) — currently
   left plain because they carry `report`/`imported` fields; wrap the error
   case only.
4. History endpoints (`/history*`).
- Add a lint/grep check to `backend.yml`: `grep -rn 'map\[string\]string{"error"' internal/api` should only match an allowlist.
**DoD**: the grep check passes; a spot-check of one endpoint per batch shows a
coded response. Commits: 4.

#### E3d — Wording & i18n scaffold
- One pass over every `apierr` message + every `PRESETS` string for voice
  (imperative hint, no jargon, no stack-trace leakage).
- Extract `PRESETS` titles/hints into a single `errorStrings.ts` map so a
  future i18n layer has one file to translate. No actual i18n runtime yet.
**DoD**: review diff; strings centralised. One commit.

#### E3e — Per-source toast rate-limit
- `errorStore.report` — if a source fires > 3 errors in 5 s, collapse into one
  "Multiple errors from {source}" toast that opens the drawer.
- Guards against a retry loop or a dead backend spamming the corner.
**DoD**: a `setInterval` firing a failing request every 200 ms produces one
collapsed toast, not 25. One commit.

#### Still out of scope after E3
Cross-device error sync · server-side error telemetry / Sentry-style
aggregation · localised runtime (E3d only scaffolds it).

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
