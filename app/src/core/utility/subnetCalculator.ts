import type { IToolUseCase } from '../ports/IToolUseCase'

/** Which IP family a parsed CIDR block belongs to. */
export type IpVersion = 'v4' | 'v6'

export interface SubnetCalculatorInput {
  /** CIDR notation, e.g. "192.168.1.0/24" or "2001:db8::/64". */
  cidr: string
}

/**
 * Result of subnetting a CIDR block. `version` tells the caller which fields
 * are populated: IPv4-only fields (`broadcastAddress`, `subnetMask`,
 * `wildcardMask`, `firstUsableAddress`, `lastUsableAddress`,
 * `usableHostCount`) are undefined for IPv6 results.
 */
export interface SubnetCalculatorResult {
  version: IpVersion
  prefixLength: number
  /** Network address (compressed form for IPv6). */
  networkAddress: string
  /** First address in the block (== networkAddress). */
  firstAddress: string
  /** Last address in the block (== broadcastAddress for IPv4). */
  lastAddress: string
  /**
   * Total number of addresses in the block, as a `bigint` since IPv6
   * blocks can be astronomically large (up to 2^128).
   */
  totalAddressCount: bigint

  // --- IPv4-only fields ---
  broadcastAddress?: string
  subnetMask?: string
  wildcardMask?: string
  firstUsableAddress?: string
  lastUsableAddress?: string
  usableHostCount?: number
}

const V4_FULL_MASK = 0xffffffff

/**
 * IPv4/IPv6 subnet calculator: parses CIDR notation and computes network
 * boundaries by hand with integer/bigint bit masking.
 *
 * IPv4 addresses are packed into a 32-bit value carried in a JS `number`
 * (safe: no arithmetic here ever exceeds 53 bits). IPv6 addresses are
 * packed into a 128-bit `bigint`.
 */
export class SubnetCalculator implements IToolUseCase<SubnetCalculatorInput, SubnetCalculatorResult> {
  execute(input: SubnetCalculatorInput): SubnetCalculatorResult {
    const cidr = input.cidr.trim()
    if (cidr.length === 0) {
      throw new Error('Input is empty')
    }

    const slashIndex = cidr.indexOf('/')
    if (slashIndex === -1) {
      throw new Error('Missing "/" prefix length, e.g. 192.168.1.0/24')
    }
    if (cidr.indexOf('/', slashIndex + 1) !== -1) {
      throw new Error('CIDR must contain exactly one "/"')
    }

    const addressPart = cidr.substring(0, slashIndex).trim()
    const prefixPart = cidr.substring(slashIndex + 1).trim()

    if (addressPart.length === 0) {
      throw new Error('Missing IP address before "/"')
    }
    if (prefixPart.length === 0 || !/^\d+$/.test(prefixPart)) {
      throw new Error(`"${prefixPart}" is not a valid prefix length`)
    }
    const prefixLength = parseInt(prefixPart, 10)

    const isV6 = addressPart.includes(':')
    const isV4 = !isV6 && addressPart.includes('.')
    if (!isV4 && !isV6) {
      throw new Error(`"${addressPart}" is not a recognizable IPv4 or IPv6 address`)
    }

    if (isV4) {
      if (prefixLength < 0 || prefixLength > 32) {
        throw new Error(`IPv4 prefix length must be between 0 and 32, got /${prefixLength}`)
      }
      return computeV4(addressPart, prefixLength)
    } else {
      if (prefixLength < 0 || prefixLength > 128) {
        throw new Error(`IPv6 prefix length must be between 0 and 128, got /${prefixLength}`)
      }
      return computeV6(addressPart, prefixLength)
    }
  }
}

// --- IPv4 ---

function computeV4(addressPart: string, prefixLength: number): SubnetCalculatorResult {
  const addressInt = parseIPv4(addressPart)

  const maskInt = prefixLength === 0 ? 0 : (V4_FULL_MASK << (32 - prefixLength)) & V4_FULL_MASK
  const wildcardInt = ~maskInt & V4_FULL_MASK
  const networkInt = addressInt & maskInt
  const broadcastInt = networkInt | wildcardInt
  const total = 2n ** BigInt(32 - prefixLength)

  let firstUsable: string
  let lastUsable: string
  let usableHostCount: number
  if (prefixLength === 32) {
    // Host route: exactly one address, no network/broadcast distinction.
    usableHostCount = 1
    firstUsable = formatIPv4(networkInt)
    lastUsable = formatIPv4(networkInt)
  } else if (prefixLength === 31) {
    // RFC 3021 point-to-point link: both addresses are usable.
    usableHostCount = 2
    firstUsable = formatIPv4(networkInt)
    lastUsable = formatIPv4(broadcastInt)
  } else {
    usableHostCount = Number(total - 2n)
    firstUsable = formatIPv4(networkInt + 1)
    lastUsable = formatIPv4(broadcastInt - 1)
  }

  return {
    version: 'v4',
    prefixLength,
    networkAddress: formatIPv4(networkInt),
    firstAddress: formatIPv4(networkInt),
    lastAddress: formatIPv4(broadcastInt),
    totalAddressCount: total,
    broadcastAddress: formatIPv4(broadcastInt),
    subnetMask: formatIPv4(maskInt),
    wildcardMask: formatIPv4(wildcardInt),
    firstUsableAddress: firstUsable,
    lastUsableAddress: lastUsable,
    usableHostCount,
  }
}

