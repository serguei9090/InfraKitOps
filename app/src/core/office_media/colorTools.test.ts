import { describe, expect, it } from 'vitest'
import {
  COLOR_BLINDNESS_TYPES,
  ColorBlindnessSimulator,
  hexToRgb,
  hslToRgb,
  rgbEquals,
  rgbToHex,
  rgbToHsl,
  type RgbColor,
} from './colorTools'

function luminance(c: RgbColor): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

describe('hexToRgb / rgbToHex', () => {
  it('parses 6-digit hex', () => {
    expect(hexToRgb('#FF0000')).toEqual({ r: 255, g: 0, b: 0 })
    expect(hexToRgb('00FF00')).toEqual({ r: 0, g: 255, b: 0 })
    expect(hexToRgb('#0000ff')).toEqual({ r: 0, g: 0, b: 255 })
  })

  it('parses 3-digit shorthand hex', () => {
    expect(hexToRgb('#F00')).toEqual({ r: 255, g: 0, b: 0 })
    expect(hexToRgb('0F0')).toEqual({ r: 0, g: 255, b: 0 })
  })

  it('formats rgb back to uppercase 6-digit hex', () => {
    expect(rgbToHex({ r: 255, g: 0, b: 0 })).toBe('#FF0000')
    expect(rgbToHex({ r: 0, g: 128, b: 255 })).toBe('#0080FF')
  })

  it('rejects invalid hex strings', () => {
    expect(() => hexToRgb('not-a-color')).toThrow()
    expect(() => hexToRgb('#12345')).toThrow()
  })
})

describe('rgb <-> hsl round trip for known colors', () => {
  it('#FF0000 == rgb(255,0,0) == hsl(0, 100%, 50%)', () => {
    const rgb = hexToRgb('#FF0000')
    expect(rgb).toEqual({ r: 255, g: 0, b: 0 })

    const hsl = rgbToHsl(rgb)
    expect(hsl.h).toBeCloseTo(0, 2)
    expect(hsl.s).toBeCloseTo(100, 2)
    expect(hsl.l).toBeCloseTo(50, 2)

    expect(hslToRgb(hsl)).toEqual(rgb)
  })

  it('#00FF00 == hsl(120, 100%, 50%)', () => {
    const rgb = hexToRgb('#00FF00')
    const hsl = rgbToHsl(rgb)
    expect(hsl.h).toBeCloseTo(120, 2)
    expect(hsl.s).toBeCloseTo(100, 2)
    expect(hsl.l).toBeCloseTo(50, 2)
    expect(hslToRgb(hsl)).toEqual(rgb)
  })

  it('#0000FF == hsl(240, 100%, 50%)', () => {
    const rgb = hexToRgb('#0000FF')
    const hsl = rgbToHsl(rgb)
    expect(hsl.h).toBeCloseTo(240, 2)
    expect(hsl.s).toBeCloseTo(100, 2)
    expect(hsl.l).toBeCloseTo(50, 2)
    expect(hslToRgb(hsl)).toEqual(rgb)
  })

  it('#FFFFFF == hsl(_, 0%, 100%) and #000000 == hsl(_, 0%, 0%)', () => {
    const white = rgbToHsl(hexToRgb('#FFFFFF'))
    expect(white.s).toBeCloseTo(0, 2)
    expect(white.l).toBeCloseTo(100, 2)

    const black = rgbToHsl(hexToRgb('#000000'))
    expect(black.s).toBeCloseTo(0, 2)
    expect(black.l).toBeCloseTo(0, 2)
  })

  it('round trip is stable for an arbitrary color (#3C7DBF)', () => {
    const rgb = hexToRgb('#3C7DBF')
    const hsl = rgbToHsl(rgb)
    const back = hslToRgb(hsl)
    expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(1)
    expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(1)
    expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(1)
  })
})

describe('ColorBlindnessSimulator', () => {
  const simulator = new ColorBlindnessSimulator()
  const red: RgbColor = { r: 255, g: 0, b: 0 }

  it('execute returns a result for all three simulation types', () => {
    const result = simulator.execute(red)
    for (const type of COLOR_BLINDNESS_TYPES) expect(result[type]).toBeDefined()
  })

  it('produces different output than input for a saturated color', () => {
    const result = simulator.execute(red)
    for (const type of COLOR_BLINDNESS_TYPES) {
      expect(rgbEquals(result[type], red)).toBe(false)
    }
  })

  it('roughly preserves overall luminance (does not just black it out)', () => {
    const originalLuminance = luminance(red)
    const result = simulator.execute(red)
    for (const type of COLOR_BLINDNESS_TYPES) {
      expect(Math.abs(luminance(result[type]) - originalLuminance)).toBeLessThan(80)
    }
  })

  it('individual simulate() matches the corresponding execute() entry', () => {
    const result = simulator.execute(red)
    for (const type of COLOR_BLINDNESS_TYPES) {
      expect(simulator.simulate(red, type)).toEqual(result[type])
    }
  })
})
