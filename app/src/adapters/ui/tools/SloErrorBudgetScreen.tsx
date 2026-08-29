import { useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { BalancedFlowScaffold } from '@/adapters/ui/shell/BalancedFlowScaffold'
import { BreakdownTable, SizerCaveat, StatCard, StatGrid } from '@/adapters/ui/tuning/SizerPanels'
import { SloErrorBudget, type SloErrorBudgetInput } from '@/core/tuning/sloErrorBudget'

const calc = new SloErrorBudget()

interface FormState {
  sloTargetPercent: number
  windowDays: number
  currentSuccessRatePercent: number
  requestsPerDay: number
  useCurrent: boolean
  useVolume: boolean
}

const defaults: FormState = {
  sloTargetPercent: 99.9,
  windowDays: 30,
  currentSuccessRatePercent: 99.95,
  requestsPerDay: 10_000_000,
  useCurrent: true,
  useVolume: false,
}

function fmtMinutes(min: number): string {
  if (min < 1) return `${(min * 60).toFixed(0)} s`
  if (min < 60) return `${min.toFixed(1)} min`
  if (min < 1440) return `${(min / 60).toFixed(1)} h`
  return `${(min / 1440).toFixed(1)} d`
}

export function SloErrorBudgetScreen() {
  const [form, setForm] = useState<FormState>(defaults)
  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((s) => ({ ...s, [k]: v }))
  }
  function num(k: 'sloTargetPercent' | 'currentSuccessRatePercent' | 'requestsPerDay') {
    return { value: form[k], onChange: (e: ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value)) }
  }

  const result = useMemo(() => {
    try {
      const input: SloErrorBudgetInput = {
        sloTargetPercent: form.sloTargetPercent,
        windowDays: form.windowDays,
        currentSuccessRatePercent: form.useCurrent ? form.currentSuccessRatePercent : undefined,
        requestsPerDay: form.useVolume ? form.requestsPerDay : undefined,
      }
      return { value: calc.execute(input), error: null as string | null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [form])

  return (
    <BalancedFlowScaffold
      title="SLO & Error Budget"
      copyText={result.value?.prometheusRule}
      configLabel="OBJECTIVE"
      resultsLabel="ERROR BUDGET & BURN-RATE ALERTS"
      previewLabel="Prometheus alert rule (PREVIEW)"
      configPanel={
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="flex flex-col gap-3">
            <Label>Target</Label>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="slo-target">SLO (%)</Label>
              <Input id="slo-target" type="number" min={50} max={99.999} step="any" {...num('sloTargetPercent')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Rolling window</Label>
              <div className="flex gap-2">
                {[28, 30, 90].map((d) => (
                  <Button key={d} type="button" size="sm" variant={form.windowDays === d ? 'default' : 'outline'} onClick={() => set('windowDays', d)}>
                    {d}d
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <input id="slo-usecur" type="checkbox" checked={form.useCurrent} onChange={(e) => set('useCurrent', e.target.checked)} />
              <Label htmlFor="slo-usecur">Show budget consumed</Label>
            </div>
            {form.useCurrent ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="slo-cur">Current success rate (%)</Label>
                <Input id="slo-cur" type="number" min={0} max={100} step="any" {...num('currentSuccessRatePercent')} />
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <input id="slo-usevol" type="checkbox" checked={form.useVolume} onChange={(e) => set('useVolume', e.target.checked)} />
              <Label htmlFor="slo-usevol">Express budget as bad requests</Label>
            </div>
            {form.useVolume ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="slo-vol">Requests / day</Label>
                <Input id="slo-vol" type="number" min={1} {...num('requestsPerDay')} />
              </div>
            ) : null}
          </div>
        </div>
      }
      resultsPanel={
        result.error ? (
          <p className="text-sm text-destructive">{result.error}</p>
        ) : result.value ? (
          <div className="flex flex-col gap-5">
            <StatGrid>
              <StatCard label="Error budget" value={`${(result.value.errorBudgetFraction * 100).toFixed(3)}%`} />
              <StatCard label={`Allowed downtime / ${form.windowDays}d`} value={fmtMinutes(result.value.allowedDowntimeMinutesPerWindow)} sub={`${fmtMinutes(result.value.allowedDowntimeMinutesPerDay)} / day`} tone="muted" />
              {result.value.budgetRemainingPercent != null ? (
                <StatCard
                  label="Budget remaining"
                  value={`${result.value.budgetRemainingPercent.toFixed(0)}%`}
                  tone={result.value.budgetRemainingPercent < 0 ? 'warn' : result.value.budgetRemainingPercent < 25 ? 'warn' : 'primary'}
                />
              ) : (
                <StatCard label="Allowed downtime / week" value={fmtMinutes(result.value.allowedDowntimeMinutesPerWeek)} tone="muted" />
              )}
            </StatGrid>

            {result.value.allowedBadRequestsPerWindow != null ? (
              <BreakdownTable
                rows={[['Allowed bad requests / window', Math.round(result.value.allowedBadRequestsPerWindow).toLocaleString(), true]]}
              />
            ) : null}

            <BreakdownTable
              title="Burn-rate alert thresholds"
              rows={result.value.thresholds.map((t) => [
                `${t.severity} — ${t.label}`,
                `${t.burnRate.toFixed(2)}×  (err ratio > ${t.errorRatioThreshold.toExponential(1)}, ${t.longWindow}/${t.shortWindow})`,
                t.severity === 'page',
              ])}
            />

            <SizerCaveat>
              Multi-window burn-rate alerting from the Google SRE Workbook. Wire the{' '}
              <span className="font-mono">sli:error_ratio</span> recording rule to your real success metric before using
              the generated alerts.
            </SizerCaveat>
          </div>
        ) : null
      }
      previewPanel={
        result.value ? (
          <pre className="max-w-full overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-xs whitespace-pre">
            {result.value.prometheusRule}
          </pre>
        ) : null
      }
    />
  )
}
