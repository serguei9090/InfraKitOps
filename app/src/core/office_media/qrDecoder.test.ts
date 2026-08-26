import QRCode from 'qrcode'
import { describe, expect, it } from 'vitest'
import { QrDecoder, formatLabel, isDecoded, parsePayload, payloadFields, payloadKindLabel } from './qrDecoder'
import { QrPayloadBuilder, type QrPayloadInput } from './qrPayloadBuilder'

// Vitest's default environment for this project is `node` (see
// app/vite.config.ts), which has neither `document`/`createImageBitmap` nor
// any other Canvas API. `QrDecoder.decodeImageBytes` (the browser-file-input
// entry point) therefore can't be exercised here — it needs an actual
// browser/webview to test end to end (see the screen's manual verification
// note in the phase report instead).
//
// `QrDecoder.decodePixels`, however, is plain RGBA-pixel-array logic with no
// Canvas dependency (that's *why* it was split out of `decodeImageBytes` —
// see qrDecoder.ts), so it can be driven directly here. To get real QR pixel
// data without any binary fixture file, this rasterizes the `qrcode`
// package's low-level module matrix (`QRCode.create`) into an RGBA buffer by
// hand — a clean round trip through the actual jsQR decoder with zero
// fixture files, just like the byte-string round trip below it.
function rasterizeQrMatrix(text: string, scale = 6, margin = 4): { data: Uint8ClampedArray; width: number; height: number } {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const size = qr.modules.size
  const dimension = (size + margin * 2) * scale
  const data = new Uint8ClampedArray(dimension * dimension * 4).fill(255) // opaque white
  for (let i = 3; i < data.length; i += 4) data[i] = 255 // alpha channel

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (qr.modules.get(row, col) === 0) continue // light module — leave white
      const px0 = (margin + col) * scale
      const py0 = (margin + row) * scale
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const idx = ((py0 + dy) * dimension + (px0 + dx)) * 4
          data[idx] = 0
          data[idx + 1] = 0
          data[idx + 2] = 0
          data[idx + 3] = 255
        }
      }
    }
  }

  return { data, width: dimension, height: dimension }
}

const decoder = new QrDecoder()
const builder = new QrPayloadBuilder()

describe('QrDecoder.decodePixels — round trip through a real QR symbol', () => {
  it('decodes plain text back out unchanged', () => {
    const { data, width, height } = rasterizeQrMatrix('https://example.com/path?x=1')
    const result = decoder.decodePixels(data, width, height)
    expect(result.status).toBe('decoded')
    expect(isDecoded(result)).toBe(true)
    expect(result.text).toBe('https://example.com/path?x=1')
    expect(result.format).toBe('qrCode')
    expect(formatLabel(result)).toBe('QR Code')
    expect(result.symbolVersion).toBeGreaterThan(0)
  })

  it('decodes a Wi-Fi payload built by QrPayloadBuilder and parses it back into structured fields', () => {
    const input: QrPayloadInput = { kind: 'wifiNetwork', ssid: 'MyHomeNetwork', password: 'sup3rSecret' }
    const payloadText = builder.execute(input)
    const { data, width, height } = rasterizeQrMatrix(payloadText)

    const result = decoder.decodePixels(data, width, height)
    expect(result.status).toBe('decoded')
    expect(result.text).toBe(payloadText)
    expect(result.payload).toEqual({
      kind: 'wifi',
      ssid: 'MyHomeNetwork',
      security: 'WPA',
      password: 'sup3rSecret',
      hidden: false,
    })
  })

  it('decodes a vCard payload built by QrPayloadBuilder and parses it back into structured fields', () => {
    const payloadText = builder.execute({
      kind: 'vCard',
      firstName: 'Ada',
      lastName: 'Lovelace',
      organization: 'Analytical Engines Ltd',
    })
    const { data, width, height } = rasterizeQrMatrix(payloadText)

    const result = decoder.decodePixels(data, width, height)
    expect(result.status).toBe('decoded')
    expect(result.payload).toMatchObject({
      kind: 'vCard',
      fullName: 'Ada Lovelace',
      organization: 'Analytical Engines Ltd',
    })
  })

  it('reports notFound for a blank (all-white) image', () => {
    const dimension = 200
    const data = new Uint8ClampedArray(dimension * dimension * 4).fill(255)
    const result = decoder.decodePixels(data, dimension, dimension)
    expect(result.status).toBe('notFound')
    expect(result.payload).toBeUndefined()
    expect(result.message).toBeTruthy()
  })

  it('reports notFound for an image too small to contain a QR code', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4).fill(255)
    const result = decoder.decodePixels(data, 4, 4)
    expect(result.status).toBe('notFound')
    expect(result.message).toContain('too small')
  })
})

