import { useCallback, useEffect, useState } from 'react'
import { backendGet, backendPost } from '@/adapters/backend/backendClient'
import {
  NetworkToolScaffold,
  QueryBar,
  QueryField,
  SavedTargetsPane,
  Sparkline,
  StatusStrip,
  useNetworkRun,
} from '@/adapters/ui/network'
import { runToEnvelope } from '@/core/network/history'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { RunEnvelope } from '@/core/network/history'
import type { IperfResult } from '@/core/network/toolResults'

export function Iperf3Screen() {
  const [host, setHost] = useState('')
  const [port, setPort] = useState(5201)
  const [duration, setDuration] = useState(10)
  const [reverse, setReverse] = useState(false)
  const [bidir, setBidir] = useState(false)
  const [udp, setUdp] = useState(false)
  const [parallel, setParallel] = useState(1)
  const [omit, setOmit] = useState(0)
  const [override, setOverride] = useState(false)
  const [mss, setMss] = useState(0)
  const [length, setLength] = useState(0)
  const [bitrate, setBitrate] = useState('')
  const [extraArgs, setExtraArgs] = useState('')

  const params = useCallback(
    () => ({
      host: host.trim(),
      port,
      duration,
      reverse: bidir ? false : reverse,
      bidir,
      udp,
      parallel,
      omit,
      mss: override ? mss : 0,
      length: override ? length : 0,
      bitrate: override ? bitrate : '',
      extraArgs: extraArgs.trim(),
    }),
    [host, port, duration, reverse, bidir, udp, parallel, omit, override, mss, length, bitrate, extraArgs],
  )

  const run = useCallback(
    async (signal: AbortSignal): Promise<RunEnvelope> => {
      const { envelope } = await backendPost<{ envelope: RunEnvelope }>('/iperf3', params(), signal)
      return envelope
    },
    [params],
  )

  const { running, error, result, completions, start, stop, restore } = useNetworkRun<IperfResult>({ run })
  const d = result?.detail

  const [server, setServer] = useState<{ running: boolean; port: number }>({ running: false, port: 5201 })
  const refreshServer = useCallback(() => {
    backendGet<{ running: boolean; port: number }>('/iperf3/server')
      .then(setServer)
      .catch(() => {})
  }, [])
  useEffect(refreshServer, [refreshServer])

  async function toggleServer() {
    try {
      const next = await backendPost<{ running: boolean; port: number }>('/iperf3/server', {
        running: !server.running,
        port,
      })
      setServer(next)
    } catch {
      /* not-installed handled by the results banner */
    }
  }

  return (
    <NetworkToolScaffold
      title="iperf3 Throughput"
      toolId="iperf3"
      historyTarget={host.trim()}
      historyRefreshKey={completions}
      onRestoreRun={(stored) => {
        if (typeof stored.params.host === 'string') setHost(stored.params.host)
        restore(runToEnvelope(stored))
      }}
      savedTargets={
        <SavedTargetsPane
          tool="iperf3"
          currentParams={host.trim() ? params() : null}
          currentLabel={host.trim()}
          onLoad={(p) => {
            if (typeof p.host === 'string') setHost(p.host)
            if (typeof p.port === 'number') setPort(p.port)
          }}
        />
      }
      statusStrip={
        <StatusStrip
          running={running}
          items={[
            result ? `avg ${result.stats.avg.toFixed(1)} Mbit/s` : '',
            d ? `${d.protocol}${d.reverse ? ' (reverse)' : ''}` : '',
            d?.sender.retransmits ? `${d.sender.retransmits} retransmits` : '',
          ].filter(Boolean)}
        />
      }
      queryBar={
        <QueryBar
          onRun={start}
          onStop={stop}
          running={running}
          canRun={host.trim().length > 0}
          runLabel="Run test"
          advanced={
            <>
              <QueryField label="Port" htmlFor="ip-port">
                <Input id="ip-port" type="number" value={port} onChange={(e) => setPort(Number(e.target.value) || 5201)} className="w-24" />
              </QueryField>
              <QueryField label="Duration (s)" htmlFor="ip-dur">
                <Input id="ip-dur" type="number" min={1} max={60} value={duration} onChange={(e) => setDuration(Math.max(1, Math.min(60, Number(e.target.value) || 10)))} className="w-20" />
              </QueryField>
              <Button type="button" size="sm" variant={reverse ? 'secondary' : 'outline'} disabled={bidir} onClick={() => setReverse((v) => !v)}>
                Reverse {reverse ? 'on' : 'off'}
              </Button>
              <Button type="button" size="sm" variant={bidir ? 'secondary' : 'outline'} onClick={() => setBidir((v) => !v)}>
                Bidirectional {bidir ? 'on' : 'off'}
              </Button>
              <Button type="button" size="sm" variant={udp ? 'secondary' : 'outline'} onClick={() => setUdp((v) => !v)}>
                UDP {udp ? 'on' : 'off'}
              </Button>
              <QueryField label="Parallel (-P)" htmlFor="ip-par">
                <Input id="ip-par" type="number" min={1} max={128} value={parallel} onChange={(e) => setParallel(Math.max(1, Math.min(128, Number(e.target.value) || 1)))} className="w-20" />
              </QueryField>
              <QueryField label="Omit (-O)" htmlFor="ip-omit">
                <Input id="ip-omit" type="number" min={0} max={60} value={omit} onChange={(e) => setOmit(Math.max(0, Math.min(60, Number(e.target.value) || 0)))} placeholder="0" className="w-20" />
              </QueryField>
              <Button type="button" size="sm" variant={override ? 'secondary' : 'outline'} onClick={() => setOverride((v) => !v)}>
                {override ? 'Custom MTU/buffers' : 'Use defaults'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={server.running ? 'secondary' : 'outline'}
                onClick={() => void toggleServer()}
              >
                {server.running ? `Stop local server (:${server.port})` : 'Start local server'}
              </Button>
              {override ? (
                <>
                  <QueryField label="MSS (--set-mss)" htmlFor="ip-mss">
                    <Input id="ip-mss" type="number" value={mss} onChange={(e) => setMss(Number(e.target.value) || 0)} placeholder="0 = default" className="w-28" />
                  </QueryField>
                  <QueryField label="Length (-l)" htmlFor="ip-len">
                    <Input id="ip-len" type="number" value={length} onChange={(e) => setLength(Number(e.target.value) || 0)} placeholder="0 = default" className="w-28" />
                  </QueryField>
                  {udp ? (
                    <QueryField label="Bitrate (-b)" htmlFor="ip-br">
                      <Input id="ip-br" value={bitrate} onChange={(e) => setBitrate(e.target.value)} placeholder="e.g. 100M" className="w-24" />
                    </QueryField>
                  ) : null}
                </>
              ) : null}
              <QueryField label="Extra iperf3 args" htmlFor="ip-extra" className="min-w-0 flex-1 basis-[18rem]">
                <Input
                  id="ip-extra"
                  value={extraArgs}
                  onChange={(e) => setExtraArgs(e.target.value)}
                  placeholder="passed verbatim, e.g. --get-server-output --dscp AF11"
                  className="font-mono"
                />
              </QueryField>
            </>
          }
        >
          <QueryField label="iperf3 server host" htmlFor="ip-host" className="min-w-0 flex-1 basis-[22rem]">
            <Input id="ip-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="10.0.0.5  (run `iperf3 -s` there)" className="font-mono" />
          </QueryField>
        </QueryBar>
      }
      results={
        error ? (
          error.includes('503') ? (
            <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
              <p className="font-medium">iperf3 is not installed.</p>
              <p>
                Linux/macOS ship a bundled static copy. On Windows, install it once — every build links{' '}
                <code>cygwin1.dll</code> (GPL), so it can&apos;t be bundled:
              </p>
              <pre className="rounded bg-black/10 p-2 font-mono text-xs dark:bg-white/10">winget install ar51an.iPerf3</pre>
              <p className="text-xs">
                Then reload. (<code>choco install iperf3</code> or a manual download also work.)
              </p>
            </div>
          ) : (
            <p className="text-sm text-destructive">{error}</p>
          )
        ) : running && !result ? (
          <p className="text-sm text-muted-foreground">Running test…</p>
        ) : !result ? (
          <p className="text-sm text-muted-foreground">
            Enter a host running <code>iperf3 -s</code> and press Run — or hit <em>Start local server</em> (Advanced) and
            run <code>iperf3 -c &lt;this machine&gt;</code> from the other end.
          </p>
        ) : d && !d.ok ? (
          <p className="text-sm text-destructive">{d.error || 'test failed'}</p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Sender" value={`${(result.detail.sender.bitsPerSecond / 1e6).toFixed(1)} Mbit/s`} />
              <Stat label="Receiver" value={`${(result.detail.receiver.bitsPerSecond / 1e6).toFixed(1)} Mbit/s`} />
              <Stat label="Avg / p95" value={`${result.stats.avg.toFixed(0)} / ${result.stats.p95.toFixed(0)}`} />
              <Stat
                label={d?.protocol === 'UDP' ? 'Jitter / loss' : 'Retransmits'}
                value={
                  d?.protocol === 'UDP'
                    ? `${result.detail.receiver.jitterMs?.toFixed(2) ?? '—'} ms / ${result.detail.receiver.lostPercent?.toFixed(1) ?? '—'}%`
                    : `${result.detail.sender.retransmits ?? 0}`
                }
              />
            </div>
            {result.samples.length >= 2 ? (
              <div className="rounded-lg border border-border/60 bg-card p-3">
                <p className="mb-1 text-xs text-muted-foreground">Per-second throughput (Mbit/s)</p>
                <Sparkline values={result.samples} width={560} height={64} className="w-full" />
              </div>
            ) : null}
            {d?.command?.length ? (
              <div className="rounded-lg border border-border/60 bg-card p-3">
                <p className="mb-1 text-xs text-muted-foreground">Command</p>
                <code className="block overflow-x-auto whitespace-pre font-mono text-xs">{d.command.join(' ')}</code>
              </div>
            ) : null}
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
      <p className="mt-0.5 font-mono text-sm font-medium">{value}</p>
    </div>
  )
}
