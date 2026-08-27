import { useCallback, useState } from 'react'
import { backendPost } from '@/adapters/backend/backendClient'
import {
  NetworkResultTable,
  NetworkToolScaffold,
  QueryBar,
  QueryField,
  SavedTargetsPane,
  StatusStrip,
  useNetworkRun,
  type ResultColumn,
} from '@/adapters/ui/network'
import { runToEnvelope } from '@/core/network/history'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { RunEnvelope } from '@/core/network/history'
import type { SnmpResult, SnmpRow } from '@/core/network/toolResults'

const OID_PROFILES: Record<string, string> = {
  System: '1.3.6.1.2.1.1',
  Interfaces: '1.3.6.1.2.1.2.2.1',
  'IP addresses': '1.3.6.1.2.1.4.20.1',
  'TCP conns': '1.3.6.1.2.1.6.13.1',
  'Host resources': '1.3.6.1.2.1.25',
}

const COLUMNS: ResultColumn<SnmpRow>[] = [
  { key: 'oid', header: 'OID', cell: (r) => <span className="font-mono text-xs">{r.oid}</span> },
  { key: 'type', header: 'Type', cell: (r) => <span className="text-xs text-muted-foreground">{r.type}</span> },
  { key: 'value', header: 'Value', cell: (r) => <span className="font-mono text-xs break-all">{r.value}</span> },
]

