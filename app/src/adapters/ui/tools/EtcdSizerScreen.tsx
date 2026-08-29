import { useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { BalancedFlowScaffold } from '@/adapters/ui/shell/BalancedFlowScaffold'
import { BreakdownTable, SizerCaveat, StatCard, StatGrid } from '@/adapters/ui/tuning/SizerPanels'
import { EtcdSizer, type EtcdSizerInput } from '@/core/tuning/etcdSizer'

const sizer = new EtcdSizer()

interface FormState {
  objectCount: number
  avgObjectSizeBytes: number
  writesPerSec: number
  compactionRetentionHours: number
  fragmentationFactor: number
  quotaBackendGiB: number
}

const defaults: FormState = {
  objectCount: 100_000,
  avgObjectSizeBytes: 8192,
  writesPerSec: 50,
  compactionRetentionHours: 1,
  fragmentationFactor: 1.8,
  quotaBackendGiB: 8,
}

const gib = (b: number) => `${(b / 1024 ** 3).toFixed(2)} GiB`
const mib = (b: number) => `${(b / 1024 ** 2).toFixed(0)} MiB`

export function EtcdSizerScreen() {
  const [form, setForm] = useState<FormState>(defaults)
  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((s) => ({ ...s, [k]: v }))
  }
  function num(k: keyof FormState) {
    return { value: form[k], onChange: (e: ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value)) }
  }

  const result = useMemo(() => {
    try {
      const input: EtcdSizerInput = { ...form }
      return { value: sizer.execute(input), error: null as string | null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [form])

  return (
    <BalancedFlowScaffold
      title="etcd Sizer"
      copyText={result.value?.configText}
      configLabel="KEYSPACE & CHURN"
      resultsLabel="DB SIZE, RAM & DISK"
      previewLabel="etcd flags (PREVIEW)"
      configPanel={
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="flex flex-col gap-3">
            <Label>Keyspace</Label>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="e-obj">Object count</Label>
              <Input id="e-obj" type="number" min={1} {...num('objectCount')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="e-size">Avg object size (B)</Label>
              <Input id="e-size" type="number" min={1} {...num('avgObjectSizeBytes')} />
              <p className="text-xs text-muted-foreground">Kubernetes objects ~5–15 KiB</p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Label>Churn & history</Label>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="e-w">Writes / sec</Label>
              <Input id="e-w" type="number" min={0} {...num('writesPerSec')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="e-comp">Compaction retention (h)</Label>
              <Input id="e-comp" type="number" min={0.05} step="any" {...num('compactionRetentionHours')} />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Label>Layout</Label>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="e-frag">Fragmentation factor</Label>
              <Input id="e-frag" type="number" min={1} step={0.1} {...num('fragmentationFactor')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="e-quota">quota-backend-bytes (GiB)</Label>
              <Input id="e-quota" type="number" min={1} max={8} step="any" {...num('quotaBackendGiB')} />
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
              <StatCard label="Peak DB size" value={gib(result.value.peakDbSizeBytes)} sub={`${result.value.hardLimitUtilizationPercent.toFixed(0)}% of the 8 GiB wall`} tone={result.value.hardLimitUtilizationPercent > 60 ? 'warn' : 'primary'} />
              <StatCard label="Recommended RAM" value={gib(result.value.recommendedRamBytes)} tone="muted" />
              <StatCard label="Defrag every" value={Number.isFinite(result.value.defragIntervalHours) ? `${result.value.defragIntervalHours.toFixed(1)} h` : '—'} tone="muted" />
            </StatGrid>

            <BreakdownTable
              rows={[
                ['Live data', mib(result.value.liveDataBytes)],
                ['MVCC history', mib(result.value.historyBytes)],
                ['Configured quota', gib(result.value.quotaBackendBytes)],
                ['Quota utilisation', `${result.value.quotaUtilizationPercent.toFixed(0)}%`],
                ['Write IOPS (fsync/s)', String(Math.round(result.value.writeIops))],
                ['Write bandwidth', `${mib(result.value.writeBandwidthBytesPerSec)}/s`, true],
              ]}
            />

            {result.value.warnings.map((w, i) => (
              <Alert key={i} variant="destructive">
                <AlertDescription>{w}</AlertDescription>
              </Alert>
            ))}

            <SizerCaveat>
              Watch <span className="font-mono">etcd_mvcc_db_total_size_in_bytes</span> and{' '}
              <span className="font-mono">etcd_disk_wal_fsync_duration_seconds</span>. Above 8 GiB etcd goes read-only
              and the control plane stalls — keep real margin.
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
