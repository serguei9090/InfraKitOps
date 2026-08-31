/**
 * Runbooks — spec-to-spec diff for the version Compare view. Pure logic.
 * See RUNBOOK_MODULE_PLAN.md §7.2.
 */
import { diffWordsWithSpace, type Change } from 'diff'
import type { ArgSpec, RunbookSpec, StepSpec } from './runbookModel'

export type FieldDiffKind = 'unchanged' | 'changed'

export interface FieldDiff {
  label: string
  kind: FieldDiffKind
  before: string
  after: string
  wordDiff?: Change[]
}

export type StepDiffKind = 'unchanged' | 'added' | 'removed' | 'changed'

export interface StepDiff {
  kind: StepDiffKind
  /** step name shown in the header (b's, or a's for removed) */
  name: string
  executorBefore?: string
  executorAfter?: string
  scriptBefore?: string
  scriptAfter?: string
  scriptWordDiff?: Change[]
}

export interface ArgDiff {
  name: string
  kind: 'unchanged' | 'added' | 'removed' | 'changed'
  before?: string
  after?: string
}

export interface SpecDiff {
  fields: FieldDiff[]
  steps: StepDiff[]
  args: ArgDiff[]
}

function fieldDiff(label: string, before: string, after: string): FieldDiff {
  if (before === after) return { label, kind: 'unchanged', before, after }
  return { label, kind: 'changed', before, after, wordDiff: diffWordsWithSpace(before, after) }
}

function argLine(a: ArgSpec): string {
  const bits = [a.type, a.required ? 'required' : 'optional']
  if (a.validationPreset) bits.push(`preset:${a.validationPreset}`)
  if (a.validationRegex) bits.push(`regex:${a.validationRegex}`)
  if (a.default) bits.push(`default:${a.default}`)
  return `${a.name} — ${bits.join(', ')}`
}

export function diffSpecs(a: RunbookSpec, b: RunbookSpec): SpecDiff {
  const fields: FieldDiff[] = [
    fieldDiff('Name', a.name, b.name),
    fieldDiff('Description', a.description ?? '', b.description ?? ''),
    fieldDiff('Default timeout', String(a.defaultTimeoutSec), String(b.defaultTimeoutSec)),
    fieldDiff('Tags', a.tags.join(', '), b.tags.join(', ')),
  ]

  const steps = diffStepLists(a.steps, b.steps)

  const aArgs = new Map(a.args.map((x) => [x.name, argLine(x)]))
  const bArgs = new Map(b.args.map((x) => [x.name, argLine(x)]))
  const argNames = [...new Set([...a.args.map((x) => x.name), ...b.args.map((x) => x.name)])]
  const args: ArgDiff[] = argNames.map((name) => {
    const before = aArgs.get(name)
    const after = bArgs.get(name)
    if (before === undefined) return { name, kind: 'added', after }
    if (after === undefined) return { name, kind: 'removed', before }
    if (before === after) return { name, kind: 'unchanged', before, after }
    return { name, kind: 'changed', before, after }
  })

  return { fields, steps, args }
}

function diffStepLists(a: StepSpec[], b: StepSpec[]): StepDiff[] {
  const bIds = new Set(b.map((s) => s.id))
  const aById = new Map(a.map((s) => [s.id, s]))
  const shareIds = a.some((s) => bIds.has(s.id))

  const out: StepDiff[] = []
  if (!shareIds) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) out.push(classifyStep(a[i], b[i]))
    return out
  }
  for (const bs of b) out.push(classifyStep(aById.get(bs.id), bs))
  for (const as of a) if (!bIds.has(as.id)) out.push(classifyStep(as, undefined))
  return out.filter(Boolean)
}

function classifyStep(a: StepSpec | undefined, b: StepSpec | undefined): StepDiff {
  if (a && b) {
    if (a.script === b.script && a.executor === b.executor && a.name === b.name) {
      return { kind: 'unchanged', name: b.name || 'step', executorAfter: b.executor }
    }
    return {
      kind: 'changed',
      name: b.name || a.name || 'step',
      executorBefore: a.executor,
      executorAfter: b.executor,
      scriptBefore: a.script,
      scriptAfter: b.script,
      scriptWordDiff: a.script === b.script ? undefined : diffWordsWithSpace(a.script, b.script),
    }
  }
  if (b) return { kind: 'added', name: b.name || 'step', executorAfter: b.executor, scriptAfter: b.script }
  if (a) return { kind: 'removed', name: a.name || 'step', executorBefore: a.executor, scriptBefore: a.script }
  return { kind: 'unchanged', name: '' }
}

export function diffSummary(d: SpecDiff): {
  fields: number
  args: number
  stepsAdded: number
  stepsRemoved: number
  stepsChanged: number
} {
  return {
    fields: d.fields.filter((f) => f.kind === 'changed').length,
    args: d.args.filter((a) => a.kind !== 'unchanged').length,
    stepsAdded: d.steps.filter((s) => s.kind === 'added').length,
    stepsRemoved: d.steps.filter((s) => s.kind === 'removed').length,
    stepsChanged: d.steps.filter((s) => s.kind === 'changed').length,
  }
}
