# Network Module — Implementation Plan & Roadmap

Status: **approved 2026-08-27**. Not started — N0 is the next phase of work.

This module adds live network diagnostics to InfraKit Studio. It is the first part
of the app that needs a **backend process** — the deferred "Phase 8 — Go backend"
in [`MIGRATION_PLAN.md`](MIGRATION_PLAN.md) now starts here, scoped to network
tools only (no Ansible / model-serving yet).

Reference app for tool logic and UX: **NETworkManager** by BornToBeRoot
(WPF/.NET, `Source/NETworkManager.Models/Network/*`). We port the *behaviour and
option sets*, not the C#.

---

## 1. Scope

### 1.1 Tools in the module

| # | Tool | Backend? | Source of logic | Complexity |
|---|------|----------|-----------------|------------|
| 1 | **Subnet Calculator** (IPv4/IPv6) | no (pure client) | existing `subnetCalculator.ts` — *moved* from module 2 | trivial (move only) |
| 2 | **IP / Network Scanner** | yes, streaming | NETworkManager `IPScanner.cs` | hard |
| 3 | **Port Scanner** | yes, streaming | `PortScanner.cs` | medium |
| 4 | **Ping Monitor** | yes, SSE + chart | `Ping.cs` | medium |
| 5 | **Traceroute** | yes, SSE + geo map | `Traceroute.cs` | medium |
| 6 | **iperf3 throughput** | yes (bundled binary) | new (NETworkManager has none) | medium |
| 7 | **DNS Lookup** | yes | `DNSLookup.cs` | easy |
| 8 | **SNMP** (v1/v2c/v3) | yes | `SNMPClient.cs` | medium |
| 9 | **SNTP Lookup** | yes | `SNTPLookup.cs` | easy |
| 10 | **Whois** | yes | `Whois.cs` | easy |
| 11 | **IP Geolocation** | yes | `IPGeolocationService.cs` | easy–medium |
| 12 | **Neighbor Table** (ARP/NDP, read) | yes | `NeighborTable.cs` | medium |
| 13 | **Connections / Listeners** (netstat) | yes | `Connection.cs` / `Listener.cs` | easy |
| 14 | **Hosts File Editor** | yes + elevated helper | `HostsFileEditor/*` | medium |
| 15 | **Firewall Viewer** (read-only) | yes + elevated read | Windows Firewall MMC columns | medium |
| 16 | **Wake on LAN** | yes (trivial UDP) | `WakeOnLAN.cs` | easy |
| 17 | **Discovery Protocol** (LLDP/CDP) | yes, pcap (optional component) | `DiscoveryProtocol.cs` | hard — **deferred** |

### 1.2 Firewall — now vs later (decision)

**Ship a read-only firewall viewer in the first Network release. Defer
write CRUD (add / edit / remove / enable / disable rules) to its own dedicated
release after the module lands.**

Why defer the writes:

- **Windows**: no high-level Go wrapper for the `HNetCfg.FwPolicy2` COM API
  exists; ~300–600 LOC of `go-ole` plumbing (enumerate `Rules`, decode the
  `Profiles` bitmask, join filters). PowerShell `*-NetFirewallRule` is the
  no-COM fallback but is slow at scale and splits each rule across 5 filter
  cmdlets.
- **Linux**: firewalld (D-Bus rich rules) / ufw (CLI only) / nftables / iptables
  do not map onto one rule model or onto the Windows columns. Realistic full
  support = per-backend adapters, long bug tail.
- **Lockout liability**: an explicit outbound-block or a "block all inbound"
  toggle over RDP/SSH can lock the user out. Doing writes properly needs a
  confirm dialog, pre-change ruleset export, and a **timed auto-revert**
  ("keep these changes? 60s…").
- Estimated effort: read-only both platforms ~7–10 pd; full read-write both
  platforms ~20–30 pd and a materially higher code-signing / security-review bar.

