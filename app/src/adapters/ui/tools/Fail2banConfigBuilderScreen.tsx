import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BalancedFlowScaffold } from '@/adapters/ui/shell/BalancedFlowScaffold'
import {
  Fail2banJailConfigBuilder,
  fail2banActionPresetDescription,
  fail2banActionPresetLabel,
  fail2banJailCategoryLabel,
  fail2banJailCategoryValues,
  kFail2banActionPresets,
  kFail2banJailCatalog,
  type Fail2banActionPreset,
  type Fail2banDefaults,
  type Fail2banJailPreset,
  type Fail2banJailSelection,
} from '@/core/config/fail2banJailConfigBuilder'

const builder = new Fail2banJailConfigBuilder()

const kBackendLabels: Record<string, string> = {
  auto: 'auto — pyinotify, then polling',
  systemd: 'systemd — read the journal directly',
  polling: 'polling — poll log files for changes',
  pyinotify: 'pyinotify — inotify-based watching',
}

const kDefaultDefaults: Fail2banDefaults = {
  bantime: '10m',
  findtime: '10m',
  maxretry: '5',
  ignoreIp: '127.0.0.1/8 ::1',
  backend: 'auto',
  actionPreset: 'banOnly',
}

export function Fail2banConfigBuilderScreen() {
  const [defaults, setDefaults] = useState<Fail2banDefaults>(kDefaultDefaults)
  const [jails, setJails] = useState<Record<string, Fail2banJailSelection>>({})
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ ssh: true })

  const result = useMemo(() => {
    try {
      return { value: builder.execute({ defaults, jails: Object.values(jails) }), error: null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [defaults, jails])

  function updateDefault<K extends keyof Fail2banDefaults>(key: K, value: Fail2banDefaults[K]) {
    setDefaults((prev) => ({ ...prev, [key]: value }))
  }

  function toggleJail(preset: Fail2banJailPreset, enabled: boolean) {
    setJails((prev) => ({ ...prev, [preset.id]: { ...(prev[preset.id] ?? { id: preset.id, enabled: false }), enabled } }))
  }

  function updateJail(id: string, patch: Partial<Fail2banJailSelection>) {
    setJails((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { id, enabled: false }), ...patch } }))
  }

  const q = query.trim().toLowerCase()
  function matches(p: Fail2banJailPreset): boolean {
    return q.length === 0 || p.id.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
  }

  const enabledCount = Object.values(jails).filter((j) => j.enabled).length

  return (
    <BalancedFlowScaffold
      title="Fail2ban Jail Config Builder"
      copyText={result.value ?? undefined}
      configLabel="[DEFAULT] SECTION"
      resultsLabel="JAIL CATALOG"
      previewLabel="jail.local"
      configPanel={
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="f2b-bantime">Ban time</Label>
            <Input id="f2b-bantime" value={defaults.bantime ?? ''} onChange={(e) => updateDefault('bantime', e.target.value)} placeholder="10m" />
            <p className="text-xs text-muted-foreground">Duration a host stays banned. "10m", "1h", "1d", a plain second count, or "-1" for permanent.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="f2b-findtime">Find time</Label>
            <Input id="f2b-findtime" value={defaults.findtime ?? ''} onChange={(e) => updateDefault('findtime', e.target.value)} placeholder="10m" />
            <p className="text-xs text-muted-foreground">Window over which maxretry failures must occur to trigger a ban.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="f2b-maxretry">Max retry</Label>
            <Input id="f2b-maxretry" value={defaults.maxretry ?? ''} onChange={(e) => updateDefault('maxretry', e.target.value)} placeholder="5" />
            <p className="text-xs text-muted-foreground">Failures within findtime before a ban is issued.</p>
          </div>

          <div className="flex flex-col gap-1.5 md:col-span-2">
            <Label htmlFor="f2b-ignoreip">Ignore IPs</Label>
            <Input
              id="f2b-ignoreip"
              className="font-mono text-xs"
              value={defaults.ignoreIp ?? ''}
              onChange={(e) => updateDefault('ignoreIp', e.target.value)}
              placeholder="127.0.0.1/8 ::1"
            />
            <p className="text-xs text-muted-foreground">Space-separated IPs/CIDRs never banned — always include your own management IP.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="f2b-backend">Backend</Label>
            <Select value={defaults.backend ?? 'auto'} onValueChange={(v) => updateDefault('backend', v ?? 'auto')}>
              <SelectTrigger id="f2b-backend" className="w-full">
                <SelectValue>{(v: string) => kBackendLabels[v] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">auto — pyinotify, then polling</SelectItem>
                <SelectItem value="systemd">systemd — read the journal directly</SelectItem>
                <SelectItem value="polling">polling — poll log files for changes</SelectItem>
                <SelectItem value="pyinotify">pyinotify — inotify-based watching</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5 md:col-span-3">
            <Label htmlFor="f2b-action">Ban action</Label>
            <Select value={defaults.actionPreset ?? 'banOnly'} onValueChange={(v) => updateDefault('actionPreset', v as Fail2banActionPreset)}>
              <SelectTrigger id="f2b-action" className="w-full max-w-md">
                <SelectValue>{(v: Fail2banActionPreset) => fail2banActionPresetLabel(v)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {kFail2banActionPresets.map((preset) => (
                  <SelectItem key={preset} value={preset}>
                    {fail2banActionPresetLabel(preset)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{fail2banActionPresetDescription(defaults.actionPreset ?? 'banOnly')}</p>
          </div>

          {defaults.actionPreset && defaults.actionPreset !== 'banOnly' ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="f2b-destemail">Destination email</Label>
                <Input
                  id="f2b-destemail"
                  value={defaults.destEmail ?? ''}
                  onChange={(e) => updateDefault('destEmail', e.target.value)}
                  placeholder="root@localhost"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="f2b-sender">Sender</Label>
                <Input id="f2b-sender" value={defaults.sender ?? ''} onChange={(e) => updateDefault('sender', e.target.value)} placeholder="fail2ban@localhost" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="f2b-mta">MTA</Label>
                <Input id="f2b-mta" value={defaults.mta ?? ''} onChange={(e) => updateDefault('mta', e.target.value)} placeholder="sendmail" />
              </div>
            </>
          ) : null}
        </div>
      }
      resultsPanel={
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{enabledCount} jail{enabledCount === 1 ? '' : 's'} enabled</p>
            <Input placeholder="Search jails…" className="max-w-[200px]" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>

          <div className="flex flex-col gap-2">
            {fail2banJailCategoryValues.map((category) => {
              const presets = kFail2banJailCatalog.filter((p) => p.category === category && matches(p))
              if (presets.length === 0) return null
              const isOpen = q.length > 0 || (expanded[category] ?? false)
              const enabledInCategory = presets.filter((p) => jails[p.id]?.enabled).length

              return (
                <div key={category} className="rounded-lg border border-border/60">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left"
                    onClick={() => setExpanded((prev) => ({ ...prev, [category]: !prev[category] }))}
                  >
                    {isOpen ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
                    <span className="flex-1 text-sm font-semibold">{fail2banJailCategoryLabel(category)}</span>
                    <span className="text-xs text-muted-foreground">{presets.length}</span>
                    {enabledInCategory > 0 ? <Badge variant="secondary">{enabledInCategory}</Badge> : null}
                  </button>
                  {isOpen ? (
                    <div className="flex flex-col gap-3 border-t border-border/60 px-3 py-3">
                      {presets.map((preset) => (
                        <JailRow
                          key={preset.id}
                          preset={preset}
                          selection={jails[preset.id]}
                          onToggle={(enabled) => toggleJail(preset, enabled)}
                          onChange={(patch) => updateJail(preset.id, patch)}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      }
      previewPanel={
        result.error ? (
          <p className="text-sm text-destructive">{result.error}</p>
        ) : (
          <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-background p-4 font-mono text-xs">
            {result.value}
          </pre>
        )
      }
    />
  )
}

function JailRow({
  preset,
  selection,
  onToggle,
  onChange,
}: {
  preset: Fail2banJailPreset
  selection: Fail2banJailSelection | undefined
  onToggle: (enabled: boolean) => void
  onChange: (patch: Partial<Fail2banJailSelection>) => void
}) {
  const checked = selection?.enabled ?? false

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <Checkbox checked={checked} onCheckedChange={onToggle} className="mt-0.5" />
        <div className="flex-1">
          <span className={`font-mono text-xs font-semibold ${checked ? 'text-primary' : ''}`}>{preset.id}</span>
          <p className="text-xs text-muted-foreground">{preset.description}</p>
        </div>
      </div>
      {checked ? (
        <div className="ml-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Input
            className="font-mono text-xs"
            placeholder="maxretry (inherit)"
            value={selection?.maxretry ?? ''}
            onChange={(e) => onChange({ maxretry: e.target.value })}
          />
          <Input
            className="font-mono text-xs"
            placeholder="bantime (inherit)"
            value={selection?.bantime ?? ''}
            onChange={(e) => onChange({ bantime: e.target.value })}
          />
          <Input
            className="font-mono text-xs"
            placeholder={preset.defaultPort ?? 'port (inherit)'}
            value={selection?.port ?? ''}
            onChange={(e) => onChange({ port: e.target.value })}
          />
          <Input
            className="font-mono text-xs"
            placeholder="logpath (inherit)"
            value={selection?.logPath ?? ''}
            onChange={(e) => onChange({ logPath: e.target.value })}
          />
        </div>
      ) : null}
    </div>
  )
}