function parseIPv4(addr: string): number {
  const parts = addr.split('.')
  if (parts.length !== 4) {
    throw new Error(`"${addr}" is not a valid IPv4 address: expected 4 octets, got ${parts.length}`)
  }
  let value = 0
  for (const p of parts) {
    if (p.length === 0 || !/^\d+$/.test(p)) {
      throw new Error(`"${p}" is not a valid IPv4 octet`)
    }
    const n = parseInt(p, 10)
    if (n < 0 || n > 255) {
      throw new Error(`"${p}" is out of range for an IPv4 octet (0-255)`)
    }
    value = (value << 8) | n
  }
  return value >>> 0
}

function formatIPv4(value: number): string {
  const v = value >>> 0
  const b0 = (v >>> 24) & 0xff
  const b1 = (v >>> 16) & 0xff
  const b2 = (v >>> 8) & 0xff
  const b3 = v & 0xff
  return `${b0}.${b1}.${b2}.${b3}`
}

// --- IPv6 ---

function computeV6(addressPart: string, prefixLength: number): SubnetCalculatorResult {
  const addressBig = parseIPv6(addressPart)
  const fullMask = (1n << 128n) - 1n
  const maskBig = prefixLength === 0 ? 0n : (fullMask << BigInt(128 - prefixLength)) & fullMask
  const networkBig = addressBig & maskBig
  const wildcardBig = ~maskBig & fullMask
  const lastBig = networkBig | wildcardBig
  const total = 2n ** BigInt(128 - prefixLength)

  return {
    version: 'v6',
    prefixLength,
    networkAddress: formatIPv6(networkBig),
    firstAddress: formatIPv6(networkBig),
    lastAddress: formatIPv6(lastBig),
    totalAddressCount: total,
  }
}

function parseIPv6(addr: string): bigint {
  let groups: string[]

  if (addr.includes('::')) {
    const parts = addr.split('::')
    if (parts.length !== 2) {
      throw new Error(`"${addr}" is not a valid IPv6 address: "::" may appear at most once`)
    }
    const left = parts[0].length === 0 ? [] : parts[0].split(':')
    const right = parts[1].length === 0 ? [] : parts[1].split(':')
    if (left.length + right.length > 7) {
      throw new Error(`"${addr}" is not a valid IPv6 address: too many groups for "::" compression`)
    }
    const missing = 8 - left.length - right.length
    groups = [...left, ...Array(missing).fill('0'), ...right]
  } else {
    groups = addr.split(':')
  }

  if (groups.length !== 8) {
    throw new Error(`"${addr}" is not a valid IPv6 address: expected 8 groups, got ${groups.length}`)
  }

  let value = 0n
  for (const g of groups) {
    if (g.length === 0 || g.length > 4 || !/^[0-9a-fA-F]+$/.test(g)) {
      throw new Error(`"${g}" is not a valid IPv6 group in "${addr}"`)
    }
    const part = parseInt(g, 16)
    value = (value << 16n) | BigInt(part)
  }
  return value
}

function formatIPv6(value: bigint): string {
  const groups: number[] = []
  for (let i = 0; i < 8; i++) {
    const shift = BigInt((7 - i) * 16)
    groups.push(Number((value >> shift) & 0xffffn))
  }

  // Find the longest run of consecutive zero groups (length >= 2),
  // preferring the leftmost run on ties, per RFC 5952 compression rules.
  let bestStart = -1
  let bestLen = 0
  let i = 0
  while (i < 8) {
    if (groups[i] === 0) {
      let j = i
      while (j < 8 && groups[j] === 0) {
        j++
      }
      const len = j - i
      if (len > bestLen) {
        bestLen = len
        bestStart = i
      }
      i = j
    } else {
      i++
    }
  }

  const hexGroups = groups.map((g) => g.toString(16))

  if (bestLen >= 2) {
    const left = hexGroups.slice(0, bestStart).join(':')
    const right = hexGroups.slice(bestStart + bestLen).join(':')
    return `${left}::${right}`
  }
  return hexGroups.join(':')
}
