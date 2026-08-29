import { useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BalancedFlowScaffold } from '@/adapters/ui/shell/BalancedFlowScaffold'
import { BreakdownTable, SizerCaveat, StatCard, StatGrid } from '@/adapters/ui/tuning/SizerPanels'
import {
  STORAGE_LAYOUT_LABELS,
  StorageIopsSizer,
  type StorageIopsSizerInput,
  type StorageLayout,
} from '@/core/tuning/storageIopsSizer'

const sizer = new StorageIopsSizer()

interface FormState {
  targetIops: number
  readPercent: number
  perDiskIops: number
  perDiskCapacityGb: number
  requiredCapacityGb: number
  layout: StorageLayout
  replicationFactor: number
  growthPercentPerYear: number
}

const defaults: FormState = {
  targetIops: 10_000,
  readPercent: 70,
  perDiskIops: 800,
  perDiskCapacityGb: 1000,
  requiredCapacityGb: 4000,
  layout: 'raid10',
  replicationFactor: 3,
  growthPercentPerYear: 30,
}

type NumericKey = Exclude<keyof FormState, 'layout'>

export function StorageIopsSizerScreen() {
  const [form, setForm] = useState<FormState>(defaults)
  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((s) => ({ ...s, [k]: v }))
  }
  function num(k: NumericKey) {
    return { value: form[k], onChange: (e: ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value)) }
  }

  const result = useMemo(() => {
    try {
      const input: StorageIopsSizerInput = { ...form }
      return { value: sizer.execute(input), error: null as string | null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [form])

  const fmtGb = (gb: number) => (gb >= 1024 ? `${(gb / 1024).toFixed(1)} TiB` : `${Math.round(gb)} GiB`)

  return (
    <BalancedFlowScaffold
      title="Storage IOPS & Capacity"
      copyText={result.value?.summaryText}
      configLabel="WORKLOAD & DISKS"
      resultsLabel="ARRAY SIZING"
      previewLabel="SUMMARY"
      configPanel={
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="flex flex-col gap-3">
            <Label>Workload</Label>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="s-iops">Peak IOPS (front-end)</Label>
              <Input id="s-iops" type="number" min={1} {...num('targetIops')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="s-read">Read %</Label>
              <Input id="s-read" type="number" min={0} max={100} {...num('readPercent')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="s-cap">Usable capacity needed (GiB)</Label>
              <Input id="s-cap" type="number" min={1} {...num('requiredCapacityGb')} />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Label>Per disk</Label>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="s-dis-iops">Random IOPS / disk</Label>
              <Input id="s-dis-iops" type="number" min={1} {...num('perDiskIops')} />
              <p className="text-xs text-muted-foreground">HDD ~150, SATA SSD ~10k, NVMe ~100k+</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="s-dis-cap">Capacity / disk (GiB)</Label>
              <Input id="s-dis-cap" type="number" min={1} {...num('perDiskCapacityGb')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="s-growth">Annual growth %</Label>
              <Input id="s-growth" type="number" min={0} {...num('growthPercentPerYear')} />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Label>Redundancy layout</Label>
            <Select value={form.layout} onValueChange={(v) => set('layout', v as StorageLayout)}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: StorageLayout) => STORAGE_LAYOUT_LABELS[v]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STORAGE_LAYOUT_LABELS) as StorageLayout[]).map((l) => (
                  <SelectItem key={l} value={l}>
                    {STORAGE_LAYOUT_LABELS[l]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.layout === 'replication' ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="s-rf">Replication factor</Label>
                <Input id="s-rf" type="number" min={1} {...num('replicationFactor')} />
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
              <StatCard label="Disks needed" value={result.value.disksNeeded} sub={`IOPS ${result.value.disksForIops} · capacity ${result.value.disksForCapacity}`} />
              <StatCard label="Write penalty" value={`×${result.value.penalty}`} sub={`back-end ${Math.round(result.value.backEndIops).toLocaleString()} IOPS`} tone="muted" />
              <StatCard
                label="Growth runway"
                value={Number.isFinite(result.value.runwayYears) ? `${result.value.runwayYears.toFixed(1)} yr` : '∞'}
                sub={`at ${form.growthPercentPerYear}% / yr`}
                tone={Number.isFinite(result.value.runwayYears) && result.value.runwayYears < 2 ? 'warn' : 'muted'}
              />
            </StatGrid>

            <BreakdownTable
              rows={[
                ['Front-end read / write IOPS', `${Math.round(result.value.frontEndReadIops)} / ${Math.round(result.value.frontEndWriteIops)}`],
                ['Back-end IOPS (with penalty)', Math.round(result.value.backEndIops).toLocaleString()],
                ['Usable write IOPS at this array', Math.round(result.value.usableIops).toLocaleString()],
                ['Usable capacity', `${fmtGb(result.value.usableCapacityGb)}  (${(result.value.usableCapacityFraction * 100).toFixed(0)}% of raw)`, true],
              ]}
            />

            <SizerCaveat>
              The RAID write penalty (×1/2/4/6) is what most back-of-envelope sizing misses. Usable write IOPS is the
              pessimistic all-write figure — reads see closer to raw disks × per-disk IOPS.
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
