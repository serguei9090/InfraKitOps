import { describe, expect, it } from 'vitest'
import { QrPayloadBuilder, type QrPayloadInput } from './qrPayloadBuilder'

const builder = new QrPayloadBuilder()

describe('PlainTextQrInput', () => {
  it('passes text/URL payloads through unchanged', () => {
    const input: QrPayloadInput = { kind: 'plainText', text: 'https://example.com/path?x=1&y=2' }
    expect(builder.execute(input)).toBe('https://example.com/path?x=1&y=2')
  })

  it('passes arbitrary plain text through unchanged', () => {
    const input: QrPayloadInput = { kind: 'plainText', text: 'Just some plain text, with punctuation!' }
    expect(builder.execute(input)).toBe('Just some plain text, with punctuation!')
  })
})

describe('WifiNetworkQrInput', () => {
  it('builds a standard WPA payload', () => {
    const input: QrPayloadInput = { kind: 'wifiNetwork', ssid: 'MyHomeNetwork', password: 'sup3rSecret' }
    expect(builder.execute(input)).toBe('WIFI:T:WPA;S:MyHomeNetwork;P:sup3rSecret;H:false;;')
  })

  it('escapes special characters (; , " \\) in SSID and password', () => {
    const input: QrPayloadInput = {
      kind: 'wifiNetwork',
      ssid: 'Weird;SSID,"Name"',
      password: 'p\\a;s,s"word',
      security: 'wpa',
    }
    const payload = builder.execute(input)
    expect(payload).toBe('WIFI:T:WPA;S:Weird\\;SSID\\,\\"Name\\";P:p\\\\a\\;s\\,s\\"word;H:false;;')
  })

  it('escapes a literal backslash first so it is not double-escaped', () => {
    const input: QrPayloadInput = { kind: 'wifiNetwork', ssid: 'back\\slash' }
    const payload = builder.execute(input)
    expect(payload).toContain('S:back\\\\slash;')
  })

  it('nopass security omits the P: field entirely', () => {
    const input: QrPayloadInput = { kind: 'wifiNetwork', ssid: 'OpenNetwork', security: 'nopass' }
    const payload = builder.execute(input)
    expect(payload).toBe('WIFI:T:nopass;S:OpenNetwork;H:false;;')
    expect(payload).not.toContain('P:')
  })

  it('WEP security uses the WEP security code', () => {
    const input: QrPayloadInput = { kind: 'wifiNetwork', ssid: 'OldRouter', password: 'wepkey123', security: 'wep' }
    expect(builder.execute(input)).toBe('WIFI:T:WEP;S:OldRouter;P:wepkey123;H:false;;')
  })

  it('hidden network sets H:true', () => {
    const input: QrPayloadInput = { kind: 'wifiNetwork', ssid: 'HiddenNet', password: 'hunter2', hidden: true }
    expect(builder.execute(input)).toBe('WIFI:T:WPA;S:HiddenNet;P:hunter2;H:true;;')
  })

  it('rejects an empty SSID', () => {
    expect(() => builder.execute({ kind: 'wifiNetwork', ssid: '' })).toThrow()
  })
})

describe('PhoneNumberQrInput', () => {
  it('builds a tel: URI keeping the international + prefix', () => {
    expect(builder.execute({ kind: 'phoneNumber', number: '+1 (212) 555-1212' })).toBe('tel:+12125551212')
  })

  it('strips visual separators from a national number', () => {
    expect(builder.execute({ kind: 'phoneNumber', number: '0151 123-456.78' })).toBe('tel:015112345678')
  })

  it('rejects input with no digits', () => {
    expect(() => builder.execute({ kind: 'phoneNumber', number: 'not a number' })).toThrow()
  })
})

describe('SmsQrInput', () => {
  it('builds SMSTO:<number>:<message>', () => {
    expect(builder.execute({ kind: 'sms', number: '+1 800 555 1212', message: 'Hello there' })).toBe(
      'SMSTO:+18005551212:Hello there',
    )
  })

  it('leaves the message trailing colon-free but allows inner colons', () => {
    expect(builder.execute({ kind: 'sms', number: '5551212', message: 'ETA: 12:30, bring keys' })).toBe(
      'SMSTO:5551212:ETA: 12:30, bring keys',
    )
  })

  it('omits the message when empty, leaving a trailing colon', () => {
    expect(builder.execute({ kind: 'sms', number: '+15551212' })).toBe('SMSTO:+15551212:')
  })

  it('folds embedded newlines to spaces so the record stays intact', () => {
    expect(builder.execute({ kind: 'sms', number: '5551212', message: 'line one\r\nline two' })).toBe(
      'SMSTO:5551212:line one line two',
    )
  })

  it('rejects a number with no digits', () => {
    expect(() => builder.execute({ kind: 'sms', number: '' })).toThrow()
  })
})

