import type { IToolUseCase } from '../ports/IToolUseCase'

/** The four common textual notations a 48-bit MAC address is written in. */
export type MacNotation = 'colon' | 'hyphen' | 'dotted' | 'bare'

const ALL_NOTATIONS: MacNotation[] = ['colon', 'hyphen', 'dotted', 'bare']

/**
 * How a curated OUI entry is useful, so the UI can highlight the entries an
 * SRE actually cares about (spotting a virtual NIC) separately from plain
 * hardware-vendor identification.
 */
export type OuiCategory = 'virtualization' | 'hardware'

/**
 * One row of the *curated* OUI table shipped with the app.
 *
 * `prefixHex` is uppercase hex with no separators and may be shorter than
 * the usual 6 digits: Docker, for example, only fixes the first two octets
 * (`0242`), so prefixes are matched longest-first rather than assuming a
 * 24-bit OUI.
 */
export interface OuiEntry {
  /** Uppercase hex digits, no separators, e.g. `005056` or `0242`. */
  prefixHex: string
  vendor: string
  category: OuiCategory
  /** Extra context worth showing, e.g. which product uses the prefix. */
  note?: string
}

/** The prefix rendered with colons, e.g. `00:50:56` / `02:42`. */
export function ouiPrefixDisplay(entry: OuiEntry): string {
  const pairs: string[] = []
  for (let i = 0; i + 1 < entry.prefixHex.length; i += 2) {
    pairs.push(entry.prefixHex.substring(i, i + 2))
  }
  return pairs.join(':')
}

/** Input for `MacAddressTool.execute`: a MAC address in any notation. */
export interface MacAddressInput {
  mac: string
}

/** Everything `MacAddressTool` can say about a single MAC address. */
export interface MacAddressAnalysis {
  /** Uppercase, separator-free, exactly 12 hex digits. */
  normalizedHex: string
  colonForm: string
  hyphenForm: string
  dottedForm: string
  bareForm: string
  /** First three octets as uppercase hex, no separators (`001A2B`). */
  ouiHex: string
  /**
   * True when the U/L bit (bit 1, mask `0x02`, of the *first* octet) is set,
   * meaning the address was assigned locally rather than from an IEEE-
   * registered OUI. Locally administered addresses have no meaningful
   * vendor — hypervisors and container runtimes mint them freely.
   */
  isLocallyAdministered: boolean
  /**
   * True when the I/G bit (bit 0, mask `0x01`, of the first octet) is set,
   * meaning the frame is group-addressed (multicast) rather than unicast.
   */
  isMulticast: boolean
  /** `FF:FF:FF:FF:FF:FF` — the special all-ones broadcast address. */
  isBroadcast: boolean
  /**
   * Curated-table match, or undefined when the OUI isn't one of the
   * well-known prefixes bundled with the app. An undefined vendor never
   * means "unassigned".
   */
  vendor?: OuiEntry
}

/** `00:1A:2B` — the OUI in the conventional display form. */
export function ouiDisplay(analysis: MacAddressAnalysis): string {
  const hex = analysis.ouiHex
  return `${hex.substring(0, 2)}:${hex.substring(2, 4)}:${hex.substring(4, 6)}`
}

export function isUniversallyAdministered(analysis: MacAddressAnalysis): boolean {
  return !analysis.isLocallyAdministered
}

export function isUnicast(analysis: MacAddressAnalysis): boolean {
  return !analysis.isMulticast
}

/** The address rendered in the requested notation. */
export function inNotation(analysis: MacAddressAnalysis, notation: MacNotation): string {
  switch (notation) {
    case 'colon':
      return analysis.colonForm
    case 'hyphen':
      return analysis.hyphenForm
    case 'dotted':
      return analysis.dottedForm
    case 'bare':
      return analysis.bareForm
  }
}

/** Options for `MacAddressTool.generate`. */
export interface MacGenerationOptions {
  /** How many addresses to mint. Must be >= 1. Default 1. */
  count?: number
  /**
   * Sets the U/L bit (`0x02`) on the first octet when true, clears it when
   * false. Ignored when `vendorPrefixHex` is supplied — a real vendor OUI
   * defines its own flag bits and rewriting them would produce an address
   * that no longer belongs to that vendor. Default true.
   */
  locallyAdministered?: boolean
  /**
   * Clears the I/G bit (`0x01`) when true (unicast), sets it when false
   * (multicast). Also ignored when `vendorPrefixHex` is supplied. Default
   * true.
   */
  unicast?: boolean
  /**
   * Optional fixed leading hex digits (separators allowed, e.g. `00:50:56`
   * or `525400`). Must be an even number of hex digits, 2..10.
   */
  vendorPrefixHex?: string
}

