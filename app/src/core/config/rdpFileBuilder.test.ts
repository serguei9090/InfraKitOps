import { describe, expect, it } from 'vitest'
import {
  RDP_GROUP_ORDER,
  RDP_OPTION_CATALOG,
  RdpFileBuilder,
  rdpHardenedBaseline,
  rdpLanBaseline,
  rdpOptionFor,
  rdpOptionsOrdered,
} from './rdpFileBuilder'

const builder = new RdpFileBuilder()

/** File body without the leading `#` header comment lines. */
function body(text: string): string {
  return text
    .split('\r\n')
    .filter((l) => !l.startsWith('#'))
    .join('\n')
    .trim()
}

describe('RdpFileBuilder', () => {
  it('always emits full address first, then selected properties in catalog order', () => {
    const r = builder.execute({
      address: 'jump.example.com:3390',
      values: {
        'screen mode id': '2',
        username: 'CONTOSO\\jdoe',
        redirectclipboard: '0',
        'server port': '3390',
      },
    })
    expect(body(r.fileText)).toBe(
      ['full address:s:jump.example.com:3390', 'server port:i:3390', 'username:s:CONTOSO\\jdoe', 'screen mode id:i:2', 'redirectclipboard:i:0'].join('\n'),
    )
  })

  it('uses CRLF line endings and a trailing CRLF', () => {
    const r = builder.execute({ address: 'host', includeHeader: false })
    expect(r.fileText).toBe('full address:s:host\r\n')
  })

  it('suggests a .rdp filename, adding the extension when missing', () => {
    expect(builder.execute({ address: 'h' }).suggestedFileName).toBe('connection.rdp')
    expect(builder.execute({ address: 'h', fileName: 'prod-jump' }).suggestedFileName).toBe('prod-jump.rdp')
    expect(builder.execute({ address: 'h', fileName: 'prod.RDP' }).suggestedFileName).toBe('prod.rdp')
  })

  it('rejects an empty address', () => {
    expect(() => builder.execute({ address: '   ' })).toThrow(/host address is required/i)
  })

  it('rejects an unknown property', () => {
    expect(() => builder.execute({ address: 'h', values: { bogusprop: '1' } })).toThrow(/not a known .rdp property/i)
  })

  it('coerces yes/no/true/false to 1/0 for boolean properties', () => {
    const r = builder.execute({ address: 'h', includeHeader: false, values: { compression: 'yes', 'disable themes': 'false' } })
    expect(body(r.fileText)).toContain('compression:i:1')
    expect(body(r.fileText)).toContain('disable themes:i:0')
  })

  it('rejects a boolean value that is not 0/1/yes/no', () => {
    expect(() => builder.execute({ address: 'h', values: { compression: '2' } })).toThrow(/must be 0 or 1/i)
  })

  it('rejects a choice value outside the allowed set', () => {
    expect(() => builder.execute({ address: 'h', values: { 'screen mode id': '3' } })).toThrow(/must be one of/i)
  })

  it('range-checks integer properties', () => {
    expect(() => builder.execute({ address: 'h', values: { 'server port': '70000' } })).toThrow(/at most 65535/i)
    expect(() => builder.execute({ address: 'h', values: { 'autoreconnect max retries': '-1' } })).toThrow(/at least 0/i)
  })

  it('rejects multi-line values', () => {
    expect(() => builder.execute({ address: 'h', values: { username: 'a\nb' } })).toThrow(/single line/i)
    expect(() => builder.execute({ address: 'a\nb' })).toThrow(/single line/i)
  })

  it('keeps an explicitly-empty string property (redirect nothing)', () => {
    const r = builder.execute({ address: 'h', includeHeader: false, values: { drivestoredirect: '' } })
    expect(body(r.fileText)).toContain('drivestoredirect:s:')
  })

  describe('header', () => {
    it('is on by default and mentions cmdkey, not a stored password', () => {
      const t = builder.execute({ address: 'h' }).fileText
      expect(t).toMatch(/^# Windows Remote Desktop connection file/)
      expect(t).toContain('cmdkey /generic:TERMSRV/')
      expect(t).not.toContain('password 51')
    })

    it('lockGuidance adds attrib +R and rdpsign instructions', () => {
      const t = builder.execute({ address: 'h', lockGuidance: true }).fileText
      expect(t).toContain('attrib +R connection.rdp')
      expect(t).toContain('rdpsign.exe /sha256')
      expect(t).toContain('trusted .rdp publishers')
    })

    it('can be suppressed', () => {
      expect(builder.execute({ address: 'h', includeHeader: false }).fileText).not.toContain('#')
    })
  })

  describe('warnings (never block generation)', () => {
    it('flags NLA disabled', () => {
      const r = builder.execute({ address: 'h', values: { enablecredsspsupport: '0' } })
      expect(r.warnings.join(' ')).toMatch(/Network Level Authentication/i)
      expect(r.fileText).toContain('enablecredsspsupport:i:0')
    })

    it('flags authentication level 0 / 3', () => {
      expect(builder.execute({ address: 'h', values: { 'authentication level': '0' } }).warnings.join(' ')).toMatch(/spoofed/i)
      expect(builder.execute({ address: 'h', values: { 'authentication level': '3' } }).warnings.join(' ')).toMatch(/spoofed/i)
    })

    it('flags drivestoredirect:*', () => {
      expect(builder.execute({ address: 'h', values: { drivestoredirect: '*' } }).warnings.join(' ')).toMatch(/every local drive/i)
    })

    it('flags selectedmonitors without use multimon', () => {
      expect(builder.execute({ address: 'h', values: { selectedmonitors: '0,1' } }).warnings.join(' ')).toMatch(/use multimon/i)
    })

    it('flags remoteapplicationmode with no program', () => {
      expect(builder.execute({ address: 'h', values: { remoteapplicationmode: '1' } }).warnings.join(' ')).toMatch(/nothing will launch/i)
    })
  })

  describe('presets', () => {
    it('hardened baseline turns redirection off and keeps NLA on, and every value validates', () => {
      const preset = rdpHardenedBaseline()
      expect(preset.redirectclipboard).toBe('0')
      expect(preset.enablecredsspsupport).toBe('1')
      expect(preset['authentication level']).toBe('1')
      expect(preset.audiomode).toBe('2')
      const r = builder.execute({ address: 'h', values: preset })
      expect(r.fileText).toContain('redirectclipboard:i:0')
    })

    it('LAN baseline enables the rich experience, and every value validates', () => {
      const preset = rdpLanBaseline()
      expect(preset['connection type']).toBe('6')
      expect(preset.compression).toBe('1')
      expect(() => builder.execute({ address: 'h', values: preset })).not.toThrow()
    })
  })

  describe('catalog integrity', () => {
    it('every option has a non-empty key, description, and known group', () => {
      for (const o of RDP_OPTION_CATALOG) {
        expect(o.key.trim().length).toBeGreaterThan(0)
        expect(o.description.trim().length).toBeGreaterThan(0)
        expect(RDP_GROUP_ORDER).toContain(o.group)
      }
    })

    it('option keys are unique', () => {
      const keys = RDP_OPTION_CATALOG.map((o) => o.key)
      expect(new Set(keys).size).toBe(keys.length)
    })

    it('choice options carry at least two choices; boolean/integer carry none', () => {
      for (const o of RDP_OPTION_CATALOG) {
        if (o.kind === 'choice') expect((o.choices ?? []).length).toBeGreaterThanOrEqual(2)
        else expect(o.choices).toBeUndefined()
      }
    })

    it('rdpOptionsOrdered covers the whole catalog and follows group order', () => {
      const ordered = rdpOptionsOrdered()
      expect(ordered.length).toBe(RDP_OPTION_CATALOG.length)
      const firstIndexOfGroup = RDP_GROUP_ORDER.map((g) => ordered.findIndex((o) => o.group === g)).filter((i) => i >= 0)
      expect(firstIndexOfGroup).toEqual([...firstIndexOfGroup].sort((a, b) => a - b))
    })

    it('rdpOptionFor round-trips', () => {
      expect(rdpOptionFor('screen mode id')?.kind).toBe('choice')
      expect(rdpOptionFor('nope')).toBeUndefined()
    })

    it('has genuine breadth (40+ properties across every group)', () => {
      expect(RDP_OPTION_CATALOG.length).toBeGreaterThanOrEqual(40)
      for (const g of RDP_GROUP_ORDER) {
        expect(RDP_OPTION_CATALOG.some((o) => o.group === g)).toBe(true)
      }
    })
  })
})
