/**
 * Shared host / range parser for the Network Toolkit — a TypeScript port of
 * NETworkManager's `HostRangeHelper`. Every host-taking tool (IP Scanner,
 * Port Scanner, Ping Monitor) runs its input through this.
 *
 * Pure logic, no backend needed: IPv4 ranges/patterns/CIDR are expanded here;
 * bare hostnames and `hostname/prefix` entries are returned as descriptors for
 * the backend to resolve (it can't be done in the browser). See
 * NETWORK_MODULE_PLAN.md §2.5.
 *
 * Accepted forms per `;`- or newline-separated entry:
 *   192.168.0.1              single IPv4
 *   2001:db8::1              single IPv6
 *   host.example.net         hostname            -> hostnames[]
 *   example.com/24           hostname + prefix   -> hostnameSubnets[]
 *   192.168.0.0/24           CIDR
 *   192.168.0.0/255.255.255.0   subnet mask
 *   192.168.0.1-100          short dash range (last octet)
 *   192.168.0.0 - 192.168.0.100  full dash range
 *   192.168.[50-100].1       octet range pattern
 *   10.0.[0-9,20].[1-2]      octet list/range pattern, any/all octets
 */

export interface HostSubnetSpec {
  host: string
  prefixLength: number
}

export interface HostRangeParseError {
  entry: string
  message: string
}

export interface HostRangeResult {
  /** Fully-expanded, de-duped, ascending IPv4 addresses plus any single IPv6 addresses. */
  addresses: string[]
  /** Bare hostnames the backend must resolve before scanning. */
  hostnames: string[]
  /** `hostname/prefix` entries the backend resolves, then expands around. */
  hostnameSubnets: HostSubnetSpec[]
  /** Per-entry parse failures. */
  errors: HostRangeParseError[]
  /** True if expansion hit `maxAddresses` and stopped early. */
  truncated: boolean
}

export interface HostRangeOptions {
  /** Hard cap on expanded addresses; expansion stops and sets `truncated`. */
  maxAddresses?: number
}

const DEFAULT_MAX = 65536

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const HOSTNAME_RE = /^(?=.{1,253}$)([a-zA-Z0-9_](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?)(\.[a-zA-Z0-9_](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?)*$/

export function parseHostRange(input: string, options: HostRangeOptions = {}): HostRangeResult {
  const max = options.maxAddresses ?? DEFAULT_MAX
  const addresses = new Set<string>()
  const hostnames = new Set<string>()
  const hostnameSubnets: HostSubnetSpec[] = []
  const errors: HostRangeParseError[] = []
  let truncated = false

  const entries = input
    .split(/[;\n]+/)
    .map((e) => e.trim())
    .filter((e) => e.length > 0)

  for (const entry of entries) {
    if (addresses.size >= max) {
      truncated = true
      break
    }
    try {
      const produced = expandEntry(entry, max - addresses.size)
      if (produced.truncated) truncated = true
      for (const a of produced.addresses) addresses.add(a)
      for (const h of produced.hostnames) hostnames.add(h)
      for (const s of produced.hostnameSubnets) hostnameSubnets.push(s)
    } catch (e) {
      errors.push({ entry, message: e instanceof Error ? e.message : String(e) })
    }
  }

  return {
    addresses: sortIpv4First([...addresses]),
    hostnames: [...hostnames],
    hostnameSubnets,
    errors,
    truncated,
  }
}

interface EntryExpansion {
  addresses: string[]
  hostnames: string[]
  hostnameSubnets: HostSubnetSpec[]
  truncated: boolean
}

function expandEntry(entry: string, budget: number): EntryExpansion {
  const empty: EntryExpansion = { addresses: [], hostnames: [], hostnameSubnets: [], truncated: false }

  // Full dash range: "A - B" or "A-B" where both sides are complete IPv4.
  const dashParts = entry.split('-').map((p) => p.trim())
  if (dashParts.length === 2 && IPV4_RE.test(dashParts[0]) && IPV4_RE.test(dashParts[1])) {
    return { ...empty, ...expandIntRange(parseIpv4(dashParts[0]), parseIpv4(dashParts[1]), budget) }
  }

  // Slash forms: CIDR, subnet mask, or hostname/prefix.
  const slash = entry.indexOf('/')
  if (slash !== -1) {
    const left = entry.slice(0, slash).trim()
    const right = entry.slice(slash + 1).trim()
    if (entry.indexOf('/', slash + 1) !== -1) throw new Error('more than one "/"')

    if (IPV4_RE.test(left)) {
      let prefix: number
      if (IPV4_RE.test(right)) {
        prefix = maskToPrefix(parseIpv4(right))
      } else if (/^\d{1,2}$/.test(right)) {
        prefix = parseInt(right, 10)
        if (prefix > 32) throw new Error(`IPv4 prefix /${prefix} out of range`)
      } else {
        throw new Error(`"${right}" is not a prefix length or subnet mask`)
      }
      return { ...empty, ...expandCidr(parseIpv4(left), prefix, budget) }
    }

    if (left.includes(':')) throw new Error('IPv6 ranges cannot be expanded; enter single IPv6 addresses')

    if (HOSTNAME_RE.test(left) && /^\d{1,2}$/.test(right)) {
      const prefixLength = parseInt(right, 10)
      if (prefixLength > 32) throw new Error(`prefix /${prefixLength} out of range`)
      return { ...empty, hostnameSubnets: [{ host: left, prefixLength }] }
    }
    throw new Error(`unrecognized "host/prefix" form`)
  }

  // Octet pattern: any octet may be "[a-b]" / "[a,b,c]" / "[a-b,c]".
  if (entry.includes('[')) {
    return { ...empty, ...expandOctetPattern(entry, budget) }
  }

  // Short dash range: "192.168.0.1-100" (last octet only).
  const shortDash = entry.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})-(\d{1,3})$/)
  if (shortDash) {
    const base = [1, 2, 3, 4].map((i) => octet(shortDash[i]))
    const from = octet(shortDash[4])
    const to = octet(shortDash[5])
    if (to < from) throw new Error('range end is before its start')
    const start = ((base[0] << 24) | (base[1] << 16) | (base[2] << 8) | from) >>> 0
    const end = ((base[0] << 24) | (base[1] << 16) | (base[2] << 8) | to) >>> 0
    return { ...empty, ...expandIntRange(start, end, budget) }
  }

  // Single IPv4.
  if (IPV4_RE.test(entry)) {
    return { ...empty, addresses: [formatIpv4(parseIpv4(entry))] }
  }

  // Single IPv6 (loose validation — enough hex groups and at most one "::").
  if (entry.includes(':')) {
    if (!isPlausibleIpv6(entry)) throw new Error(`"${entry}" is not a valid IPv6 address`)
    return { ...empty, addresses: [entry] }
  }

  // Bare hostname.
  if (HOSTNAME_RE.test(entry)) {
    return { ...empty, hostnames: [entry] }
  }

  throw new Error(`"${entry}" is not an IP, range, CIDR, pattern or hostname`)
}

