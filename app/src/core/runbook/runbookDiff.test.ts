import { describe, expect, it } from 'vitest'
import { diffSpecs, diffSummary } from './runbookDiff'
import { emptySpec, type RunbookSpec, type StepSpec } from './runbookModel'

function step(id: string, script: string): StepSpec {
  return { id, name: id, executor: 'bash', script, continueOnError: false, runIf: '' }
}
function spec(over: Partial<RunbookSpec>): RunbookSpec {
  return { ...emptySpec(), steps: [], ...over }
}

describe('diffSpecs', () => {
  it('flags changed fields with a word diff', () => {
    const a = spec({ name: 'Restart web', defaultTimeoutSec: 30 })
    const b = spec({ name: 'Restart api', defaultTimeoutSec: 60 })
    const d = diffSpecs(a, b)
    const name = d.fields.find((f) => f.label === 'Name')!
    expect(name.kind).toBe('changed')
    expect(name.wordDiff?.some((c) => c.added)).toBe(true)
    expect(d.fields.find((f) => f.label === 'Default timeout')?.kind).toBe('changed')
  })

  it('detects added / removed / changed steps by id', () => {
    const a = spec({ steps: [step('1', 'echo a'), step('2', 'echo b')] })
    const b = spec({ steps: [step('1', 'echo A'), step('3', 'echo c')] })
    const d = diffSpecs(a, b)
    expect(d.steps.map((s) => s.kind).sort()).toEqual(['added', 'changed', 'removed'])
    expect(diffSummary(d)).toMatchObject({ stepsAdded: 1, stepsRemoved: 1, stepsChanged: 1 })
  })

  it('detects arg config changes', () => {
    const a = spec({ args: [{ name: 'PORT', type: 'string', required: true }] })
    const b = spec({ args: [{ name: 'PORT', type: 'string', required: true, validationRegex: '^\\d+$' }] })
    const d = diffSpecs(a, b)
    expect(d.args[0].kind).toBe('changed')
    expect(diffSummary(d).args).toBe(1)
  })

  it('unchanged spec has no changes', () => {
    const a = spec({ name: 'x', steps: [step('1', 'echo')] })
    expect(diffSummary(diffSpecs(a, a))).toEqual({
      fields: 0,
      args: 0,
      stepsAdded: 0,
      stepsRemoved: 0,
      stepsChanged: 0,
    })
  })
})