const DEFAULT_OPTIONS: Required<Omit<MacGenerationOptions, 'vendorPrefixHex'>> & { vendorPrefixHex?: string } = {
  count: 1,
  locallyAdministered: true,
  unicast: true,
  vendorPrefixHex: undefined,
}

/** Bit 0 of the first octet. Set => group address (multicast). */
const IG_BIT_MASK = 0x01
/** Bit 1 of the first octet. Set => locally administered. */
const UL_BIT_MASK = 0x02

const ALLOWED_CHARS = /^[0-9A-Fa-f:.\-\s]+$/
const SEPARATORS = /[:.\-\s]/g

/**
 * MAC address normalizer, analyzer, and generator.
 *
 * ## Vendor lookup is a *curated subset*, not the IEEE registry
 *
 * The real IEEE OUI/MA-L registry is roughly 35,000 assignments and several
 * megabytes of CSV — far too much to bundle into a client-first offline app
 * for a feature this peripheral. `kCuratedOuiTable` therefore ships a small
 * hand-picked table biased toward the prefixes that are actually *load
 * bearing* during triage: hypervisor and container-runtime NIC prefixes
 * (VMware, VirtualBox, Xen, Hyper-V, KVM/QEMU, Docker, Parallels), plus a
 * handful of very common hardware vendors. A miss means "not in our small
 * table" and never "unassigned by the IEEE"; the UI must say so.
 */
export class MacAddressTool implements IToolUseCase<MacAddressInput, MacAddressAnalysis> {
  execute(input: MacAddressInput): MacAddressAnalysis {
    return this.analyze(input.mac)
  }

  /**
   * Parses `raw` in any supported notation and returns the full analysis.
   *
   * Throws if the input isn't a well-formed 48-bit MAC.
   */
  analyze(raw: string): MacAddressAnalysis {
    const hex = this.normalize(raw)
    const firstOctet = parseInt(hex.substring(0, 2), 16)
    const oui = hex.substring(0, 6)

    return {
      normalizedHex: hex,
      colonForm: this.format(hex, 'colon'),
      hyphenForm: this.format(hex, 'hyphen'),
      dottedForm: this.format(hex, 'dotted'),
      bareForm: this.format(hex, 'bare'),
      ouiHex: oui,
      isLocallyAdministered: (firstOctet & UL_BIT_MASK) !== 0,
      isMulticast: (firstOctet & IG_BIT_MASK) !== 0,
      isBroadcast: hex === 'FFFFFFFFFFFF',
      vendor: this.lookupVendor(hex),
    }
  }

  // ------------------------------------------------------------- normalize

  /**
   * Strips separators and validates, returning 12 uppercase hex digits.
   *
   * Accepts `00:1A:2B:3C:4D:5E`, `00-1A-2B-3C-4D-5E`, `001A.2B3C.4D5E`,
   * `001A2B3C4D5E` and any mixture of those separators.
   *
   * Throws on anything else.
   */
  normalize(raw: string): string {
    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      throw new Error('Enter a MAC address.')
    }
    if (!ALLOWED_CHARS.test(trimmed)) {
      throw new Error(`"${trimmed}" contains characters that are not hex digits or MAC separators (: - .).`)
    }

