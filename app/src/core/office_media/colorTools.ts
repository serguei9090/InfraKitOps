import type { IToolUseCase } from '../ports/IToolUseCase'

/** A plain sRGB color value. */
export interface RgbColor {
  /** 0-255. */
  r: number
  /** 0-255. */
  g: number
  /** 0-255. */
  b: number
}

/** A plain HSL color value. */
export interface HslColor {
  /** Hue in degrees, 0-360. */
  h: number
  /** Saturation as a percentage, 0-100. */
  s: number
  /** Lightness as a percentage, 0-100. */
  l: number
}

export function rgbEquals(a: RgbColor, b: RgbColor): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b
}

/** Clamps a color channel to the valid byte range, rounding first. */
function clampByte(value: number): number {
  const rounded = Math.round(value)
  if (rounded < 0) return 0
  if (rounded > 255) return 255
  return rounded
}

const HEX_RE = /^[0-9a-fA-F]{6}$/

/** Parses a `#RGB`, `#RRGGBB`, `RGB` or `RRGGBB` hex string into an {@link RgbColor}. Throws if invalid. */
export function hexToRgb(hex: string): RgbColor {
  let value = hex.trim()
  if (value.startsWith('#')) value = value.slice(1)
  if (value.length === 3) {
    value = value
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (value.length !== 6 || !HEX_RE.test(value)) {
    throw new Error(`Invalid hex color: ${hex}`)
  }
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  }
}

/** Formats an {@link RgbColor} as an uppercase `#RRGGBB` hex string. */
export function rgbToHex(rgb: RgbColor): string {
  const byteHex = (v: number) => clampByte(v).toString(16).padStart(2, '0')
  return `#${byteHex(rgb.r)}${byteHex(rgb.g)}${byteHex(rgb.b)}`.toUpperCase()
}

/** Converts sRGB to HSL. */
export function rgbToHsl(rgb: RgbColor): HslColor {
  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255

  const maxC = Math.max(r, g, b)
  const minC = Math.min(r, g, b)
  const delta = maxC - minC

  let h: number
  if (delta === 0) {
    h = 0
  } else if (maxC === r) {
    h = 60 * (((g - b) / delta) % 6)
  } else if (maxC === g) {
    h = 60 * ((b - r) / delta + 2)
  } else {
    h = 60 * ((r - g) / delta + 4)
  }
  if (h < 0) h += 360

  const l = (maxC + minC) / 2
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))

  return { h, s: s * 100, l: l * 100 }
}

/** Converts HSL to sRGB. */
export function hslToRgb(hsl: HslColor): RgbColor {
  const h = hsl.h % 360
  const s = Math.min(1, Math.max(0, hsl.s / 100))
  const l = Math.min(1, Math.max(0, hsl.l / 100))

  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2

  let r1: number
  let g1: number
  let b1: number
  if (h < 60) {
    ;[r1, g1, b1] = [c, x, 0]
  } else if (h < 120) {
    ;[r1, g1, b1] = [x, c, 0]
  } else if (h < 180) {
    ;[r1, g1, b1] = [0, c, x]
  } else if (h < 240) {
    ;[r1, g1, b1] = [0, x, c]
  } else if (h < 300) {
    ;[r1, g1, b1] = [x, 0, c]
  } else {
    ;[r1, g1, b1] = [c, 0, x]
  }

  return {
    r: clampByte((r1 + m) * 255),
    g: clampByte((g1 + m) * 255),
    b: clampByte((b1 + m) * 255),
  }
}

/** The color vision deficiency types {@link ColorBlindnessSimulator} can simulate. */
export type ColorBlindnessType = 'protanopia' | 'deuteranopia' | 'tritanopia'

export const COLOR_BLINDNESS_TYPES: ColorBlindnessType[] = ['protanopia', 'deuteranopia', 'tritanopia']

const MATRICES: Record<ColorBlindnessType, readonly number[]> = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
}

/**
 * Simulates how an sRGB color would appear to someone with red-blind
 * (protanopia), green-blind (deuteranopia) or blue-blind (tritanopia) color
 * vision, using the 100%-severity dichromacy simulation matrices from
 * Machado, Oliveira & Fairchild, "A Physiologically-based Model for
 * Simulation of Color Vision Deficiency" (IEEE TVCG, 2009).
 */
export class ColorBlindnessSimulator
  implements IToolUseCase<RgbColor, Record<ColorBlindnessType, RgbColor>>
{
  execute(input: RgbColor): Record<ColorBlindnessType, RgbColor> {
    const result = {} as Record<ColorBlindnessType, RgbColor>
    for (const type of COLOR_BLINDNESS_TYPES) {
      result[type] = this.simulate(input, type)
    }
    return result
  }

  /** Simulates a single {@link ColorBlindnessType} for `input`. */
  simulate(input: RgbColor, type: ColorBlindnessType): RgbColor {
    const m = MATRICES[type]
    const r = input.r / 255
    const g = input.g / 255
    const b = input.b / 255

    const simR = m[0] * r + m[1] * g + m[2] * b
    const simG = m[3] * r + m[4] * g + m[5] * b
    const simB = m[6] * r + m[7] * g + m[8] * b

    return { r: clampByte(simR * 255), g: clampByte(simG * 255), b: clampByte(simB * 255) }
  }
}