export function SnmpScreen() {
  const [host, setHost] = useState('')
  const [version, setVersion] = useState<'1' | '2c' | '3'>('2c')
  const [mode, setMode] = useState<'get' | 'walk'>('walk')
  const [oid, setOid] = useState('1.3.6.1.2.1.1')
  const [community, setCommunity] = useState('public')
  const [username, setUsername] = useState('')
  const [secLevel, setSecLevel] = useState<'noAuthNoPriv' | 'authNoPriv' | 'authPriv'>('authPriv')
  const [authProto, setAuthProto] = useState('SHA')
  const [authKey, setAuthKey] = useState('')
  const [privProto, setPrivProto] = useState('AES')
  const [privKey, setPrivKey] = useState('')

  const params = useCallback(
    () => ({
      host: host.trim(),
      version,
      mode,
      oids: oid.split(/[\s;,]+/).map((s) => s.trim()).filter(Boolean),
      community,
      username,
      secLevel,
      authProto,
      authKey,
      privProto,
      privKey,
    }),
    [host, version, mode, oid, community, username, secLevel, authProto, authKey, privProto, privKey],
  )

  const run = useCallback(
    async (signal: AbortSignal): Promise<RunEnvelope> => {
      const { envelope } = await backendPost<{ envelope: RunEnvelope }>('/snmp', params(), signal)
      return envelope
    },
    [params],
  )

  const { running, error, result, completions, start, stop, restore } = useNetworkRun<SnmpResult>({ run })

  return (
    <NetworkToolScaffold
      title="SNMP"
      toolId="snmp"
      historyTarget={host.trim()}
      historyRefreshKey={completions}
      onRestoreRun={(stored) => {
        const p = stored.params
        if (typeof p.host === 'string') setHost(p.host)
        if (p.version === '1' || p.version === '2c' || p.version === '3') setVersion(p.version)
        if (p.mode === 'get' || p.mode === 'walk') setMode(p.mode)
        if (Array.isArray(p.oids) && p.oids[0]) setOid((p.oids as string[]).join('; '))
        restore(runToEnvelope(stored))
      }}
      savedTargets={
        <SavedTargetsPane
          tool="snmp"
          currentParams={host.trim() ? params() : null}
          currentLabel={`${host.trim()} ${oid}`}
          onLoad={(p) => {
            if (typeof p.host === 'string') setHost(p.host)
            if (p.version === '1' || p.version === '2c' || p.version === '3') setVersion(p.version)
            if (Array.isArray(p.oids) && p.oids[0]) setOid((p.oids as string[]).join('; '))
            if (typeof p.community === 'string') setCommunity(p.community)
          }}
        />
      }
      statusStrip={
        <StatusStrip running={running} items={[result ? `${result.rows.length} variable${result.rows.length === 1 ? '' : 's'}` : '']} />
      }
      queryBar={
        <QueryBar
          onRun={start}
          onStop={stop}
          running={running}
          canRun={host.trim().length > 0}
          runLabel="Query"
          advanced={
            version === '3' ? (
              <>
                <QueryField label="Username" htmlFor="snmp-user">
                  <Input id="snmp-user" value={username} onChange={(e) => setUsername(e.target.value)} className="w-40" />
                </QueryField>
                <QueryField label="Security level">
                  <Select value={secLevel} onValueChange={(v) => v && setSecLevel(v as typeof secLevel)}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="noAuthNoPriv">noAuthNoPriv</SelectItem>
                      <SelectItem value="authNoPriv">authNoPriv</SelectItem>
                      <SelectItem value="authPriv">authPriv</SelectItem>
                    </SelectContent>
                  </Select>
                </QueryField>
                {secLevel !== 'noAuthNoPriv' ? (
                  <>
                    <QueryField label="Auth">
                      <div className="flex gap-1.5">
                        <Select value={authProto} onValueChange={(v) => v && setAuthProto(v)}>
                          <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {['MD5', 'SHA', 'SHA224', 'SHA256', 'SHA384', 'SHA512'].map((a) => (
                              <SelectItem key={a} value={a}>{a}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input type="password" value={authKey} onChange={(e) => setAuthKey(e.target.value)} placeholder="auth key" className="w-40" />
                      </div>
                    </QueryField>
                  </>
                ) : null}
                {secLevel === 'authPriv' ? (
                  <QueryField label="Privacy">
                    <div className="flex gap-1.5">
                      <Select value={privProto} onValueChange={(v) => v && setPrivProto(v)}>
                        <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {['DES', 'AES', 'AES192', 'AES256'].map((a) => (
                            <SelectItem key={a} value={a}>{a}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input type="password" value={privKey} onChange={(e) => setPrivKey(e.target.value)} placeholder="priv key" className="w-40" />
                    </div>
                  </QueryField>
                ) : null}
              </>
            ) : (
              <QueryField label="Community" htmlFor="snmp-comm">
                <Input id="snmp-comm" value={community} onChange={(e) => setCommunity(e.target.value)} className="w-40 font-mono" />
              </QueryField>
            )
          }
        >
          <QueryField label="Host" htmlFor="snmp-host" className="min-w-[16rem] flex-1">
            <Input id="snmp-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="switch.example.net" className="font-mono" />
          </QueryField>
          <QueryField label="Version">
            <Select value={version} onValueChange={(v) => v && setVersion(v as typeof version)}>
              <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">v1</SelectItem>
                <SelectItem value="2c">v2c</SelectItem>
                <SelectItem value="3">v3</SelectItem>
              </SelectContent>
            </Select>
          </QueryField>
          <QueryField label="Mode">
            <Select value={mode} onValueChange={(v) => v && setMode(v as typeof mode)}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="get">Get</SelectItem>
                <SelectItem value="walk">Walk</SelectItem>
              </SelectContent>
            </Select>
          </QueryField>
          <QueryField label="OID(s)" htmlFor="snmp-oid" className="min-w-[16rem] flex-1">
            <Input id="snmp-oid" value={oid} onChange={(e) => setOid(e.target.value)} className="font-mono" />
          </QueryField>
          <QueryField label="OID profile">
            <div className="flex flex-wrap gap-1">
              {Object.entries(OID_PROFILES).map(([name, o]) => (
                <Button key={name} type="button" variant="outline" size="xs" onClick={() => setOid(o)}>
                  {name}
                </Button>
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
          <p className="text-sm text-muted-foreground">Enter a host and OID, then Query.</p>
        ) : (
          <NetworkResultTable columns={COLUMNS} rows={result.rows} rowKey={(r) => r.oid} empty="No variables returned." />
        )
      }
    />
  )
}
