import { describe, expect, it } from 'vitest'
import { canonicalizeParams, paramsKey } from './canonicalizeParams'
import { diffRuns, diffSets, diffText, seriesOverTime } from './diff'
import type { StoredRun } from './envelope'

function run(partial: Partial<StoredRun>): StoredRun {
  return {
    id: 1,
    tool: 't',
    target: 'x',
    startedAt: 0,
    status: 'ok',
    resultShape: 'text',
    pinned: false,
    params: {},
    result: { v: 1, text: '' },
    ...partial,
  }
}

describe('canonicalizeParams', () => {
  it('sorts keys recursively; arrays keep order', () => {
    const c = canonicalizeParams({ b: 1, a: { z: 2, y: [3, 1, 2] } })
    expect(JSON.stringify(c)).toBe('{"a":{"y":[3,1,2],"z":2},"b":1}')
  })

  it('paramsKey is order-independent', () => {
    expect(paramsKey({ a: 1, b: 2 })).toBe(paramsKey({ b: 2, a: 1 }))
  })
})

describe('diffSets', () => {
  it('splits added / removed / unchanged by key', () => {
    const a = [
      { key: '22/tcp', label: 'ssh' },
      { key: '80/tcp', label: 'http' },
    ]
    const b = [
      { key: '80/tcp', label: 'http' },
      { key: '443/tcp', label: 'https' },
    ]
    const d = diffSets(a, b)
    expect(d.added.map((i) => i.key)).toEqual(['443/tcp'])
    expect(d.removed.map((i) => i.key)).toEqual(['22/tcp'])
    expect(d.unchanged.map((i) => i.key)).toEqual(['80/tcp'])
    expect(d.countChanged).toBe(false)
  })

  it('flags a count change (traceroute added hops)', () => {
    const d = diffSets([{ key: '1', label: 'a' }], [
      { key: '1', label: 'a' },
      { key: '2', label: 'b' },
    ])
    expect(d.countChanged).toBe(true)
    expect(d.added).toHaveLength(1)
  })
})

describe('diffText', () => {
  it('reports added and removed lines', () => {
    const d = diffText('alpha\nbeta\ngamma', 'alpha\ndelta\ngamma')
    expect(d.addedCount).toBe(1)
    expect(d.removedCount).toBe(1)
    expect(d.lines.some((l) => l.type === 'add' && l.text === 'delta')).toBe(true)
    expect(d.lines.some((l) => l.type === 'remove' && l.text === 'beta')).toBe(true)
  })

  it('ignores volatile lines by default (whois "Last update")', () => {
    const a = 'Domain: X\n>>> Last update of whois database: 2026-01-01 <<<'
    const b = 'Domain: X\n>>> Last update of whois database: 2026-06-06 <<<'
    expect(diffText(a, b).addedCount).toBe(0)
    expect(diffText(a, b, { normalizeVolatile: false }).addedCount).toBeGreaterThan(0)
  })
})

describe('diffRuns dispatch', () => {
  it('diffs scalar_series stat deltas', () => {
    const a = run({
      resultShape: 'scalar_series',
      result: { v: 1, unit: 'ms', samples: [10, 12], stats: { min: 10, avg: 11, p50: 11, p95: 12, max: 12, loss: 0 } },
    })
    const b = run({
      resultShape: 'scalar_series',
      result: { v: 1, unit: 'ms', samples: [40, 44], stats: { min: 40, avg: 42, p50: 42, p95: 44, max: 44, loss: 0.1 } },
    })
    const d = diffRuns(a, b)
    expect(d.kind).toBe('scalar_series')
    if (d.kind === 'scalar_series') {
      expect(d.deltas.find((x) => x.stat === 'avg')?.delta).toBe(31)
      expect(d.deltas.find((x) => x.stat === 'loss')?.delta).toBeCloseTo(0.1)
    }
  })

  it('returns unsupported when shapes differ', () => {
    const d = diffRuns(run({ resultShape: 'text' }), run({ resultShape: 'set', result: { v: 1, items: [] } }))
    expect(d.kind).toBe('unsupported')
  })

  it('table shape is unsupported for now', () => {
    const t = run({ resultShape: 'table', result: { v: 1 } })
    expect(diffRuns(t, t).kind).toBe('unsupported')
  })
})

describe('seriesOverTime', () => {
  it('extracts a summary metric across runs, oldest first', () => {
    const runs = [
      { id: 2, tool: 't', target: 'x', startedAt: 200, status: 'ok' as const, resultShape: 'scalar_series' as const, pinned: false, summary: { avgMs: 40 } },
      { id: 1, tool: 't', target: 'x', startedAt: 100, status: 'ok' as const, resultShape: 'scalar_series' as const, pinned: false, summary: { avgMs: 12 } },
    ]
    expect(seriesOverTime(runs, 'avgMs')).toEqual([
      { at: 100, value: 12 },
      { at: 200, value: 40 },
    ])
  })
})
