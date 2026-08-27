import { describe, expect, it } from 'vitest'
import { parseHostRange } from './hostRange'

describe('parseHostRange — single values', () => {
  it('single IPv4', () => {
    expect(parseHostRange('192.168.0.1').addresses).toEqual(['192.168.0.1'])
  })

  it('single IPv6 is kept as-is', () => {
    const r = parseHostRange('2001:db8::1')
    expect(r.addresses).toEqual(['2001:db8::1'])
    expect(r.errors).toHaveLength(0)
  })

  it('bare hostname goes to hostnames[] for backend resolution', () => {
    const r = parseHostRange('server-01.example.net')
    expect(r.hostnames).toEqual(['server-01.example.net'])
    expect(r.addresses).toHaveLength(0)
  })

  it('hostname/prefix goes to hostnameSubnets[]', () => {
    const r = parseHostRange('example.com/24')
    expect(r.hostnameSubnets).toEqual([{ host: 'example.com', prefixLength: 24 }])
  })
})

describe('parseHostRange — separators & de-dup', () => {
  it('splits on ";" and newlines and de-dupes', () => {
    const r = parseHostRange('192.168.0.1; 192.168.0.2\n192.168.0.1')
    expect(r.addresses).toEqual(['192.168.0.1', '192.168.0.2'])
  })

  it('sorts numerically, IPv4 before IPv6', () => {
    const r = parseHostRange('192.168.0.10; 192.168.0.2; ::1')
    expect(r.addresses).toEqual(['192.168.0.2', '192.168.0.10', '::1'])
  })
})

describe('parseHostRange — CIDR & mask', () => {
  it('/30 expands to all 4 addresses incl. network and broadcast', () => {
    const r = parseHostRange('192.168.1.0/30')
    expect(r.addresses).toEqual(['192.168.1.0', '192.168.1.1', '192.168.1.2', '192.168.1.3'])
  })

  it('/24 expands to 256 addresses', () => {
    expect(parseHostRange('10.0.0.0/24').addresses).toHaveLength(256)
  })

  it('non-aligned host address is snapped to its network', () => {
    const r = parseHostRange('192.168.1.130/30')
    expect(r.addresses).toEqual(['192.168.1.128', '192.168.1.129', '192.168.1.130', '192.168.1.131'])
  })

  it('subnet mask form equals the prefix form', () => {
    expect(parseHostRange('192.168.1.0/255.255.255.252').addresses).toEqual(
      parseHostRange('192.168.1.0/30').addresses,
    )
  })

  it('rejects a non-contiguous mask', () => {
    expect(parseHostRange('192.168.1.0/255.0.255.0').errors[0].message).toMatch(/contiguous/)
  })

  it('rejects an out-of-range prefix', () => {
    expect(parseHostRange('192.168.1.0/33').errors).toHaveLength(1)
  })

  it('IPv6 CIDR is rejected as non-expandable', () => {
    expect(parseHostRange('2001:db8::/64').errors[0].message).toMatch(/IPv6/)
  })
})

describe('parseHostRange — dash ranges', () => {
  it('short last-octet range', () => {
    const r = parseHostRange('192.168.0.1-4')
    expect(r.addresses).toEqual(['192.168.0.1', '192.168.0.2', '192.168.0.3', '192.168.0.4'])
  })

  it('full range with spaces', () => {
    const r = parseHostRange('192.168.0.254 - 192.168.1.1')
    expect(r.addresses).toEqual(['192.168.0.254', '192.168.0.255', '192.168.1.0', '192.168.1.1'])
  })

  it('full range without spaces', () => {
    expect(parseHostRange('10.0.0.1-10.0.0.3').addresses).toEqual(['10.0.0.1', '10.0.0.2', '10.0.0.3'])
  })

  it('reversed range is an error', () => {
    expect(parseHostRange('192.168.0.10-2').errors).toHaveLength(1)
  })
})

describe('parseHostRange — octet patterns', () => {
  it('range in one octet', () => {
    const r = parseHostRange('192.168.[1-3].1')
    expect(r.addresses).toEqual(['192.168.1.1', '192.168.2.1', '192.168.3.1'])
  })

  it('list in one octet', () => {
    const r = parseHostRange('192.168.[1,5,10].1')
    expect(r.addresses).toEqual(['192.168.1.1', '192.168.5.1', '192.168.10.1'])
  })

  it('mixed list+range across two octets (reference example)', () => {
    const r = parseHostRange('10.0.[0-9,20].[1-2]')
    expect(r.addresses).toHaveLength(11 * 2)
    expect(r.addresses).toContain('10.0.0.1')
    expect(r.addresses).toContain('10.0.9.2')
    expect(r.addresses).toContain('10.0.20.1')
    expect(r.addresses).toContain('10.0.20.2')
  })

  it('rejects a reversed bracket range', () => {
    expect(parseHostRange('192.168.[10-2].1').errors).toHaveLength(1)
  })
})

describe('parseHostRange — limits & errors', () => {
  it('respects maxAddresses and flags truncation', () => {
    const r = parseHostRange('10.0.0.0/16', { maxAddresses: 100 })
    expect(r.addresses).toHaveLength(100)
    expect(r.truncated).toBe(true)
  })

  it('collects per-entry errors without dropping the good entries', () => {
    const r = parseHostRange('192.168.0.1; not-valid!!; 192.168.0.2')
    expect(r.addresses).toEqual(['192.168.0.1', '192.168.0.2'])
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].entry).toBe('not-valid!!')
  })

  it('rejects an octet above 255', () => {
    expect(parseHostRange('192.168.0.256').errors).toHaveLength(1)
  })
})
