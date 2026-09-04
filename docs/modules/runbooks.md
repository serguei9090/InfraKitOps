# Runbooks

Backend-mandatory module for reusable multi-step command runbooks. The
second big consumer of the Go backend after Network, and the one that
introduced the Vault.

## Architecture

```mermaid
flowchart TB
    Screen["ConsoleScaffold (T7)<br/>adapters/ui/runbook/"]
    Client["runbookClient.ts + sseClient.ts"]
    API["api/runbook.go"]
    Engine["orchestrator.Engine<br/>render + redact + run"]
    Executors["executor/*<br/>powershell · cmd · bash ·<br/>ssh · http · python-via-uv"]
    Vault["vault.Store<br/>Argon2id + AES-256-GCM"]
    DB[("orchestrator.db")]

    Screen --> Client --> API --> Engine
    Engine --> Executors
    Engine -->|resolve {{secret:NAME}}| Vault
    Engine --> DB
```

## Templating

Steps are plain command strings with three token kinds, rendered
server-side by `internal/templating`:

- `{{VAR}}` — a runbook argument, auto-detected from the step text, typed
  and validated (`ArgSpec.Type` + `ValidationPreset`, e.g. `port`).
- `{{secret:NAME}}` — resolved from the Vault, **redacted from every SSE
  event** before it leaves the process — the browser never sees a plaintext
  secret in a stream.
- `{{steps.N.stdout}}` — chains a later step's command to an earlier step's
  output (used by the HTTP executor's asserts and multi-step SSH flows).

Before a run starts, the Engine scans the rendered commands for a
destructive-pattern list and can require a second operator's approval
(`RequiresApproval`, multi-user only) before a non-dry run executes.

## Versioning

A runbook has an immutable version history (`SaveVersion`, pin, per-version
delete, word-level diff via `runbookDiff.ts`) plus a live draft — the same
pattern later reused by Ansible's playbook editor and Prompt Library's
message history.

## Vault

`internal/vault` is shared infrastructure, not Runbooks-specific — it also
backs Ansible's `ansible-vault` integration, LLM provider API keys, and git
sync tokens. Argon2id derives the key from a passphrase; the key lives in
RAM only and auto-locks after an idle interval. Under `--auth on`, each user
gets their **own** vault file — an admin can never read another user's
vault. See [`docs/deployment/DEPLOY.md`](../deployment/DEPLOY.md#the-vault) for
the operational caveats (a scheduled run needs its owner's vault unlocked).

## Design history

[`docs/plans/RUNBOOK_MODULE_PLAN.md`](../plans/RUNBOOK_MODULE_PLAN.md) — R0–R4,
including the SSH/HTTP/Python executors, packages detection, git sync, and
scheduled/cron runs. The AI Assistant tab is covered in
[`docs/plans/AI_MODULE_PLAN.md`](../plans/AI_MODULE_PLAN.md) (A2) since it's
built on the shared AI Hub, not a Runbooks-specific model integration.
