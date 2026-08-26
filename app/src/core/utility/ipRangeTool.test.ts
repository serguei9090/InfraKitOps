import { describe, expect, it } from 'vitest'
import { cidrOf, IpRangeTool, type CidrBlock } from './ipRangeTool'

describe('IpRangeTool', () => {
  const tool = new IpRangeTool()

  /**
   * Asserts that `blocks` exactly tile the inclusive range `startInt`..
   * `endInt`: sorted ascending, contiguous (no gaps), non-overlapping, and
   * the total of every block's addressCount equals the range size. This is
   * a structural check rather than an eyeball of the block list.
   */
  function expectExactTiling(blocks: CidrBlock[], startInt: number, endInt: number) {
    expect(blocks.length).toBeGreaterThan(0)

    const totalRangeSize = endInt - startInt + 1
    const summedSize = blocks.reduce((sum, b) => sum + b.addressCount, 0)
    expect(summedSize).toBe(totalRangeSize)

    expect(tool.parseIPv4(blocks[0].firstAddress)).toBe(startInt)
    expect(tool.parseIPv4(blocks[blocks.length - 1].lastAddress)).toBe(endInt)

    // Every block must be a valid, aligned power-of-two CIDR block whose
    // size matches its prefix length.
    for (const b of blocks) {
      expect(b.addressCount).toBe(2 ** (32 - b.prefixLength))
      const networkInt = tool.parseIPv4(b.networkAddress)
      expect(networkInt & (b.addressCount - 1)).toBe(0)
    }

    // Contiguity: each block's first address is exactly one past the
    // previous block's last address — no gap and no overlap possible.
    let expectedNext = startInt
    for (const b of blocks) {
      expect(tool.parseIPv4(b.firstAddress)).toBe(expectedNext)
      expectedNext = tool.parseIPv4(b.lastAddress) + 1
    }
    expect(expectedNext).toBe(endInt + 1)
  }

  describe('summarizeRange -> exact CIDR cover', () => {
    it('a range that is already exactly one CIDR block yields one block', () => {
      const result = tool.summarizeRange('192.168.1.0', '192.168.1.255')
      expect(result.blocks).toHaveLength(1)
      expect(cidrOf(result.blocks[0])).toBe('192.168.1.0/24')
      expect(result.totalAddresses).toBe(256)
      expectExactTiling(result.blocks, tool.parseIPv4('192.168.1.0'), tool.parseIPv4('192.168.1.255'))
    })

    it('a single address yields one /32 block', () => {
      const result = tool.summarizeRange('10.0.0.5', '10.0.0.5')
      expect(result.blocks).toHaveLength(1)
      expect(cidrOf(result.blocks[0])).toBe('10.0.0.5/32')
      expect(result.totalAddresses).toBe(1)
    })

    it('an unaligned/odd-sized range needs several blocks that tile exactly (no gaps, no overlap)', () => {
      const start = tool.parseIPv4('192.168.1.5')
      const end = tool.parseIPv4('192.168.1.10')
      const result = tool.summarizeRange('192.168.1.5', '192.168.1.10')

      expect(result.totalAddresses).toBe(6)
      expect(result.blocks.length).toBeGreaterThan(1)
      expectExactTiling(result.blocks, start, end)
    })

    it('a larger unaligned range across a /24 boundary tiles exactly', () => {
      const start = tool.parseIPv4('10.0.0.10')
      const end = tool.parseIPv4('10.0.3.100')
      const result = tool.summarizeRange('10.0.0.10', '10.0.3.100')

      expect(result.totalAddresses).toBe(end - start + 1)
      expectExactTiling(result.blocks, start, end)
    })

    it('a range starting at 0.0.0.0 with a small span still tiles exactly', () => {
      const start = tool.parseIPv4('0.0.0.0')
      const end = tool.parseIPv4('0.0.0.9')
      const result = tool.summarizeRange('0.0.0.0', '0.0.0.9')
      expectExactTiling(result.blocks, start, end)
    })

    it('blocks are returned in ascending address order', () => {
      const result = tool.summarizeRange('172.16.5.5', '172.16.5.40')
      for (let i = 1; i < result.blocks.length; i++) {
        expect(tool.parseIPv4(result.blocks[i].firstAddress)).toBeGreaterThan(
          tool.parseIPv4(result.blocks[i - 1].firstAddress),
        )
      }
    })

    it('start above end throws', () => {
      expect(() => tool.summarizeRange('10.0.0.10', '10.0.0.5')).toThrow()
    })

    it('a malformed start address throws', () => {
      expect(() => tool.summarizeRange('999.0.0.1', '10.0.0.5')).toThrow()
      expect(() => tool.summarizeRange('10.0.0', '10.0.0.5')).toThrow()
    })

    it('a malformed end address throws', () => {
      expect(() => tool.summarizeRange('10.0.0.1', 'not-an-ip')).toThrow()
    })
  })

  describe('CIDR -> range expansion', () => {
    it('expands a /24 to its network/first/last and count', () => {
      const block = tool.expandCidr('10.0.0.0/24')
      expect(block.networkAddress).toBe('10.0.0.0')
      expect(block.firstAddress).toBe('10.0.0.0')
      expect(block.lastAddress).toBe('10.0.0.255')
      expect(block.addressCount).toBe(256)
      expect(block.prefixLength).toBe(24)
    })

    it('a host part that is not zeroed is masked down to the network address', () => {
      const block = tool.expandCidr('192.168.1.37/24')
      expect(block.networkAddress).toBe('192.168.1.0')
      expect(block.firstAddress).toBe('192.168.1.0')
      expect(block.lastAddress).toBe('192.168.1.255')
    })

    it('a /32 covers exactly one address', () => {
      const block = tool.expandCidr('10.0.0.5/32')
      expect(block.firstAddress).toBe('10.0.0.5')
      expect(block.lastAddress).toBe('10.0.0.5')
      expect(block.addressCount).toBe(1)
    })

    it('a /0 covers the entire IPv4 space', () => {
      const block = tool.expandCidr('1.2.3.4/0')
      expect(block.networkAddress).toBe('0.0.0.0')
      expect(block.lastAddress).toBe('255.255.255.255')
      expect(block.addressCount).toBe(4294967296)
    })

    it('round-trips with summarizeRange: expanding a summarized block reproduces it', () => {
      const summarized = tool.summarizeRange('192.168.1.0', '192.168.1.255').blocks[0]
      const expanded = tool.expandCidr(cidrOf(summarized))
      expect(expanded).toEqual(summarized)
    })

    it('missing the "/" prefix throws', () => {
      expect(() => tool.expandCidr('10.0.0.0')).toThrow()
    })

    it('more than one "/" throws', () => {
      expect(() => tool.expandCidr('10.0.0.0/24/8')).toThrow()
    })

    it('a prefix length above 32 throws', () => {
      expect(() => tool.expandCidr('10.0.0.0/33')).toThrow()
    })

    it('a malformed address throws', () => {
      expect(() => tool.expandCidr('10.0.0.999/24')).toThrow()
    })
  })

  describe('IPv4 codec', () => {
    it('rejects an octet with a leading zero', () => {
      expect(() => tool.parseIPv4('10.0.0.01')).toThrow()
    })

    it('rejects an octet above 255', () => {
      expect(() => tool.parseIPv4('10.0.0.256')).toThrow()
    })

    it('rejects the wrong number of octets', () => {
      expect(() => tool.parseIPv4('10.0.0')).toThrow()
      expect(() => tool.parseIPv4('10.0.0.0.0')).toThrow()
    })

    it('parse/format round-trips', () => {
      expect(tool.formatIPv4(tool.parseIPv4('203.0.113.42'))).toBe('203.0.113.42')
    })
  })

  describe('IPv6 ULA generation', () => {
    it('generated prefix always starts with fd (L bit set)', () => {
      for (let i = 0; i < 100; i++) {
        const ula = tool.generateUla()
        expect(ula.prefix48.startsWith('fd')).toBe(true)
        expect(/^fd[0-9a-f]{2}:[0-9a-f]{1,4}:[0-9a-f]{1,4}::\/48$/.test(ula.prefix48)).toBe(true)
      }
    })

    it('the /64 subnet and example address share the /48 prefix', () => {
      const ula = tool.generateUla()
      const sitePrefix = ula.prefix48.split('::/48')[0]
      expect(ula.subnet64.startsWith(sitePrefix)).toBe(true)
      expect(ula.exampleAddress.startsWith(sitePrefix)).toBe(true)
      expect(ula.exampleAddress.endsWith('::1')).toBe(true)
    })

    it('an explicit subnetId is honored and reflected in subnet64', () => {
      const ula = tool.generateUla(0x00ab)
      expect(ula.subnetId).toBe(0x00ab)
      expect(ula.subnet64).toContain(':00ab::/64')
    })

    it('subnetId out of range throws', () => {
      expect(() => tool.generateUla(-1)).toThrow()
      expect(() => tool.generateUla(0x10000)).toThrow()
    })

    it('globalIdHex is 10 lowercase hex digits', () => {
      const ula = tool.generateUla()
      expect(/^[0-9a-f]{10}$/.test(ula.globalIdHex)).toBe(true)
    })

    it('repeated generation is not deterministic (randomness sanity check)', () => {
      const prefixes = new Set(Array.from({ length: 20 }, () => tool.generateUla().prefix48))
      expect(prefixes.size).toBeGreaterThan(1)
    })

    it('subnetOfUla carves the requested subnet out of a /48 prefix', () => {
      const ula = tool.generateUla()
      const carved = tool.subnetOfUla(ula.prefix48, 0x0007)
      expect(carved).toBe(ula.prefix48.replace('::/48', ':0007::/64'))
    })

    it('subnetOfUla rejects a malformed /48 prefix', () => {
      expect(() => tool.subnetOfUla('not-a-prefix', 1)).toThrow()
      expect(() => tool.subnetOfUla('2001:db8::/48', 1)).toThrow() // not fd/fc
    })

    it('subnetOfUla rejects an out-of-range subnetId', () => {
      const ula = tool.generateUla()
      expect(() => tool.subnetOfUla(ula.prefix48, -1)).toThrow()
      expect(() => tool.subnetOfUla(ula.prefix48, 0x10000)).toThrow()
    })
  })
})
