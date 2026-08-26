import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * One CIDR block, either produced by summarizing a range or parsed from
 * user-entered notation.
 */
export interface CidrBlock {
  /** Dotted-quad network (base) address. */
  networkAddress: string
  prefixLength: number
  /** First address in the block (identical to `networkAddress`). */
  firstAddress: string
  /** Last address in the block (the IPv4 broadcast address). */
  lastAddress: string
  /** Total addresses covered, including network and broadcast. */
  addressCount: number
}

/** `10.0.0.0/24` */
export function cidrOf(block: CidrBlock): string {
  return `${block.networkAddress}/${block.prefixLength}`
}

/** Input for `IpRangeTool.execute`: an inclusive IPv4 range. */
export interface Ipv4RangeInput {
  startAddress: string
  endAddress: string
}

/** The minimal CIDR cover of an inclusive IPv4 range. */
export interface Ipv4RangeResult {
  startAddress: string
  endAddress: string
  /** Inclusive count: `end - start + 1`. */
  totalAddresses: number
  /**
   * The blocks, in ascending address order. They tile the range exactly:
   * no gaps, no overlap, nothing outside `[start, end]`.
   */
  blocks: CidrBlock[]
}

/** A generated RFC 4193 Unique Local Address prefix, plus one carved subnet. */
export interface UlaPrefixResult {
  /** The 40-bit Global ID as 10 lowercase hex digits. */
  globalIdHex: string
  /** `fdXX:XXXX:XXXX::/48` — the site prefix. */
  prefix48: string
  /** The 16-bit Subnet ID used to carve `subnet64`, 0..65535. */
  subnetId: number
  /** `fdXX:XXXX:XXXX:SSSS::/64` — one routable subnet inside `prefix48`. */
  subnet64: string
  /** A sample host address inside `subnet64` (`...::1`), handy for configs. */
  exampleAddress: string
}

const V4_FULL_MASK = 0xffffffff

/**
 * IPv4 range summarization / CIDR expansion, plus an IPv6 ULA generator.
 *
 * Deliberately complements (rather than duplicates) `subnetCalculator.ts`:
 * that tool answers "what does this one CIDR block contain?", this one
 * answers "what CIDR blocks cover this arbitrary range?" and "give me a
 * private IPv6 prefix to number a site with".
 *
 * IPv4 addresses are held as 32-bit values in a JS `number` (safe: no
 * arithmetic here overflows 53 bits). IPv6 is only generated, never parsed,
 * so the ULA side works on raw octets.
 */
export class IpRangeTool implements IToolUseCase<Ipv4RangeInput, Ipv4RangeResult> {
  execute(input: Ipv4RangeInput): Ipv4RangeResult {
    return this.summarizeRange(input.startAddress, input.endAddress)
  }

  // --------------------------------------------------------- range -> CIDR

  /**
   * Computes the minimal set of CIDR blocks that exactly covers the
   * inclusive range `start`..`end`.
   *
   * Standard greedy summarization: at each position take the largest
   * CIDR block that is (a) aligned to the current address and (b) does not
   * run past `end`, then advance past it. Alignment is read straight off the
   * current address's trailing zero bits, which is why this produces the
   * minimal cover rather than merely *a* cover.
   *
   * Throws on malformed addresses and if `start` is above `end`.
   */
  summarizeRange(start: string, end: string): Ipv4RangeResult {
    const startInt = this.parseIPv4(start)
    const endInt = this.parseIPv4(end)

    if (startInt > endInt) {
      throw new Error(`The start address (${start}) is above the end address (${end}) — swap them.`)
    }

    const blocks: CidrBlock[] = []
    let current = startInt

    while (current <= endInt) {
      // Largest block whose base can be `current`: limited by the lowest set
      // bit. current === 0 has no set bits, so the whole /0 space is aligned.
      const alignmentBits = current === 0 ? 32 : trailingZeros(current)

      // ...and by how many addresses are actually left in the range.
      const remaining = endInt - current + 1
      let hostBits = alignmentBits
      while (hostBits > 0 && 2 ** hostBits > remaining) {
        hostBits--
      }

      const size = 2 ** hostBits
      const prefixLength = 32 - hostBits
      blocks.push({
        networkAddress: this.formatIPv4(current),
        prefixLength,
        firstAddress: this.formatIPv4(current),
        lastAddress: this.formatIPv4(current + size - 1),
        addressCount: size,
      })
      current += size
    }

    return {
      startAddress: this.formatIPv4(startInt),
      endAddress: this.formatIPv4(endInt),
      totalAddresses: endInt - startInt + 1,
      blocks,
    }
  }

