import { useMemo, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { BalancedFlowScaffold } from '@/adapters/ui/shell/BalancedFlowScaffold'
import {
  ZabbixSizer,
  formatZabbixBytes,
  zabbixDbEngineLabel,
  type ZabbixDbEngine,
} from '@/core/tuning/zabbixSizer'

const sizer = new ZabbixSizer()

interface ZabbixFormState {
  hostCount: number
  itemsPerHost: number
  checkIntervalSeconds: number
  historyRetentionDays: number
  trendsRetentionDays: number
  dbEngine: ZabbixDbEngine
  cpuCores: number
}

const defaultInput: ZabbixFormState = {
  hostCount: 200,
  itemsPerHost: 80,
  checkIntervalSeconds: 60,
  historyRetentionDays: 7,
  trendsRetentionDays: 365,
  dbEngine: 'postgresql',
  cpuCores: 8,
}

type NumericField = Exclude<keyof ZabbixFormState, 'dbEngine'>

export function ZabbixSizerScreen() {
  const [input, setInput] = useState<ZabbixFormState>(defaultInput)

  const result = useMemo(() => {
    try {
      return { value: sizer.execute(input), error: null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [input])

  function update<K extends keyof ZabbixFormState>(key: K, value: ZabbixFormState[K]) {
    setInput((s) => ({ ...s, [key]: value }))
  }

  function numberField(key: NumericField) {
    return {
      value: input[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => update(key, Number(e.target.value)),
    }
  }

  return (
    <BalancedFlowScaffold
      title="Zabbix Monitoring Sizer"
      copyText={result.value?.configText}
      resultsLabel="SIZING RESULTS & DB GROWTH"
      previewLabel="zabbix_server.conf (PREVIEW)"
      configPanel={
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-3">
            <Label>Monitored environment</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="host-count">Hosts</Label>
                <Input id="host-count" type="number" min={1} {...numberField('hostCount')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="items-per-host">Items per host</Label>
                <Input id="items-per-host" type="number" min={1} {...numberField('itemsPerHost')} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="check-interval">Check interval (seconds)</Label>
              <Input id="check-interval" type="number" min={1} step="any" {...numberField('checkIntervalSeconds')} />
              <p className="text-xs text-muted-foreground">Average item refresh rate</p>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Label>Housekeeping retention</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="history-days">History retention (days)</Label>
                <Input id="history-days" type="number" min={1} {...numberField('historyRetentionDays')} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="trends-days">Trends retention (days)</Label>
                <Input id="trends-days" type="number" min={1} {...numberField('trendsRetentionDays')} />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Label>Server</Label>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cpu-cores">CPU cores on Zabbix server</Label>
              <Input id="cpu-cores" type="number" min={1} {...numberField('cpuCores')} />
              <p className="text-xs text-muted-foreground">StartPreprocessors is floored at this value</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Database engine</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={input.dbEngine === 'postgresql' ? 'default' : 'outline'}
                  onClick={() => update('dbEngine', 'postgresql')}
                >
                  PostgreSQL
                </Button>
                <Button
                  type="button"
                  variant={input.dbEngine === 'mysql' ? 'default' : 'outline'}
                  onClick={() => update('dbEngine', 'mysql')}
                >
                  MySQL / MariaDB
                </Button>
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
            <div className="rounded-lg bg-primary/10 p-4">
              <p className="text-xs font-medium text-muted-foreground">NVPS (New Values Per Second)</p>
              <p className="mt-1 text-2xl font-semibold text-primary">{result.value.nvps.toFixed(2)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{result.value.totalItems} total items</p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">Recommended workers</p>
              <BreakdownTable
                rows={[
                  ['StartPollers', String(result.value.startPollers)],
                  ['StartPollersUnreachable', String(result.value.startPollersUnreachable)],
                  ['StartPreprocessors', String(result.value.startPreprocessors)],
                  ['StartTrappers', String(result.value.startTrappers)],
                  ['StartDBSyncers', String(result.value.startDbSyncers)],
                ]}
              />
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">Recommended caches</p>
              <BreakdownTable
                rows={[
                  ['CacheSize', `${result.value.cacheSizeMb} MB`],
                  ['HistoryCacheSize', `${result.value.historyCacheSizeMb} MB`],
                  ['HistoryIndexCacheSize', `${result.value.historyIndexCacheSizeMb} MB`],
                  ['TrendCacheSize', `${result.value.trendCacheSizeMb} MB`],
                  ['ValueCacheSize', `${result.value.valueCacheSizeMb} MB`],
                ]}
              />
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">Database growth estimate</p>
              <BreakdownTable
                rows={[
                  ['History growth / day', formatZabbixBytes(result.value.historyBytesPerDay)],
                  [
                    `History total (${input.historyRetentionDays}d retention)`,
                    formatZabbixBytes(result.value.historyBytesTotal),
                  ],
                  ['Trend rows / day', result.value.trendRowsPerDay.toFixed(0)],
                  ['Trends growth / day', formatZabbixBytes(result.value.trendsBytesPerDay)],
                  ['Trends total', formatZabbixBytes(result.value.trendsBytesTotal)],
                  [
                    `Engine overhead (${zabbixDbEngineLabel(result.value.dbEngine)})`,
                    `${result.value.engineOverheadFactor.toFixed(2)}x`,
                  ],
                ]}
                emphasizeLast={['Estimated total DB size', formatZabbixBytes(result.value.totalDbBytes)]}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Cache and worker figures are heuristic starting points — verify against the internal items Zabbix
              exposes once the server is running, e.g. zabbix[wcache,values], zabbix[vcache,buffer,pfree].
            </p>
          </div>
        ) : null
      }
      previewPanel={
        result.value ? (
          <pre className="max-w-full overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-xs">
            {result.value.configText}
          </pre>
        ) : null
      }
    />
  )
}

function BreakdownTable({
  rows,
  emphasizeLast,
}: {
  rows: [string, string][]
  emphasizeLast?: [string, string]
}) {
  const allRows = emphasizeLast ? [...rows, emphasizeLast] : rows
  return (
    <div className="mt-2 divide-y divide-border rounded-lg border border-border">
      {allRows.map(([label, value], i) => {
        const isEmphasis = emphasizeLast != null && i === allRows.length - 1
        return (
          <div key={label} className="flex items-center justify-between gap-4 px-3 py-2">
            <span className={isEmphasis ? 'text-sm font-medium' : 'text-sm text-muted-foreground'}>{label}</span>
            <span className={isEmphasis ? 'font-mono text-sm font-semibold' : 'font-mono text-sm'}>{value}</span>
          </div>
        )
      })}
    </div>
  )
}
