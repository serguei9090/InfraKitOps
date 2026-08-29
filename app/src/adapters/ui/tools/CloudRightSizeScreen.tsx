import { useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { BalancedFlowScaffold } from '@/adapters/ui/shell/BalancedFlowScaffold'
import { BreakdownTable, SizerCaveat, StatCard, StatGrid } from '@/adapters/ui/tuning/SizerPanels'
import { CloudRightSize, type CloudRightSizeInput } from '@/core/tuning/cloudRightSize'

const calc = new CloudRightSize()

interface FormState {
  currentVcpu: number
  currentRamGb: number
  observedCpuP95Percent: number
  observedRamP95Percent: number
  targetUtilizationPercent: number
  onDemandHourly: number
  hoursPerMonth: number
  instanceCount: number
  reservedDiscountPercent: number
  spotDiscountPercent: number
  spotFractionPercent: number
  commitmentTermYears: number
}

const defaults: FormState = {
  currentVcpu: 16,
  currentRamGb: 64,
  observedCpuP95Percent: 25,
  observedRamP95Percent: 30,
  targetUtilizationPercent: 60,
  onDemandHourly: 0.8,
  hoursPerMonth: 730,
  instanceCount: 4,
  reservedDiscountPercent: 40,
  spotDiscountPercent: 70,
  spotFractionPercent: 0,
  commitmentTermYears: 1,
}

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`

export function CloudRightSizeScreen() {
  const [form, setForm] = useState<FormState>(defaults)
  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((s) => ({ ...s, [k]: v }))
  }
  function num(k: keyof FormState) {
    return { value: form[k], onChange: (e: ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value)) }
  }

  const result = useMemo(() => {
    try {
      const input: CloudRightSizeInput = { ...form }
      return { value: calc.execute(input), error: null as string | null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [form])

  return (
    <BalancedFlowScaffold
      title="Cloud Right-Size & Commitment"
      copyText={result.value?.summaryText}
      configLabel="INSTANCE, USAGE & PRICING"
      resultsLabel="RECOMMENDATION & COST"
      previewLabel="SUMMARY"
      configPanel={
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="flex flex-col gap-3">
            <Label>Current instance</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-vcpu">vCPU</Label>
                <Input id="c-vcpu" type="number" min={1} {...num('currentVcpu')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-ram">RAM (GiB)</Label>
                <Input id="c-ram" type="number" min={1} {...num('currentRamGb')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-p95cpu">p95 CPU %</Label>
                <Input id="c-p95cpu" type="number" min={0} {...num('observedCpuP95Percent')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-p95ram">p95 RAM %</Label>
                <Input id="c-p95ram" type="number" min={0} {...num('observedRamP95Percent')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-target">Target util %</Label>
                <Input id="c-target" type="number" min={1} max={100} {...num('targetUtilizationPercent')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-count">Instances</Label>
                <Input id="c-count" type="number" min={1} {...num('instanceCount')} />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Label>Pricing</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-od">On-demand $/hr (current)</Label>
                <Input id="c-od" type="number" min={0} step="any" {...num('onDemandHourly')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-hpm">Hours / month</Label>
                <Input id="c-hpm" type="number" min={1} {...num('hoursPerMonth')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-ri">Reserved discount %</Label>
                <Input id="c-ri" type="number" min={0} max={99} {...num('reservedDiscountPercent')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-sp">Spot discount %</Label>
                <Input id="c-sp" type="number" min={0} max={99} {...num('spotDiscountPercent')} />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Label>Commitment</Label>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-spf">Spot-tolerant fleet %</Label>
              <Input id="c-spf" type="number" min={0} max={100} {...num('spotFractionPercent')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Term</Label>
              <div className="flex gap-2">
                {[1, 3].map((y) => (
                  <Button key={y} type="button" size="sm" variant={form.commitmentTermYears === y ? 'default' : 'outline'} onClick={() => set('commitmentTermYears', y)}>
                    {y} yr
                  </Button>
                ))}
              </div>
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
              <StatCard label="Right-size to" value={`${result.value.recommendedVcpu} vCPU`} sub={`${result.value.recommendedRamGb} GiB · ${result.value.bindingDimension}-bound`} />
              <StatCard label="Monthly saving (reserved)" value={money(result.value.savingVsCurrentReserved)} sub={`${((result.value.savingVsCurrentReserved / result.value.monthlyCurrent) * 100).toFixed(0)}% off current`} tone="primary" />
              <StatCard label="Reserve break-even" value={`${result.value.reservedBreakEvenUtilPercent.toFixed(0)}%`} sub="runtime to beat on-demand" tone="muted" />
            </StatGrid>

            <BreakdownTable
              title="Monthly cost — fleet"
              rows={[
                ['Current (on-demand)', money(result.value.monthlyCurrent)],
                ['Right-sized on-demand', money(result.value.monthlyRightSizedOnDemand)],
                [`Right-sized ${form.commitmentTermYears}yr reserved`, money(result.value.monthlyRightSizedReserved)],
                ['Right-sized spot mix', money(result.value.monthlyRightSizedSpotMix), true],
              ]}
            />

            <SizerCaveat>
              Price assumed linear in instance size within a family — accurate enough for planning, not for the invoice.
              Reserved commitments lose money on anything you turn off; the break-even is the runtime floor.
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
