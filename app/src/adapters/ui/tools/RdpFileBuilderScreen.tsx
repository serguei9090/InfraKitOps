import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Download } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StepperWorkspaceScaffold } from '@/adapters/ui/shell/StepperWorkspaceScaffold'
import { downloadBlob } from '@/lib/downloadFile'
import {
  RdpFileBuilder,
  RDP_GROUP_ORDER,
  rdpHardenedBaseline,
  rdpLanBaseline,
  rdpOptionsInGroup,
  type RdpFileBuilderInput,
  type RdpOption,
} from '@/core/config/rdpFileBuilder'

type Values = Record<string, string>

const builder = new RdpFileBuilder()

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

  const selectedCount = Object.keys(values).length
  // Properties are optional — a file with just `full address` is already
  // valid and usable, so as soon as the host resolves cleanly the output
  // (step 3) is ready.
  const activeStep = address.trim().length === 0 ? 0 : result.error ? 1 : 2

  function downloadFile() {
    if (!result.value) return
    downloadBlob(result.value.fileText, result.value.suggestedFileName, 'application/x-rdp;charset=utf-8')
  }

  return (
    <StepperWorkspaceScaffold
      title="Windows RDP File Builder"
      copyText={result.value?.fileText}
      steps={[{ label: 'Host' }, { label: 'Properties (optional)' }, { label: 'Review & download' }]}
      activeStep={activeStep}
      builderLabel="HOST & PROPERTIES"
      outputLabel="GENERATED .RDP"
      builderPanel={
        <div className="flex flex-col gap-5">
          <div>
            <label className="text-sm font-semibold" htmlFor="rdp-address">
              Host address
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-mono">host</span>, <span className="font-mono">host:port</span> or an IP. Emitted as{' '}
              <span className="font-mono">full address:s:</span> and always first.
            </p>
            <Input
              id="rdp-address"
              className="mt-2 max-w-md font-mono text-sm"
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

          <div className="rounded-lg border border-border/60 bg-muted/30 p-3.5">
            <p className="text-sm font-semibold">Presets</p>
            <p className="mt-1 text-xs text-muted-foreground">
              A starting point, not a finished file. Every value is still editable below.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => setValues(rdpHardenedBaseline())}>
                Hardened / locked-down
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setValues(rdpLanBaseline())}>
                LAN / full experience
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setValues({})}>
                Clear all
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Hardened: NLA on, strict host auth, all redirection (clipboard, drives, printers, audio, mic) off.
              LAN: multi-monitor, dynamic resolution, compression and the rich visual experience on.
            </p>
          </div>

          <div className="rounded-lg border border-border/60 p-3.5">
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
                  <span className="font-mono">rdpsign.exe /sha256</span> (a signature that any later edit invalidates) plus
                  the matching GPO.
                </p>
              </div>
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold">
              Properties{' '}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                {selectedCount > 0 ? `${selectedCount} selected` : 'none selected'}
              </span>
            </p>
            <div className="mt-2 flex flex-col gap-1.5">
              {RDP_GROUP_ORDER.map((group) => {
                const options = rdpOptionsInGroup(group)
                const groupSelected = options.filter((o) => o.key in values).length
                return (
                  <details key={group} open={groupSelected > 0} className="rounded-lg border border-border/60 px-3 py-1.5">
                    <summary className="cursor-pointer select-none py-1 text-sm font-semibold">
                      {group}{' '}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        {groupSelected > 0 ? `${groupSelected} of ${options.length} selected` : `${options.length} available`}
                      </span>
                    </summary>
                    <div className="flex flex-col divide-y divide-border/40 pb-1">
                      {options.map((option) => (
                        <OptionRow key={option.key} option={option} values={values} onChange={setValues} />
                      ))}
                    </div>
                  </details>
                )
              })}
            </div>
          </div>
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
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" className="gap-1.5" onClick={downloadFile}>
                  <Download className="size-4" />
                  Download {result.value.suggestedFileName}
                </Button>
                <p className="text-xs text-muted-foreground">
                  then open with <span className="font-mono">mstsc.exe {result.value.suggestedFileName}</span>
                </p>
              </div>
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

function OptionRow({ option, values, onChange }: { option: RdpOption; values: Values; onChange: (v: Values) => void }) {
  const selected = option.key in values
  const current = values[option.key] ?? ''
  const choices = option.choices ?? []

  function toggle(checked: boolean | 'indeterminate') {
    if (checked === true) {
      let seed = option.hardenedValue ?? option.lanValue ?? option.defaultValue
      if (seed == null) {
        if (option.kind === 'boolean') seed = '0'
        else if (option.kind === 'choice') seed = choices[0]?.value ?? ''
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

  return (
    <div className="flex flex-col gap-1.5 py-2">
      <div className="flex items-start gap-2">
        <Checkbox checked={selected} onCheckedChange={toggle} className="mt-0.5" />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs font-semibold">{option.key}</span>
            <span className="font-mono text-[11px] text-muted-foreground">:{option.field}:</span>
            {option.hardenedValue != null ? <Badge variant="secondary">hardened</Badge> : null}
          </div>
          <p className="text-xs text-muted-foreground">{option.description}</p>
          {option.defaultValue != null || option.note != null ? (
            <p className="text-[11px] text-muted-foreground/80">
              {[option.defaultValue != null ? `mstsc default: ${option.defaultValue}` : null, option.note]
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
              <Switch checked={current === '1'} onCheckedChange={(c) => setValue(c ? '1' : '0')} />
              <span className="font-mono text-xs">{current === '1' ? 'i:1' : 'i:0'}</span>
            </div>
          ) : option.kind === 'choice' ? (
            <Select value={choices.some((c) => c.value === current) ? current : choices[0]?.value} onValueChange={(v) => setValue(String(v))}>
              <SelectTrigger className="w-full max-w-md" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {choices.map((choice) => (
                  <SelectItem key={choice.value} value={choice.value}>
                    {choice.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              className="max-w-md font-mono text-xs"
              type={option.kind === 'integer' ? 'number' : 'text'}
              value={current}
              placeholder={option.hint}
              min={option.min}
              max={option.max}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </div>
      ) : null}
    </div>
  )
}
