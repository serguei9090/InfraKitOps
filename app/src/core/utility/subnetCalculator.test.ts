import { describe, expect, it } from 'vitest'
import { SubnetCalculator } from './subnetCalculator'

describe('SubnetCalculator IPv4', () => {
  const calculator = new SubnetCalculator()

  it('192.168.1.0/24 -> classic class-C subnet', () => {
    const result = calculator.execute({ cidr: '192.168.1.0/24' })

    expect(result.version).toBe('v4')
    expect(result.networkAddress).toBe('192.168.1.0')
    expect(result.broadcastAddress).toBe('192.168.1.255')
    expect(result.subnetMask).toBe('255.255.255.0')
    expect(result.wildcardMask).toBe('0.0.0.255')
    expect(result.firstUsableAddress).toBe('192.168.1.1')
    expect(result.lastUsableAddress).toBe('192.168.1.254')
    expect(result.usableHostCount).toBe(254)
    expect(result.totalAddressCount).toBe(256n)
  })

  it('10.0.0.0/8 -> classic class-A subnet', () => {
    const result = calculator.execute({ cidr: '10.0.0.0/8' })

    expect(result.networkAddress).toBe('10.0.0.0')
    expect(result.broadcastAddress).toBe('10.255.255.255')
    expect(result.subnetMask).toBe('255.0.0.0')
    expect(result.usableHostCount).toBe(16777214)
    expect(result.totalAddressCount).toBe(16777216n)
  })

  it('10.0.0.0/22 -> multi-octet boundary subnet', () => {
    const result = calculator.execute({ cidr: '10.0.0.0/22' })

    expect(result.networkAddress).toBe('10.0.0.0')
    expect(result.broadcastAddress).toBe('10.0.3.255')
    expect(result.subnetMask).toBe('255.255.252.0')
    expect(result.wildcardMask).toBe('0.0.3.255')
    expect(result.usableHostCount).toBe(1022)
  })

  it('accepts a non-aligned host address and derives the network', () => {
    const result = calculator.execute({ cidr: '192.168.1.130/24' })

    expect(result.networkAddress).toBe('192.168.1.0')
    expect(result.broadcastAddress).toBe('192.168.1.255')
  })

  it('/31 point-to-point link has 2 usable addresses, no broadcast concept', () => {
    const result = calculator.execute({ cidr: '192.168.1.0/31' })

    expect(result.usableHostCount).toBe(2)
    expect(result.firstUsableAddress).toBe('192.168.1.0')
    expect(result.lastUsableAddress).toBe('192.168.1.1')
  })

  it('/32 host route has exactly 1 usable address', () => {
    const result = calculator.execute({ cidr: '192.168.1.5/32' })

    expect(result.usableHostCount).toBe(1)
    expect(result.firstUsableAddress).toBe('192.168.1.5')
    expect(result.lastUsableAddress).toBe('192.168.1.5')
    expect(result.broadcastAddress).toBe('192.168.1.5')
  })

  it('/0 covers the entire IPv4 address space', () => {
    const result = calculator.execute({ cidr: '0.0.0.0/0' })

    expect(result.networkAddress).toBe('0.0.0.0')
    expect(result.broadcastAddress).toBe('255.255.255.255')
    expect(result.subnetMask).toBe('0.0.0.0')
    expect(result.wildcardMask).toBe('255.255.255.255')
  })
})

describe('SubnetCalculator IPv6', () => {
  const calculator = new SubnetCalculator()

  it('2001:db8::/64 -> compressed network and full 64-bit host range', () => {
    const result = calculator.execute({ cidr: '2001:db8::/64' })

    expect(result.version).toBe('v6')
    expect(result.prefixLength).toBe(64)
    expect(result.networkAddress).toBe('2001:db8::')
    expect(result.firstAddress).toBe('2001:db8::')
    expect(result.lastAddress).toBe('2001:db8::ffff:ffff:ffff:ffff')
    expect(result.totalAddressCount).toBe(2n ** 64n)
    // IPv4-only fields must stay undefined for an IPv6 result.
    expect(result.broadcastAddress).toBeUndefined()
    expect(result.subnetMask).toBeUndefined()
    expect(result.usableHostCount).toBeUndefined()
  })

  it('::1/128 -> loopback host route', () => {
    const result = calculator.execute({ cidr: '::1/128' })

    expect(result.networkAddress).toBe('::1')
    expect(result.firstAddress).toBe('::1')
    expect(result.lastAddress).toBe('::1')
    expect(result.totalAddressCount).toBe(1n)
  })

  it('prefers the leftmost longest zero run when compressing', () => {
    const result = calculator.execute({ cidr: '2001:db8:0:0:1:0:0:1/128' })

    expect(result.networkAddress).toBe('2001:db8::1:0:0:1')
  })

  it('::/0 covers the entire IPv6 address space', () => {
    const result = calculator.execute({ cidr: '::/0' })

    expect(result.networkAddress).toBe('::')
    expect(result.lastAddress).toBe('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')
    expect(result.totalAddressCount).toBe(2n ** 128n)
  })
})

describe('SubnetCalculator invalid input', () => {
  const calculator = new SubnetCalculator()

  it('rejects an empty input', () => {
    expect(() => calculator.execute({ cidr: '' })).toThrow()
  })

  it('rejects a missing "/" prefix length', () => {
    expect(() => calculator.execute({ cidr: '192.168.1.0' })).toThrow()
  })

  it('rejects an out-of-range IPv4 prefix length (/33)', () => {
    expect(() => calculator.execute({ cidr: '192.168.1.0/33' })).toThrow()
  })

  it('rejects an out-of-range IPv6 prefix length (/129)', () => {
    expect(() => calculator.execute({ cidr: '2001:db8::/129' })).toThrow()
  })

  it('rejects an IPv4 address with the wrong octet count', () => {
    expect(() => calculator.execute({ cidr: '192.168.1/24' })).toThrow()
  })

  it('rejects an out-of-range IPv4 octet', () => {
    expect(() => calculator.execute({ cidr: '192.168.1.256/24' })).toThrow()
  })

  it('rejects an IPv6 address with an invalid hex group', () => {
    expect(() => calculator.execute({ cidr: 'gggg::1/64' })).toThrow()
  })

  it('rejects an IPv6 address with more than one "::"', () => {
    expect(() => calculator.execute({ cidr: '2001::db8::1/64' })).toThrow()
  })

  it('rejects an unrecognizable address format', () => {
    expect(() => calculator.execute({ cidr: 'not-an-ip/24' })).toThrow()
  })
})
