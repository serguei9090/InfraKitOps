import { describe, expect, it } from 'vitest'
import {
  inNotation,
  isUnicast,
  isUniversallyAdministered,
  MacAddressTool,
  ouiDisplay,
  ouiPrefixDisplay,
} from './macAddressTool'

describe('MacAddressTool', () => {
  const tool = new MacAddressTool()

  describe('normalize / notation parsing', () => {
    it('colon, hyphen, dotted and bare notations all normalize the same', () => {
      const expected = '001A2B3C4D5E'
      expect(tool.normalize('00:1A:2B:3C:4D:5E')).toBe(expected)
      expect(tool.normalize('00-1A-2B-3C-4D-5E')).toBe(expected)
      expect(tool.normalize('001A.2B3C.4D5E')).toBe(expected)
      expect(tool.normalize('001A2B3C4D5E')).toBe(expected)
    })

    it('lowercase input normalizes to uppercase', () => {
      expect(tool.normalize('00:1a:2b:3c:4d:5e')).toBe('001A2B3C4D5E')
    })

    it('mixed separators are all stripped', () => {
      expect(tool.normalize('00:1A-2B.3C4D5E')).toBe('001A2B3C4D5E')
    })

    it('analyze() reports every notation consistently for the same address', () => {
      const a = tool.analyze('00:1A:2B:3C:4D:5E')
      const b = tool.analyze('00-1A-2B-3C-4D-5E')
      const c = tool.analyze('001A.2B3C.4D5E')
      const d = tool.analyze('001A2B3C4D5E')

      for (const analysis of [a, b, c, d]) {
        expect(analysis.normalizedHex).toBe('001A2B3C4D5E')
        expect(analysis.colonForm).toBe('00:1A:2B:3C:4D:5E')
        expect(analysis.hyphenForm).toBe('00-1A-2B-3C-4D-5E')
        expect(analysis.dottedForm).toBe('001A.2B3C.4D5E')
        expect(analysis.bareForm).toBe('001A2B3C4D5E')
      }
    })

    it('allFormats returns every notation keyed by enum', () => {
      const formats = tool.allFormats('001A2B3C4D5E')
      expect(formats.colon).toBe('00:1A:2B:3C:4D:5E')
      expect(formats.hyphen).toBe('00-1A-2B-3C-4D-5E')
      expect(formats.dotted).toBe('001A.2B3C.4D5E')
      expect(formats.bare).toBe('001A2B3C4D5E')
    })

    it('inNotation on the analysis matches format()', () => {
      const analysis = tool.analyze('00:1A:2B:3C:4D:5E')
      expect(inNotation(analysis, 'colon')).toBe(analysis.colonForm)
      expect(inNotation(analysis, 'hyphen')).toBe(analysis.hyphenForm)
      expect(inNotation(analysis, 'dotted')).toBe(analysis.dottedForm)
      expect(inNotation(analysis, 'bare')).toBe(analysis.bareForm)
    })
  })

  describe('U/L and I/G bit decoding', () => {
    it('02: leading octet is locally administered, unicast', () => {
      const a = tool.analyze('02:00:00:00:00:00')
      expect(a.isLocallyAdministered).toBe(true)
      expect(isUniversallyAdministered(a)).toBe(false)
      expect(a.isMulticast).toBe(false)
      expect(isUnicast(a)).toBe(true)
    })

    it('01: leading octet is multicast, universally administered', () => {
      const a = tool.analyze('01:00:00:00:00:00')
      expect(a.isMulticast).toBe(true)
      expect(isUnicast(a)).toBe(false)
      expect(a.isLocallyAdministered).toBe(false)
      expect(isUniversallyAdministered(a)).toBe(true)
    })

    it('03: leading octet sets both bits', () => {
      const a = tool.analyze('03:00:00:00:00:00')
      expect(a.isLocallyAdministered).toBe(true)
      expect(a.isMulticast).toBe(true)
    })

    it('00: leading octet sets neither bit', () => {
      const a = tool.analyze('00:11:22:33:44:55')
      expect(a.isLocallyAdministered).toBe(false)
      expect(a.isMulticast).toBe(false)
    })

    it('a real vendor OUI (VMware, 00:50:56) is universally administered, unicast', () => {
      const a = tool.analyze('00:50:56:12:34:56')
      expect(a.isLocallyAdministered).toBe(false)
      expect(a.isMulticast).toBe(false)
    })

    it('broadcast address FF:FF:FF:FF:FF:FF is flagged and is both bits set', () => {
      const a = tool.analyze('FF:FF:FF:FF:FF:FF')
      expect(a.isBroadcast).toBe(true)
      expect(a.isLocallyAdministered).toBe(true)
      expect(a.isMulticast).toBe(true)
    })

    it('a non-broadcast address is not flagged as broadcast', () => {
      expect(tool.analyze('00:1A:2B:3C:4D:5E').isBroadcast).toBe(false)
    })
  })

  describe('vendor lookup', () => {
    it('hits a known virtualization prefix (VMware 00:50:56)', () => {
      const vendor = tool.lookupVendor('005056123456')
      expect(vendor).not.toBeUndefined()
      expect(vendor!.vendor).toBe('VMware')
      expect(vendor!.category).toBe('virtualization')
    })

    it('longest-prefix match: Docker (0242, 2-octet prefix) beats a miss', () => {
      const vendor = tool.lookupVendor('0242AC110002')
      expect(vendor).not.toBeUndefined()
      expect(vendor!.vendor).toBe('Docker')
      expect(vendor!.prefixHex).toBe('0242')
    })

    it('misses an OUI that is not in the curated table', () => {
      expect(tool.lookupVendor('AABBCC001122')).toBeUndefined()
    })

    it('analyze() surfaces the vendor lookup result inline', () => {
      const a = tool.analyze('00:0C:29:AA:BB:CC')
      expect(a.vendor).not.toBeUndefined()
      expect(a.vendor!.vendor).toBe('VMware')
    })

    it('analyze() leaves vendor undefined for an unlisted OUI', () => {
      const a = tool.analyze('AA:BB:CC:00:00:00')
      expect(a.vendor).toBeUndefined()
    })

    it('ouiPrefixDisplay renders colon-separated pairs, including odd-length prefixes', () => {
      const docker = { prefixHex: '0242', vendor: 'Docker', category: 'virtualization' as const }
      expect(ouiPrefixDisplay(docker)).toBe('02:42')
      const full = { prefixHex: '005056', vendor: 'VMware', category: 'virtualization' as const }
      expect(ouiPrefixDisplay(full)).toBe('00:50:56')
    })

    it('ouiDisplay on the analysis matches the colon form of the OUI', () => {
      const a = tool.analyze('00:50:56:12:34:56')
      expect(a.ouiHex).toBe('005056')
      expect(ouiDisplay(a)).toBe('00:50:56')
    })
  })

  describe('malformed input rejected', () => {
    it('empty string throws', () => {
      expect(() => tool.normalize('')).toThrow()
      expect(() => tool.normalize('   ')).toThrow()
    })

    it('non-hex characters throw', () => {
      expect(() => tool.normalize('ZZ:11:22:33:44:55')).toThrow()
      expect(() => tool.normalize('gg-11-22-33-44-55')).toThrow()
    })

    it('wrong digit count throws', () => {
      expect(() => tool.normalize('00:1A:2B:3C:4D')).toThrow() // 10 digits
      expect(() => tool.normalize('00:1A:2B:3C:4D:5E:6F')).toThrow() // 14 digits
    })

    it('analyze() propagates the same validation', () => {
      expect(() => tool.analyze('not-a-mac')).toThrow()
    })
  })

  describe('generation', () => {
    it('default options mint a locally-administered, unicast MAC', () => {
      const results = tool.generate({ count: 25 })
      expect(results).toHaveLength(25)
      for (const r of results) {
        expect(r.isLocallyAdministered).toBe(true)
        expect(r.isMulticast).toBe(false)
      }
    })

    it('locallyAdministered: false clears the U/L bit', () => {
      const results = tool.generate({ count: 25, locallyAdministered: false })
      for (const r of results) {
        expect(r.isLocallyAdministered).toBe(false)
      }
    })

    it('unicast: false sets the I/G bit (multicast)', () => {
      const results = tool.generate({ count: 25, unicast: false })
      for (const r of results) {
        expect(r.isMulticast).toBe(true)
      }
    })

    it('addresses across a batch are not all identical (randomness sanity check)', () => {
      const results = tool.generate({ count: 25 })
      const distinct = new Set(results.map((r) => r.normalizedHex))
      expect(distinct.size).toBeGreaterThan(1)
    })

    it('a vendor prefix pins the leading octets verbatim, ignoring U/L and unicast options', () => {
      const results = tool.generate({
        count: 10,
        vendorPrefixHex: '00:50:56',
        locallyAdministered: false,
        unicast: false,
      })
      for (const r of results) {
        expect(r.ouiHex).toBe('005056')
        expect(r.vendor?.vendor).toBe('VMware')
      }
    })

    it('a short (2-octet) vendor prefix pins only the leading octets given', () => {
      const results = tool.generate({ count: 5, vendorPrefixHex: '0242' })
      for (const r of results) {
        expect(r.normalizedHex.startsWith('0242')).toBe(true)
      }
    })

    it('count of 1 is allowed and yields exactly one address', () => {
      expect(tool.generate({ count: 1 })).toHaveLength(1)
    })

    it('count of 0 throws', () => {
      expect(() => tool.generate({ count: 0 })).toThrow()
    })

    it('count above 256 throws', () => {
      expect(() => tool.generate({ count: 257 })).toThrow()
    })

    it('count of exactly 256 is allowed', () => {
      expect(tool.generate({ count: 256 })).toHaveLength(256)
    })

    it('an odd-length vendor prefix throws', () => {
      expect(() => tool.generate({ vendorPrefixHex: '005' })).toThrow()
    })

    it('a non-hex vendor prefix throws', () => {
      expect(() => tool.generate({ vendorPrefixHex: 'ZZ' })).toThrow()
    })

    it('a vendor prefix longer than 5 octets throws', () => {
      expect(() => tool.generate({ vendorPrefixHex: '0011223344556677' })).toThrow()
    })
  })
})
