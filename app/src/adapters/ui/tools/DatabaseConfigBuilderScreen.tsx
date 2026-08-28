import { useMemo, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Slider } from '@/components/ui/slider'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { GeneratorScaffold } from '@/adapters/ui/shell/GeneratorScaffold'
import {
  DatabaseConfigBuilder,
  dbPolicyOptionsForEngine,
  dbEffectiveChoices,
  databaseEngineSuggestedFileName,
  pgWorkloadTypeLabel,
  pgStorageTypeLabel,
  pgReplicationRoleLabel,
  mariaDbWorkloadTypeLabel,
  mariaDbStorageTypeLabel,
  type DatabaseEngine,
  type PostgresMetrics,
  type MariaDbMetrics,
  type PgWorkloadType,
  type PgStorageType,
  type PgReplicationRole,
  type MariaDbWorkloadType,
  type MariaDbStorageType,
  type DbPolicyOption,
} from '@/core/config/databaseConfigBuilder'

const builder = new DatabaseConfigBuilder()

const pgWorkloadTypes: PgWorkloadType[] = ['web', 'oltp', 'dw', 'desktop', 'mixed']
const pgStorageTypes: PgStorageType[] = ['hdd', 'ssd', 'san', 'nvme']
const pgReplicationRoles: PgReplicationRole[] = ['standalone', 'primary', 'replica', 'logical']
const maWorkloadTypes: MariaDbWorkloadType[] = ['oltp', 'olap', 'mixed', 'web', 'smallVps']
const maStorageTypes: MariaDbStorageType[] = ['hdd', 'ssd', 'nvme']

interface PgFormState {
  totalMemoryMb: number
  cpuCount: string
  dbVersion: string
  dbType: PgWorkloadType
  storageType: PgStorageType
  maxConnAuto: boolean
  maxConnections: string
  osIsWindows: boolean
  dbFitsInRam: boolean
  replicationRole: PgReplicationRole
}

interface MaFormState {
  totalMemoryMb: number
  reservedForOsMb: number
  storageType: MariaDbStorageType
  dbType: MariaDbWorkloadType
  osIsWindows: boolean
  majorVersion: string
  minorVersion: string
}

function sectionsInOrder(catalog: DbPolicyOption[]): string[] {
  const seen: string[] = []
  for (const o of catalog) {
    if (!seen.includes(o.section)) seen.push(o.section)
  }
  return seen
}

function dependencyMet(activeValues: Record<string, string>, option: DbPolicyOption): boolean {
  const governingKey = option.dependsOnKey
  if (governingKey == null) return true
  const raw = activeValues[governingKey]
  if (raw == null || raw.trim().length === 0) return false
  const required = option.dependsOnValue
  if (required == null) return true
  return raw.trim().toLowerCase() === required.toLowerCase()
}

