import { useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BalancedFlowScaffold } from '@/adapters/ui/shell/BalancedFlowScaffold'
import { BreakdownTable, SizerCaveat, StatCard, StatGrid } from '@/adapters/ui/tuning/SizerPanels'
import {
  ACCESS_PATTERN_LABELS,
  CacheSizer,
  type AccessPattern,
  type CacheSizerInput,
  type EvictionPolicy,
} from '@/core/tuning/cacheSizer'

const sizer = new CacheSizer()

const POLICIES: EvictionPolicy[] = ['allkeys-lru', 'allkeys-lfu', 'volatile-lru', 'volatile-ttl', 'noeviction']

interface FormState {
  workingSetItems: number
  avgItemSizeBytes: number
  keyOverheadBytes: number
  targetHitRatioPercent: number
  accessPattern: AccessPattern
  readsPerSec: number
  missLatencyMs: number
  evictionPolicy: EvictionPolicy
}

const defaults: FormState = {
  workingSetItems: 1_000_000,
  avgItemSizeBytes: 512,
  keyOverheadBytes: 64,
  targetHitRatioPercent: 90,
  accessPattern: 'skewed',
  readsPerSec: 20_000,
  missLatencyMs: 5,
  evictionPolicy: 'allkeys-lru',
}

function fmtBytes(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GiB`
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1)} MiB`
  return `${(b / 1024).toFixed(0)} KiB`
}

export function CacheSizerScreen() {
  const [form, setForm] = useState<FormState>(defaults)
  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((s) => ({ ...s, [k]: v }))
  }
  function num(k: Exclude<keyof FormState, 'accessPattern' | 'evictionPolicy'>) {
    return { value: form[k], onChange: (e: ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value)) }
  }

  const result = useMemo(() => {
    try {
      const input: CacheSizerInput = { ...form }
      return { value: sizer.execute(input), error: null as string | null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [form])

  return (
    <BalancedFlowScaffold
      title="Cache Sizer"
      copyText={result.value?.configText}
      configLabel="WORKING SET & ACCESS"
      resultsLabel="MEMORY & DB OFFLOAD"
      previewLabel="redis.conf (PREVIEW)"
      configPanel={
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="flex flex-col gap-3">
            <Label>Working set</Label>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ca-items">Distinct keys</Label>
              <Input id="ca-items" type="number" min={1} {...num('workingSetItems')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ca-val">Value bytes</Label>
                <Input id="ca-val" type="number" min={1} {...num('avgItemSizeBytes')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ca-ovh">Overhead / key</Label>
                <Input id="ca-ovh" type="number" min={0} {...num('keyOverheadBytes')} />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Label>Target & access</Label>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ca-hit">Target hit ratio %</Label>
              <Input id="ca-hit" type="number" min={1} max={99} {...num('targetHitRatioPercent')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Access pattern</Label>
              <Select value={form.accessPattern} onValueChange={(v) => set('accessPattern', v as AccessPattern)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: AccessPattern) => ACCESS_PATTERN_LABELS[v]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ACCESS_PATTERN_LABELS) as AccessPattern[]).map((p) => (
                    <SelectItem key={p} value={p}>
                      {ACCESS_PATTERN_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Label>Load & policy</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ca-rps">Reads / sec</Label>
                <Input id="ca-rps" type="number" min={0} {...num('readsPerSec')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ca-miss">Miss latency (ms)</Label>
                <Input id="ca-miss" type="number" min={0} step="any" {...num('missLatencyMs')} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Eviction policy</Label>
              <Select value={form.evictionPolicy} onValueChange={(v) => set('evictionPolicy', v as EvictionPolicy)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POLICIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <StatCard label="Recommended maxmemory" value={fmtBytes(result.value.recommendedMaxmemoryBytes)} sub={`${(result.value.fractionCached * 100).toFixed(0)}% of the working set`} />
              <StatCard label="Hit ratio reached" value={`${(result.value.achievedHitRatio * 100).toFixed(1)}%`} tone="muted" />
              <StatCard label="DB reads offloaded" value={`${Math.round(result.value.dbReadsOffloadedPerSec).toLocaleString()}/s`} sub={`${Math.round(result.value.dbReadsRemainingPerSec).toLocaleString()}/s still hit the DB`} tone="primary" />
            </StatGrid>

            <BreakdownTable
              rows={[
                ['Entry size (value + overhead)', `${result.value.entryBytes} B`],
                ['Full working set in memory', fmtBytes(result.value.fullWorkingSetBytes)],
                ['Entries resident for target', result.value.entriesForTarget.toLocaleString()],
                ['Memory for target hit ratio', fmtBytes(result.value.memoryForTargetBytes)],
                ['DB latency avoided', `${(result.value.latencyAvoidedMsPerSec / 1000).toFixed(1)} s of DB time per second`, true],
              ]}
            />

            <SizerCaveat>
              Hit-ratio model is a Zipf approximation — real numbers depend on temporal locality and TTLs. Measure with{' '}
              <span className="font-mono">INFO stats</span> (keyspace_hits / keyspace_misses).
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
