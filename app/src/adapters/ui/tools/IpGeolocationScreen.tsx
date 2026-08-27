import { useCallback, useState } from 'react'
import { backendPost } from '@/adapters/backend/backendClient'
import { NetworkToolScaffold, QueryBar, QueryField, StatusStrip, TextResultView, useNetworkRun } from '@/adapters/ui/network'
import { Input } from '@/components/ui/input'
import type { RunEnvelope } from '@/core/network/history'
import type { IpGeoResult } from '@/core/network/toolResults'

export function IpGeolocationScreen() {
  const [query, setQuery] = useState('')

  const run = useCallback(
    async (signal: AbortSignal): Promise<RunEnvelope> => {
      const { envelope } = await backendPost<{ envelope: RunEnvelope }>(
        '/ip-geolocation',
        { query: query.trim() },
        signal,
      )
      return envelope
    },
    [query],
  )

  const { running, error, result, start, stop } = useNetworkRun<IpGeoResult>({ run })

  return (
    <NetworkToolScaffold
      title="IP Geolocation"
      toolId="ip-geolocation"
      statusStrip={
        <StatusStrip
          running={running}
          items={[
            result?.fields?.country ? `${result.fields.city ?? ''} ${result.fields.country}`.trim() : '',
            result ? `ip-api quota: ${result.rateRemaining} left` : '',
          ].filter(Boolean)}
        />
      }
      queryBar={
        <QueryBar onRun={start} onStop={stop} running={running} canRun={query.trim().length > 0} runLabel="Locate">
          <QueryField label="IP address or hostname" htmlFor="geo-q" className="min-w-[22rem] flex-1">
            <Input
              id="geo-q"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && query.trim() && start()}
              placeholder="1.1.1.1  or  example.com"
              className="font-mono"
            />
          </QueryField>
        </QueryBar>
      }
      results={
        error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : running && !result ? (
          <p className="text-sm text-muted-foreground">Locating…</p>
        ) : !result ? (
          <p className="text-sm text-muted-foreground">Enter a public IP or hostname. Data from ip-api.com (non-commercial use).</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Country" value={fmt(result.fields.country, result.fields.countryCode)} />
              <Stat label="City / Region" value={`${result.fields.city ?? '—'}, ${result.fields.regionName ?? ''}`} />
              <Stat label="ISP" value={String(result.fields.isp ?? '—')} />
              <Stat label="Org" value={String(result.fields.org ?? '—')} />
              <Stat label="AS" value={String(result.fields.as ?? '—')} />
              <Stat
                label="Coordinates"
                value={
                  result.fields.lat !== undefined ? `${result.fields.lat}, ${result.fields.lon}` : '—'
                }
              />
            </div>
            <TextResultView text={result.text} title="All fields" />
          </div>
        )
      }
    />
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium break-words">{value}</p>
    </div>
  )
}

function fmt(a: unknown, code: unknown): string {
  if (!a) return '—'
  return code ? `${a} (${code})` : String(a)
}