Read-only viewer delivers the `wf.msc`-style column table (Name, Direction,
Action, Protocol, Local/Remote IP+port, Program, Profile, Description) with
near-zero risk:

- Windows: COM `INetFwPolicy2.Rules` enumerate (read needs an elevated context
  in practice — reuse the elevated helper), or the fast registry read cache at
  `HKLM\…\FirewallPolicy\FirewallRules`.
- Linux: `firewall-cmd --list-all-zones` via D-Bus + `nft -j list ruleset` +
  `ufw status numbered`, whichever manager is active.

---

## 2. Architecture

### 2.1 Go backend as a sidecar + standalone service

New Go module at `backend/` (repo root, sibling of `app/`).

- **One binary, two deployment modes.** Desktop: Tauri v2 **sidecar**
  (`externalBin` in `tauri.conf.json`, spawned from `lib.rs`). Web: the same
  binary run as a standalone HTTP service (or "backend unavailable" — the 44
  existing client-only tools are untouched either way).
- **Transport: localhost HTTP + JSON for one-shot calls, SSE for streams.** One
  embedded `net/http` (or `chi`) server. No stdio JSON-RPC, no Tauri events —
  both are Tauri-only and would fork the web path.
  - one-shot: `POST /api/v1/<tool>` → JSON
  - streaming: `GET /api/v1/<tool>/stream?…` → `text/event-stream`
    (ping monitor, traceroute hops, scan progress)
- **Bind + auth**: spawn with `--addr 127.0.0.1:0`; Go binds an ephemeral port
  and prints `LISTENING 127.0.0.1:<port>` on stdout; Rust parses and stores it.
  Random per-launch **bearer token** passed as `--token`, required on every
  request. CORS locked to `tauri://localhost` / `http://tauri.localhost`.
- **Lifecycle**: keep the `CommandChild` in Tauri managed state, `.kill()` on
  `RunEvent::ExitRequested`. Belt-and-braces: Go self-exits if no request within
  N seconds or if its parent PID disappears.
- **Sidecar capability** (`src-tauri/capabilities/`): `shell:allow-spawn` scoped
  to the one binary with **arg validators** (`127\.0\.0\.1:\d+`, `\S+`). Never
  build shell strings when calling `nmap` / `iperf3` — always `exec.Command`
  with an arg slice.
