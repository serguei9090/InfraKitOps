import { useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { BalancedFlowScaffold } from '@/adapters/ui/shell/BalancedFlowScaffold'
import { BreakdownTable, SizerCaveat, StatCard, StatGrid } from '@/adapters/ui/tuning/SizerPanels'
import { CapacityRunway, type CapacityRunwayInput, type GrowthModel } from '@/core/tuning/capacityRunway'

const calc = new CapacityRunway()

interface FormState {
  currentUsage: number
  ceiling: number
  growthModel: GrowthModel
  growthRate: number
  orderLeadTimeMonths: number
  targetHeadroomPercent: number
  projectionMonths: number
  unit: string
}

const defaults: FormState = {
  currentUsage: 400,
  ceiling: 1000,
  growthModel: 'compound',
  growthRate: 8,
  orderLeadTimeMonths: 2,
  targetHeadroomPercent: 20,
  projectionMonths: 24,
  unit: 'GiB',
}

type NumericKey = Exclude<keyof FormState, 'growthModel' | 'unit'>

function humanMonths(m: number): string {
  if (!Number.isFinite(m)) return 'never'
  if (m <= 0) return 'now'
  if (m < 1) return `${Math.round(m * 30)} d`
  if (m < 24) return `${m.toFixed(1)} mo`
  return `${(m / 12).toFixed(1)} yr`
}

export function CapacityRunwayScreen() {
  const [form, setForm] = useState<FormState>(defaults)
  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((s) => ({ ...s, [k]: v }))
  }
  function num(k: NumericKey) {
    return { value: form[k], onChange: (e: ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value)) }
  }

  const result = useMemo(() => {
    try {
      const input: CapacityRunwayInput = { ...form }
      return { value: calc.execute(input), error: null as string | null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [form])

  return (
    <BalancedFlowScaffold
      title="Capacity Runway"
      copyText={result.value?.summaryText}
      configLabel="RESOURCE & GROWTH"
      resultsLabel="RUNWAY & PROJECTION"
      previewLabel="SUMMARY"
      configPanel={
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="flex flex-col gap-3">
            <Label>Resource</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cr-cur">Current usage</Label>
                <Input id="cr-cur" type="number" min={0} step="any" {...num('currentUsage')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cr-ceil">Ceiling</Label>
                <Input id="cr-ceil" type="number" min={1} step="any" {...num('ceiling')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cr-unit">Unit</Label>
                <Input id="cr-unit" value={form.unit} onChange={(e) => set('unit', e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cr-proj">Project (months)</Label>
                <Input id="cr-proj" type="number" min={1} {...num('projectionMonths')} />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Label>Growth</Label>
            <div className="flex gap-2">
              {(['linear', 'compound'] as GrowthModel[]).map((m) => (
                <Button key={m} type="button" size="sm" variant={form.growthModel === m ? 'default' : 'outline'} onClick={() => set('growthModel', m)}>
                  {m}
                </Button>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cr-rate">{form.growthModel === 'linear' ? `${form.unit} / month` : '% / month'}</Label>
              <Input id="cr-rate" type="number" step="any" {...num('growthRate')} />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Label>Provisioning</Label>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cr-lead">Order lead time (months)</Label>
              <Input id="cr-lead" type="number" min={0} step="any" {...num('orderLeadTimeMonths')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cr-head">Act at headroom (%)</Label>
              <Input id="cr-head" type="number" min={0} max={99} {...num('targetHeadroomPercent')} />
            </div>
          </div>
        </div>
      }
      resultsPanel={
        result.error ? (
          <p className="text-sm text-destructive">{result.error}</p>
        ) : result.value ? (
          <div className="flex flex-col gap-5">
            <StatGrid>
              <StatCard label="Hits ceiling in" value={humanMonths(result.value.monthsToCeiling)} sub={`${result.value.currentHeadroomPercent.toFixed(0)}% headroom now`} />
              <StatCard label="Below target headroom in" value={humanMonths(result.value.monthsToTrigger)} tone="muted" />
              <StatCard
                label="Start provisioning by"
                value={humanMonths(result.value.orderByMonth)}
                tone={result.value.actNow ? 'warn' : 'primary'}
                sub={result.value.actNow ? 'act now' : undefined}
              />
            </StatGrid>

            <BreakdownTable
              title="Projection"
              rows={result.value.projection.map((p) => [
                `Month ${p.month}`,
                `${p.usage.toFixed(0)} ${form.unit}  ·  ${p.headroomPercent.toFixed(0)}% headroom${p.overCeiling ? '  ⚠ over' : ''}`,
                p.overCeiling,
              ])}
            />

            <SizerCaveat>
              One resource, one growth rate, no seasonality. Feed it a trend line (p95 over the last few months), not a
              single peak.
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