describe('EmailQrInput', () => {
  it('builds a bare mailto: when no subject/body given', () => {
    expect(builder.execute({ kind: 'email', address: 'someone@example.com' })).toBe('mailto:someone@example.com')
  })

  it('percent-encodes spaces as %20 and & as %26 in subject and body', () => {
    const payload = builder.execute({
      kind: 'email',
      address: 'someone@example.com',
      subject: 'Mail from Our Site',
      body: 'Hi Bob & Alice, see you soon',
    })
    expect(payload).toBe(
      'mailto:someone@example.com?subject=Mail%20from%20Our%20Site&body=Hi%20Bob%20%26%20Alice%2C%20see%20you%20soon',
    )
    // RFC 6068 requires %20, never `+`, for a literal space.
    expect(payload).not.toContain('+')
  })

  it('percent-encodes query delimiters and a literal plus sign', () => {
    const payload = builder.execute({ kind: 'email', address: 'a@b.co', body: 'a=1?b#c+d' })
    expect(payload).toBe('mailto:a@b.co?body=a%3D1%3Fb%23c%2Bd')
  })

  it('emits only body when subject is empty', () => {
    expect(builder.execute({ kind: 'email', address: 'a@b.co', body: 'just a body' })).toBe(
      'mailto:a@b.co?body=just%20a%20body',
    )
  })

  it('rejects a malformed address', () => {
    for (const bad of ['nope', 'a@b', 'a b@c.com', 'a@@b.com', '']) {
      expect(() => builder.execute({ kind: 'email', address: bad }), `expected "${bad}" to be rejected`).toThrow()
    }
  })
})

describe('VCardQrInput', () => {
  it('builds a full vCard 3.0 record with CRLF line breaks', () => {
    const payload = builder.execute({
      kind: 'vCard',
      firstName: 'Sean',
      lastName: 'Owen',
      organization: 'Google',
      title: 'Engineer',
      phone: '+1 212-555-1212',
      email: 'srowen@example.com',
      url: 'https://example.com/sean',
      street: '76 9th Avenue',
      city: 'New York',
      region: 'NY',
      postalCode: '10011',
      country: 'USA',
    })

    expect(payload).toBe(
      'BEGIN:VCARD\r\n' +
        'VERSION:3.0\r\n' +
        'N:Owen;Sean;;;\r\n' +
        'FN:Sean Owen\r\n' +
        'ORG:Google\r\n' +
        'TITLE:Engineer\r\n' +
        'TEL;TYPE=CELL,VOICE:+12125551212\r\n' +
        'EMAIL;TYPE=INTERNET:srowen@example.com\r\n' +
        'URL:https://example.com/sean\r\n' +
        'ADR;TYPE=HOME:;;76 9th Avenue;New York;NY;10011;USA\r\n' +
        'END:VCARD',
    )
  })

  it('omits every optional property that is blank', () => {
    const payload = builder.execute({ kind: 'vCard', firstName: 'Ada', lastName: 'Lovelace' })
    expect(payload).toBe('BEGIN:VCARD\r\nVERSION:3.0\r\nN:Lovelace;Ada;;;\r\nFN:Ada Lovelace\r\nEND:VCARD')
    expect(payload).not.toContain('ADR')
    expect(payload).not.toContain('TEL')
  })

  it('escapes commas and semicolons inside a structured component', () => {
    const payload = builder.execute({
      kind: 'vCard',
      firstName: 'Ann',
      lastName: 'Smith-Jones',
      organization: 'Acme, Inc.; R&D Division',
      street: '1 Main St, Apt; 4',
    })
    expect(payload).toContain('ORG:Acme\\, Inc.\\; R&D Division')
    expect(payload).toContain('ADR;TYPE=HOME:;;1 Main St\\, Apt\\; 4;;;;')
  })

  it('escapes a literal backslash first so it is not double-escaped', () => {
    const payload = builder.execute({ kind: 'vCard', firstName: 'A\\B', lastName: 'C' })
    expect(payload).toContain('N:C;A\\\\B;;;')
  })

  it('escapes newlines in a text value as the two-character \\n', () => {
    const payload = builder.execute({ kind: 'vCard', firstName: 'Ann', title: 'Head of\r\nEverything' })
    expect(payload).toContain('TITLE:Head of\\nEverything')
    // The escape is literal text, not a real line break.
    expect(payload.split('\r\n')).not.toContain('Everything')
  })

  it('leaves colons unescaped so URL values stay usable', () => {
    const payload = builder.execute({ kind: 'vCard', firstName: 'Ann', url: 'https://a.example/x' })
    expect(payload).toContain('URL:https://a.example/x')
  })

  it('emits FN with only the name part that was supplied', () => {
    const payload = builder.execute({ kind: 'vCard', lastName: 'Cher' })
    expect(payload).toContain('N:Cher;;;;')
    expect(payload).toContain('FN:Cher')
  })

  it('rejects a card with no name at all', () => {
    expect(() => builder.execute({ kind: 'vCard', organization: 'Acme' })).toThrow()
  })

  it('rejects a malformed contact email', () => {
    expect(() => builder.execute({ kind: 'vCard', firstName: 'Ann', email: 'not-an-email' })).toThrow()
  })
})