- **Frontend** gets one `backendClient` abstraction: `probe()` →
  `GET /api/v1/health`; a `backendAvailable` flag + a per-tool capability map
  from `GET /api/v1/capabilities` (an unprivileged backend still can't SYN-scan).
  Network tool screens render a disabled state + setup banner when unavailable.

### 2.2 Privilege model

Run the sidecar **unprivileged** by default. Gray out the operations that need
elevation with a "Requires running as Administrator / elevated" note.

| Needs elevation | Mitigation |
|-----------------|------------|
| Raw-socket ICMP ping / traceroute | Linux: prefer `SOCK_DGRAM` ICMP (`ping_group_range` sysctl) or `setcap cap_net_raw+eip` on the sidecar at install. Windows: use `iphlpapi!IcmpSendEcho2` (unprivileged) for ICMP-mode ping *and* traceroute. |
| SYN / UDP scan (nmap), ARP-based host discovery | Offer only when elevated / Npcap present; degrade to TCP-connect + ICMP + reverse-DNS. |
| LLDP/CDP capture | Elevated-only, optional component (pcap/Npcap). |
| MTU **set** | Elevated-only; MTU **read** is free. |
| Hosts file write, firewall read/any write, static neighbor add | **Elevated helper binary** (built once, §2.4). |

- **Windows sidecar manifest = `asInvoker`** (a `requireAdministrator` manifest
  would UAC-prompt on every app launch).
- **Linux**: package post-install runs
  `setcap cap_net_raw,cap_net_admin+eip` on the sidecar + drops a
  `net.ipv4.ping_group_range` sysctl file.

### 2.3 Result history + versioning + diff

Net-new capability — NETworkManager has **no result history or diff** anywhere
(its "history" is just input-box autocomplete). This is a differentiator.

- **Every tool returns a common envelope from day one**, even before the UI
  consumes it:

  ```ts
  interface RunEnvelope {
    tool: string            // 'ping' | 'traceroute' | 'port-scan' | …
    target: string          // normalized host / IP / CIDR
    startedAt: number        // unix ms UTC
    finishedAt?: number
    status: 'ok' | 'partial' | 'error' | 'timeout'
    params: Record<string, unknown>   // canonicalized (sorted keys) — groups "same query"
    resultShape: 'scalar_series' | 'set' | 'table' | 'text'
    result: unknown          // tool-specific, self-versioned { v: N, … }
    summary?: Record<string, unknown>  // headline metrics for the list row
  }
  ```

- **Storage**: embedded SQLite in the sidecar via **`modernc.org/sqlite`**
  (pure Go — keeps the CGO-free cross-compile). One `run` table, indexed on
  `(tool, target, started_at)`. Retention = keep last N per `(tool,target)` ∪
  pinned/labelled ∪ newer than X days. `HistoryPort` HTTP endpoints:
  `GET /api/v1/history?tool=&target=`, `GET /api/v1/history/:id`,
  `POST /api/v1/history/:id/pin`, `DELETE …`.
- **Web build**: `HistoryPort` gets a second adapter (IndexedDB via **Dexie**) —
  **deferred** until the web build actually needs history. Diff logic is pure TS
  in `src/core/network/history/` and runs identically on both.
- **Diff by `resultShape`**:
  - `scalar_series` (ping RTT, DNS resolve time) → delta of min/avg/p95/loss +
    a **latency-over-time sparkline** across all runs to that target
    (SmokePing / PingPlotter style). *"12 ms last Tuesday, 40 ms now."*
  - `set` (open ports, discovered hosts, traceroute hops, DNS records, TLS SANs)
    → canonical sorted key set → added / removed / unchanged; hops also get
    "changed at position N" + "hop count changed".
  - `table` (scan host+port rows, ARP tables) → key by `(host,port)` →
    per-row added / removed / modified. **Deferred** to phase N4.
  - `text` (whois, dig +trace) → normalize volatile lines → unified diff
    (`jsdiff` in UI).
- **UI**: a **History drawer** per tool (reverse-chron, grouped by target, delta
  chip per row, click → re-render read-only with a "from history" banner) and a
  **Compare view** (A/B picker with "latest vs previous" / "latest vs 7 days
  ago" presets, shape-specific diff body, "show only differences" toggle).

### 2.4 Elevated helper (built once, reused)

A tiny separate CLI helper binary. Main app spawns it only for privileged ops;
the GUI/sidecar itself never elevates.

- **Windows**: helper exe with `requireAdministrator` in its embedded manifest;
  spawned via `ShellExecuteW` verb `runas` → UAC. Payload passed on **stdin /
  temp file, never argv**. Helper validates + does an atomic write
  (temp file in the same dir + `MoveFileEx REPLACE_EXISTING`) + timestamped
  backup, against an **allow-listed path set**.
- **Linux**: ship a polkit action XML, invoke via `pkexec` (graphical prompt).
  `sudo` needs a TTY — avoid. AppImage/Flatpak fall back to generic `pkexec`.
- Consumers: Hosts File Editor (write), Firewall (read + any future write),
  static neighbor add, MTU set.

### 2.5 Shared host-range parser

Port NETworkManager's `HostRangeHelper` to `src/core/network/hostRange.ts`
(pure TS, fully unit-testable **without the backend** — good first commit).
Accepts a `;`- or newline-separated list where each entry is one of:

| Form | Example |
|------|---------|
| Single IPv4 / IPv6 | `192.168.0.1`, `2001:db8::1` |
| Hostname | `server-01.example.net` |
| Hostname + CIDR / mask | `example.com/24` |
| CIDR / `/prefix` | `192.168.0.0/24`, `/23` |
| Subnet mask | `192.168.0.0/255.255.255.0` |
| Dash range | `192.168.0.1-100`, `192.168.0.0 - 192.168.0.100` |
| Octet pattern | `192.168.[50-100].1`, `10.0.[0-9,20].[1-2]` |

De-dupe, sort by IP. Reuse `subnetCalculator.ts` / an `IPNetwork`-style helper
for the CIDR math.

---

## 3. UI standard scheme — the T4 "Network Console" archetype

The 3 existing scaffolds (T1 split, T2 balanced, T3 stepper) don't fit the
NETworkManager pattern. Add a fourth, `NetworkToolScaffold`, built from the same
`ToolScaffoldHeader` / `ToolScaffoldPanel` primitives so it stays visually
consistent.

```
┌───────────────────────────────────────────────────────────────┬───────────────┐
│  Title                          [History] [Export] [Copy]      │ Saved Targets │
├───────────────────────────────────────────────────────────────┤  ▸ Network    │
│  QUERY BAR (full-width card)                                   │    unifi.…    │
│  Host [___________]  Mode [Walk▾]  Version [v3▾]   ( ▶ Query ) │  ▸ Web        │
│  ⌄ Advanced params  (timeout, retries, interface, …)          │    github.com │
├───────────────────────────────────────────────────────────────┤    + Add      │
│  RESULTS  (full-width, streaming, virtualized)                 │               │
│   ┌─────────────────────────────────────────────────────────┐ │               │
│   │ group header — live counters (12 up / 3 down)            │ │               │
│   │ row … row … (expandable for detail)                      │ │               │
│   └─────────────────────────────────────────────────────────┘ │               │
├───────────────────────────────────────────────────────────────┴───────────────┤
│  STATUS STRIP:  ▓▓▓▓░░ 62%   ·  elapsed 3.1s  ·  iface eth0  ·  backend ✓     │
└──────────────────────────────────────────────────────────────────────────────┘
```

Shared components to build (each used by ≥3 tools):

| Component | Role |
|-----------|------|
| `NetworkToolScaffold` | the T4 layout above; props: `queryBar`, `results`, `statusStrip`, `savedTargetsKey`, `historyTool` |
| `QueryBar` | inline field row + primary action + collapsible "Advanced params" |
| `NetworkResultTable` | virtualized, streaming-append, group headers with live counters, row-expand |
| `SavedTargetsPane` | right-side collapsible tree of profiles, grouped by folder; add/edit/delete; click → load into query bar. Backed by `IStoragePort` (same scheme as `SchemaRepository`) |
| `StatusStrip` | progress bar + counts + elapsed + interface + backend indicator |
| `HistoryDrawer` | slides from right; run list, delta chips, re-open, "Compare" |
| `RunComparePanel` | A/B diff view; shape-specific renderers |
| `BackendUnavailable` | full-scaffold disabled overlay + setup instructions |
| `InterfacePicker` | dropdown from `GET /api/v1/interfaces`; feeds the module's default + per-tool override |
| `GeoMap` | leaflet-style hop/geo map for Traceroute + IP Geolocation (offline tiles or vector) |

### 3.1 Module settings (gear at the bottom of the tool-list pane)

Like `ModuleSettingsDialog` but scoped to this module. Persisted via
`IStoragePort`. A `networkSettingsStore` (zustand) exposes them to every tool.

| Setting | Default | Applies to |
|---------|---------|------------|
| Default network interface | *auto (OS routing table)* | all socket-based tools; per-tool override in Advanced params |
| Proxy | *none* — `http://` or `socks5://`, optional auth | **HTTP-based tools + Whois only** (DNS-over-HTTPS, IP geolocation API, whois via SOCKS5). Documented: ICMP / traceroute / UDP-DNS / SNMP / NTP **cannot** use a proxy. |
| Custom DNS servers | *empty → OS resolvers* | app-wide PTR / hostname resolution (not the DNS Lookup tool's own server field) |
| Prefer IPv4 when resolving | on | name resolution |
| Default timeout / retries | 4000 ms / 2 | seeds each tool's Advanced params |
| Geo provider | *online API* (`ip-api.com`) or *MaxMind key* | IP Geolocation + Traceroute hop geo |
| History retention | keep 90 days + last 20 per target | history store pruning |
| Result auto-save to history | on | all tools |

---

## 4. Roadmap — phases

Solo-developer person-day (pd) estimates. LOC = new Go + TS + tests, rough.
Commit after every checkpoint bullet.

### Phase N0 — Foundations (no user-visible tools) — ~13–18 pd, ~2.0–2.5k LOC — **DONE 2026-08-27**

| Checkpoint (= one commit) | pd | status |
|---------------------------|----|--------|
| `backend/` Go module: `chi` server, `:0` bind + stdout announce, bearer-token middleware, `/health`, `/capabilities`, `/interfaces`, SSE helper, `RunEnvelope` types, graceful-shutdown watchdog | 3–4 | ✅ `083024f` |
| Tauri sidecar wiring: `externalBin`, `shell:allow-spawn` capability + arg validators, spawn/parse-port/kill in `src-tauri/src/lib.rs`, `backend_endpoint` command | 2–3 | ✅ `93f0a3c` |
| CI: cross-compile matrix (`CGO_ENABLED=0`, win-msvc + linux-gnu), triple-suffixed artifacts; `build-sidecar.sh`/`.ps1` for local. (Authenticode sign — deferred to N-packaging) | 1–2 | ✅ `d7829f2` |
| Frontend: `backendClient` + `backendStore`, `network` module entry in `moduleTaxonomy.ts` + rail icon, routes group | 1–2 | ✅ `9443e3d` |
| `NetworkToolScaffold` (T4) + `QueryBar` + `StatusStrip` + `BackendUnavailable` | 3–4 | ✅ `9978fa4` |
| `networkSettingsStore` + module settings dialog | 2 | ✅ `b82cc50` |
| `src/core/network/hostRange.ts` + full unit tests (no backend needed) | 2 | ✅ `9f704db` (24 tests) |
| **Move Subnet Calculator** into the module (`src/core/network/`, re-register taxonomy) | 0.5 | ✅ `9443e3d` |

**Phase DoD**: ✅ `bun run build` + `cargo check` + `go build/vet/test` clean;
`bun run test` green (1013 + 24 new); backend binary smoke-tested (401 without
token, 200 with, `/interfaces` + `/capabilities` shaped right, idle self-exit);
web build shows "backend unavailable" gracefully; Subnet Calculator verified
in-browser under the Network Toolkit module; `hostRange` parses every §2.5 row.
**Not yet verified**: `bun run tauri dev` opening a real window with the sidecar
live (GUI, unobservable here) — needs one manual pass.

### Phase N1 — Easy read-only tools + history store — ~24–32 pd — **DONE 2026-08-27**

Proves the one-shot pipe end-to-end and lands the history layer.

| Checkpoint | status |
|-----------|--------|
| History store: `modernc.org/sqlite`, `run` table + prune (`PrunePolicy`), `/api/v1/history` GET/POST/GET-id/PATCH/DELETE | ✅ `639b904` |
| History/diff core (TS): envelope types + `canonicalizeParams` + `text` diff (jsdiff, volatile-line strip) + `set` diff + `scalar_series` deltas + `seriesOverTime` | ✅ `fbdfd92` (10 tests) |
| `HistoryDrawer` UI — list, this-target/all toggle, restore, pin/delete, inline diff-vs-previous | ✅ `39f562f` |
| `SavedTargetsPane` (folder-grouped, IStoragePort) + `NetworkResultTable` + `TextResultView` | ✅ `a73b33a` / `b338992` |
| **SNTP Lookup** — `beevik/ntp`, concurrent, median offset; 4 presets | ✅ `5a9a38d` |
| **DNS Lookup** — `miekg/dns`; any type, custom resolver (default 1.1.1.1), UDP/TCP; shape `set` | ✅ `fa54732` / `b338992` |
| **Whois** — `likexian/whois` + parser; raw + structured; shape `text` | ✅ `fa54732` / `b338992` |
| **IP Geolocation** — `ip-api.com`, 24 fields, formatted block, rate headers; shape `text` | ✅ `fa54732` / `b338992` |
| **Connections / Listeners** — `gopsutil/v4/net` + process; TCP/UDP v4/v6; shape `table` | ✅ `fa54732` / `b338992` |
| **Wake on LAN** — 102-byte magic packet, UDP broadcast | ✅ `fa54732` / `b338992` |

**DoD met**: DNS matches `dig`, SNTP offset/RTT sane vs `w32tm`, whois parsed
fields present, connections count matches `netstat`, geo returns full record —
all verified in-browser against the dev backend; every run auto-saves to
history; restore repopulates inputs; saved targets round-trip through
`IStoragePort`; backend-down → banner. **Deferred within N1**: `DoH` transport,
"use my MaxMind key" offline geo, and reshaping SNTP from `table` to
`scalar_series` (so its median-offset-over-time diffs) — all small follow-ups.
Proxy-aware http client is N2 (nothing in N1 needs it yet).

### Phase N2 — ICMP / probe tools + streaming + compare — **DONE 2026-08-27**

| Checkpoint | status |
|-----------|--------|
| `internal/sse` (channel-funnelled Writer + Pump) + `sseClient` (fetch-event-source, token header) + `useNetworkStream` hook | ✅ `c01d103` |
| `scalar_series` diff (N1) + `Sparkline` + `LatencyChart` (inline SVG, no charting dep) | ✅ `2f68f7a` |
| `RunComparePanel` — A/B picker, "latest vs previous" / "vs ~7 days" presets, "only differences", set + scalar + text renderers; opened from HistoryDrawer | ✅ `3cf769f` |
| **Ping Monitor** — per-OS unprivileged ICMP (`IcmpSendEcho` on Windows / `pro-bing` datagram elsewhere); multi-host live `LatencyChart`, loss %, jitter, flap thresholds; on Stop saves a `scalar_series` run + refreshes the "avg across runs" sparkline | ✅ `2f68f7a` |
| **Traceroute** — per-OS TTL probes (`IcmpSendEcho`+`IP_OPTION_INFORMATION` on Windows / datagram-ICMP `SetTTL` elsewhere), N probes/hop, PTR, optional per-hop geo; shape `set` keyed by hop addr | ✅ `96c8d02` |
| **Port Scanner** — `net.DialTimeout` + host×port bounded pools, `ParsePorts`, built-in service map + profiles; SSE open/closed/progress; shape `set` | ✅ `aa868c2` |
| **IP / Network Scanner** — ICMP echo + reverse DNS + optional TCP probe (source-IP bindable), `InterfacePicker`; SSE host/progress; shape `table` | ✅ `754ea5e` |

**DoD met**: SSE verified end-to-end for all four streaming tools (events
append live, Stop cancels the backend goroutine); Traceroute reached 8.8.8.8
in 9 hops ending at `dns.google`; RunComparePanel shows scalar stat-deltas +
set add/remove. **Deferred**: `GeoMap` (leaflet) — hop location is a column
for now; ARP-based discovery (pcap/elevation → N4); explicit SSE reconnect
dedupe (append is keyed, so idempotent for set/table tools).

### Phase N3 — System-state + privileged tools — **5/6 done 2026-08-27**

| Checkpoint | status |
|-----------|--------|
| **SNMP** — `gosnmp`; v1 / v2c / v3 (full USM: auth MD5/SHA/224…512, priv DES/AES/192/256, noAuth/authNoPriv/authPriv); Get + BulkWalk; shape `set` keyed by OID; 5 OID profiles | ✅ `63b2562` |
| **Neighbor Table** (read) — per-OS parse (`arp -a` / `/proc/net/arp`), IP/MAC/iface/state/family; shape `table`. GetIpNetTable2 (IPv6/NDP, richer state) = later upgrade | ✅ `da07df7` |
| **Hosts File Editor** — `internal/tools/hostsfile`: line classifier + "commented = disabled" convention, formatting-preserving render, atomic Apply (backup + rename), RestoreLatest; screen with editable table (200-row cap + filter), diff-before-apply, "run as admin" banner on EACCES | ✅ `4638105` |
| **Firewall Viewer** (read-only) — Windows `netsh advfirewall … verbose` parse (no COM yet), Linux firewalld/ufw/nft detect; wf.msc column table + direction/action facets; shape `table` | ✅ `22df096` |
| **iperf3** — binary wrapper (`iperf3 --json`), "use defaults / custom" for `--set-mss` / `-l` / `-w` / `-b`, reverse + UDP; per-interval Mbps → `scalar_series`; 503 `notInstalled` when the binary is absent (capability probes `iperf.Available()`) | ✅ `d2281d3` |
| **Elevated helper binary** — Windows `runas`+manifest / Linux polkit `pkexec`, stdin payload, allow-listed atomic write, JSON stdout protocol; makes hosts-write (and future firewall-write) work without launching the whole app elevated | ⏳ **remaining N3 item** |

**DoD met so far**: SNMP v2c/v3 walk verified against demo.pysnmp.com; Neighbor
Table read 22 host entries; Hosts Editor loads a 7335-line file (capped 200)
and shows the pending `+ #` / `-` diff on toggle; Firewall Viewer parsed 2587
Windows rules with the wf.msc columns; iperf3 screen wires + shows the
not-installed state cleanly. **Simplifications vs the original plan**: Firewall
uses `netsh` text parsing rather than `go-ole` COM (COM upgrade = when write
CRUD lands); hosts-write is direct-with-elevation-error pending the helper;
iperf3 uses a PATH/bundled binary, not a second sidecar. SNMP Set + "13 OID
profiles" trimmed to Get/Walk + 5 profiles.

### Phase N4 — Deferred / optional — ~35–50 pd

Not part of the first module release. Each is independently schedulable.

| Item | pd | Note |
|------|----|----|
| **Firewall write CRUD** | 20–30 | **Its own release.** Raises signing / security-review bar. Needs confirm dialog + pre-change export + timed auto-revert. Windows COM `.Add`/`.Remove`; Linux firewalld rich-rule CRUD only, read-only for ufw/nft. Gate behind an "advanced" toggle. |
| **Discovery Protocol (LLDP/CDP)** | 5–7 | `gopacket` behind a `//go:build pcap` tag; CGO + libpcap/Npcap; built on native CI runners; shipped as an optional component; bundle/prompt Npcap installer on Windows. Passive 30–60 s capture window. |
| **Web IndexedDB history adapter** (Dexie) | 2–3 | Only when the web build needs history. |
| **`table`-shape diff** (scan rows, ARP tables) | 2–3 | |
| **Traceroute scrub-timeline history** (PingPlotter style) | 3–4 | |
| **Neighbor Table write** (`New-NetNeighbor` equivalent — netlink / iphlpapi) | 1–2 | via elevated helper |
| **MTU set** | 2–3 | Linux `netlink LinkSetMTU`, Windows `SetIpInterfaceEntry`; elevated |

---

## 5. Totals

| Phase | Effort | New LOC |
|-------|--------|---------|
| N0 Foundations | 13–18 pd | 2.0–2.5k |
| N1 Easy tools + history | 24–32 pd | 4–5k |
| N2 Streaming tools + compare | 21–28 pd | 4–5k |
| N3 Privileged tools | 27–36 pd | 5–6k |
| **First module release (N0–N3)** | **~85–114 pd** | **~15–19k LOC** |
| | **≈ 17–23 weeks solo (~4–5.5 months)** | |
| N4 Deferred (mostly firewall CRUD) | 35–50 pd | 6–9k |

Go ~6–8k · TS ~7–10k · tests ~4–6k across N0–N3.

---

## 6. Dependencies

### Go (`backend/go.mod`, target Go 1.24)

```
github.com/prometheus-community/pro-bing   // ICMP ping + monitor
github.com/miekg/dns                        // DNS: all types, custom resolver, DoH
github.com/gosnmp/gosnmp                     // SNMP v1/v2c/v3
github.com/beevik/ntp                        // SNTP offset + RTT
github.com/likexian/whois + whois-parser     // WHOIS + structured parse
github.com/oschwald/geoip2-golang            // MaxMind .mmdb reader (DB licensed separately)
github.com/shirou/gopsutil/v4                // netstat connections, iface stats
github.com/vishvananda/netlink               // linux: neighbor table, MTU set  (build-tag linux)
github.com/gopacket/gopacket                 // LLDP/CDP + ARP scan  (build-tag pcap, CGO — N4)
github.com/Ullaakut/nmap/v3                  // optional SYN/version scan (needs nmap binary)
github.com/go-ole/go-ole                     // windows firewall COM  (build-tag windows)
modernc.org/sqlite                           // pure-Go SQLite for history
golang.org/x/net                             // icmp, ipv4/6 (traceroute), proxy (SOCKS5)
golang.org/x/sys                             // windows: IcmpSendEcho2, iphlpapi
github.com/go-chi/chi/v5                      // HTTP routing
```

Stdlib-only: TCP-connect port scanner, host-discovery orchestration, interface
enumeration + MTU **read**, proxy plumbing, SSE. iperf3 = bundled binary.

### Frontend (add to `app/`)

```
@microsoft/fetch-event-source   // SSE with auth header
dexie                            // IndexedDB history adapter (N4)
jsdiff                            // text-blob unified diff
leaflet / maplibre-gl            // Traceroute + geo map (evaluate offline-tile story)
```

### Bundled data / binaries

- IANA `service-names-port-numbers.csv` (port → service)
- IEEE OUI list (MAC → vendor) — reuse whatever `mac-address` tool uses
- WHOIS TLD → server map
- `iperf3` binary (BSD-3) per platform — second sidecar
- IPinfo "Country+ASN" or DB-IP Lite `.mmdb` (CC BY / CC BY-SA — bundling OK with
  attribution). **Do not bundle MaxMind GeoLite2** — its EULA forbids
  redistribution without a commercial license; offer "use my own key" instead.

---

## 7. Reusable outcomes (feeds future modules)

The eventual Ansible / AI modules (Phase 8 proper) reuse, unchanged:

- the sidecar spawn / token / lifecycle / capability pattern
- the `backendClient` + `backendAvailable` + capability-map abstraction
- the SSE streaming hook + streaming-append table
- the `RunEnvelope` + `HistoryPort` + diff-by-shape store (Ansible run history,
  model-eval history slot straight into it)
- the elevated-helper binary
- the T4 `NetworkToolScaffold` generalizes to any "query bar → live results →
  saved targets → history" tool

## 8. Open questions to resolve before N0

1. Backend language re-confirm: `MIGRATION_PLAN.md` Phase 8 says Go — this plan
   assumes Go. OK to start it now, scoped to network tools only?
2. Offline map tiles for Traceroute / Geo — bundle a vector basemap, or
   accept an online tile dependency (breaks "fully offline / local-first")?
3. `nmap` dependency for SYN/version scan — bundle it (large) or make it a
   detected-optional feature?
4. History DB location — `Documents/InfraKitStudio/` (NETworkManager-style) vs
   OS app-data dir. Encryption at rest?
5. Web build: ship a hosted shared instance of the Go service for the
   non-privileged tools (DNS/Whois/NTP/geo), or web = "desktop only for network
   tools"?
