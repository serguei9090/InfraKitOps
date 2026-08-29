import { useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BalancedFlowScaffold } from '@/adapters/ui/shell/BalancedFlowScaffold'
import { BreakdownTable, SizerCaveat, StatCard, StatGrid } from '@/adapters/ui/tuning/SizerPanels'
import {
  LoadBalancerSizer,
  WORKER_MODEL_LABELS,
  type Headroom,
  type LbOutputFormat,
  type LoadBalancerSizerInput,
  type WorkerModel,
} from '@/core/tuning/loadBalancerSizer'

const sizer = new LoadBalancerSizer()

interface FormState {
  peakRps: number
  avgResponseMs: number
  instanceRamGb: number
  instanceCpuCores: number
  perWorkerRamMb: number
  osReserveMb: number
  workerModel: WorkerModel
  waitToComputeRatio: number
  targetUtilization: number
  headroom: Headroom
  outputFormat: LbOutputFormat
  upstreamName: string
}

const defaults: FormState = {
  peakRps: 500,
  avgResponseMs: 120,
  instanceRamGb: 8,
  instanceCpuCores: 4,
  perWorkerRamMb: 256,
  osReserveMb: 512,
  workerModel: 'process',
  waitToComputeRatio: 1,
  targetUtilization: 0.7,
  headroom: 'n+1',
  outputFormat: 'nginx',
  upstreamName: 'app',
}

type NumericKey = 'peakRps' | 'avgResponseMs' | 'instanceRamGb' | 'instanceCpuCores' | 'perWorkerRamMb' | 'osReserveMb' | 'waitToComputeRatio'

export function LoadBalancerSizerScreen() {
  const [form, setForm] = useState<FormState>(defaults)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((s) => ({ ...s, [key]: value }))
  }
  function num(key: NumericKey) {
    return { value: form[key], onChange: (e: ChangeEvent<HTMLInputElement>) => set(key, Number(e.target.value)) }
  }

  const result = useMemo(() => {
    try {
      const input: LoadBalancerSizerInput = { ...form }
      return { value: sizer.execute(input), error: null as string | null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [form])

  const pct = (n: number) => {
    const v = n * 100
    if (v > 0 && v < 0.5) return '<0.5%'
    return `${v.toFixed(v < 10 ? 1 : 0)}%`
  }

  return (
    <BalancedFlowScaffold
      title="Load Balancer & App Tier Sizer"
      copyText={result.value?.configText}
      configLabel="TRAFFIC & INSTANCE SHAPE"
      resultsLabel="SIZING RESULTS"
      previewLabel={form.outputFormat === 'nginx' ? 'nginx (PREVIEW)' : 'haproxy.cfg (PREVIEW)'}
      configPanel={
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="flex flex-col gap-3">
            <Label>Traffic</Label>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lb-rps">Peak requests / second</Label>
              <Input id="lb-rps" type="number" min={1} {...num('peakRps')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lb-latency">Avg response time (ms)</Label>
              <Input id="lb-latency" type="number" min={1} step="any" {...num('avgResponseMs')} />
              <p className="text-xs text-muted-foreground">Server-side, the service time W</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lb-util">Target worker utilisation</Label>
              <Input id="lb-util" type="number" min={0.1} max={0.95} step={0.05} value={form.targetUtilization} onChange={(e) => set('targetUtilization', Number(e.target.value))} />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Label>One app instance</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lb-ram">RAM (GiB)</Label>
                <Input id="lb-ram" type="number" min={1} step="any" {...num('instanceRamGb')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lb-cpu">vCPU / cores</Label>
                <Input id="lb-cpu" type="number" min={1} {...num('instanceCpuCores')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lb-worker-ram">RAM / worker (MiB)</Label>
                <Input id="lb-worker-ram" type="number" min={1} {...num('perWorkerRamMb')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lb-os">OS reserve (MiB)</Label>
                <Input id="lb-os" type="number" min={0} {...num('osReserveMb')} />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Label>Worker model & output</Label>
            <div className="flex flex-col gap-1.5">
              <Label>Concurrency model</Label>
              <Select value={form.workerModel} onValueChange={(v) => set('workerModel', v as WorkerModel)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: WorkerModel) => WORKER_MODEL_LABELS[v]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(WORKER_MODEL_LABELS) as WorkerModel[]).map((m) => (
                    <SelectItem key={m} value={m}>
                      {WORKER_MODEL_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.workerModel === 'thread' ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lb-wc">Wait / compute ratio</Label>
                <Input id="lb-wc" type="number" min={0} step={0.5} {...num('waitToComputeRatio')} />
                <p className="text-xs text-muted-foreground">I/O wait ÷ CPU time per request</p>
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label>Availability spares</Label>
              <div className="flex gap-2">
                {(['none', 'n+1', 'n+2'] as Headroom[]).map((h) => (
                  <Button key={h} type="button" size="sm" variant={form.headroom === h ? 'default' : 'outline'} onClick={() => set('headroom', h)}>
                    {h === 'none' ? 'None' : h.toUpperCase()}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Proxy config</Label>
              <div className="flex gap-2">
                {(['nginx', 'haproxy'] as LbOutputFormat[]).map((f) => (
                  <Button key={f} type="button" size="sm" variant={form.outputFormat === f ? 'default' : 'outline'} onClick={() => set('outputFormat', f)}>
                    {f}
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
              <StatCard label="App instances" value={result.value.instancesWithHeadroom} sub={`${result.value.instancesNeeded} needed + ${result.value.instancesWithHeadroom - result.value.instancesNeeded} spare`} />
              <StatCard label="Workers / instance" value={result.value.workersPerInstance} sub={`${result.value.bindingConstraint === 'ram' ? 'RAM' : 'CPU'}-bound`} tone="muted" />
              <StatCard label="Peak concurrency" value={Math.ceil(result.value.peakConcurrency)} sub="requests in flight (Little’s Law)" tone="muted" />
            </StatGrid>

            <BreakdownTable
              rows={[
                ['Total workers needed', String(result.value.workersNeeded)],
                ['Utilisation at that count', pct(result.value.utilizationAtTarget)],
                ['P(request queues)', pct(result.value.probabilityQueued)],
                ['RAM-bound workers / instance', String(result.value.ramBoundWorkers)],
                ['CPU-bound workers / instance', String(result.value.cpuBoundWorkers)],
                ['Effective tier capacity', `${Math.floor(result.value.effectiveCapacityRps)} rps`, true],
              ]}
            />

            <BreakdownTable
              title="Connection tuning"
              rows={[
                ['nginx worker_connections', String(result.value.nginxWorkerConnections)],
                ['Global maxconn', String(result.value.maxConnections)],
              ]}
            />

            <SizerCaveat>
              Rules of thumb — Little’s Law for concurrency, M/M/c for the worker count, standard worker-per-core
              heuristics. Load-test against the real workload before committing capacity.
            </SizerCaveat>
          </div>
        ) : null
      }
      previewPanel={
        result.value ? (
          <pre className="max-w-full overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-xs whitespace-pre">
            {result.value.configText}
          </pre>
        ) : null
      }
    />
  )
}
