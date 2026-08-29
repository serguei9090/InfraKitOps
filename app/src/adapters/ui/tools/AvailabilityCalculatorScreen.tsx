import { useMemo, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { BalancedFlowScaffold } from '@/adapters/ui/shell/BalancedFlowScaffold'
import { BreakdownTable, SizerCaveat, StatCard, StatGrid } from '@/adapters/ui/tuning/SizerPanels'
import {
  AvailabilityCalculator,
  type AvailabilityCalculatorInput,
  type AvailabilityComponentInput,
  type Topology,
} from '@/core/tuning/availabilityCalculator'

const calc = new AvailabilityCalculator()

interface RowState {
  id: number
  name: string
  mode: 'availability' | 'mtbf'
  availabilityPercent: string
  mtbfHours: string
  mttrHours: string
  redundant: boolean
  total: string
  required: string
}

function newRow(id: number, name: string, avail: string): RowState {
  return { id, name, mode: 'availability', availabilityPercent: avail, mtbfHours: '4380', mttrHours: '2', redundant: false, total: '3', required: '2' }
}

const initialRows: RowState[] = [
  newRow(0, 'Load balancer', '99.99'),
  newRow(1, 'App tier', '99.95'),
  newRow(2, 'Database', '99.9'),
]

function toComponent(r: RowState): AvailabilityComponentInput {
  const c: AvailabilityComponentInput = { name: r.name.trim() || 'component' }
  if (r.mode === 'availability') c.availabilityPercent = Number(r.availabilityPercent)
  else {
    c.mtbfHours = Number(r.mtbfHours)
    c.mttrHours = Number(r.mttrHours)
  }
  if (r.redundant) c.redundancy = { total: Number(r.total), required: Number(r.required) }
  return c
}

export function AvailabilityCalculatorScreen() {
  const [rows, setRows] = useState<RowState[]>(initialRows)
  const [topology, setTopology] = useState<Topology>('series')
  const [useTarget, setUseTarget] = useState(true)
  const [targetPercent, setTargetPercent] = useState('99.9')
  const nextId = useRef(3)

  function patch(id: number, p: Partial<RowState>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)))
  }
  function addRow() {
    setRows((rs) => [...rs, newRow(nextId.current++, `Component ${rs.length + 1}`, '99.9')])
  }
  function removeRow(id: number) {
    setRows((rs) => rs.filter((r) => r.id !== id))
  }

  const result = useMemo(() => {
    try {
      const input: AvailabilityCalculatorInput = {
        components: rows.map(toComponent),
        topology,
        targetPercent: useTarget ? Number(targetPercent) : undefined,
      }
      return { value: calc.execute(input), error: null as string | null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [rows, topology, useTarget, targetPercent])

  const fmtPct = (p: number) => `${p.toFixed(p >= 99.99 ? 4 : 3)}%`
  const fmtMin = (m: number) => (m < 60 ? `${m.toFixed(1)} min` : m < 1440 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} d`)

  return (
    <BalancedFlowScaffold
      title="Availability & Redundancy"
      copyText={result.value?.summaryText}
      configLabel="COMPONENTS"
      resultsLabel="COMPOSITE AVAILABILITY"
      previewLabel="SUMMARY"
      configPanel={
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Combine as</Label>
              <div className="flex gap-2">
                {(['series', 'parallel'] as Topology[]).map((t) => (
                  <Button key={t} type="button" size="sm" variant={topology === t ? 'default' : 'outline'} onClick={() => setTopology(t)}>
                    {t === 'series' ? 'Series (all needed)' : 'Parallel (any one)'}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input id="av-t" type="checkbox" checked={useTarget} onChange={(e) => setUseTarget(e.target.checked)} />
              <Label htmlFor="av-t">Target</Label>
              {useTarget ? <Input className="w-24" type="number" step="any" value={targetPercent} onChange={(e) => setTargetPercent(e.target.value)} /> : null}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-col gap-2 rounded-lg border border-border/60 p-3">
                <div className="flex items-center gap-2">
                  <Input className="max-w-56" value={r.name} onChange={(e) => patch(r.id, { name: e.target.value })} />
                  <div className="flex gap-1">
                    {(['availability', 'mtbf'] as const).map((m) => (
                      <Button key={m} type="button" size="sm" variant={r.mode === m ? 'default' : 'outline'} onClick={() => patch(r.id, { mode: m })}>
                        {m === 'availability' ? 'A %' : 'MTBF/MTTR'}
                      </Button>
                    ))}
                  </div>
                  {rows.length > 1 ? (
                    <Button type="button" size="icon-sm" variant="ghost" onClick={() => removeRow(r.id)}>
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {r.mode === 'availability' ? (
                    <div className="flex items-center gap-1.5">
                      <Label className="text-xs">Availability %</Label>
                      <Input className="w-28" type="number" step="any" value={r.availabilityPercent} onChange={(e) => patch(r.id, { availabilityPercent: e.target.value })} />
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5">
                        <Label className="text-xs">MTBF (h)</Label>
                        <Input className="w-24" type="number" step="any" value={r.mtbfHours} onChange={(e) => patch(r.id, { mtbfHours: e.target.value })} />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Label className="text-xs">MTTR (h)</Label>
                        <Input className="w-20" type="number" step="any" value={r.mttrHours} onChange={(e) => patch(r.id, { mttrHours: e.target.value })} />
                      </div>
                    </>
                  )}
                  <div className="flex items-center gap-1.5">
                    <Switch checked={r.redundant} onCheckedChange={(c) => patch(r.id, { redundant: c })} />
                    <Label className="text-xs">Redundant pool</Label>
                  </div>
                  {r.redundant ? (
                    <div className="flex items-center gap-1.5">
                      <Input className="w-16" type="number" min={1} value={r.required} onChange={(e) => patch(r.id, { required: e.target.value })} />
                      <span className="text-xs text-muted-foreground">of</span>
                      <Input className="w-16" type="number" min={1} value={r.total} onChange={(e) => patch(r.id, { total: e.target.value })} />
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={addRow} className="w-fit">
              <Plus className="size-4" /> Add component
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
              <StatCard label="System availability" value={fmtPct(result.value.systemAvailabilityPercent)} sub={`${result.value.nines.toFixed(2)} nines`} />
              <StatCard label="Downtime / year" value={fmtMin(result.value.downtimePerYearMinutes)} sub={`${fmtMin(result.value.downtimePerMonthMinutes)} / month`} tone="muted" />
              {result.value.meetsTarget != null ? (
                <StatCard
                  label={`vs target ${targetPercent}%`}
                  value={result.value.meetsTarget ? '✓ meets' : '✕ misses'}
                  sub={result.value.gapToTargetMinutesPerYear != null ? `${result.value.gapToTargetMinutesPerYear > 0 ? '+' : ''}${fmtMin(Math.abs(result.value.gapToTargetMinutesPerYear))}/yr` : undefined}
                  tone={result.value.meetsTarget ? 'primary' : 'warn'}
                />
              ) : (
                <StatCard label="Downtime / week" value={fmtMin(result.value.downtimePerWeekMinutes)} tone="muted" />
              )}
            </StatGrid>

            <BreakdownTable
              title="Per component"
              rows={result.value.components.map((c) => [
                c.name + (c.redundancy ? ` (${c.redundancy.required}-of-${c.redundancy.total})` : ''),
                c.redundancy
                  ? `${fmtPct(c.instanceAvailability * 100)} → ${fmtPct(c.effectiveAvailability * 100)}${c.availabilityWithOneMore != null ? `  (+1 → ${fmtPct(c.availabilityWithOneMore * 100)})` : ''}`
                  : fmtPct(c.effectiveAvailability * 100),
              ])}
            />

            <SizerCaveat>
              Assumes independent failures. Shared power, one bad deploy, or a poisoned config correlates failures and
              makes real availability worse — treat this as an upper bound.
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
