import { useCallback, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { backendPost } from '@/adapters/backend/backendClient'
import { NetworkToolScaffold, QueryBar, QueryField, StatusStrip, useNetworkRun } from '@/adapters/ui/network'
import { Input } from '@/components/ui/input'
import type { RunEnvelope } from '@/core/network/history'
import type { WolResult } from '@/core/network/toolResults'

const MAC_RE = /^(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$|^[0-9a-fA-F]{12}$/

export function WakeOnLanScreen() {
  const [mac, setMac] = useState('')
  const [broadcast, setBroadcast] = useState('255.255.255.255')
  const [port, setPort] = useState(9)

  const macValid = MAC_RE.test(mac.trim())

  const run = useCallback(
    async (signal: AbortSignal): Promise<RunEnvelope> => {
      const { envelope } = await backendPost<{ envelope: RunEnvelope }>(
        '/wake-on-lan',
        { mac: mac.trim(), broadcast: broadcast.trim(), port },
        signal,
      )
      return envelope
    },
    [mac, broadcast, port],
  )

  const { running, error, result, envelope, start } = useNetworkRun<WolResult>({ run })

  return (
    <NetworkToolScaffold
      title="Wake on LAN"
      toolId="wake-on-lan"
      statusStrip={<StatusStrip running={running} items={[result ? `${result.bytesSent} bytes sent` : '']} />}
      queryBar={
        <QueryBar
          onRun={start}
          running={running}
          canRun={macValid}
          runLabel="Send magic packet"
          advanced={
            <>
              <QueryField label="Broadcast address" htmlFor="wol-bc">
                <Input id="wol-bc" value={broadcast} onChange={(e) => setBroadcast(e.target.value)} className="w-48 font-mono" />
              </QueryField>
              <QueryField label="UDP port" htmlFor="wol-port">
                <Input
                  id="wol-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(e) => setPort(Math.max(1, Math.min(65535, Number(e.target.value) || 9)))}
                  className="w-24"
                />
              </QueryField>
            </>
          }
        >
          <QueryField label="Target MAC address" htmlFor="wol-mac" className="min-w-[18rem] flex-1">
            <Input
              id="wol-mac"
              value={mac}
              onChange={(e) => setMac(e.target.value)}
              placeholder="00:11:22:33:44:55"
              className="font-mono"
              aria-invalid={mac.length > 0 && !macValid}
            />
          </QueryField>
        </QueryBar>
      }
      results={
        error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : result && envelope?.status === 'ok' ? (
          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card p-4 text-sm">
            <CheckCircle2 className="size-5 text-emerald-500" />
            <span>{result.text}</span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Enter the target&apos;s MAC address. The packet is sent as a UDP broadcast on your local segment — the
            host must support Wake-on-LAN and be on the same broadcast domain.
          </p>
        )
      }
    />
  )
}
