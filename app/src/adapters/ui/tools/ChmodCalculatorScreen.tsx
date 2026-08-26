import { useMemo, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { ChmodCalculator, type ChmodPermissions, type PermissionTriad } from '@/core/config/chmodCalculator'

const calculator = new ChmodCalculator()

const defaultPermissions: ChmodPermissions = {
  owner: { read: true, write: true, execute: true },
  group: { read: true, write: false, execute: true },
  other: { read: true, write: false, execute: true },
  setUid: false,
  setGid: false,
  sticky: false,
}

type Who = 'owner' | 'group' | 'other'

export function ChmodCalculatorScreen() {
  const [permissions, setPermissions] = useState<ChmodPermissions>(defaultPermissions)
  const [path, setPath] = useState('filename')

  // The octal/symbolic text fields are free text so the user can type
  // through an invalid intermediate state; they only feed back into
  // `permissions` once they parse. Undefined means "not being edited as
  // free text right now" — fall back to the derived value from `permissions`.
  const [octalText, setOctalText] = useState<string | undefined>(undefined)
  const [symbolicText, setSymbolicText] = useState<string | undefined>(undefined)
  const [octalError, setOctalError] = useState<string | null>(null)
  const [symbolicError, setSymbolicError] = useState<string | null>(null)

  const result = useMemo(() => {
    try {
      return { value: calculator.fromPermissions(permissions, path), error: null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [permissions, path])

  function setTriad(who: Who, update: (t: PermissionTriad) => PermissionTriad) {
    setPermissions((p) => ({ ...p, [who]: update(p[who]) }))
    setOctalText(undefined)
    setSymbolicText(undefined)
    setOctalError(null)
    setSymbolicError(null)
  }

  function setSpecial(key: 'setUid' | 'setGid' | 'sticky', value: boolean) {
    setPermissions((p) => ({ ...p, [key]: value }))
    setOctalText(undefined)
    setSymbolicText(undefined)
    setOctalError(null)
    setSymbolicError(null)
  }

  function onOctalChange(text: string) {
    setOctalText(text)
    const trimmed = text.trim()
    if (trimmed.length === 0) {
      setOctalError(null)
      return
    }
    try {
      const parsed = calculator.parseOctal(trimmed)
      setPermissions(parsed)
      setSymbolicText(undefined)
      setOctalError(null)
    } catch (e) {
      setOctalError(e instanceof Error ? e.message : String(e))
    }
  }

  function onSymbolicChange(text: string) {
    setSymbolicText(text)
    const trimmed = text.trim()
    if (trimmed.length === 0) {
      setSymbolicError(null)
      return
    }
    try {
      const parsed = calculator.parseSymbolic(trimmed)
      setPermissions(parsed)
      setOctalText(undefined)
      setSymbolicError(null)
    } catch (e) {
      setSymbolicError(e instanceof Error ? e.message : String(e))
    }
  }

  const displayOctal = octalText ?? result.value?.octalFull ?? ''
  const displaySymbolic = symbolicText ?? result.value?.symbolic ?? ''

  return (
    <ToolDetailScaffold
      title="chmod Calculator"
      copyText={result.value?.command}
      inputPanel={
        <div className="flex max-w-md flex-col gap-5">
          <div>
            <p className="text-sm font-medium">Permissions</p>
            <PermissionGrid permissions={permissions} onChange={setTriad} />
          </div>

          <div>
            <p className="text-sm font-medium">Special bits</p>
            <div className="mt-2 flex flex-col gap-2">
              <SpecialBitSwitch
                label="setuid (4000)"
                checked={permissions.setUid}
                onCheckedChange={(v) => setSpecial('setUid', v)}
              />
              <SpecialBitSwitch
                label="setgid (2000)"
                checked={permissions.setGid}
                onCheckedChange={(v) => setSpecial('setGid', v)}
              />
              <SpecialBitSwitch
                label="sticky (1000)"
                checked={permissions.sticky}
                onCheckedChange={(v) => setSpecial('sticky', v)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chmod-path">Target path</Label>
            <Input
              id="chmod-path"
              className="font-mono"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="filename"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chmod-octal">Octal</Label>
            <Input
              id="chmod-octal"
              className="font-mono"
              value={displayOctal}
              onChange={(e) => onOctalChange(e.target.value)}
              placeholder="e.g. 755 or 4755"
            />
            {octalError ? <p className="text-xs text-destructive">{octalError}</p> : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chmod-symbolic">Symbolic</Label>
            <Input
              id="chmod-symbolic"
              className="font-mono"
              value={displaySymbolic}
              onChange={(e) => onSymbolicChange(e.target.value)}
              placeholder="e.g. rwxr-xr-x"
            />
            {symbolicError ? <p className="text-xs text-destructive">{symbolicError}</p> : null}
          </div>
        </div>
      }
      outputPanel={
        result.error ? (
          <p className="text-sm text-destructive">{result.error}</p>
        ) : result.value ? (
          <div className="flex flex-col gap-5">
            <div>
              <p className="text-xs text-muted-foreground">Command</p>
              <pre className="mt-1.5 rounded-md border border-border/60 bg-muted/40 p-3 font-mono text-sm">
                {result.value.command}
              </pre>
            </div>
            <div className="flex flex-col gap-2">
              <FieldRow label="Octal" value={result.value.octalFull} />
              <FieldRow label="Symbolic" value={result.value.symbolic} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">What this allows</p>
              <p className="mt-1.5 text-sm">{result.value.description}</p>
            </div>
          </div>
        ) : null
      }
    />
  )
}

function PermissionGrid({
  permissions,
  onChange,
}: {
  permissions: ChmodPermissions
  onChange: (who: Who, update: (t: PermissionTriad) => PermissionTriad) => void
}) {
  const rows: { who: Who; label: string; triad: PermissionTriad }[] = [
    { who: 'owner', label: 'Owner', triad: permissions.owner },
    { who: 'group', label: 'Group', triad: permissions.group },
    { who: 'other', label: 'Other', triad: permissions.other },
  ]

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0" />
        <span className="flex-1 text-center text-xs text-muted-foreground">Read</span>
        <span className="flex-1 text-center text-xs text-muted-foreground">Write</span>
        <span className="flex-1 text-center text-xs text-muted-foreground">Exec</span>
      </div>
      {rows.map(({ who, label, triad }) => (
        <div key={who} className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-sm">{label}</span>
          <span className="flex flex-1 justify-center">
            <Checkbox
              checked={triad.read}
              onCheckedChange={(checked) => onChange(who, (t) => ({ ...t, read: checked === true }))}
            />
          </span>
          <span className="flex flex-1 justify-center">
            <Checkbox
              checked={triad.write}
              onCheckedChange={(checked) => onChange(who, (t) => ({ ...t, write: checked === true }))}
            />
          </span>
          <span className="flex flex-1 justify-center">
            <Checkbox
              checked={triad.execute}
              onCheckedChange={(checked) => onChange(who, (t) => ({ ...t, execute: checked === true }))}
            />
          </span>
        </div>
      ))}
    </div>
  )
}

function SpecialBitSwitch({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-sm font-normal">{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-20 shrink-0 text-sm font-medium">{label}</span>
      <span className="font-mono text-sm">{value}</span>
    </div>
  )
}
