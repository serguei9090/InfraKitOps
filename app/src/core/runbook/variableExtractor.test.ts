import { describe, expect, it } from 'vitest'
import { extractTokens, isBuiltinToken, specArgNames, specSecretRefs } from './variableExtractor'
import { emptySpec, type RunbookSpec } from './runbookModel'

function spec(scripts: string[]): RunbookSpec {
  const s = emptySpec()
  s.steps = scripts.map((script, i) => ({
    id: `s${i}`,
    name: '',
    executor: 'bash' as const,
    script,
    continueOnError: false,
    runIf: '' as const,
  }))
  return s
}

describe('extractTokens', () => {
  it('finds names, dedupes, keeps order', () => {
    expect(extractTokens('{{B}} {{A}} {{B}} {{ SPACED }}')).toEqual(['B', 'A', 'SPACED'])
  })
  it('matches secret and step refs', () => {
    expect(extractTokens('{{secret:TOK}} {{steps.2.stdout}}')).toEqual(['secret:TOK', 'steps.2.stdout'])
  })
})

describe('isBuiltinToken', () => {
  it('classifies refs', () => {
    expect(isBuiltinToken('HOST')).toBe(false)
    expect(isBuiltinToken('secret:X')).toBe(true)
    expect(isBuiltinToken('steps.1.stdout')).toBe(true)
  })
})

describe('specArgNames', () => {
  it('collects user args across steps, excludes builtins', () => {
    const s = spec(['deploy {{APP}} {{secret:KEY}}', 'restart {{APP}} on {{HOST}} {{steps.1.stdout}}'])
    expect(specArgNames(s)).toEqual(['APP', 'HOST'])
  })
})

describe('specSecretRefs', () => {
  it('collects secret names', () => {
    const s = spec(['{{secret:A}} {{secret:B}} {{secret:A}}'])
    expect(specSecretRefs(s)).toEqual(['A', 'B'])
  })
})
