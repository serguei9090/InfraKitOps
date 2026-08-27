import { ArrowLeftRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getRun } from '@/adapters/backend/historyClient'
import { Button } from '@/components/ui/button'
import { diffRuns, type RunDiff, type RunSummary, type StoredRun } from '@/core/network/history'
import { cn } from '@/lib/utils'

interface RunComparePanelProps {
  /** The full run list for the current tool (newest first). */
  runs: RunSummary[]
  /** Pre-selected A / B ids (older, newer). */
  initialA?: number
  initialB?: number
  onBack: () => void
}

/**
 * Compare two stored runs of the same tool: an A/B picker with presets and a
 * shape-specific diff body. See NETWORK_MODULE_PLAN.md §2.3.
 */
export function RunComparePanel({ runs, initialA, initialB, onBack }: RunComparePanelProps) {
  const [aId, setAId] = useState<number | undefined>(initialA ?? runs[1]?.id)
  const [bId, setBId] = useState<number | undefined>(initialB ?? runs[0]?.id)
  const [pair, setPair] = useState<{ a: StoredRun; b: StoredRun } | null>(null)
  const [onlyDiff, setOnlyDiff] = useState(true)

  useEffect(() => {
    if (aId == null || bId == null) return
    let cancelled = false
    Promise.all([getRun(aId), getRun(bId)]).then(([a, b]) => {
      if (!cancelled && a && b) setPair({ a, b })
    })
    return () => {
      cancelled = true
    }
  }, [aId, bId])

  const diff: RunDiff | null = useMemo(() => (pair ? diffRuns(pair.a, pair.b) : null), [pair])

  function applyPreset(kind: 'previous' | 'week') {
    if (runs.length < 2) return
    setBId(runs[0].id)
    if (kind === 'previous') {
      setAId(runs[1].id)
    } else {
      const weekAgo = runs[0].startedAt - 7 * 86400_000
      const older = runs.find((r) => r.startedAt <= weekAgo) ?? runs[runs.length - 1]
      setAId(older.id)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between border-b border-border/60 px-4">
        <button type="button" onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to history
        </button>
        <Button variant="outline" size="xs" onClick={() => setOnlyDiff((v) => !v)}>
          {onlyDiff ? 'Only differences' : 'Show all'}
        </Button>
      </div>

      <div className="space-y-2 border-b border-border/60 p-3">
        <div className="flex gap-1.5">
          <Button variant="outline" size="xs" onClick={() => applyPreset('previous')}>
            Latest vs previous
          </Button>
          <Button variant="outline" size="xs" onClick={() => applyPreset('week')}>
            Latest vs ~7 days ago
          </Button>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <RunSelect label="A (older)" value={aId} runs={runs} onChange={setAId} />
          <ArrowLeftRight className="size-4 text-muted-foreground" />
          <RunSelect label="B (newer)" value={bId} runs={runs} onChange={setBId} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {!diff ? (
          <p className="text-sm text-muted-foreground">Pick two runs to compare.</p>
        ) : (
          <DiffBody diff={diff} onlyDiff={onlyDiff} />
        )}
      </div>
    </div>
  )
}

function RunSelect({
  label,
  value,
  runs,
  onChange,
}: {
  label: string
  value: number | undefined
  runs: RunSummary[]
  onChange: (id: number) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
      >
        {runs.map((r) => (
          <option key={r.id} value={r.id}>
            {new Date(r.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </option>
        ))}
      </select>
    </label>
  )
}

function DiffBody({ diff, onlyDiff }: { diff: RunDiff; onlyDiff: boolean }) {
  switch (diff.kind) {
    case 'set':
      return (
        <div className="space-y-3 text-sm">
          {diff.countChanged ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">Item count changed.</p>
          ) : null}
          <Group title={`Added (${diff.added.length})`} tone="add">
            {diff.added.map((i) => (
              <li key={i.key}>{i.label} — {i.detail ?? i.key}</li>
            ))}
          </Group>
          <Group title={`Removed (${diff.removed.length})`} tone="remove">
            {diff.removed.map((i) => (
              <li key={i.key}>{i.label} — {i.detail ?? i.key}</li>
            ))}
          </Group>
          {!onlyDiff ? (
            <Group title={`Unchanged (${diff.unchanged.length})`} tone="ctx">
              {diff.unchanged.map((i) => (
                <li key={i.key}>{i.label} — {i.detail ?? i.key}</li>
              ))}
            </Group>
          ) : null}
        </div>
      )
    case 'scalar_series':
      return (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1">Stat</th>
              <th className="py-1 text-right">A</th>
              <th className="py-1 text-right">B</th>
              <th className="py-1 text-right">Δ</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {diff.deltas.map((d) => (
              <tr key={d.stat}>
                <td className="py-0.5">{d.stat}</td>
                <td className="py-0.5 text-right">{d.a}</td>
                <td className="py-0.5 text-right">{d.b}</td>
                <td
                  className={cn(
                    'py-0.5 text-right',
                    d.delta > 0 && 'text-destructive',
                    d.delta < 0 && 'text-emerald-600 dark:text-emerald-400',
                  )}
                >
                  {d.delta > 0 ? '+' : ''}
                  {d.delta} {diff.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    case 'text':
      return (
        <pre className="overflow-x-auto rounded-md border border-border/60 bg-card p-2 font-mono text-xs leading-relaxed">
          {diff.lines
            .filter((l) => !onlyDiff || l.type !== 'context')
            .map((l, i) => (
              <div
                key={i}
                className={cn(
                  l.type === 'add' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                  l.type === 'remove' && 'bg-destructive/10 text-destructive',
                )}
              >
                {l.type === 'add' ? '+ ' : l.type === 'remove' ? '- ' : '  '}
                {l.text}
              </div>
            ))}
        </pre>
      )
    default:
      return <p className="text-sm text-muted-foreground">Comparison isn&apos;t available for this result type yet.</p>
  }
}

function Group({
  title,
  tone,
  children,
}: {
  title: string
  tone: 'add' | 'remove' | 'ctx'
  children: React.ReactNode
}) {
  const items = Array.isArray(children) ? children : [children]
  if (items.length === 0) return null
  return (
    <div>
      <p
        className={cn(
          'mb-1 text-xs font-medium',
          tone === 'add' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'remove' && 'text-destructive',
          tone === 'ctx' && 'text-muted-foreground',
        )}
      >
        {title}
      </p>
      <ul className="space-y-0.5 font-mono text-xs">{children}</ul>
    </div>
  )
}
