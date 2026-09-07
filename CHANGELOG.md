# Changelog

All notable changes to InfraKit Studio. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions are
[SemVer](https://semver.org/).

## [0.1.0] — first public release

The React + Go rewrite of the original Flutter app, cut for a public launch.
One React codebase ships as a static web app and a Tauri v2 desktop app; a Go
backend runs as the desktop sidecar or a standalone service for a hosted
deployment.

### Client-only (no backend, work offline)

- **Tuning & Sizing** — ~25 calculators: DB RAM, Ceph PG, k8s node/pod
  capacity, SLO error budget, retry budget, Kafka / etcd / cache sizing,
  storage IOPS, cloud right-size, capacity runway, availability.
- **Utilities** — encoders, formatters, hash / bcrypt / htpasswd, JWT parser,
  regex tester, diff, JSONPath, UUID / ULID, SSH keygen, X.509 inspector.
- **Config Builders** — nginx, database, Zabbix, Fail2ban, SSH, sysctl,
  firewall rule, crontab, chmod, RDP, `docker run` → compose.
- **Office & Media** — PDF split / merge / inspect, image convert, EXIF, QR
  generate / decode, colour tools.
- **FormFlow** — XML / YAML form designer with schema and dynamic-array-loop
  auto-detect.
- **Knowledge Hub** — curated, link-health-checked resource lists + cheat
  sheets.
- **Prompt Library** — folders, tags, ordered messages, `{{VAR}}`
  fill-and-copy, full version history, templates gallery, JSON import / export.

### Backend modules (Go sidecar / service)

- **Network Toolkit** — ping monitor, traceroute + route map (ICMP + UDP
  probe), DNS, whois, SNMP v1/v2c/v3, SNTP, port / network scan, iperf3,
  neighbor table, connections, firewall viewer + write CRUD (Windows).
- **Runbooks** — reusable multi-step command runbooks; encrypted Vault
  (Argon2id → AES-256-GCM); PowerShell / cmd / bash / SSH / HTTP /
  Python-via-`uv` executors; `{{VAR}}` / `{{secret:}}` / `{{steps.N.stdout}}`
  render with server-side secret redaction; cron schedules; multi-user
  approvals.
- **Ansible Manager** — local-folder or git projects; live play → task → host
  tree; inventory, jobs, surveys, schedules, ad-hoc; CodeMirror editor +
  `ansible-doc` / syntax-check / lint; Galaxy search + install;
  `ansible-vault` ↔ Vault; runs from Windows via Docker / Podman, WSL, or a
  remote SSH control node.
- **AI Hub** — one LLM layer every module reuses: Ollama /
  OpenAI-compatible / Anthropic / Gemini; connections registry; grounding
  "tasks"; MCP tool-calling with read-only auto-run and a write-tool approval
  gate; MCP resources & prompts; opt-in conversation history; token-usage
  view.
- **Monitors** — server-side persistent checks (icmp / tcp / http / dns /
  tls-cert / domain / ssh); alert delivery (webhook / SMTP / desktop);
  per-monitor policy, mute, tags, dependencies; sample rollups + incidents +
  uptime / MTTR / MTBF reporting with CSV / JSON export; public
  token-addressed status pages; bulk import + templates.
- **Background Runs** — Ansible and Runbook runs survive a client disconnect;
  a global Runs drawer re-attaches live output and cancels for real.

### Platform

- **Multi-tenant auth** — opt-in (`--auth on`, off by default; the solo build
  is byte-identical). Per-user data isolation, admin audit log, targeted
  item sharing, self-signed TLS (`--tls auto`) with fingerprint pinning and a
  hard non-loopback gate.
- **Hosted deployment** — `Dockerfile` + `deploy/compose.yml` (Caddy TLS),
  one backend container serving `/api/v1` and the built frontend.
- **Observability** — structured `slog` (text / JSON), a dependency-free
  Prometheus `/metrics` endpoint, panic recovery, an optional error webhook,
  `--pprof`; a Grafana dashboard overlay.
- **Backups** — consistent hot `VACUUM INTO` snapshots on a timer and at
  shutdown.

### Known limits

- Desktop installers are **not code-signed** — Windows SmartScreen warns once.
- The Ansible control node does not run on native Windows; use the Docker /
  Podman, WSL, or remote-SSH runner.
- Multi-user mode targets a small trusted team, not hostile public
  multi-tenancy — see [`SECURITY.md`](SECURITY.md).
- The codebase is AI-assisted; the crypto uses audited primitives but the
  composition has not had a third-party audit.

[0.1.0]: https://github.com/serguei9090/InfraKitOps/releases/tag/v0.1.0