export function DatabaseConfigBuilderScreen() {
  const [engine, setEngine] = useState<DatabaseEngine>('postgresql')

  const [pg, setPg] = useState<PgFormState>({
    totalMemoryMb: 8192,
    cpuCount: '4',
    dbVersion: '17',
    dbType: 'oltp',
    storageType: 'ssd',
    maxConnAuto: true,
    maxConnections: '300',
    osIsWindows: false,
    dbFitsInRam: false,
    replicationRole: 'standalone',
  })

  const [ma, setMa] = useState<MaFormState>({
    totalMemoryMb: 8192,
    reservedForOsMb: 1024,
    storageType: 'ssd',
    dbType: 'oltp',
    osIsWindows: false,
    majorVersion: '10',
    minorVersion: '11',
  })

  // Policy option key -> selected value, one map per engine so switching
  // engines never loses the other engine's choices. Presence in the map is
  // selection, matching DatabaseConfigBuilderInput.policyValues semantics.
  const [pgPolicyValues, setPgPolicyValues] = useState<Record<string, string>>({})
  const [maPolicyValues, setMaPolicyValues] = useState<Record<string, string>>({})

  const activeCatalog = dbPolicyOptionsForEngine(engine)
  const activeValues = engine === 'postgresql' ? pgPolicyValues : maPolicyValues
  const setActiveValues = engine === 'postgresql' ? setPgPolicyValues : setMaPolicyValues

  function toggleOption(option: DbPolicyOption, checked: boolean) {
    setActiveValues((values) => {
      if (checked) {
        return { ...values, [option.key]: values[option.key] ?? option.defaultValue }
      }
      const next = { ...values }
      delete next[option.key]
      return next
    })
  }

  function updateOptionValue(option: DbPolicyOption, value: string) {
    setActiveValues((values) => ({ ...values, [option.key]: value }))
  }

  const result = useMemo(() => {
    try {
      if (engine === 'postgresql') {
        const metrics: PostgresMetrics = {
          totalMemoryMb: pg.totalMemoryMb,
          cpuCount: Number(pg.cpuCount) || 0,
          dbVersion: Number(pg.dbVersion) || 17,
          dbType: pg.dbType,
          maxConnections: pg.maxConnAuto ? undefined : Number(pg.maxConnections) || undefined,
          storageType: pg.storageType,
          osIsWindows: pg.osIsWindows,
          dbFitsInRam: pg.dbFitsInRam,
          replicationRole: pg.replicationRole,
        }
        const text = builder.execute({ engine, postgres: metrics, policyValues: pgPolicyValues })
        return { text, error: null }
      }

      const metrics: MariaDbMetrics = {
        totalMemoryMb: ma.totalMemoryMb,
        reservedForOsMb: ma.reservedForOsMb,
        storageType: ma.storageType,
        dbType: ma.dbType,
        osIsWindows: ma.osIsWindows,
        majorVersion: Number(ma.majorVersion) || 10,
        minorVersion: Number(ma.minorVersion) || 6,
      }
      const text = builder.execute({ engine, mariadb: metrics, policyValues: maPolicyValues })
      return { text, error: null }
    } catch (e) {
      return { text: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [engine, pg, ma, pgPolicyValues, maPolicyValues])

  return (
    <GeneratorScaffold
      title="Database Config Builder"
      output={
        result.text
          ? {
              text: result.text,
              fileName: databaseEngineSuggestedFileName(engine),
              mimeType: 'text/plain;charset=utf-8',
            }
          : undefined
      }
      formPanel={
        <div className="flex flex-col gap-6">
          <div>
            <p className="text-sm font-medium">Engine</p>
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                variant={engine === 'postgresql' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setEngine('postgresql')}
              >
                PostgreSQL
              </Button>
              <Button
                type="button"
                variant={engine === 'mariadb' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setEngine('mariadb')}
              >
                MariaDB
              </Button>
            </div>
          </div>

          {result.error ? (
            <Alert variant="destructive">
              <AlertDescription>{result.error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="max-w-2xl">
            {engine === 'postgresql' ? (
              <PostgresMetricsForm state={pg} onChange={(patch) => setPg((s) => ({ ...s, ...patch }))} />
            ) : (
              <MariaDbMetricsForm state={ma} onChange={(patch) => setMa((s) => ({ ...s, ...patch }))} />
            )}
          </div>

          <div>
            <p className="text-sm font-semibold">Policy options</p>
            <p className="mt-1 text-xs text-muted-foreground">Only the options you select appear in the generated file.</p>
            <div className="mt-3 flex flex-col gap-4">
              {sectionsInOrder(activeCatalog).map((section) => {
              const options = activeCatalog.filter((o) => o.section === section && dependencyMet(activeValues, o))
              if (options.length === 0) return null
              return (
                <div key={section}>
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground">{section}</p>
                  <div className="mt-2 flex flex-col gap-3">
                    {options.map((option) => (
                      <PolicyOptionRow
                        key={option.key}
                        option={option}
                        checked={Object.prototype.hasOwnProperty.call(activeValues, option.key)}
                        value={activeValues[option.key] ?? option.defaultValue}
                        onToggle={(checked) => toggleOption(option, checked)}
                        onValueChange={(value) => updateOptionValue(option, value)}
                      />
                    ))}
                  </div>
                </div>
              )
              })}
            </div>
          </div>
        </div>
      }
    />
  )
}

function PostgresMetricsForm({
  state,
  onChange,
}: {
  state: PgFormState
  onChange: (patch: Partial<PgFormState>) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-medium">Machine & workload</p>

      <div className="flex flex-col gap-1.5">
        <Label>Total RAM: {state.totalMemoryMb} MB</Label>
        <Slider
          min={512}
          max={262144}
          step={512}
          value={[state.totalMemoryMb]}
          onValueChange={(v) => onChange({ totalMemoryMb: Array.isArray(v) ? v[0] : v })}
        />
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="pg-cpu">CPU cores</Label>
          <Input
            id="pg-cpu"
            type="number"
            min={1}
            value={state.cpuCount}
            onChange={(e) => onChange({ cpuCount: e.target.value })}
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="pg-version">PostgreSQL version</Label>
          <Input
            id="pg-version"
            type="number"
            min={9}
            value={state.dbVersion}
            onChange={(e) => onChange({ dbVersion: e.target.value })}
            placeholder="17"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Workload type</Label>
        <Select value={state.dbType} onValueChange={(v) => onChange({ dbType: v as PgWorkloadType })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pgWorkloadTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {pgWorkloadTypeLabel(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Storage type</Label>
        <Select value={state.storageType} onValueChange={(v) => onChange({ storageType: v as PgStorageType })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pgStorageTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {pgStorageTypeLabel(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Replication role (drives wal_level)</Label>
        <Select
          value={state.replicationRole}
          onValueChange={(v) => onChange({ replicationRole: v as PgReplicationRole })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pgReplicationRoles.map((r) => (
              <SelectItem key={r} value={r}>
                {pgReplicationRoleLabel(r)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Label className="font-normal">Max connections: Auto</Label>
        <Switch checked={state.maxConnAuto} onCheckedChange={(v) => onChange({ maxConnAuto: v })} />
      </div>
      {!state.maxConnAuto ? (
        <Input
          type="number"
          min={1}
          value={state.maxConnections}
          onChange={(e) => onChange({ maxConnections: e.target.value })}
          placeholder="e.g. 300"
        />
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <div>
          <Label className="font-normal">Database fits entirely in RAM</Label>
          <p className="text-xs text-muted-foreground">Feeds the work_mem multiplier and random_page_cost.</p>
        </div>
        <Switch checked={state.dbFitsInRam} onCheckedChange={(v) => onChange({ dbFitsInRam: v })} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <div>
          <Label className="font-normal">Server runs Windows</Label>
          <p className="text-xs text-muted-foreground">
            Applies the Windows-specific caps and drops effective_io_concurrency.
          </p>
        </div>
        <Switch checked={state.osIsWindows} onCheckedChange={(v) => onChange({ osIsWindows: v })} />
      </div>
    </div>
  )
}

function MariaDbMetricsForm({
  state,
  onChange,
}: {
  state: MaFormState
  onChange: (patch: Partial<MaFormState>) => void
}) {
  const reservedPct = state.totalMemoryMb > 0 ? Math.round((state.reservedForOsMb / state.totalMemoryMb) * 100) : 0

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-medium">Machine & workload</p>

      <div className="flex flex-col gap-1.5">
        <Label>Total RAM: {state.totalMemoryMb} MB</Label>
        <Slider
          min={512}
          max={262144}
          step={512}
          value={[state.totalMemoryMb]}
          onValueChange={(v) => {
            const totalMemoryMb = Array.isArray(v) ? v[0] : v
            const reservedForOsMb =
              state.reservedForOsMb >= totalMemoryMb ? Math.round(totalMemoryMb * 0.15) : state.reservedForOsMb
            onChange({ totalMemoryMb, reservedForOsMb })
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>
          Reserved for OS: {state.reservedForOsMb} MB ({reservedPct}% of total)
        </Label>
        <Slider
          min={0}
          max={Math.max(1, state.totalMemoryMb - 1)}
          step={1}
          value={[Math.min(state.reservedForOsMb, Math.max(0, state.totalMemoryMb - 1))]}
          onValueChange={(v) => onChange({ reservedForOsMb: Array.isArray(v) ? v[0] : v })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Workload type</Label>
        <Select value={state.dbType} onValueChange={(v) => onChange({ dbType: v as MariaDbWorkloadType })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {maWorkloadTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {mariaDbWorkloadTypeLabel(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Storage type</Label>
        <Select value={state.storageType} onValueChange={(v) => onChange({ storageType: v as MariaDbStorageType })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {maStorageTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {mariaDbStorageTypeLabel(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="ma-major">MariaDB major version</Label>
          <Input
            id="ma-major"
            type="number"
            min={5}
            value={state.majorVersion}
            onChange={(e) => onChange({ majorVersion: e.target.value })}
            placeholder="10"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="ma-minor">Minor version</Label>
          <Input
            id="ma-minor"
            type="number"
            min={0}
            value={state.minorVersion}
            onChange={(e) => onChange({ minorVersion: e.target.value })}
            placeholder="11"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        10.8+ emits innodb_redo_log_capacity; earlier versions emit innodb_log_file_size.
      </p>

      <div className="flex items-center justify-between gap-2">
        <div>
          <Label className="font-normal">Server runs Windows</Label>
          <p className="text-xs text-muted-foreground">Switches innodb_flush_method from O_DIRECT to unbuffered.</p>
        </div>
        <Switch checked={state.osIsWindows} onCheckedChange={(v) => onChange({ osIsWindows: v })} />
      </div>
    </div>
  )
}

function PolicyOptionRow({
  option,
  checked,
  value,
  onToggle,
  onValueChange,
}: {
  option: DbPolicyOption
  checked: boolean
  value: string
  onToggle: (checked: boolean) => void
  onValueChange: (value: string) => void
}) {
  const choices = dbEffectiveChoices(option)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2.5">
        <Checkbox checked={checked} onCheckedChange={(c) => onToggle(c === true)} className="mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium">{option.label}</p>
          <p className="text-xs text-muted-foreground">{option.description}</p>
        </div>
      </div>
      {checked ? (
        <div className="pl-6.5">
          {choices.length > 0 ? (
            <Select value={value} onValueChange={(v) => onValueChange(v ?? option.defaultValue)}>
              <SelectTrigger className="w-full" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {choices.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              className="font-mono text-xs"
              value={value}
              onChange={(e) => onValueChange(e.target.value)}
              placeholder={option.hint ?? option.defaultValue}
            />
          )}
        </div>
      ) : null}
    </div>
  )
}
