/**
 * Structured result shapes returned by each backend tool inside a
 * `RunEnvelope.result`. Kept here (framework-free) so screens and the history
 * renderers share one definition. Each mirrors the Go tool package.
 */

export interface SntpServerRow {
  server: string
  ip?: string
  ok: boolean
  error?: string
  clockOffsetSec: number
  rttMs: number
  stratum: number
  referenceId?: string
  queriedAt: string
  serverTime?: string
}

export interface SntpResult {
  v: number
  servers: SntpServerRow[]
  medianOffsetSec: number
  okCount: number
}

// --- DNS Lookup ---
export interface DnsRecord {
  name: string
  type: string
  ttl: number
  value: string
}

export interface DnsResult {
  v: number
  items: { key: string; label: string; detail: string }[]
  records: DnsRecord[]
  resolver: string
  protocol: string
  errors: string[] | null
}

// --- Whois ---
export interface WhoisParsed {
  domainName?: string
  registrar?: string
  createdDate?: string
  updatedDate?: string
  expirationDate?: string
  nameServers?: string[]
  statuses?: string[]
  dnssec?: string
  registrantOrg?: string
  registrantCountry?: string
}

export interface WhoisResult {
  v: number
  query: string
  server?: string
  text: string
  parsed: WhoisParsed
  parseError?: string
}

// --- IP Geolocation ---
export interface IpGeoResult {
  v: number
  query: string
  fields: Record<string, unknown>
  order: string[]
  text: string
  rateRemaining: number
  rateResetSec: number
  error?: string
}

// --- Connections ---
export interface ConnRow {
  proto: string
  localAddr: string
  localPort: number
  remoteAddr?: string
  remotePort?: number
  state: string
  pid?: number
  processName?: string
}

export interface ConnectionsResult {
  v: number
  connections: ConnRow[]
  listening: number
  established: number
}

// --- Port Scanner ---
export interface PortRow {
  host: string
  port: number
  state: 'open' | 'closed' | 'timeout'
  service?: string
}

export interface PortScanProgress {
  scanned: number
  total: number
  openCount: number
}

export interface PortScanResult {
  v: number
  open: PortRow[]
  items: { key: string; label: string; detail: string }[]
  total: number
}

// --- iperf3 ---
export interface IperfStream {
  bitsPerSecond: number
  bytes: number
  retransmits?: number
  jitterMs?: number
  lostPercent?: number
}
export interface IperfDetail {
  v: number
  ok: boolean
  error?: string
  protocol: string
  reverse: boolean
  sender: IperfStream
  receiver: IperfStream
  samples: number[]
  mss?: number
  length?: number
  command?: string[]
}
export interface IperfResult {
  v: number
  unit: string
  samples: number[]
  stats: { min: number; avg: number; p50: number; p95: number; max: number }
  detail: IperfDetail
}

// --- Firewall Viewer ---
export interface FirewallRule {
  name: string
  enabled: boolean
  direction: 'inbound' | 'outbound'
  action: 'allow' | 'block'
  protocol?: string
  localPorts?: string
  remotePorts?: string
  localAddresses?: string
  remoteAddresses?: string
  profiles?: string
  program?: string
  grouping?: string
  description?: string
}
export interface FirewallResult {
  v: number
  backend: string
  rules: FirewallRule[]
  note?: string
}

// --- Hosts File Editor ---
export interface HostsLine {
  kind: 'mapping' | 'comment' | 'blank'
  enabled: boolean
  ip?: string
  hostnames?: string[]
  comment?: string
  raw: string
}
export interface HostsFile {
  v: number
  path: string
  lines: HostsLine[]
}

// --- Neighbor Table ---
export interface NeighborEntry {
  ip: string
  mac: string
  interface?: string
  state?: string
  family: 'v4' | 'v6'
}
export interface NeighborResult {
  v: number
  entries: NeighborEntry[]
}

// --- SNMP ---
export interface SnmpRow {
  oid: string
  type: string
  value: string
}
export interface SnmpResult {
  v: number
  mode: string
  rows: SnmpRow[]
}

// --- Network Scanner ---
export interface ScanHostRow {
  ip: string
  alive: boolean
  rttMs?: number
  hostname?: string
  openPorts?: number[]
}

export interface NetScanResult {
  v: number
  hosts: ScanHostRow[]
  alive: number
  total: number
}

export interface NetScanProgress {
  scanned: number
  total: number
  alive: number
}

// --- Traceroute ---
export interface TraceHop {
  ttl: number
  addr?: string
  hostname?: string
  rttsMs: number[]
  timeouts: number
  reached: boolean
  country?: string
  city?: string
  isp?: string
  lat?: number
  lon?: number
}

export interface TraceResult {
  v: number
  host: string
  destIp: string
  hops: TraceHop[]
  reached: boolean
  hopCount: number
  rounds?: number
}

/** One hop's rolling stats across rounds — the mtr-style row (`hop-update`). */
export interface TraceHopStat {
  ttl: number
  addrs: string[]
  addr: string
  hostname?: string
  sent: number
  recv: number
  lossPct: number
  lastMs: number
  bestMs: number
  worstMs: number
  avgMs: number
  stdevMs: number
  jitterMs: number
  recent: number[]
  reached: boolean
  country?: string
  city?: string
  isp?: string
  lat?: number
  lon?: number
}

// --- Ping Monitor ---
export interface PingSample {
  host: string
  seq: number
  ok: boolean
  rttMs: number
  ttl?: number
  error?: string
}

export interface PingStats {
  host: string
  sent: number
  received: number
  lossPct: number
  minMs: number
  avgMs: number
  maxMs: number
  p95Ms: number
  jitterMs: number
  status: 'up' | 'down' | 'pending'
  lastRttMs: number
}

// --- Wake on LAN ---
export interface WolResult {
  v: number
  mac: string
  broadcast: string
  port: number
  bytesSent: number
  text: string
  error?: string
}
