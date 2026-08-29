import { useMemo, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { BalancedFlowScaffold } from '@/adapters/ui/shell/BalancedFlowScaffold'
import { BreakdownTable, SizerCaveat, StatCard, StatGrid } from '@/adapters/ui/tuning/SizerPanels'
import { RetryBudget, type RetryBudgetInput, type RetryHopInput } from '@/core/tuning/retryBudget'

const calc = new RetryBudget()

interface HopRow extends RetryHopInput {
  id: number
}

const initial: HopRow[] = [
  { id: 0, name: 'gateway', typicalMs: 20, timeoutMs: 900, retries: 0, backoffBaseMs: 0 },
  { id: 1, name: 'service-a', typicalMs: 60, timeoutMs: 400, retries: 1, backoffBaseMs: 50 },
  { id: 2, name: 'database', typicalMs: 30, timeoutMs: 100, retries: 2, backoffBaseMs: 20 },
]

export function RetryBudgetScreen() {
  const [budgetMs, setBudgetMs] = useState(1000)
  const [rows, setRows] = useState<HopRow[]>(initial)
  const nextId = useRef(3)

  function patch(id: number, p: Partial<HopRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)))
  }
  function addRow() {
    setRows((rs) => [...rs, { id: nextId.current++, name: `hop-${rs.length + 1}`, typicalMs: 30, timeoutMs: 200, retries: 0, backoffBaseMs: 20 }])
  }
  function removeRow(id: number) {
    setRows((rs) => rs.filter((r) => r.id !== id))
  }

  const result = useMemo(() => {
    try {
      const input: RetryBudgetInput = {
        endToEndBudgetMs: budgetMs,
        hops: rows.map((r) => ({
          name: r.name,
          typicalMs: r.typicalMs,
          timeoutMs: r.timeoutMs,
          retries: r.retries,
          backoffBaseMs: r.backoffBaseMs,
        })),
      }
      return { value: calc.execute(input), error: null as string | null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [budgetMs, rows])

  return (
    <BalancedFlowScaffold
      title="Retry & Timeout Budget"
      copyText={result.value?.summaryText}
      configLabel="CALL CHAIN"
      resultsLabel="LATENCY & AMPLIFICATION"
      previewLabel="SUMMARY"
      configPanel={
        <div className="flex flex-col gap-4">
          <div className="flex max-w-xs flex-col gap-1.5">
            <Label htmlFor="rb-budget">End-to-end budget (ms)</Label>
            <Input id="rb-budget" type="number" min={1} value={budgetMs} onChange={(e) => setBudgetMs(Number(e.target.value))} />
          </div>

          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-[1fr_5rem_5rem_4rem_5rem_2rem] items-center gap-2 text-xs font-medium text-muted-foreground">
              <span>Hop (outer → inner)</span>
              <span>Typical ms</span>
              <span>Timeout ms</span>
              <span>Retries</span>
              <span>Backoff ms</span>
              <span />
            </div>
            {rows.map((r) => (
              <div key={r.id} className="grid grid-cols-[1fr_5rem_5rem_4rem_5rem_2rem] items-center gap-2">
                <Input value={r.name} onChange={(e) => patch(r.id, { name: e.target.value })} />
                <Input type="number" min={1} value={r.typicalMs} onChange={(e) => patch(r.id, { typicalMs: Number(e.target.value) })} />
                <Input type="number" min={1} value={r.timeoutMs} onChange={(e) => patch(r.id, { timeoutMs: Number(e.target.value) })} />
                <Input type="number" min={0} value={r.retries} onChange={(e) => patch(r.id, { retries: Number(e.target.value) })} />
                <Input type="number" min={0} value={r.backoffBaseMs} onChange={(e) => patch(r.id, { backoffBaseMs: Number(e.target.value) })} />
                {rows.length > 1 ? (
                  <Button type="button" size="icon-sm" variant="ghost" onClick={() => removeRow(r.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                ) : (
                  <span />
                )}
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={addRow} className="w-fit">
              <Plus className="size-4" /> Add hop
            </Button>
          </div>
        </div>
      }
      resultsPanel={
        result.error ? (
          <p className="text-sm text-destructive">{result.error}</p>
        ) : result.value ? (
          <div className="flex flex-col gap-5">
            <StatGrid>
              <StatCard label="Worst-case latency" value={`${Math.round(result.value.worstCaseTotalMs)} ms`} sub={`budget ${budgetMs} ms`} tone={result.value.fitsBudget ? 'primary' : 'warn'} />
              <StatCard label="Fits budget" value={result.value.fitsBudget ? '✓' : '✕'} tone={result.value.fitsBudget ? 'primary' : 'warn'} />
              <StatCard label="Retry amplification" value={`${result.value.retryAmplification}×`} sub="to the innermost hop" tone={result.value.amplificationRisk ? 'warn' : 'muted'} />
            </StatGrid>

            <BreakdownTable
              title="Per hop"
              rows={result.value.hops.map((h) => [
                h.name,
                `${h.attempts} attempt(s) · worst ${Math.round(h.worstCaseMs)} ms · → timeout ${h.recommendedTimeoutMs} ms${h.timeoutTooTightForDownstream ? '  ⚠' : ''}`,
                h.timeoutTooTightForDownstream || h.overBudgetShare,
              ])}
            />

            {result.value.warnings.map((w, i) => (
              <Alert key={i} variant="destructive">
                <AlertDescription>{w}</AlertDescription>
              </Alert>
            ))}

            <SizerCaveat>
              Worst case = every retry times out then the last attempt succeeds. Jitter helps the average, not this.
              Retry at one layer only, and keep each hop's timeout above the worst case of everything it calls.
            </SizerCaveat>
          </div>
        ) : null
      }
      previewPanel={
        result.value ? (
          <pre className="max-w-full overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-xs whitespace-pre-wrap">
            {result.value.summaryText}
          </pre>
        ) : null
      }
    />
  )
}