function expandIntRange(start: number, end: number, budget: number): Pick<EntryExpansion, 'addresses' | 'truncated'> {
  if (end < start) throw new Error('range end is before its start')
  const count = end - start + 1
  const truncated = count > budget
  const limit = truncated ? start + budget : end + 1
  const addresses: string[] = []
  for (let v = start; v < limit; v++) addresses.push(formatIpv4(v >>> 0))
  return { addresses, truncated }
}

function expandCidr(addr: number, prefix: number, budget: number): Pick<EntryExpansion, 'addresses' | 'truncated'> {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const network = (addr & mask) >>> 0
  const broadcast = (network | (~mask >>> 0)) >>> 0
  return expandIntRange(network, broadcast, budget)
}

function expandOctetPattern(entry: string, budget: number): Pick<EntryExpansion, 'addresses' | 'truncated'> {
  const parts = entry.split('.')
  if (parts.length !== 4) throw new Error('octet pattern must have four parts')
  const perOctet: number[][] = parts.map((p) => {
    const m = p.match(/^\[(.+)\]$/)
    if (!m) {
      const n = octet(p)
      return [n]
    }
    const values: number[] = []
    for (const item of m[1].split(',').map((s) => s.trim())) {
      const rng = item.match(/^(\d{1,3})-(\d{1,3})$/)
      if (rng) {
        const a = octet(rng[1])
        const b = octet(rng[2])
        if (b < a) throw new Error(`range ${item} is reversed`)
        for (let v = a; v <= b; v++) values.push(v)
      } else if (/^\d{1,3}$/.test(item)) {
        values.push(octet(item))
      } else {
        throw new Error(`"${item}" is not a number or range`)
      }
    }
    return values
  })

  let truncated = false
  const addresses: string[] = []
  outer: for (const a of perOctet[0]) {
    for (const b of perOctet[1]) {
      for (const c of perOctet[2]) {
        for (const d of perOctet[3]) {
          if (addresses.length >= budget) {
            truncated = true
            break outer
          }
          addresses.push(`${a}.${b}.${c}.${d}`)
        }
      }
    }
  }
  return { addresses, truncated }
}

// --- IPv4 helpers ---

function octet(s: string): number {
  const n = parseInt(s, 10)
  if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error(`"${s}" is not a 0-255 octet`)
  return n
}

function parseIpv4(s: string): number {
  const m = s.match(IPV4_RE)
  if (!m) throw new Error(`"${s}" is not a valid IPv4 address`)
  return ((octet(m[1]) << 24) | (octet(m[2]) << 16) | (octet(m[3]) << 8) | octet(m[4])) >>> 0
}

function formatIpv4(v: number): string {
  return `${(v >>> 24) & 0xff}.${(v >>> 16) & 0xff}.${(v >>> 8) & 0xff}.${v & 0xff}`
}

function maskToPrefix(mask: number): number {
  // A valid mask is a run of 1s followed by a run of 0s.
  const inverted = (~mask >>> 0) + 1
  if ((inverted & (inverted - 1)) !== 0) throw new Error(`${formatIpv4(mask)} is not a contiguous subnet mask`)
  let prefix = 0
  let m = mask >>> 0
  while (m & 0x80000000) {
    prefix++
    m = (m << 1) >>> 0
  }
  return prefix
}

function isPlausibleIpv6(s: string): boolean {
  if ((s.match(/::/g) ?? []).length > 1) return false
  const groups = s.split(/:+/).filter((g) => g.length > 0)
  if (groups.length > 8) return false
  return groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))
}

function sortIpv4First(list: string[]): string[] {
  return list.sort((a, b) => {
    const av4 = IPV4_RE.test(a)
    const bv4 = IPV4_RE.test(b)
    if (av4 && bv4) return parseIpv4(a) - parseIpv4(b)
    if (av4 !== bv4) return av4 ? -1 : 1
    return a.localeCompare(b)
  })
}
