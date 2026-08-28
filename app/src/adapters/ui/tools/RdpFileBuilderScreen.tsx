import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import {
  DirectiveCatalogEditor,
  type CatalogGroup,
  type CatalogItem,
  type CatalogPreset,
} from '@/adapters/ui/config/DirectiveCatalogEditor'
import {
  RDP_GROUP_ORDER,
  RDP_OPTION_CATALOG,
  RdpFileBuilder,
  rdpHardenedBaseline,
  rdpLanBaseline,
  type RdpFileBuilderInput,
  type RdpOption,
} from '@/core/config/rdpFileBuilder'

type Values = Record<string, string>

const builder = new RdpFileBuilder()

const GROUPS: CatalogGroup[] = RDP_GROUP_ORDER.map((g) => ({ id: g, label: g }))

function seedFor(o: RdpOption): string {
  if (o.hardenedValue != null) return o.hardenedValue
  if (o.lanValue != null) return o.lanValue
  if (o.defaultValue != null) return o.defaultValue
  if (o.kind === 'boolean') return '0'
  if (o.kind === 'choice') return o.choices?.[0]?.value ?? ''
  return ''
}

const ITEMS: CatalogItem[] = RDP_OPTION_CATALOG.map((o) => ({
  key: o.key,
  group: o.group,
  description: o.description,
  seedValue: seedFor(o),
  badge: o.hardenedValue != null ? 'hardened' : undefined,
  meta: [`:${o.field}:`, o.defaultValue != null ? `mstsc default ${o.defaultValue}` : null, o.note]
    .filter(Boolean)
    .join('  ·  '),
  control:
    o.kind === 'boolean'
      ? { kind: 'toggle' }
      : o.kind === 'choice'
        ? { kind: 'select', choices: o.choices ?? [] }
        : { kind: 'text', numeric: o.kind === 'integer', placeholder: o.hint, min: o.min, max: o.max },
}))

const PRESETS: CatalogPreset[] = [
  { id: 'hardened', label: 'Hardened / locked-down', description: 'NLA on, strict host auth, all redirection off.', values: rdpHardenedBaseline() },
  { id: 'lan', label: 'LAN / full experience', description: 'Multi-monitor, dynamic resolution, compression, rich visuals.', values: rdpLanBaseline() },
]

export function RdpFileBuilderScreen() {
  const [address, setAddress] = useState('jump.example.com')
  const [fileName, setFileName] = useState('connection')
  const [lockGuidance, setLockGuidance] = useState(false)
  const [values, setValues] = useState<Values>({})

  const result = useMemo(() => {
    try {
      const input: RdpFileBuilderInput = { address, values, lockGuidance, fileName }
      return { value: builder.execute(input), error: null as string | null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [address, values, lockGuidance, fileName])

  return (
    <ToolDetailScaffold
      title="Windows RDP File Builder"
      copyText={result.value?.fileText}
      download={
        result.value
          ? {
              fileName: result.value.suggestedFileName,
              content: result.value.fileText,
              mimeType: 'application/x-rdp;charset=utf-8',
            }
          : undefined
      }
      inputPanel={
        <DirectiveCatalogEditor
          groups={GROUPS}
          items={ITEMS}
          values={values}
          onChange={setValues}
          presets={PRESETS}
          searchPlaceholder={`Search ${ITEMS.length} .rdp properties…`}
          defaultOpenGroups={['Connection', 'Authentication & Gateway']}
          toolbar={
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-sm font-semibold" htmlFor="rdp-address">
                  Host address
                </label>
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="font-mono">host</span>, <span className="font-mono">host:port</span> or an IP —
                  emitted as <span className="font-mono">full address:s:</span> and always first.
                </p>
                <Input
                  id="rdp-address"
                  className="mt-2 font-mono text-sm"
                  value={address}
                  placeholder="jump.example.com"
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-semibold" htmlFor="rdp-filename">
                  Save-as name
                </label>
                <Input
                  id="rdp-filename"
                  className="mt-2 max-w-xs font-mono text-sm"
                  value={fileName}
                  placeholder="connection"
                  onChange={(e) => setFileName(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="font-mono">.rdp</span> is appended automatically.
                </p>
              </div>
            </div>
          }
        />
      }
      outputPanel={
        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-border/60 p-3">
            <div className="flex items-start gap-2">
              <Checkbox
                id="rdp-lock"
                checked={lockGuidance}
                onCheckedChange={(c) => setLockGuidance(c === true)}
                className="mt-0.5"
              />
              <div>
                <label htmlFor="rdp-lock" className="text-sm font-semibold">
                  Add "make it read-only" guidance
                </label>
                <p className="mt-1 text-xs text-muted-foreground">
                  A <span className="font-mono">.rdp</span> file has no in-file lock. Adds a header block with{' '}
                  <span className="font-mono">attrib +R</span> (read-only on disk) and{' '}
                  <span className="font-mono">rdpsign.exe /sha256</span> (a signature any later edit invalidates), plus
                  the trusted-publisher GPO.
                </p>
              </div>
            </div>
          </div>

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
              <p className="text-xs text-muted-foreground">
                Save as <span className="font-mono">{result.value.suggestedFileName}</span> (Download, top right), then
                open with <span className="font-mono">mstsc.exe {result.value.suggestedFileName}</span>.
              </p>
              <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-background p-4 font-mono text-xs">
                {result.value.fileText}
              </pre>
            </>
          ) : null}
        </div>
      }
    />
  )
}