  // --------------------------------------------------------- CIDR -> range

  /**
   * Expands `a.b.c.d/n` to its network/first/last addresses and total count.
   *
   * A host part that isn't already zeroed (e.g. `192.168.1.37/24`) is
   * masked down to the network address rather than rejected — that's what
   * every routing tool does, and rejecting it would be a nuisance.
   *
   * Throws on malformed input.
   */
  expandCidr(cidr: string): CidrBlock {
    const text = cidr.trim()
    if (text.length === 0) {
      throw new Error('Enter a CIDR block, e.g. 192.168.1.0/24.')
    }

    const slash = text.indexOf('/')
    if (slash === -1) {
      throw new Error('Missing "/" prefix length, e.g. 192.168.1.0/24.')
    }
    if (text.indexOf('/', slash + 1) !== -1) {
      throw new Error('A CIDR block contains exactly one "/".')
    }

    const addressPart = text.substring(0, slash).trim()
    const prefixPart = text.substring(slash + 1).trim()
    if (!/^\d{1,2}$/.test(prefixPart)) {
      throw new Error(`"${prefixPart}" is not a valid IPv4 prefix length.`)
    }
    const prefixLength = parseInt(prefixPart, 10)
    if (prefixLength > 32) {
      throw new Error(`An IPv4 prefix length is 0-32, got /${prefixLength}.`)
    }

    const addressInt = this.parseIPv4(addressPart)
    const mask = prefixLength === 0 ? 0 : (V4_FULL_MASK << (32 - prefixLength)) & V4_FULL_MASK
    const network = addressInt & mask
    const last = network | (~mask & V4_FULL_MASK)

    return {
      networkAddress: this.formatIPv4(network),
      prefixLength,
      firstAddress: this.formatIPv4(network),
      lastAddress: this.formatIPv4(last),
      addressCount: 2 ** (32 - prefixLength),
    }
  }

  // ------------------------------------------------------------ IPv4 codec

  /**
   * Parses a dotted-quad IPv4 address into a 32-bit int.
   *
   * Throws on anything that isn't four 0-255 decimal octets. Leading zeros
   * are rejected outright because they are read as octal by some resolvers
   * and decimal by others — an address that means two different things is
   * not an address worth accepting.
   */
  parseIPv4(address: string): number {
    const text = address.trim()
    if (text.length === 0) {
      throw new Error('Enter an IPv4 address.')
    }
    const parts = text.split('.')
    if (parts.length !== 4) {
      throw new Error(`"${text}" is not an IPv4 address: expected 4 octets, got ${parts.length}.`)
    }
    let value = 0
    for (const part of parts) {
      if (part.length === 0 || !/^\d{1,3}$/.test(part)) {
        throw new Error(`"${part}" is not a valid IPv4 octet in "${text}".`)
      }
      if (part.length > 1 && part.startsWith('0')) {
        throw new Error(`"${part}" has a leading zero — write octets without one (e.g. 10, not 010).`)
      }
      const octet = parseInt(part, 10)
      if (octet > 255) {
        throw new Error(`"${part}" is out of range for an IPv4 octet (0-255).`)
      }
      value = (value << 8) | octet
    }
    return value >>> 0
  }

  /** Renders a 32-bit int as a dotted-quad address. */
  formatIPv4(value: number): string {
    const v = value >>> 0
    return `${(v >>> 24) & 0xff}.${(v >>> 16) & 0xff}.${(v >>> 8) & 0xff}.${v & 0xff}`
  }

  // ------------------------------------------------------- IPv6 ULA (4193)

