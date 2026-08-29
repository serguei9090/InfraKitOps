import { useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BalancedFlowScaffold } from '@/adapters/ui/shell/BalancedFlowScaffold'
import { BreakdownTable, SizerCaveat, StatCard, StatGrid } from '@/adapters/ui/tuning/SizerPanels'
import {
  ConnectionPoolSizer,
  POOL_MODE_LABELS,
  type ConnectionPoolSizerInput,
  type PoolMode,
} from '@/core/tuning/connectionPoolSizer'

const sizer = new ConnectionPoolSizer()

interface FormState {
  dbMaxConnections: number
  reservedConnections: number
  appInstances: number
  poolSizePerInstance: number
  peakConcurrentQueriesPerInstance: number
  dbCpuCores: number
  poolMode: PoolMode
  pgbouncerPoolCount: number
}

const defaults: FormState = {
  dbMaxConnections: 200,
  reservedConnections: 10,
  appInstances: 8,
  poolSizePerInstance: 20,
  peakConcurrentQueriesPerInstance: 10,
  dbCpuCores: 8,
  poolMode: 'direct',
  pgbouncerPoolCount: 1,
}

type NumericKey = Exclude<keyof FormState, 'poolMode'>

export function ConnectionPoolSizerScreen() {
  const [form, setForm] = useState<FormState>(defaults)
  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((s) => ({ ...s, [k]: v }))
  }
  function num(k: NumericKey) {
    return { value: form[k], onChange: (e: ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value)) }
  }

  const result = useMemo(() => {
    try {
      const input: ConnectionPoolSizerInput = {
        ...form,
        dbCpuCores: form.dbCpuCores > 0 ? form.dbCpuCores : undefined,
      }
      return { value: sizer.execute(input), error: null as string | null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [form])

  const isPgbouncer = form.poolMode !== 'direct'

  return (
    <BalancedFlowScaffold
      title="Connection Pool Sizer"
      copyText={result.value?.configText}
      configLabel="DATABASE & APP TIER"
      resultsLabel="POOL FIT & RECOMMENDATION"
      previewLabel={isPgbouncer ? 'pgbouncer.ini (PREVIEW)' : 'POOL SETTINGS (PREVIEW)'}
      configPanel={
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="flex flex-col gap-3">
            <Label>Database</Label>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cp-max">max_connections</Label>
              <Input id="cp-max" type="number" min={1} {...num('dbMaxConnections')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cp-reserved">Reserved (superuser, replication, monitoring)</Label>
              <Input id="cp-reserved" type="number" min={0} {...num('reservedConnections')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cp-cores">DB CPU cores (0 = skip that ceiling)</Label>
              <Input id="cp-cores" type="number" min={0} {...num('dbCpuCores')} />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Label>App tier</Label>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cp-instances">App instances</Label>
              <Input id="cp-instances" type="number" min={1} {...num('appInstances')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cp-pool">Configured pool size / instance</Label>
              <Input id="cp-pool" type="number" min={1} {...num('poolSizePerInstance')} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cp-peak">Peak concurrent queries / instance</Label>
              <Input id="cp-peak" type="number" min={1} {...num('peakConcurrentQueriesPerInstance')} />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Label>Pooling mode</Label>
            <Select value={form.poolMode} onValueChange={(v) => set('poolMode', v as PoolMode)}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: PoolMode) => POOL_MODE_LABELS[v]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(POOL_MODE_LABELS) as PoolMode[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {POOL_MODE_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isPgbouncer ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cp-pools">(user, database) pool pairs</Label>
                <Input id="cp-pools" type="number" min={1} {...num('pgbouncerPoolCount')} />
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
              <StatCard
                label={result.value.fits ? 'Fits' : 'Over budget'}
                value={result.value.fits ? '✓' : '✕'}
                sub={`${result.value.currentServerDemand} / ${result.value.availableConnections} server connections`}
                tone={result.value.fits ? 'primary' : 'warn'}
              />
              <StatCard
                label={isPgbouncer ? 'Recommended default_pool_size' : 'Recommended pool / instance'}
                value={result.value.recommendedPoolSize}
                tone="muted"
              />
              <StatCard
                label="Headroom"
                value={`${result.value.headroom}`}
                sub={`${result.value.headroomPercent.toFixed(0)}% free`}
                tone="muted"
              />
            </StatGrid>

            <BreakdownTable
              rows={[
                ['Available (max − reserved)', String(result.value.availableConnections)],
                ['Current server demand', String(result.value.currentServerDemand)],
                ['Fair-share ceiling', String(result.value.fairShareCeiling)],
                ...(result.value.classicCeiling != null
                  ? ([['(cores·2 + spindles) ceiling', String(result.value.classicCeiling)]] as [string, string][])
                  : []),
                ...(result.value.recommendedMaxClientConn != null
                  ? ([['Recommended max_client_conn', String(result.value.recommendedMaxClientConn), true]] as [
                      string,
                      string,
                      boolean,
                    ][])
                  : []),
              ]}
            />

            {result.value.warnings.map((w, i) => (
              <Alert key={i} variant="destructive">
                <AlertDescription>{w}</AlertDescription>
              </Alert>
            ))}

            <SizerCaveat>
              A small pool a little above real query concurrency (HikariCP guidance) beats a large one. Global rule:
              Σ server connections ≤ max_connections − reserved.
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
