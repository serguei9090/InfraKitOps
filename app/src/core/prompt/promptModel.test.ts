import { describe, expect, it } from 'vitest'
import { isVariableMetaEmpty, sanitizeVariableMeta, sanitizeVariables } from './promptModel'

describe('isVariableMetaEmpty', () => {
  it('is true for {} and for a bare text kind', () => {
    expect(isVariableMetaEmpty({})).toBe(true)
    expect(isVariableMetaEmpty({ kind: 'text' })).toBe(true)
  })

  it('is false once any real field is set', () => {
    expect(isVariableMetaEmpty({ description: 'x' })).toBe(false)
    expect(isVariableMetaEmpty({ kind: 'select', options: [{ value: 'a' }] })).toBe(false)
    expect(isVariableMetaEmpty({ required: true })).toBe(false)
    expect(isVariableMetaEmpty({ min: 0 })).toBe(false)
  })
})

describe('sanitizeVariableMeta', () => {
  it('keeps known fields and drops junk', () => {
    const meta = sanitizeVariableMeta({
      description: 'd',
      defaultValue: 'prod',
      kind: 'select',
      options: [{ value: 'prod', label: 'Production' }, { value: 'dev' }, { nope: 1 }, { value: 'prod' }],
      allowCustom: true,
      min: 1,
      max: 'bad',
      required: true,
      extra: 'ignored',
    })
    expect(meta).toEqual({
      description: 'd',
      defaultValue: 'prod',
      kind: 'select',
      options: [{ value: 'prod', label: 'Production' }, { value: 'dev' }],
      allowCustom: true,
      min: 1,
      required: true,
    })
  })

  it('rejects an unknown kind', () => {
    expect(sanitizeVariableMeta({ kind: 'radio' }).kind).toBeUndefined()
  })

  it('sanitizeVariables maps every entry', () => {
    const out = sanitizeVariables({ A: { kind: 'number', step: 2 }, B: 'garbage' })
    expect(out.A).toEqual({ kind: 'number', step: 2 })
    expect(out.B).toEqual({})
  })
})
