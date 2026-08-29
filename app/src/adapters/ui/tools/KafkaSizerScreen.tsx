import { useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { BalancedFlowScaffold } from '@/adapters/ui/shell/BalancedFlowScaffold'
import { BreakdownTable, SizerCaveat, StatCard, StatGrid } from '@/adapters/ui/tuning/SizerPanels'
import { KafkaSizer, type KafkaSizerInput } from '@/core/tuning/kafkaSizer'

const sizer = new KafkaSizer()

interface FormState {
  ingressMbPerSec: number
  avgMessageSizeBytes: number
  replicationFactor: number
  retentionHours: number
  consumerGroups: number
  maxConsumersPerGroup: number
  partitionThroughputMbPerSec: number
  diskPerBrokerTiB: number
  networkPerBrokerGbps: number
}

const defaults: FormState = {
  ingressMbPerSec: 100,
  avgMessageSizeBytes: 1024,
  replicationFactor: 3,
  retentionHours: 168,
  consumerGroups: 3,
  maxConsumersPerGroup: 12,
  partitionThroughputMbPerSec: 10,
  diskPerBrokerTiB: 4,
  networkPerBrokerGbps: 10,
}

export function KafkaSizerScreen() {
  const [form, setForm] = useState<FormState>(defaults)
  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((s) => ({ ...s, [k]: v }))
  }
  function num(k: keyof FormState) {
    return { value: form[k], onChange: (e: ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value)) }
  }

  const result = useMemo(() => {
    try {
      const input: KafkaSizerInput = { ...form }
      return { value: sizer.execute(input), error: null as string | null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [form])

  const mb = (n: number) => `${n.toFixed(0)} MB/s`
  const tib = (n: number) => `${n.toFixed(1)} TiB`

  return (
    <BalancedFlowScaffold
      title="Kafka Sizer"
      copyText={result.value?.configText}
      configLabel="THROUGHPUT, RETENTION & HARDWARE"
      resultsLabel="CLUSTER SIZING"
      previewLabel="TOPIC CONFIG (PREVIEW)"
      configPanel={
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="flex flex-col gap-3">
            <Label>Workload</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="k-in">Ingress MB/s</Label>
                <Input id="k-in" type="number" min={1} step="any" {...num('ingressMbPerSec')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="k-msg">Msg size (B)</Label>
                <Input id="k-msg" type="number" min={1} {...num('avgMessageSizeBytes')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="k-rf">Replication factor</Label>
                <Input id="k-rf" type="number" min={1} {...num('replicationFactor')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="k-ret">Retention (h)</Label>
                <Input id="k-ret" type="number" min={1} {...num('retentionHours')} />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Label>Consumers & partitions</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="k-cg">Consumer groups</Label>
                <Input id="k-cg" type="number" min={0} {...num('consumerGroups')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="k-cpg">Max consumers / group</Label>
                <Input id="k-cpg" type="number" min={1} {...num('maxConsumersPerGroup')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="k-pt">Partition MB/s ceiling</Label>
                <Input id="k-pt" type="number" min={1} step="any" {...num('partitionThroughputMbPerSec')} />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Label>Per broker</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="k-disk">Disk (TiB)</Label>
                <Input id="k-disk" type="number" min={0.1} step="any" {...num('diskPerBrokerTiB')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="k-nic">NIC (Gbit/s)</Label>
                <Input id="k-nic" type="number" min={1} {...num('networkPerBrokerGbps')} />
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
              <StatCard label="Brokers" value={result.value.recommendedBrokers} sub={`storage ${result.value.brokersByStorage} · net ${result.value.brokersByNetwork} · parts ${result.value.brokersByPartitionCap}`} />
              <StatCard label="Partitions" value={result.value.recommendedPartitions} sub={`ingress ${result.value.partitionsByIngress} · consumers ${result.value.partitionsByConsumers}`} tone="muted" />
              <StatCard label="Total storage" value={tib(result.value.totalStorageTiB)} sub={`${tib(result.value.perBrokerStorageTiB)} / broker`} tone="muted" />
            </StatGrid>

            <BreakdownTable
              rows={[
                ['Replication egress', mb(result.value.replicationEgressMbPerSec)],
                ['Consumer egress', mb(result.value.consumerEgressMbPerSec)],
                ['Total cluster throughput', mb(result.value.totalClusterThroughputMbPerSec)],
                ['Per-broker throughput', mb(result.value.perBrokerThroughputMbPerSec)],
                ['Replica partitions / broker', String(result.value.perBrokerReplicaPartitions), true],
              ]}
            />

            {result.value.warnings.map((w, i) => (
              <Alert key={i} variant="destructive">
                <AlertDescription>{w}</AlertDescription>
              </Alert>
            ))}

            <SizerCaveat>
              Per-partition throughput is a conservative 10 MB/s default — real ceilings depend on message size,
              batching and `acks`. Floor values; load-test.
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