  /**
   * Generates an RFC 4193 Unique Local Address prefix: `fd` + a 40-bit
   * Global ID, yielding `fdXX:XXXX:XXXX::/48`, plus a `/64` carved out of it
   * using `subnetId` (random when omitted).
   *
   * **On the Global ID:** RFC 4193 §3.2.2 describes a specific derivation —
   * concatenate an EUI-64 with an NTP-format timestamp, SHA-1 the result,
   * and take the low 40 bits. That ritual exists purely to make collisions
   * unlikely without a central registry; the RFC itself notes any method
   * producing a well-distributed 40-bit value works. This generator uses a
   * CSPRNG directly instead, which is the common practical approach and
   * gives the same collision properties without needing a hardware MAC
   * address. It is therefore **RFC 4193-shaped, not an RFC-exact
   * derivation** — do not describe it as the latter.
   *
   * The `L` bit is always 1 (hence `fd00::/8`); `fc00::/8` is reserved for a
   * centrally-assigned scheme that was never defined, so it must not be
   * generated.
   *
   * Throws if `subnetId` is outside 0..65535.
   */
  generateUla(subnetId?: number): UlaPrefixResult {
    if (subnetId !== undefined && (subnetId < 0 || subnetId > 0xffff)) {
      throw new Error(`A subnet ID is a 16-bit value (0-65535), got ${subnetId}.`)
    }
    const subnet = subnetId ?? randomInt(0x10000)

    // 40 bits of Global ID, drawn as five independent octets.
    const globalId = Array.from({ length: 5 }, () => randomInt(256))
    const globalIdHex = globalId.map(hex2).join('')

    // Address layout: fd | 40-bit global id | 16-bit subnet id | 64-bit iface
    // group0 = 0xfd<<8 | globalId[0], then two groups of the remaining 32
    // bits, then the subnet id as group3.
    const group0 = (0xfd << 8) | globalId[0]
    const group1 = (globalId[1] << 8) | globalId[2]
    const group2 = (globalId[3] << 8) | globalId[4]

    const g = (v: number) => v.toString(16).padStart(4, '0')

    const prefix48 = `${g(group0)}:${g(group1)}:${g(group2)}::/48`
    const subnetBase = `${g(group0)}:${g(group1)}:${g(group2)}:${g(subnet)}`

    return {
      globalIdHex,
      prefix48,
      subnetId: subnet,
      subnet64: `${subnetBase}::/64`,
      exampleAddress: `${subnetBase}::1`,
    }
  }

  /**
   * Carves a specific `/64` out of an already-generated site prefix.
   *
   * `prefix48` must be the `fdXX:XXXX:XXXX::/48` form `generateUla`
   * produces. Throws otherwise.
   */
  subnetOfUla(prefix48: string, subnetId: number): string {
    if (subnetId < 0 || subnetId > 0xffff) {
      throw new Error(`A subnet ID is a 16-bit value (0-65535), got ${subnetId}.`)
    }
    const match = /^(f[cd][0-9a-f]{2}):([0-9a-f]{1,4}):([0-9a-f]{1,4})::\/48$/i.exec(prefix48.trim())
    if (match === null) {
      throw new Error(`"${prefix48}" is not a ULA /48 prefix like fd12:3456:789a::/48.`)
    }
    const g = (v: string) => parseInt(v, 16).toString(16).padStart(4, '0')
    const base = `${g(match[1])}:${g(match[2])}:${g(match[3])}:${subnetId.toString(16).padStart(4, '0')}`
    return `${base}::/64`
  }
}

/** Number of trailing zero bits in the low 32 bits of `value`. */
function trailingZeros(value: number): number {
  let count = 0
  let v = value >>> 0
  if (v === 0) return 32
  while ((v & 1) === 0) {
    v >>>= 1
    count++
  }
  return count
}

function hex2(v: number): string {
  return v.toString(16).padStart(2, '0')
}

/** Cryptographically-secure random integer in `[0, max)`. */
function randomInt(max: number): number {
  const array = new Uint32Array(1)
  crypto.getRandomValues(array)
  return array[0] % max
}
