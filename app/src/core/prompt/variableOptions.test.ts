import { describe, expect, it } from 'vitest'
import {
  optionLabel,
  optionsToLines,
  parseOptionLines,
  PRESET_OPTION_SETS,
} from './variableOptions'

describe('parseOptionLines', () => {
  it('parses bare values and value|label / value=label pairs', () => {
    const out = parseOptionLines('prod\nstaging | Staging\ndev = Development\n')
    expect(out).toEqual([
      { value: 'prod' },
      { value: 'staging', label: 'Staging' },
      { value: 'dev', label: 'Development' },
    ])
  })

  it('skips blank lines and drops duplicate values', () => {
    const out = parseOptionLines('a\n\n  \na | Again\nb')
    expect(out).toEqual([{ value: 'a' }, { value: 'b' }])
  })

  it('does not store a label equal to the value', () => {
    expect(parseOptionLines('prod | prod')).toEqual([{ value: 'prod' }])
  })

  it('round-trips through optionsToLines', () => {
    const opts = [{ value: 'prod', label: 'Production' }, { value: 'dev' }]
    expect(parseOptionLines(optionsToLines(opts))).toEqual(opts)
  })
})

describe('PRESET_OPTION_SETS', () => {
  it('every preset has a unique id and non-empty, unique-valued options', () => {
    const ids = PRESET_OPTION_SETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const preset of PRESET_OPTION_SETS) {
      expect(preset.options.length).toBeGreaterThan(1)
      const values = preset.options.map((o) => o.value)
      expect(new Set(values).size).toBe(values.length)
    }
  })
})

describe('optionLabel', () => {
  it('falls back to value when label is blank', () => {
    expect(optionLabel({ value: 'x' })).toBe('x')
    expect(optionLabel({ value: 'x', label: '  ' })).toBe('x')
    expect(optionLabel({ value: 'x', label: 'X!' })).toBe('X!')
  })
})
