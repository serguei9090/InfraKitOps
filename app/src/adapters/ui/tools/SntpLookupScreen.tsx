import { useCallback, useMemo, useState } from 'react'
import { backendPost } from '@/adapters/backend/backendClient'
import { NetworkToolScaffold, QueryBar, QueryField, SavedTargetsPane, StatusStrip } from '@/adapters/ui/network'
import { useNetworkRun } from '@/adapters/ui/network/useNetworkRun'
import { runToEnvelope } from '@/core/network/history'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { RunEnvelope } from '@/core/network/history'
import type { SntpResult } from '@/core/network/toolResults'
import { useNetworkSettingsStore } from '@/stores/networkSettingsStore'

const PRESETS: Record<string, string[]> = {
  'pool.ntp.org': ['0.pool.ntp.org', '1.pool.ntp.org', '2.pool.ntp.org', '3.pool.ntp.org'],
  Cloudflare: ['time.cloudflare.com'],
  Google: ['time.google.com', 'time2.google.com'],
  Microsoft: ['time.windows.com'],
}

export function SntpLookupScreen() {
  const [serversText, setServersText] = useState('pool.ntp.org')
  const timeoutMs = useNetworkSettingsStore((s) => s.defaultTimeoutMs)

  const servers = useMemo(
    () =>
      serversText
        .split(/[\s;,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [serversText],
  )

  const run = useCallback(
    async (signal: AbortSignal): Promise<RunEnvelope> => {
      const { envelope } = await backendPost<{ envelope: RunEnvelope }>(
        '/sntp',
        { servers, timeoutMs },
        signal,
      )
      return envelope
    },
    [servers, timeoutMs],
  )

  const { running, error, result, envelope, completions, start, stop, restore } = useNetworkRun<SntpResult>({ run })

  return (
    <NetworkToolScaffold
      title="SNTP Lookup"
      toolId="sntp"
      historyTarget={servers.join('; ')}
      historyRefreshKey={completions}
      onRestoreRun={(stored) => {
        const list = (stored.params.servers as string[] | undefined) ?? []
        if (list.length) setServersText(list.join('; '))
        restore(runToEnvelope(stored))
      }}
      savedTargets={
        <SavedTargetsPane
          tool="sntp"
          currentParams={servers.length ? { servers } : null}
          currentLabel={servers[0]}
          onLoad={(p) => Array.isArray(p.servers) && setServersText((p.servers as string[]).join('; '))}
        />
      }
      statusStrip={
        <StatusStrip
          running={running}
          items={[
            envelope ? `${result?.okCount ?? 0}/${result?.servers.length ?? 0} responded` : '',
            envelope?.finishedAt && envelope.startedAt
              ? `${envelope.finishedAt - envelope.startedAt} ms`
              : '',
          ].filter(Boolean)}
        />
      }
      queryBar={
        <QueryBar onRun={start} onStop={stop} running={running} canRun={servers.length > 0} runLabel="Query">
          <QueryField label="NTP server(s)" htmlFor="sntp-servers" className="min-w-[22rem] flex-1">
            <Input
              id="sntp-servers"
              value={serversText}
              onChange={(e) => setServersText(e.target.value)}
              placeholder="pool.ntp.org; time.cloudflare.com"
              className="font-mono"
            />
          </QueryField>
          <div className="flex flex-wrap gap-1.5">
            {Object.keys(PRESETS).map((name) => (
              <Button
                key={name}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setServersText(PRESETS[name].join('; '))}
              >
                {name}
              </Button>
            ))}
          </div>
        </QueryBar>
      }
      results={
        <SntpResults result={result} error={error} pending={running} />
      }
    />
  )
}

function SntpResults({
  result,
  error,
  pending,
}: {
  result: SntpResult | undefined
  error: string | null
  pending: boolean
}) {
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!result && pending) return <p className="text-sm text-muted-foreground">Querying…</p>
  if (!result) return <p className="text-sm text-muted-foreground">Enter one or more NTP servers and press Query.</p>

  return (
    <div className="space-y-4">
      <p className="text-sm">
        Median clock offset:{' '}
        <span className="font-mono font-medium">{fmtSec(result.medianOffsetSec)}</span>
      </p>
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Server</TableHead>
              <TableHead className="text-right">Offset</TableHead>
              <TableHead className="text-right">RTT</TableHead>
              <TableHead className="text-right">Stratum</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Server time (UTC)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.servers.map((row) => (
              <TableRow key={row.server}>
                <TableCell className="font-mono">{row.server}</TableCell>
                {row.ok ? (
                  <>
                    <TableCell className="text-right font-mono tabular-nums">{fmtSec(row.clockOffsetSec)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{row.rttMs.toFixed(1)} ms</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{row.stratum}</TableCell>
                    <TableCell className="font-mono text-xs">{row.referenceId ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{row.serverTime?.replace('T', ' ').replace(/\..*/, '') ?? '—'}</TableCell>
                  </>
                ) : (
                  <TableCell colSpan={5} className="text-destructive">
                    {row.error ?? 'no response'}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function fmtSec(s: number): string {
  const ms = s * 1000
  if (Math.abs(ms) < 1000) return `${ms >= 0 ? '+' : ''}${ms.toFixed(1)} ms`
  return `${s >= 0 ? '+' : ''}${s.toFixed(3)} s`
}
