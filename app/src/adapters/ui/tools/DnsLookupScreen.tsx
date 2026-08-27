import { useCallback, useMemo, useState } from 'react'
import { backendPost } from '@/adapters/backend/backendClient'
import {
  NetworkResultTable,
  NetworkToolScaffold,
  QueryBar,
  QueryField,
  StatusStrip,
  useNetworkRun,
  type ResultColumn,
} from '@/adapters/ui/network'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { RunEnvelope } from '@/core/network/history'
import type { DnsRecord, DnsResult } from '@/core/network/toolResults'
import { useNetworkSettingsStore } from '@/stores/networkSettingsStore'

const TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'PTR', 'SOA', 'SRV', 'TXT', 'CAA']
const RESOLVERS: Record<string, string> = {
  Cloudflare: '1.1.1.1',
  Google: '8.8.8.8',
  Quad9: '9.9.9.9',
}

const COLUMNS: ResultColumn<DnsRecord>[] = [
  { key: 'type', header: 'Type', cell: (r) => <span className="font-mono">{r.type}</span> },
  { key: 'name', header: 'Name', cell: (r) => <span className="font-mono text-xs">{r.name}</span> },
  { key: 'ttl', header: 'TTL', align: 'right', cell: (r) => r.ttl },
  { key: 'value', header: 'Value', cell: (r) => <span className="font-mono text-xs break-all">{r.value}</span> },
]

export function DnsLookupScreen() {
  const settingsResolver = useNetworkSettingsStore((s) => s.customDnsServers.split(/[;\s,]+/)[0] ?? '')
  const [name, setName] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<string[]>(['A', 'AAAA'])
  const [resolver, setResolver] = useState(settingsResolver || '1.1.1.1')
  const [tcp, setTcp] = useState(false)

  const run = useCallback(
    async (signal: AbortSignal): Promise<RunEnvelope> => {
      const { envelope } = await backendPost<{ envelope: RunEnvelope }>(
        '/dns-lookup',
        { name: name.trim(), types: selectedTypes, resolver: resolver.trim(), tcp },
        signal,
      )
      return envelope
    },
    [name, selectedTypes, resolver, tcp],
  )

  const { running, error, result, start, stop } = useNetworkRun<DnsResult>({ run })
  const records = useMemo(() => result?.records ?? [], [result])

  function toggleType(t: string) {
    setSelectedTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))
  }

  return (
    <NetworkToolScaffold
      title="DNS Lookup"
      toolId="dns-lookup"
      statusStrip={
        <StatusStrip
          running={running}
          items={[
            result ? `${records.length} record${records.length === 1 ? '' : 's'}` : '',
            result?.resolver ? `via ${result.resolver} (${result.protocol})` : '',
          ].filter(Boolean)}
        />
      }
      queryBar={
        <QueryBar
          onRun={start}
          onStop={stop}
          running={running}
          canRun={name.trim().length > 0 && selectedTypes.length > 0}
          runLabel="Query"
          advanced={
            <>
              <QueryField label="Resolver (IP or host)" htmlFor="dns-resolver">
                <Input
                  id="dns-resolver"
                  value={resolver}
                  onChange={(e) => setResolver(e.target.value)}
                  className="w-56 font-mono"
                  placeholder="1.1.1.1"
                />
              </QueryField>
              <div className="flex gap-1.5">
                {Object.entries(RESOLVERS).map(([label, ip]) => (
                  <Button key={label} type="button" variant="outline" size="sm" onClick={() => setResolver(ip)}>
                    {label}
                  </Button>
                ))}
              </div>
              <Button
                type="button"
                variant={tcp ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setTcp((v) => !v)}
              >
                TCP {tcp ? 'on' : 'off'}
              </Button>
            </>
          }
        >
          <QueryField label="Name" htmlFor="dns-name" className="min-w-[18rem] flex-1">
            <Input
              id="dns-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && name.trim() && start()}
              placeholder="example.com"
              className="font-mono"
            />
          </QueryField>
          <QueryField label="Record types">
            <div className="flex flex-wrap gap-1">
              {TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleType(t)}
                  className={
                    'rounded-md border px-2 py-1 font-mono text-xs ' +
                    (selectedTypes.includes(t)
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground')
                  }
                >
                  {t}
                </button>
              ))}
            </div>
          </QueryField>
        </QueryBar>
      }
      results={
        error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : running && !result ? (
          <p className="text-sm text-muted-foreground">Querying…</p>
        ) : !result ? (
          <p className="text-sm text-muted-foreground">Enter a name, pick record types, and press Query.</p>
        ) : (
          <div className="space-y-3">
            <NetworkResultTable
              columns={COLUMNS}
              rows={records}
              rowKey={(r) => `${r.type}:${r.value}`}
              empty="No records returned."
            />
            {result.errors && result.errors.length > 0 ? (
              <ul className="text-xs text-destructive">
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            ) : null}
          </div>
        )
      }
    />
  )
}
