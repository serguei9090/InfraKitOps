# Discovery Protocol (LLDP / CDP) — plan (WS2)

`moduleTaxonomy.ts` declares a **Discovery Protocol** tool ("Capture LLDP / CDP
neighbor advertisements") with **no `route:` and no backend package** — a dead
menu row. Build it.

Goal: passively listen on a network interface for LLDP (IEEE 802.1AB) and Cisco
CDP frames and show what switch / port / VLAN each interface is plugged into.

No new Go dependency (hand-roll the pcapng + TLV parse). No bundled capture
driver — Npcap's license is not MIT-compatible.

## Capture strategy — OS built-ins only

| OS | Method | Privilege |
|---|---|---|
| **Windows** | `pktmon` (built-in ≥ Win10 1809 / Server 2019): start a capture with a packet filter on EtherType `0x88CC` (LLDP) and on dst MAC `01:00:0C:CC:CC:CC` (CDP), run ~65 s, `pktmon pcapng` export, parse the file. | admin (pktmon needs it) |
| **Linux** | Prefer `lldpctl -f keyvalue` / `-f json` when `lldpd` is installed (structured, no capture needed). Fallback: raw `AF_PACKET` socket (`syscall.Socket(AF_PACKET, SOCK_RAW, ETH_P_ALL)`) bound to the interface, filter in-process. | `lldpctl`: none · raw socket: `CAP_NET_RAW` / root |
| **macOS** | out of scope for now (no user). |

LLDP transmit interval is 30 s, CDP 60 s → a **65 s** capture window catches at
least one of each on an active link.

## Phases

### D0 — capture spike ⚠️ (do first, could slip)

- **Windows `pktmon` path**: prove the full loop on the dev box —
  `pktmon start --capture --pkt-size 0 --file-name <tmp>.etl` with a filter
  (`pktmon filter add -e 0x88CC`; a second for the CDP MAC), wait, `pktmon stop`,
  `pktmon pcapng <etl> -o <tmp>.pcapng`, read the pcapng, find an LLDP frame.
- **Linux `lldpctl` path**: parse `lldpctl -f keyvalue`.
- If `pktmon` can't filter by MAC (only ethertype/port/ip), capture all and
  drop non-LLDP/CDP in the parser.
- Decision gate: if neither path works on a target OS, ship the other + a clear
  "not supported on this OS" state. Do **not** delete the menu row unless both
  fail.

### D1 — parser (`internal/tools/lldp/`)

- **pcapng reader** — minimal: Section Header Block, Interface Description
  Block, Enhanced/Simple Packet Block. Enough to pull raw Ethernet frames +
  timestamps. ~120 lines, no dep.
- **Ethernet + LLDP TLV parser**:
  - mandatory TLVs: Chassis ID (1), Port ID (2), TTL (3)
  - optional: Port Description (4), System Name (5), System Description (6),
    System Capabilities (7), Management Address (8)
  - org-specific (127): IEEE 802.1 → Port VLAN ID, VLAN Name; IEEE 802.3 →
    MAC/PHY, Link Aggregation, Max Frame Size
- **CDP parser** (SNAP header `00000C 2000`): Device ID, Port ID, Platform,
  Capabilities, Native VLAN, Management Address, Software Version, Duplex.
- Output type:
  ```go
  type Neighbor struct {
      Iface        string   `json:"iface"`        // local interface it arrived on
      Protocol     string   `json:"protocol"`     // "lldp" | "cdp"
      SystemName   string   `json:"systemName"`
      ChassisID    string   `json:"chassisId"`
      PortID       string   `json:"portId"`
      PortDesc     string   `json:"portDesc,omitempty"`
      Platform     string   `json:"platform,omitempty"`
      NativeVLAN   int      `json:"nativeVlan,omitempty"`
      MgmtAddrs    []string `json:"mgmtAddrs,omitempty"`
      Capabilities []string `json:"capabilities,omitempty"`
      TTL          int      `json:"ttl,omitempty"`
      SeenAt       int64    `json:"seenAt"`
  }
  ```
- Unit tests over captured sample frames (hex fixtures in the test file).

### D2 — engine + endpoint

- `Capture(ctx, iface string, window time.Duration, emit) ([]Neighbor, error)`
  — dedupe by `(iface, protocol, chassisId, portId)`, emit each new neighbor
  as `"neighbor"`, a `"tick"` per second for the countdown, `"done"` with the
  collated set (envelope shape `set`).
- `GET /discovery/stream?iface=&windowMs=` (SSE). Optional `iface=all`.
- `capabilities.go`: `"discoveryProtocol": {Available: <os-supported>, Reason}`.
- `server.go`: `r.Get("/discovery/stream", api.DiscoveryStream)`.

### D3 — UI

- `moduleTaxonomy.ts` — add `route: '/tools/discovery-protocol'`.
- `routes.tsx` — `lazy:` entry.
- `DiscoveryProtocolScreen.tsx` on T4 `NetworkToolScaffold`:
  - `InterfacePicker` (reuse) + window length + Start.
  - "Listening for neighbors… 0:52 left" progress bar during capture.
  - Neighbor cards grouped by local interface: switch/system name (big),
    remote port + description, native VLAN badge, mgmt IP (copyable),
    capability chips, protocol tag (LLDP/CDP).
  - Empty result → "No LLDP/CDP heard in 65 s — the switch may not advertise,
    or the port is access-only with discovery disabled."
- History: `set` shape → `diff.ts` handles it; key on `chassisId+portId`.

### D4 — capability gate + docs

- Disabled state when: Windows non-admin, or Linux with no `lldpctl` and no
  `CAP_NET_RAW`. Show the exact fix (run as admin / `apt install lldpd` /
  `setcap cap_net_raw+ep`).
- `NETWORK_MODULE_PLAN.md` — replace tool #? placeholder.
- README network row: add LLDP/CDP.

## Effort

D0 M (risky) · D1 M · D2 S · D3 S · D4 S → **M–L total**.

## Risks

- **`pktmon` output format** — `.etl` needs conversion; `pktmon pcapng`
  subcommand exists on 20H1+, older builds only do `.etl` → need
  `netsh trace` or a newer-Windows floor. Document a Windows 10 2004 minimum
  for this tool if so.
- **Admin requirement** kills the "just click it" feel — accept it, gate
  clearly. This is why the row was deferred originally.
- **Virtual / filtered switches** (cloud VMs, corp NAC) often strip LLDP —
  the empty-state copy must set that expectation.