    const hex = trimmed.replace(SEPARATORS, '').toUpperCase()
    if (hex.length !== 12) {
      throw new Error(`A MAC address has 12 hex digits (48 bits); "${trimmed}" has ${hex.length}.`)
    }
    return hex
  }

  /** Renders 12 normalized hex digits in `notation`. */
  format(normalizedHex: string, notation: MacNotation): string {
    const hex = normalizedHex.toUpperCase()
    if (hex.length !== 12) {
      throw new Error(`Expected 12 normalized hex digits, got ${hex.length}.`)
    }
    const octets: string[] = []
    for (let i = 0; i < 12; i += 2) {
      octets.push(hex.substring(i, i + 2))
    }
    switch (notation) {
      case 'colon':
        return octets.join(':')
      case 'hyphen':
        return octets.join('-')
      case 'dotted':
        return `${hex.substring(0, 4)}.${hex.substring(4, 8)}.${hex.substring(8, 12)}`
      case 'bare':
        return hex
    }
  }

  /** Every notation of one address, in a stable display order. */
  allFormats(normalizedHex: string): Record<MacNotation, string> {
    const result = {} as Record<MacNotation, string>
    for (const n of ALL_NOTATIONS) {
      result[n] = this.format(normalizedHex, n)
    }
    return result
  }

  // ---------------------------------------------------------------- vendor

  /**
   * Longest-prefix match against `kCuratedOuiTable`. Returns undefined on a
   * miss, which only means "not in the curated subset".
   */
  lookupVendor(normalizedHex: string): OuiEntry | undefined {
    const hex = normalizedHex.toUpperCase().replace(SEPARATORS, '')
    let best: OuiEntry | undefined
    for (const entry of kCuratedOuiTable) {
      if (hex.startsWith(entry.prefixHex)) {
        if (best === undefined || entry.prefixHex.length > best.prefixHex.length) {
          best = entry
        }
      }
    }
    return best
  }

  // -------------------------------------------------------------- generate

  /**
   * Mints `options.count` random MAC addresses.
   *
   * Randomness comes from a CSPRNG so generated addresses are not
   * predictable from one another — these get pasted into real network
   * configs, so a seeded PRNG would be the wrong default.
   *
   * Throws on invalid options.
   */
  generate(options: MacGenerationOptions = {}): MacAddressAnalysis[] {
    const opts = { ...DEFAULT_OPTIONS, ...options }
    if (opts.count < 1) {
      throw new Error(`Generate at least one address (count was ${opts.count}).`)
    }
    if (opts.count > 256) {
      throw new Error('Generate at most 256 addresses at a time.')
    }

    let prefix: string | undefined
    const rawPrefix = opts.vendorPrefixHex
    if (rawPrefix !== undefined && rawPrefix.trim().length > 0) {
      prefix = rawPrefix.trim().replace(SEPARATORS, '').toUpperCase()
      if (!/^[0-9A-F]+$/.test(prefix)) {
        throw new Error(`"${rawPrefix}" is not a hex vendor prefix.`)
      }
      if (prefix.length % 2 !== 0) {
        throw new Error(`A vendor prefix must be whole octets; "${rawPrefix}" is not.`)
      }
      if (prefix.length < 2 || prefix.length > 10) {
        throw new Error(`A vendor prefix must be 1 to 5 octets, got ${Math.floor(prefix.length / 2)}.`)
      }
    }

    const results: MacAddressAnalysis[] = []
    for (let i = 0; i < opts.count; i++) {
      results.push(this.analyze(randomHex(opts, prefix)))
    }
    return results
  }
}

function randomHex(options: { locallyAdministered: boolean; unicast: boolean }, prefix?: string): string {
  const octets = Array.from({ length: 6 }, () => randomByte())

  if (prefix !== undefined) {
    // The chosen vendor prefix owns the leading octets verbatim — including
    // its U/L and I/G bits. Overwriting them would break the very thing the
    // caller asked for (an address that looks like it came from that OUI).
    for (let i = 0; i * 2 < prefix.length; i++) {
      octets[i] = parseInt(prefix.substring(i * 2, i * 2 + 2), 16)
    }
  } else {
    let first = octets[0]
    first = options.locallyAdministered ? first | UL_BIT_MASK : first & ~UL_BIT_MASK
    first = options.unicast ? first & ~IG_BIT_MASK : first | IG_BIT_MASK
    octets[0] = first & 0xff
  }

  return octets.map((o) => o.toString(16).padStart(2, '0').toUpperCase()).join('')
}

function randomByte(): number {
  const array = new Uint8Array(1)
  crypto.getRandomValues(array)
  return array[0]
}

/**
 * The curated OUI subset. **Not** the IEEE registry — see the class doc on
 * `MacAddressTool` for why, and say so in any UI that surfaces a match.
 *
 * Virtualization prefixes come first because they're the ones that answer a
 * real operational question ("is this host a VM, and under what?").
 */