describe('parsePayload — structured format detection on raw decoded text', () => {
  it('recognizes a WIFI: payload, including an escaped SSID/password', () => {
    const payload = parsePayload(String.raw`WIFI:T:WPA;S:Weird\;SSID\,\"Name\";P:p\\a\;s\,s\"word;H:true;;`)
    expect(payload).toEqual({
      kind: 'wifi',
      ssid: 'Weird;SSID,"Name"',
      security: 'WPA',
      password: 'p\\a;s,s"word',
      hidden: true,
    })
    expect(payloadKindLabel(payload)).toBe('Wi-Fi network')
    expect(payloadFields(payload).map((f) => f.label)).toEqual([
      'Network (SSID)',
      'Security',
      'Password',
      'Hidden network',
    ])
  })

  it('falls back to plain text for a WIFI: payload with no SSID', () => {
    const payload = parsePayload('WIFI:T:WPA;;')
    expect(payload.kind).toBe('plainText')
  })

  it('recognizes a tel: payload', () => {
    const payload = parsePayload('tel:+12125551212')
    expect(payload).toEqual({ kind: 'phone', number: '+12125551212' })
    expect(payloadKindLabel(payload)).toBe('Phone number')
  })

  it('recognizes an SMSTO: payload and keeps inner colons in the message', () => {
    const payload = parsePayload('SMSTO:5551212:ETA: 12:30, bring keys')
    expect(payload).toEqual({ kind: 'sms', number: '5551212', message: 'ETA: 12:30, bring keys' })
  })

  it('recognizes a mailto: payload with subject/body query params', () => {
    const payload = parsePayload('mailto:someone@example.com?subject=Mail%20from%20Our%20Site&body=Hi%20there')
    expect(payload).toEqual({
      kind: 'email',
      address: 'someone@example.com',
      subject: 'Mail from Our Site',
      body: 'Hi there',
    })
  })

  it('recognizes a BEGIN:VCARD payload built by QrPayloadBuilder', () => {
    const payloadText = builder.execute({
      kind: 'vCard',
      firstName: 'Sean',
      lastName: 'Owen',
      organization: 'Google',
      title: 'Engineer',
      phone: '+12125551212',
      email: 'srowen@example.com',
      url: 'https://example.com/sean',
      street: '76 9th Avenue',
      city: 'New York',
      region: 'NY',
      postalCode: '10011',
      country: 'USA',
    })
    const payload = parsePayload(payloadText)
    expect(payload).toEqual({
      kind: 'vCard',
      fullName: 'Sean Owen',
      organization: 'Google',
      title: 'Engineer',
      phone: '+12125551212',
      email: 'srowen@example.com',
      url: 'https://example.com/sean',
      address: '76 9th Avenue, New York, NY, 10011, USA',
    })
  })

  it('recognizes a BEGIN:VEVENT payload built by QrPayloadBuilder', () => {
    const start = new Date(Date.UTC(2018, 5, 1, 7))
    const end = new Date(Date.UTC(2018, 7, 31, 7))
    const payloadText = builder.execute({
      kind: 'calendarEvent',
      summary: 'Summer Vacation',
      location: 'Room 4',
      start,
      end,
    })
    const payload = parsePayload(payloadText)
    expect(payload).toEqual({
      kind: 'calendarEvent',
      summary: 'Summer Vacation',
      location: 'Room 4',
      description: '',
      start: '20180601T070000Z',
      end: '20180831T070000Z',
    })
  })

  it('recognizes a geo: payload with and without altitude', () => {
    expect(parsePayload('geo:40.71872,-73.98905')).toEqual({
      kind: 'geo',
      latitude: '40.71872',
      longitude: '-73.98905',
      altitudeMeters: null,
    })
    expect(parsePayload('geo:40.71872,-73.98905,100')).toEqual({
      kind: 'geo',
      latitude: '40.71872',
      longitude: '-73.98905',
      altitudeMeters: '100',
    })
  })

  it('recognizes http:// and https:// as web links', () => {
    expect(parsePayload('https://example.com')).toEqual({ kind: 'url', url: 'https://example.com' })
    expect(parsePayload('http://example.com')).toEqual({ kind: 'url', url: 'http://example.com' })
  })

  it('falls back to plain text for anything unrecognized', () => {
    expect(parsePayload('Just some plain text')).toEqual({ kind: 'plainText', text: 'Just some plain text' })
    expect(parsePayload('')).toEqual({ kind: 'plainText', text: '' })
  })

  it('falls back to plain text for a malformed geo: payload rather than throwing', () => {
    expect(parsePayload('geo:not-a-number,also-not')).toEqual({
      kind: 'plainText',
      text: 'geo:not-a-number,also-not',
    })
  })
})
