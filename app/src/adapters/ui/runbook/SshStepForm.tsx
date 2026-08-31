import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useRunbookStore } from '@/stores/runbookStore'
import type { StepSpec } from '@/core/runbook/runbookModel'
import { SecretPicker } from './SecretPicker'

const INLINE = '__inline__'

interface Props {
  step: StepSpec
  readOnly?: boolean
  onChange: (patch: Partial<StepSpec>) => void
}

export function SshStepForm({ step, readOnly, onChange }: Props) {
  const nodes = useRunbookStore((s) => s.nodes)
  const ssh = step.ssh ?? {}

  function patchSsh(p: Partial<NonNullable<StepSpec['ssh']>>) {
    onChange({ ssh: { ...ssh, ...p } })
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">target</span>
        <Select
          value={ssh.nodeId || INLINE}
          onValueChange={(v) => v && patchSsh(v === INLINE ? { nodeId: '' } : { nodeId: v })}
        >
          <SelectTrigger size="sm" className="w-56 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INLINE}>Inline host…</SelectItem>
            {nodes.map((n) => (
              <SelectItem key={n.id} value={n.id}>
                {n.name} <span className="text-muted-foreground">· {n.user}@{n.host}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={ssh.sudo ?? false}
            onChange={(e) => patchSsh({ sudo: e.target.checked })}
            className="size-3 accent-primary"
          />
          sudo -n
        </label>
      </div>

      {!ssh.nodeId && (
        <div className="flex flex-wrap gap-2">
          <Input
            value={ssh.inlineHost ?? ''}
            onChange={(e) => patchSsh({ inlineHost: e.target.value })}
            placeholder="host or {{HOST}}"
            className="h-7 w-48 text-xs"
          />
          <Input
            value={ssh.user ?? ''}
            onChange={(e) => patchSsh({ user: e.target.value })}
            placeholder="user"
            className="h-7 w-32 text-xs"
          />
          <div className="w-56">
            <SecretPicker
              value={ssh.authSecretId ?? ''}
              onChange={(id) => patchSsh({ authSecretId: id })}
              placeholder="password / key secret"
              kinds={['password', 'ssh-key']}
            />
          </div>
        </div>
      )}

      <Textarea
        value={step.script}
        readOnly={readOnly}
        onChange={(e) => onChange({ script: e.target.value })}
        placeholder="systemctl restart {{SERVICE}}   # runs remotely via bash -c"
        className="min-h-24 resize-y bg-transparent font-mono text-[13px]"
      />
    </div>
  )
}