export const kCuratedOuiTable: OuiEntry[] = [
  // --- Virtualization / containers ---------------------------------------
  {
    prefixHex: '005056',
    vendor: 'VMware',
    category: 'virtualization',
    note: 'vSphere/ESXi-assigned VM NIC (the range vCenter hands out).',
  },
  {
    prefixHex: '000C29',
    vendor: 'VMware',
    category: 'virtualization',
    note: 'VMware Workstation / Player / auto-generated ESXi NIC.',
  },
  {
    prefixHex: '000569',
    vendor: 'VMware',
    category: 'virtualization',
    note: 'Original VMware ESX OUI.',
  },
  {
    prefixHex: '001C14',
    vendor: 'VMware',
    category: 'virtualization',
    note: 'Additional VMware-registered OUI.',
  },
  {
    prefixHex: '080027',
    vendor: 'Oracle VirtualBox',
    category: 'virtualization',
    note: 'Registered to Cadmus Computer Systems; used by VirtualBox guests.',
  },
  {
    prefixHex: '0A0027',
    vendor: 'Oracle VirtualBox',
    category: 'virtualization',
    note: 'VirtualBox host-only adapter (locally administered variant).',
  },
  {
    prefixHex: '00163E',
    vendor: 'Xen / LXC',
    category: 'virtualization',
    note: 'XenSource OUI — Xen/XCP-ng/Citrix guests, and the default LXC/LXD container NIC prefix.',
  },
  {
    prefixHex: '00155D',
    vendor: 'Microsoft Hyper-V',
    category: 'virtualization',
    note: 'Hyper-V dynamic MAC pool.',
  },
  {
    prefixHex: '001C42',
    vendor: 'Parallels',
    category: 'virtualization',
    note: 'Parallels Desktop virtual NIC.',
  },
  {
    prefixHex: '525400',
    vendor: 'QEMU / KVM',
    category: 'virtualization',
    note: 'QEMU default locally-administered prefix (libvirt guests).',
  },
  {
    prefixHex: '0242',
    vendor: 'Docker',
    category: 'virtualization',
    note: 'Container veth / docker0 bridge; only the first two octets are fixed.',
  },

  // --- Single-board computers -------------------------------------------
  {
    prefixHex: 'B827EB',
    vendor: 'Raspberry Pi Foundation',
    category: 'hardware',
    note: 'Pi 1 through Pi 3.',
  },
  {
    prefixHex: 'DCA632',
    vendor: 'Raspberry Pi Trading',
    category: 'hardware',
    note: 'Pi 4 family.',
  },
  {
    prefixHex: 'E45F01',
    vendor: 'Raspberry Pi Trading',
    category: 'hardware',
    note: 'Pi 4 / Compute Module 4 and later.',
  },
  {
    prefixHex: '28CDC1',
    vendor: 'Raspberry Pi Trading',
    category: 'hardware',
    note: 'Pi Pico W and newer boards.',
  },

  // --- Network & server hardware ----------------------------------------
  { prefixHex: '00000C', vendor: 'Cisco Systems', category: 'hardware' },
  { prefixHex: '000A41', vendor: 'Cisco Systems', category: 'hardware' },
  { prefixHex: '001B0D', vendor: 'Cisco Systems', category: 'hardware' },
  { prefixHex: '00234D', vendor: 'Cisco Systems', category: 'hardware' },

  { prefixHex: '00AA00', vendor: 'Intel', category: 'hardware' },
  { prefixHex: '0002B3', vendor: 'Intel', category: 'hardware' },
  { prefixHex: '001B21', vendor: 'Intel', category: 'hardware', note: 'Intel server/desktop NICs.' },
  { prefixHex: '001E67', vendor: 'Intel', category: 'hardware' },
  { prefixHex: 'A0369F', vendor: 'Intel', category: 'hardware' },

  { prefixHex: '001422', vendor: 'Dell', category: 'hardware' },
  { prefixHex: '00219B', vendor: 'Dell', category: 'hardware' },
  { prefixHex: '0026B9', vendor: 'Dell', category: 'hardware' },
  { prefixHex: 'B82A72', vendor: 'Dell', category: 'hardware' },
  { prefixHex: 'F8BC12', vendor: 'Dell', category: 'hardware' },

  { prefixHex: '001B78', vendor: 'Hewlett-Packard', category: 'hardware' },
  { prefixHex: '0017A4', vendor: 'Hewlett-Packard', category: 'hardware' },
  { prefixHex: '0025B3', vendor: 'Hewlett-Packard', category: 'hardware' },
  { prefixHex: '3CD92B', vendor: 'Hewlett-Packard', category: 'hardware' },
  { prefixHex: '9457A5', vendor: 'Hewlett Packard Enterprise', category: 'hardware' },

  { prefixHex: '000393', vendor: 'Apple', category: 'hardware' },
  { prefixHex: '001B63', vendor: 'Apple', category: 'hardware' },
  { prefixHex: '002500', vendor: 'Apple', category: 'hardware' },
  { prefixHex: '3C0754', vendor: 'Apple', category: 'hardware' },
  { prefixHex: 'F01898', vendor: 'Apple', category: 'hardware' },
]