describe('GeoLocationQrInput', () => {
  it('builds a geo: URI with trailing zeros trimmed', () => {
    expect(builder.execute({ kind: 'geoLocation', latitude: 40.71872, longitude: -73.98905 })).toBe(
      'geo:40.71872,-73.98905',
    )
  })

  it('appends altitude as a third component when supplied', () => {
    expect(
      builder.execute({ kind: 'geoLocation', latitude: 40.71872, longitude: -73.98905, altitudeMeters: 100 }),
    ).toBe('geo:40.71872,-73.98905,100')
  })

  it('renders whole degrees without a decimal point', () => {
    expect(builder.execute({ kind: 'geoLocation', latitude: 40, longitude: -73 })).toBe('geo:40,-73')
  })

  it('never emits exponent notation for tiny values', () => {
    const payload = builder.execute({ kind: 'geoLocation', latitude: 0.0000001, longitude: 0 })
    expect(payload.slice('geo:'.length)).not.toContain('e')
    expect(payload).toBe('geo:0,0')
  })

  it('rejects out-of-range latitude and longitude', () => {
    expect(() => builder.execute({ kind: 'geoLocation', latitude: 91, longitude: 0 })).toThrow()
    expect(() => builder.execute({ kind: 'geoLocation', latitude: 0, longitude: -181 })).toThrow()
  })

  it('accepts the exact range boundaries', () => {
    expect(builder.execute({ kind: 'geoLocation', latitude: -90, longitude: 180 })).toBe('geo:-90,180')
  })
})

describe('CalendarEventQrInput', () => {
  const start = new Date(Date.UTC(2018, 5, 1, 7))
  const end = new Date(Date.UTC(2018, 7, 31, 7))

  it('builds a VEVENT block with UTC DATE-TIME stamps', () => {
    const payload = builder.execute({ kind: 'calendarEvent', summary: 'Summer Vacation', start, end })
    expect(payload).toBe(
      'BEGIN:VEVENT\r\n' +
        'SUMMARY:Summer Vacation\r\n' +
        'DTSTART:20180601T070000Z\r\n' +
        'DTEND:20180831T070000Z\r\n' +
        'END:VEVENT',
    )
  })

  it('converts a local DateTime to UTC before formatting', () => {
    const instant = new Date(Date.UTC(2026, 0, 2, 3, 4, 5))
    const payload = builder.execute({ kind: 'calendarEvent', summary: 'Standup', start: instant, end: instant })
    expect(payload).toContain('DTSTART:20260102T030405Z')
    expect(payload).toContain('DTEND:20260102T030405Z')
  })

  it('zero-pads every component of the timestamp', () => {
    const instant = new Date(Date.UTC(2026, 0, 2, 3, 4, 5))
    const payload = builder.execute({ kind: 'calendarEvent', summary: 'x', start: instant, end: instant })
    expect(payload).toContain('DTSTART:20260102T030405Z')
  })

  it('includes location and description when supplied', () => {
    const payload = builder.execute({
      kind: 'calendarEvent',
      summary: 'Kickoff',
      location: 'Room 4',
      description: 'Bring notes',
      start,
      end,
    })
    expect(payload).toContain('LOCATION:Room 4')
    expect(payload).toContain('DESCRIPTION:Bring notes')
  })

  it('escapes commas, semicolons, backslashes and newlines in TEXT', () => {
    const payload = builder.execute({
      kind: 'calendarEvent',
      summary: 'Q3 review, part 2; final \\ draft',
      location: 'Bldg A, Floor 3',
      description: 'Agenda:\nintro, then Q&A',
      start,
      end,
    })
    expect(payload).toContain('SUMMARY:Q3 review\\, part 2\\; final \\\\ draft')
    expect(payload).toContain('LOCATION:Bldg A\\, Floor 3')
    expect(payload).toContain('DESCRIPTION:Agenda:\\nintro\\, then Q&A')
    // Colons stay unescaped — RFC 5545 TEXT does not escape them.
    expect(payload).not.toContain('Agenda\\:')
  })

  it('rejects an empty summary', () => {
    expect(() => builder.execute({ kind: 'calendarEvent', summary: '   ', start, end })).toThrow()
  })

  it('rejects an end that precedes the start', () => {
    expect(() => builder.execute({ kind: 'calendarEvent', summary: 'Backwards', start: end, end: start })).toThrow()
  })
})
