import { useMemo, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StepperWorkspaceScaffold } from '@/adapters/ui/shell/StepperWorkspaceScaffold'
import {
  SshConfigBuilder,
  sshDeprecatedAlgorithmsIn,
  sshGroupsForMode,
  sshHardenedBaseline,
  sshOptionsInGroup,
  type SshConfigBuilderInput,
  type SshConfigMode,
  type SshOption,
} from '@/core/utility/sshConfigBuilder'

type Values = Record<string, string>

const builder = new SshConfigBuilder()

interface HostBlockState {
  id: number
  pattern: string
  values: Values
}

export function SshConfigBuilderScreen() {
  const [mode, setMode] = useState<SshConfigMode>('client')
  const [hostBlocks, setHostBlocks] = useState<HostBlockState[]>([{ id: 0, pattern: 'example-host', values: {} }])
  const [globalDefaults, setGlobalDefaults] = useState<Values>({})
  const [serverValues, setServerValues] = useState<Values>({})
  const nextId = useRef(1)

  const result = useMemo(() => {
    try {
      const input: SshConfigBuilderInput =
        mode === 'client'
          ? {
              mode,
              hostBlocks: hostBlocks.map((b) => ({ pattern: b.pattern, values: b.values })),
              globalDefaults,
            }
          : { mode, serverValues }
      return { value: builder.execute(input), error: null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [mode, hostBlocks, globalDefaults, serverValues])

  function applyHardenedPreset() {
    const preset = sshHardenedBaseline(mode)
    if (mode === 'client') setGlobalDefaults(preset)
    else setServerValues(preset)
  }

  function clearAll() {
    if (mode === 'client') {
      setGlobalDefaults({})
      setHostBlocks((blocks) => blocks.map((b) => ({ ...b, values: {} })))
    } else {
      setServerValues({})
    }
  }

  function addHostBlock() {
    setHostBlocks((blocks) => [...blocks, { id: nextId.current++, pattern: `host-${blocks.length + 1}`, values: {} }])
  }

  function removeHostBlock(id: number) {
    setHostBlocks((blocks) => blocks.filter((b) => b.id !== id))
  }

  function updateHostPattern(id: number, pattern: string) {
    setHostBlocks((blocks) => blocks.map((b) => (b.id === id ? { ...b, pattern } : b)))
  }

  function updateHostValues(id: number, values: Values) {
    setHostBlocks((blocks) => blocks.map((b) => (b.id === id ? { ...b, values } : b)))
  }

  const hasAnyConfig =
    mode === 'client'
      ? hostBlocks.some((b) => Object.keys(b.values).length > 0) || Object.keys(globalDefaults).length > 0
      : Object.keys(serverValues).length > 0
  const activeStep = !hasAnyConfig ? 0 : result.error ? 1 : 2

  return (
    <StepperWorkspaceScaffold
      title="OpenSSH Config Builder"
      copyText={result.value?.configText}
      steps={[{ label: 'Choose Mode' }, { label: 'Configure Directives' }, { label: 'Review Output' }]}
      activeStep={activeStep}
      builderLabel="MODE & DIRECTIVES"
      outputLabel="GENERATED CONFIG"
      builderPanel={
        <div className="flex flex-col gap-5">
          <div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={mode === 'client' ? 'default' : 'outline'} onClick={() => setMode('client')}>
                Client
              </Button>
              <Button type="button" size="sm" variant={mode === 'server' ? 'default' : 'outline'} onClick={() => setMode('server')}>
                Server
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {mode === 'client'
                ? 'ssh_config(5) — per-user ~/.ssh/config, made of Host blocks.'
                : 'sshd_config(5) — the daemon config, a flat list of directives.'}
            </p>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/30 p-3.5">
            <p className="text-sm font-semibold">Hardened baseline</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {mode === 'client'
                ? 'Pre-selects researched secure defaults into the Host * block: keys only, no agent/X11 forwarding, hashed known_hosts, and modern crypto (no ssh-rsa/SHA-1, no CBC, no SHA-1 MACs).'
                : 'Pre-selects researched secure defaults: no root login, keys only, forwarding off, idle timeouts, VERBOSE logging, and modern crypto (no ssh-rsa/SHA-1, no CBC, no SHA-1 MACs).'}
            </p>
            <p className="mt-2 text-xs text-destructive">
              A starting point, not a finished config. Verify every directive against YOUR OpenSSH version (ssh -V,
              ssh -Q kex, ssh -Q cipher, ssh -Q mac) — naming an unknown algorithm makes sshd refuse to start.
              Always run sshd -t and keep an existing session open while testing.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={applyHardenedPreset}>
                Apply hardened baseline
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={clearAll}>
                Clear all
              </Button>
            </div>
          </div>

          {mode === 'client' ? (
            <>
              <div>
                <p className="text-sm font-semibold">Host blocks</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  One block per server or pattern. Patterns may be space-separated, e.g. "web-* db-*".
                </p>
                <div className="mt-2 flex flex-col gap-3">
                  {hostBlocks.map((block) => (
                    <div key={block.id} className="rounded-lg border border-border/60 p-3">
                      <div className="flex items-center gap-2">
                        <Input
                          className="font-mono text-sm"
                          value={block.pattern}
                          placeholder="web-01"
                          onChange={(e) => updateHostPattern(block.id, e.target.value)}
                        />
                        {hostBlocks.length > 1 ? (
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => removeHostBlock(block.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {Object.keys(block.values).length === 0
                          ? 'No directives selected yet'
                          : `${Object.keys(block.values).length} directive(s) selected`}
                      </p>
                      <div className="mt-2">
                        <GroupSection mode="client" values={block.values} onChange={(v) => updateHostValues(block.id, v)} />
                      </div>
                    </div>
                  ))}
                </div>
                <Button type="button" size="sm" variant="outline" className="mt-2" onClick={addHostBlock}>
                  <Plus className="size-4" /> Add Host block
                </Button>
              </div>

              <div>
                <p className="text-sm font-semibold">Global defaults (Host *)</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Applied to every connection. Emitted last, because ssh_config is first-match-wins: a Host * block
                  at the top would shadow the specific blocks above it.
                </p>
                <div className="mt-2 rounded-lg border border-border/60 p-3">
                  <GroupSection mode="client" values={globalDefaults} onChange={setGlobalDefaults} />
                </div>
              </div>
            </>
          ) : (
            <div>
              <p className="text-sm font-semibold">sshd_config directives</p>
              <div className="mt-2 rounded-lg border border-border/60 p-3">
                <GroupSection mode="server" values={serverValues} onChange={setServerValues} />
              </div>
            </div>
          )}
        </div>
      }
      outputPanel={
        <div className="flex flex-col gap-3">
          {result.error ? (
            <p className="text-sm text-destructive">{result.error}</p>
          ) : result.value ? (
            <>
              {result.value.warnings.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {result.value.warnings.map((warning, i) => (
                    <Alert key={i} variant="destructive">
                      <AlertDescription>{warning}</AlertDescription>
                    </Alert>
                  ))}
                </div>
              ) : null}
              <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-background p-4 font-mono text-xs">
                {result.value.configText}
              </pre>
            </>
          ) : null}
        </div>
      }
    />
  )
}

function GroupSection({ mode, values, onChange }: { mode: SshConfigMode; values: Values; onChange: (v: Values) => void }) {
  const groups = sshGroupsForMode(mode)
  return (
    <div className="flex flex-col gap-1.5">
      {groups.map((group) => {
        const options = sshOptionsInGroup(mode, group)
        if (options.length === 0) return null
        const selectedCount = options.filter((o) => o.key in values).length
        return (
          <details key={group} open={selectedCount > 0} className="rounded-lg border border-border/60 px-3 py-1.5">
            <summary className="cursor-pointer select-none py-1 text-sm font-semibold">
              {group}{' '}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                {selectedCount > 0 ? `${selectedCount} of ${options.length} selected` : `${options.length} available`}
              </span>
            </summary>
            <div className="flex flex-col divide-y divide-border/40 pb-1">
              {options.map((option) => (
                <OptionRow key={option.key} option={option} values={values} onChange={onChange} />
              ))}
            </div>
          </details>
        )
      })}
    </div>
  )
}

function OptionRow({ option, values, onChange }: { option: SshOption; values: Values; onChange: (v: Values) => void }) {
  const selected = option.key in values
  const current = values[option.key] ?? ''
  const choices = option.allowedValues ?? []

  function toggle(checked: boolean) {
    if (checked) {
      let seed = option.hardenedValue ?? option.defaultValue
      if (seed == null) {
        if (option.kind === 'boolean') seed = 'no'
        else if (option.kind === 'choice') seed = choices[0] ?? ''
        else seed = ''
      }
      onChange({ ...values, [option.key]: seed })
    } else {
      const next = { ...values }
      delete next[option.key]
      onChange(next)
    }
  }

  function setValue(value: string) {
    onChange({ ...values, [option.key]: value })
  }

  const deprecated = option.kind === 'freeText' && option.group === 'Cryptography' ? sshDeprecatedAlgorithmsIn(current) : []

  return (
    <div className="flex flex-col gap-1.5 py-2">
      <div className="flex items-start gap-2">
        <Checkbox checked={selected} onCheckedChange={toggle} className="mt-0.5" />
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs font-semibold">{option.key}</span>
            {option.hardenedValue != null ? <Badge variant="secondary">hardened</Badge> : null}
          </div>
          <p className="text-xs text-muted-foreground">{option.description}</p>
          {option.defaultValue != null || option.versionNote != null ? (
            <p className="text-[11px] text-muted-foreground/80">
              {[option.defaultValue != null ? `OpenSSH default: ${option.defaultValue}` : null, option.versionNote]
                .filter(Boolean)
                .join('  ·  ')}
            </p>
          ) : null}
        </div>
      </div>
      {selected ? (
        <div className="ml-6">
          {option.kind === 'boolean' ? (
            <div className="flex items-center gap-2">
              <Switch checked={current.toLowerCase() === 'yes'} onCheckedChange={(checked) => setValue(checked ? 'yes' : 'no')} />
              <span className="font-mono text-xs">{current.toLowerCase() === 'yes' ? 'yes' : 'no'}</span>
            </div>
          ) : option.kind === 'choice' ? (
            <Select value={choices.includes(current) ? current : choices[0]} onValueChange={(v) => setValue(String(v))}>
              <SelectTrigger className="w-full max-w-sm" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {choices.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <>
              <Input
                className="max-w-md font-mono text-xs"
                type={option.kind === 'integer' ? 'number' : 'text'}
                value={current}
                placeholder={option.hint}
                min={option.minValue}
                max={option.maxValue}
                onChange={(e) => setValue(e.target.value)}
              />
              {deprecated.length > 0 ? (
                <p className="mt-1 text-xs text-destructive">Deprecated / broken: {deprecated.join(', ')}</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
