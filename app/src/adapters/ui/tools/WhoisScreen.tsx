import { useCallback, useState } from 'react'
import { backendPost } from '@/adapters/backend/backendClient'
import {
  NetworkToolScaffold,
  QueryBar,
  QueryField,
  SavedTargetsPane,
  StatusStrip,
  TextResultView,
  useNetworkRun,
} from '@/adapters/ui/network'
import { runToEnvelope } from '@/core/network/history'
import { Input } from '@/components/ui/input'
import type { RunEnvelope } from '@/core/network/history'
import type { WhoisResult } from '@/core/network/toolResults'
import { useNetworkSettingsStore } from '@/stores/networkSettingsStore'

export function WhoisScreen() {
  const [query, setQuery] = useState('')
  const timeoutMs = useNetworkSettingsStore((s) => s.defaultTimeoutMs)

  const run = useCallback(
    async (signal: AbortSignal): Promise<RunEnvelope> => {
      const { envelope } = await backendPost<{ envelope: RunEnvelope }>(
        '/whois',
        { query: query.trim(), timeoutMs: Math.max(timeoutMs, 20000) },
        signal,
      )
      return envelope
    },
    [query, timeoutMs],
  )

  const { running, error, result, completions, start, stop, restore } = useNetworkRun<WhoisResult>({ run })
  const p = result?.parsed

  return (
    <NetworkToolScaffold
      title="Whois"
      toolId="whois"
      historyTarget={query.trim()}
      historyRefreshKey={completions}
      onRestoreRun={(stored) => {
        if (typeof stored.params.query === 'string') setQuery(stored.params.query)
        restore(runToEnvelope(stored))
      }}
      savedTargets={
        <SavedTargetsPane
          tool="whois"
          currentParams={query.trim() ? { query: query.trim() } : null}
          currentLabel={query.trim()}
          onLoad={(p) => typeof p.query === 'string' && setQuery(p.query)}
        />
      }
      statusStrip={<StatusStrip running={running} items={[p?.registrar ? `Registrar: ${p.registrar}` : '']} />}
      queryBar={
        <QueryBar onRun={start} onStop={stop} running={running} canRun={query.trim().length > 0} runLabel="Query">
          <QueryField label="Domain or IP" htmlFor="whois-q" className="min-w-0 flex-1 basis-[22rem]">
            <Input
              id="whois-q"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && query.trim() && start()}
              placeholder="example.com"
              className="font-mono"
            />
          </QueryField>
        </QueryBar>
      }
      results={
        error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : running && !result ? (
          <p className="text-sm text-muted-foreground">Querying…</p>
        ) : !result ? (
          <p className="text-sm text-muted-foreground">Enter a domain or IP and press Query.</p>
        ) : (
          <div className="space-y-4">
            {p ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
                <Field label="Registrar" value={p.registrar} />
                <Field label="Created" value={p.createdDate} />
                <Field label="Updated" value={p.updatedDate} />
                <Field label="Expires" value={p.expirationDate} />
                <Field label="DNSSEC" value={p.dnssec} />
                <Field label="Name servers" value={p.nameServers?.join('  ')} />
                <Field label="Status" value={p.statuses?.join('  ')} />
              </dl>
            ) : null}
            {result.parseError ? (
              <p className="text-xs text-muted-foreground">Structured parse unavailable: {result.parseError}</p>
            ) : null}
            <TextResultView text={result.text} title="Raw WHOIS response" />
          </div>
        )
      }
    />
  )
}

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono break-all">{value}</dd>
    </>
  )
}
