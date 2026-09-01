import { useCallback, useEffect, useState } from 'react'
import { BarChart3, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getUsage } from '@/adapters/backend/llmClient'
import type { UsageGroup } from '@/core/llm/llmModel'
import { reportError } from '@/stores/errorStore'
import { cn } from '@/lib/utils'

type GroupBy = 'model' | 'day' | 'task'
const DAYS = [7, 30, 90] as const

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function UsageView() {
  const [groupBy, setGroupBy] = useState<GroupBy>('model')
  const [days, setDays] = useState<(typeof DAYS)[number]>(7)
  const [rows, setRows] = useState<UsageGroup[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await getUsage(days, groupBy))
    } catch (e) {
      reportError(e, 'AI Hub')
    } finally {
      setLoading(false)
    }
  }, [days, groupBy])

  useEffect(() => {
    void load()
  }, [load])

  const max = Math.max(1, ...rows.map((r) => r.promptTokens + r.completionTokens))
  const totalIn = rows.reduce((a, r) => a + r.promptTokens, 0)
  const totalOut = rows.reduce((a, r) => a + r.completionTokens, 0)
  const totalCalls = rows.reduce((a, r) => a + r.calls, 0)

  return (
    <div className="p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <BarChart3 className="size-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          Prompt vs completion tokens across model calls. Counts only — no cost.
        </span>
        <div className="flex-1" />
        <div className="flex gap-0.5 rounded-md border border-border/60 p-0.5">
          {(['model', 'day', 'task'] as GroupBy[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGroupBy(g)}
              className={cn(
                'rounded px-2 py-0.5 text-xs capitalize',
                groupBy === g ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {g}
            </button>
          ))}
        </div>
        <div className="flex gap-0.5 rounded-md border border-border/60 p-0.5">
          {DAYS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={cn(
                'rounded px-2 py-0.5 text-xs',
                days === d ? 'bg-primary/15 text-primary font-medium' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {d}d
            </button>
          ))}
        </div>
        <Button size="xs" variant="ghost" onClick={() => void load()}>
          <RotateCcw className="size-3.5" />
        </Button>
      </div>

      {rows.length > 0 && (
        <div className="mb-3 flex gap-4 text-xs text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">{totalCalls}</span> calls
          </span>
          <span>
            <span className="font-medium text-foreground">{fmt(totalIn)}</span> in
          </span>
          <span>
            <span className="font-medium text-foreground">{fmt(totalOut)}</span> out
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          {loading ? 'Loading…' : `No model calls in the last ${days} days.`}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const total = r.promptTokens + r.completionTokens
            return (
              <div key={r.key} className="text-xs">
                <div className="mb-0.5 flex items-baseline gap-2">
                  <span className="font-mono font-medium">{r.key}</span>
                  <span className="text-muted-foreground">{r.calls} calls</span>
                  <div className="flex-1" />
                  <span className="text-muted-foreground">
                    {fmt(r.promptTokens)} in · {fmt(r.completionTokens)} out
                  </span>
                </div>
                <div className="flex h-3 overflow-hidden rounded bg-muted" style={{ width: `${(total / max) * 100}%` }}>
                  <div className="bg-primary/70" style={{ width: `${(r.promptTokens / total) * 100}%` }} />
                  <div className="bg-emerald-500/70" style={{ width: `${(r.completionTokens / total) * 100}%` }} />
                </div>
              </div>
            )
          })}
          <p className="mt-2 flex gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-sm bg-primary/70" /> prompt
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-sm bg-emerald-500/70" /> completion
            </span>
          </p>
        </div>
      )}
    </div>
  )
}
