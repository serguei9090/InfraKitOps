import { KeyRound } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { specArgNames, specSecretRefs } from '@/core/runbook/variableExtractor'
import type { ArgSpec, ArgType, RunbookSpec } from '@/core/runbook/runbookModel'

const ARG_TYPES: ArgType[] = ['string', 'number', 'enum', 'boolean', 'secret', 'node', 'multiline']
const PRESETS = ['', 'ipv4', 'hostname', 'port', 'k8s-name', 'slug', 'path-unix']

interface Props {
  spec: RunbookSpec
  onChangeArgs: (args: ArgSpec[]) => void
}

/**
 * Right-hand panel: auto-detected `{{ARG}}` tokens, each with its config.
 * Detection is by scanning the step scripts; `secret:` / `steps.` refs are
 * shown separately and are not user args.
 */
export function ArgConfigPanel({ spec, onChangeArgs }: Props) {
  // `spec.args` is kept reconciled with the detected tokens by the editor, so
  // this component just renders and edits it.
  const detected = specArgNames(spec)
  const secrets = specSecretRefs(spec)
  const args = spec.args

  function patch(name: string, p: Partial<ArgSpec>) {
    onChangeArgs(args.map((a) => (a.name === name ? { ...a, ...p } : a)))
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Arguments ({detected.length})
      </p>
      {detected.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Add <span className="font-mono">{'{{TOKEN}}'}</span> to a step script and configure it here.
        </p>
      )}

      {args.map((a) => (
        <div key={a.name} className="rounded-lg border border-border/60 p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-xs font-medium">{`{{${a.name}}}`}</span>
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={a.required}
                onChange={(e) => patch(a.name, { required: e.target.checked })}
                className="size-3 accent-primary"
              />
              required
            </label>
          </div>
          <div className="flex flex-col gap-1.5">
            <Input
              value={a.label ?? ''}
              onChange={(e) => patch(a.name, { label: e.target.value || undefined })}
              placeholder="Label"
              className="h-7 text-xs"
            />
            <Input
              value={a.help ?? ''}
              onChange={(e) => patch(a.name, { help: e.target.value || undefined })}
              placeholder="Help text"
              className="h-7 text-xs"
            />
            <div className="flex gap-1.5">
              <Select value={a.type} onValueChange={(v) => v && patch(a.name, { type: v as ArgType })}>
                <SelectTrigger size="sm" className="w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ARG_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={a.validationPreset || ''}
                onValueChange={(v) => patch(a.name, { validationPreset: v || undefined })}
              >
                <SelectTrigger size="sm" className="flex-1 text-xs">
                  <SelectValue placeholder="validation preset" />
                </SelectTrigger>
                <SelectContent>
                  {PRESETS.map((p) => (
                    <SelectItem key={p || 'none'} value={p || 'none'}>
                      {p || 'no preset'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {a.type === 'enum' && (
              <Input
                value={(a.enumValues ?? []).join(', ')}
                onChange={(e) =>
                  patch(a.name, { enumValues: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                }
                placeholder="option-a, option-b, option-c"
                className="h-7 text-xs"
              />
            )}
            <Input
              value={a.validationRegex ?? ''}
              onChange={(e) => patch(a.name, { validationRegex: e.target.value || undefined })}
              placeholder="Custom validation regex"
              className="h-7 font-mono text-xs"
            />
            <div className="flex gap-1.5">
              <Input
                value={a.default ?? ''}
                onChange={(e) => patch(a.name, { default: e.target.value || undefined })}
                placeholder="Default value"
                className="h-7 text-xs"
              />
              <Input
                value={a.errorMessage ?? ''}
                onChange={(e) => patch(a.name, { errorMessage: e.target.value || undefined })}
                placeholder="Error message"
                className="h-7 text-xs"
              />
            </div>
          </div>
        </div>
      ))}

      {secrets.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground">SECRETS USED</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {secrets.map((s) => (
              <li key={s} className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                <KeyRound className="size-3" />
                {'{{secret:' + s + '}}'}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
