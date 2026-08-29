import { useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { BalancedFlowScaffold } from '@/adapters/ui/shell/BalancedFlowScaffold'
import { BreakdownTable, SizerCaveat, StatCard, StatGrid } from '@/adapters/ui/tuning/SizerPanels'
import { K8sCapacitySizer, type K8sCapacitySizerInput } from '@/core/tuning/k8sCapacitySizer'

const sizer = new K8sCapacitySizer()

interface FormState {
  nodeCpuCores: number
  nodeRamGb: number
  maxPodsPerNode: number
  daemonSetCpuMillis: number
  daemonSetRamMb: number
  daemonSetPods: number
  podCpuRequestMillis: number
  podRamRequestMb: number
  replicas: number
  targetUtilization: number
  azCount: number
  namespace: string
}

const defaults: FormState = {
  nodeCpuCores: 8,
  nodeRamGb: 32,
  maxPodsPerNode: 110,
  daemonSetCpuMillis: 400,
  daemonSetRamMb: 512,
  daemonSetPods: 6,
  podCpuRequestMillis: 250,
  podRamRequestMb: 512,
  replicas: 30,
  targetUtilization: 0.8,
  azCount: 3,
  namespace: 'team-a',
}

type NumericKey = Exclude<keyof FormState, 'namespace'>

export function K8sCapacitySizerScreen() {
  const [form, setForm] = useState<FormState>(defaults)
  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((s) => ({ ...s, [k]: v }))
  }
  function num(k: NumericKey) {
    return { value: form[k], onChange: (e: ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value)) }
  }

  const result = useMemo(() => {
    try {
      const input: K8sCapacitySizerInput = { ...form }
      return { value: sizer.execute(input), error: null as string | null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [form])

  const fmtCpu = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} cores` : `${Math.round(m)}m`)
  const fmtRam = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GiB` : `${Math.round(mb)} MiB`)

  return (
    <BalancedFlowScaffold
      title="Kubernetes Node & Pod Capacity"
      copyText={result.value?.configText}
      configLabel="NODE, WORKLOAD & SPREAD"
      resultsLabel="CAPACITY"
      previewLabel="ResourceQuota + LimitRange (PREVIEW)"
      configPanel={
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="flex flex-col gap-3">
            <Label>Node type</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="k-cpu">vCPU</Label>
                <Input id="k-cpu" type="number" min={1} {...num('nodeCpuCores')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="k-ram">RAM (GiB)</Label>
                <Input id="k-ram" type="number" min={1} step="any" {...num('nodeRamGb')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="k-maxpods">--max-pods</Label>
                <Input id="k-maxpods" type="number" min={1} {...num('maxPodsPerNode')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="k-target">Target fill</Label>
                <Input id="k-target" type="number" min={0.1} max={1} step={0.05} value={form.targetUtilization} onChange={(e) => set('targetUtilization', Number(e.target.value))} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              kube/system-reserved auto-computed GKE-style from the node size.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <Label>DaemonSets (per node)</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="k-ds-cpu">CPU (m)</Label>
                <Input id="k-ds-cpu" type="number" min={0} {...num('daemonSetCpuMillis')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="k-ds-ram">RAM (Mi)</Label>
                <Input id="k-ds-ram" type="number" min={0} {...num('daemonSetRamMb')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="k-ds-pods">Pods</Label>
                <Input id="k-ds-pods" type="number" min={0} {...num('daemonSetPods')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="k-az">AZ count</Label>
                <Input id="k-az" type="number" min={1} {...num('azCount')} />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Label>Workload</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="k-pod-cpu">Pod CPU req (m)</Label>
                <Input id="k-pod-cpu" type="number" min={1} {...num('podCpuRequestMillis')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="k-pod-ram">Pod RAM req (Mi)</Label>
                <Input id="k-pod-ram" type="number" min={1} {...num('podRamRequestMb')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="k-replicas">Replicas</Label>
                <Input id="k-replicas" type="number" min={1} {...num('replicas')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="k-ns">Namespace</Label>
                <Input id="k-ns" value={form.namespace} onChange={(e) => set('namespace', e.target.value)} />
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
              <StatCard label="Nodes" value={result.value.nodesBalanced} sub={`${result.value.nodesNeeded} needed · ${result.value.nodesPerAz}/AZ`} />
              <StatCard label="Pods / node" value={result.value.podsPerNode} sub={`${result.value.bindingConstraint}-bound`} tone="muted" />
              <StatCard
                label="Survives 1 AZ loss"
                value={result.value.survivesOneAzLoss ? '✓' : '✕'}
                tone={result.value.survivesOneAzLoss ? 'primary' : 'warn'}
              />
            </StatGrid>

            <BreakdownTable
              rows={[
                ['Allocatable CPU / node', fmtCpu(result.value.allocatableCpuMillis)],
                ['Allocatable RAM / node', fmtRam(result.value.allocatableRamMb)],
                ['Usable after DaemonSets — CPU', fmtCpu(result.value.usableCpuMillis)],
                ['Usable after DaemonSets — RAM', fmtRam(result.value.usableRamMb)],
                ['CPU-bound pods / node', String(result.value.cpuBoundPods)],
                ['RAM-bound pods / node', String(result.value.ramBoundPods)],
                ['Request packing — CPU', `${result.value.cpuPackingEfficiency.toFixed(0)}%`],
                ['Request packing — RAM', `${result.value.ramPackingEfficiency.toFixed(0)}%`, true],
              ]}
            />

            <SizerCaveat>
              Estimate — real schedulability depends on affinity, topology spread, PodDisruptionBudgets, and actual
              usage vs requests. `--max-pods` and the CNI (IP-per-pod limits) can bind before CPU/RAM on large nodes.
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
