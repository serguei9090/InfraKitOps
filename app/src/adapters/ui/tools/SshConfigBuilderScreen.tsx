import { useMemo, useRef, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { ConfigValidateButton } from '@/adapters/ui/config/ConfigValidateButton'
import {
  DirectiveCatalogEditor,
  type CatalogGroup,
  type CatalogItem,
  type CatalogPreset,
} from '@/adapters/ui/config/DirectiveCatalogEditor'
import {
  SshConfigBuilder,
  sshDeprecatedAlgorithmsIn,
  sshGroupsForMode,
  sshHardenedBaseline,
  sshOptionsForMode,
  type SshConfigBuilderInput,
  type SshConfigMode,
  type SshOption,
} from '@/core/utility/sshConfigBuilder'

type Values = Record<string, string>

const builder = new SshConfigBuilder()

function seedFor(o: SshOption): string {
  if (o.hardenedValue != null) return o.hardenedValue
  if (o.defaultValue != null) return o.defaultValue
  if (o.kind === 'boolean') return 'no'
  if (o.kind === 'choice') return o.allowedValues?.[0] ?? ''
  return ''
}

function itemFor(o: SshOption): CatalogItem {
  const isCrypto = o.kind === 'freeText' && o.group === 'Cryptography'
  return {
    key: o.key,
    group: o.group,
    description: o.description,
    seedValue: seedFor(o),
    badge: o.hardenedValue != null ? 'hardened' : undefined,
    meta: [o.defaultValue != null ? `OpenSSH default: ${o.defaultValue}` : null, o.versionNote]
      .filter(Boolean)
      .join('  ·  '),
    control:
      o.kind === 'boolean'
        ? { kind: 'toggle', trueValue: 'yes', falseValue: 'no' }
        : o.kind === 'choice'
          ? { kind: 'select', choices: (o.allowedValues ?? []).map((v) => ({ value: v, label: v })) }
          : {
              kind: 'text',
              numeric: o.kind === 'integer',
              placeholder: o.hint,
              min: o.minValue,
              max: o.maxValue,
              validate: isCrypto
                ? (v: string) => {
                    const bad = sshDeprecatedAlgorithmsIn(v)
                    return bad.length > 0 ? `Deprecated / broken: ${bad.join(', ')}` : null
                  }
                : undefined,
            },
  }
}

function groupsFor(mode: SshConfigMode): CatalogGroup[] {
  return sshGroupsForMode(mode).map((g) => ({ id: g, label: g }))
}
function itemsFor(mode: SshConfigMode): CatalogItem[] {
  return sshOptionsForMode(mode).map(itemFor)
}
function hardenedPreset(mode: SshConfigMode): CatalogPreset {
  return {
    id: 'hardened',
    label: 'Hardened baseline',
    description:
      mode === 'client'
        ? 'Researched secure defaults into Host *: keys only, no agent/X11 forwarding, hashed known_hosts, modern crypto.'
        : 'Researched secure defaults: no root login, keys only, forwarding off, idle timeouts, VERBOSE logging, modern crypto.',
    values: sshHardenedBaseline(mode),
  }
}

interface HostBlockState {
  id: number
  pattern: string
  comment: string
  values: Values
}

export function SshConfigBuilderScreen() {
  const [mode, setMode] = useState<SshConfigMode>('client')
  const [hostBlocks, setHostBlocks] = useState<HostBlockState[]>([
    { id: 0, pattern: 'example-host', comment: '', values: {} },
  ])
  const [globalDefaults, setGlobalDefaults] = useState<Values>({})
  const [serverValues, setServerValues] = useState<Values>({})
  const nextId = useRef(1)

  const clientGroups = useMemo(() => groupsFor('client'), [])
  const clientItems = useMemo(() => itemsFor('client'), [])
  const serverGroups = useMemo(() => groupsFor('server'), [])
  const serverItems = useMemo(() => itemsFor('server'), [])

  const result = useMemo(() => {
    try {
      const input: SshConfigBuilderInput =
        mode === 'client'
          ? {
              mode,
              hostBlocks: hostBlocks.map((b) => ({
                pattern: b.pattern,
                values: b.values,
                comment: b.comment || undefined,
              })),
              globalDefaults,
            }
          : { mode, serverValues }
      return { value: builder.execute(input), error: null as string | null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [mode, hostBlocks, globalDefaults, serverValues])

  function addHostBlock() {
    setHostBlocks((blocks) => [
      ...blocks,
      { id: nextId.current++, pattern: `host-${blocks.length + 1}`, comment: '', values: {} },
    ])
  }
  function removeHostBlock(id: number) {
    setHostBlocks((blocks) => blocks.filter((b) => b.id !== id))
  }
  function patchBlock(id: number, patch: Partial<HostBlockState>) {
    setHostBlocks((blocks) => blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  }

  const modeToolbar = (
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
          ? 'ssh_config(5) — per-user ~/.ssh/config, made of Host blocks. The hardened preset applies to Host *.'
          : 'sshd_config(5) — the daemon config, a flat directive list.'}
      </p>
      <p className="mt-1.5 text-xs text-destructive">
        A starting point, not a finished config. Verify every directive against YOUR OpenSSH version (ssh -V, ssh -Q kex,
        ssh -Q cipher, ssh -Q mac) — an unknown algorithm makes sshd refuse to start. Run sshd -t and keep an existing
        session open while testing.
      </p>
    </div>
  )

  return (
    <ToolDetailScaffold
      title="OpenSSH Config Builder"
      copyText={result.value?.configText}
      download={
        result.value
          ? { fileName: result.value.suggestedFileName, content: result.value.configText, mimeType: 'text/plain;charset=utf-8' }
          : undefined
      }
      inputPanel={
        mode === 'server' ? (
          <DirectiveCatalogEditor
            groups={serverGroups}
            items={serverItems}
            values={serverValues}
            onChange={setServerValues}
            presets={[hardenedPreset('server')]}
            searchPlaceholder={`Search ${serverItems.length} sshd_config directives…`}
            defaultOpenGroups={['Network', 'Authentication']}
            toolbar={modeToolbar}
          />
        ) : (
          <div className="flex flex-col gap-5">
            {modeToolbar}

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
                        onChange={(e) => patchBlock(block.id, { pattern: e.target.value })}
                      />
                      {hostBlocks.length > 1 ? (
                        <Button type="button" size="icon-sm" variant="ghost" onClick={() => removeHostBlock(block.id)}>
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                    <Input
                      className="mt-2 text-xs"
                      value={block.comment}
                      placeholder="Optional comment above the Host line"
                      onChange={(e) => patchBlock(block.id, { comment: e.target.value })}
                    />
                    <div className="mt-3">
                      <DirectiveCatalogEditor
                        groups={clientGroups}
                        items={clientItems}
                        values={block.values}
                        onChange={(v) => patchBlock(block.id, { values: v })}
                        searchPlaceholder={`Search ${clientItems.length} ssh_config directives…`}
                      />
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
                Applied to every connection. Emitted last — ssh_config is first-match-wins, so a Host * block at the top
                would shadow the specific blocks above it.
              </p>
              <div className="mt-2 rounded-lg border border-border/60 p-3">
                <DirectiveCatalogEditor
                  groups={clientGroups}
                  items={clientItems}
                  values={globalDefaults}
                  onChange={setGlobalDefaults}
                  presets={[hardenedPreset('client')]}
                  searchPlaceholder={`Search ${clientItems.length} ssh_config directives…`}
                />
              </div>
            </div>
          </div>
        )
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
              <ConfigValidateButton kind={mode === 'server' ? 'sshd' : 'ssh'} text={result.value.configText} />
            </>
          ) : null}
        </div>
      }
    />
  )
}
