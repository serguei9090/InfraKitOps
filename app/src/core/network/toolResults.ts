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
