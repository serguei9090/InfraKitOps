# Enhanced Traceroute — plan (WS1)

Upgrade `internal/tools/traceroute` + `/tools/traceroute` from a single-pass TTL
sweep into an **mtr / trippy-style live path monitor**: continuous rounds,
per-hop rolling loss/RTT/jitter stats, and ICMP / UDP / TCP probe modes.

Trippy (`fujiapple852/trippy`) is Apache-2.0 **Rust** — the net backend is Go, so
we take the feature model, not the code. No new Go dependency
(`golang.org/x/net`, `golang.org/x/sys/windows` already vendored).

Route stays `/tools/traceroute`. The one-shot mode keeps working unchanged
until T3 lands the new UI.

## Current state (as of this plan)

- `traceroute.go` — `Run(ctx, Options, Emit)`, sweeps `ttl 1..maxHops`, emits
  `"hop"` (`Hop`) per TTL, returns `Result` (shape `set`). `Options{Host,
  MaxHops, ProbesPerHop, Timeout, ResolveNames}`.
- `probe_windows.go` — `IcmpSendEcho` with explicit TTL (unprivileged).
- `probe_other.go` — datagram-ICMP socket (`icmp.ListenPacket("udp4")`) +
  `SetTTL`, reads echo-reply / time-exceeded.
- `api/traceroute.go` — `GET /traceroute/stream`, geo enrichment, `done`
  envelope.
- `capabilities.go:51` — `"traceroute": {Available: true}`.
- FE `TracerouteScreen.tsx` — consumes `"hop"`, renders a table + `GeoMap`.

## Phases

### T1 — probe engine: protocol modes + rounds

**T1a — rounds + rolling stats (ICMP).** Land first; highest value.

- `Options` gains: `Rounds int` (0 = until cancelled; default 1),
  `Interval time.Duration` (between rounds; default 1s).
- New `HopStat` (streamed as `hop-update`):
  ```go
  type HopStat struct {
      TTL       int      `json:"ttl"`
      Addrs     []string `json:"addrs"`       // >1 = ECMP
      Addr      string   `json:"addr"`        // last / primary
      Hostname  string   `json:"hostname,omitempty"`
      Sent      int      `json:"sent"`
      Recv      int      `json:"recv"`
      LossPct   float64  `json:"lossPct"`
      LastMs    float64  `json:"lastMs"`
      BestMs    float64  `json:"bestMs"`
      WorstMs   float64  `json:"worstMs"`
      AvgMs     float64  `json:"avgMs"`
      StdevMs   float64  `json:"stdevMs"`
      JitterMs  float64  `json:"jitterMs"`    // EWMA of |Δrtt|
      Recent    []float64 `json:"recent"`     // ring, last ~30 RTTs for the sparkline
      Reached   bool     `json:"reached"`
  }
  ```
- `Run` loop: for each round, sweep `ttl 1..lastTTL` (where `lastTTL` grows to
  the TTL that first reached the destination, then stays fixed). Fold each
  probe into `stats[ttl-1]`; emit `hop-update` after each hop.
- Keep emitting legacy `"hop"` (`Hop`) on round 1 only, so the current FE keeps
  working until T3.
- `done` envelope: `Result` computed from the final stats (same `set` shape;
  `Items` unchanged).
- **Commit.** BE green, FE untouched.

**T1b — UDP + TCP probe modes.**

- `Options.Protocol` (`"icmp"` default | `"udp"` | `"tcp"`), `Options.Port`
  (dest port; default 33434 UDP / 80 TCP), `Options.PacketSize`.
- `probe_other.go`: UDP = send to `dest:port+ttl` with `SetTTL`, still read the
  ICMP time-exceeded / port-unreachable on a second `icmp.ListenPacket`. TCP =
  half-open SYN with `SetTTL` via `ipv4.RawConn` or `net.Dialer.Control` +
  raw socket; time-exceeded → hop, SYN-ACK/RST → reached.
- `probe_windows.go`: UDP/TCP need a raw socket → **admin**. Detect and, when
  not elevated, return a coded error ("TCP/UDP path tracing needs admin — run
  as administrator, or use ICMP mode").
- Capability payload: `traceroute.modes: ["icmp","udp","tcp"]` +
  `adminModes: [...]`.
- **Commit.**

### T2 — analysis extras

- **ECMP**: collect every distinct responder per TTL into `Addrs`.
- **Reverse DNS**: async, cached per session (don't block the round).
- **AS number** (optional): Team Cymru `origin.asn.cymru.com` TXT lookup,
  cached, best-effort, behind `?asn=true`.
- **Path change detection**: if a hop's primary `Addr` changes mid-session,
  mark `changed: true` for one update so the UI can flash it.
- **Commit.**

### T3 — UI (T4 `NetworkToolScaffold`)

- New `TraceroutePlusView` (or rework `TracerouteScreen`): mtr-style live table
  `Hop │ Host │ Loss% │ Snt │ Last │ Avg │ Best │ Wrst │ StDev │ ▁▂▅▃` — the
  last column is `Sparkline.tsx` fed `HopStat.Recent`.
- Consume `hop-update`, merge by `ttl` into a `Map`. Drop the `"hop"`
  dependency.
- Controls: protocol select, interval, max hops, dest port (udp/tcp),
  **One-shot ↔ Continuous** toggle, Stop button (reuse the SSE abort in
  `useNetworkStream`).
- Keep `GeoMap` (route map) — feed it the per-hop `Addr` + geo.
- Export: JSON + CSV of the session (all hop stats).
- Loss cell colour ramp (0 → green, >0 → amber, ≥50 → red) from a shared
  token, per `design.md`.
- **Commit.**

### T4 — polish + capability + errors

- `apierr`-coded errors for: bad host, admin-required mode, no raw socket.
- `capabilities.network.traceroute` full shape (`modes`, `adminModes`,
  `asn`).
- History/compare: `diff.ts` already treats traceroute as an ordered set —
  confirm the new `done` result still diffs (hop count + per-hop addr).
- Docs: `NETWORK_MODULE_PLAN.md` tool #5 updated; README network row.
- **Commit.**

## Effort

T1a M · T1b M · T2 S–M · T3 M · T4 S → **L total** (~3–4 sessions).

## Risks

- **Windows UDP/TCP tracing needs admin.** Mitigate: ICMP mode stays the
  unprivileged default and covers most use; UDP/TCP degrade to a clear coded
  error when not elevated.
- **Datagram-ICMP on Linux** needs `net.ipv4.ping_group_range` or the setcap
  already documented for the package — unchanged from today.
- **Firewalls drop time-exceeded** — same limitation any traceroute has; the
  `*` / 100 %-loss row is the correct display.
