import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { EXECUTOR_KINDS, EXECUTOR_LABEL, type ExecutorKind, type StepSpec } from '@/core/runbook/runbookModel'
import { SshStepForm } from './SshStepForm'
import { HttpStepForm } from './HttpStepForm'

interface Props {
  step: StepSpec
  index: number
  count: number
  readOnly?: boolean
  /** which executor kinds the connected backend can actually run */
  runnable: Record<string, boolean>
  onChange: (patch: Partial<StepSpec>) => void
  onMove: (dir: -1 | 1) => void
  onDelete: () => void
}

export function StepCard({ step, index, count, readOnly, runnable, onChange, onMove, onDelete }: Props) {
  return (
    <div className="rounded-lg border border-border/60 bg-card">
      <div className="flex items-center gap-2 border-b border-border/60 px-2.5 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">{index + 1}</span>
        <Input
          value={step.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={`Step ${index + 1}`}
          className="h-7 max-w-xs border-0 px-1 text-sm shadow-none focus-visible:ring-0"
        />
        <div className="flex-1" />
        <Select
          value={step.executor}
          onValueChange={(v) => v && onChange({ executor: v as ExecutorKind })}
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXECUTOR_KINDS.map((k) => (
              <SelectItem key={k} value={k} disabled={runnable[k] === false}>
                {EXECUTOR_LABEL[k]}
                {runnable[k] === false ? ' — R2' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon-xs" aria-label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
          <ChevronUp className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Move down"
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          <ChevronDown className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Delete step"
          disabled={count === 1}
          className="text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {step.executor === 'ssh' ? (
        <SshStepForm step={step} readOnly={readOnly} onChange={onChange} />
      ) : step.executor === 'http' ? (
        <HttpStepForm step={step} onChange={onChange} />
      ) : (
        <Textarea
          value={step.script}
          onChange={(e) => onChange({ script: e.target.value })}
          placeholder={
            step.executor === 'powershell'
              ? 'Get-Service {{SERVICE}} | Restart-Service'
              : 'systemctl restart {{SERVICE}}   # use {{ARG}}, {{secret:NAME}}, {{steps.1.stdout}}'
          }
          className="min-h-28 resize-y rounded-none border-0 bg-transparent font-mono text-[13px] focus-visible:ring-0"
        />
      )}

      <div className="flex items-center gap-3 border-t border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={step.continueOnError}
            onChange={(e) => onChange({ continueOnError: e.target.checked })}
            className="size-3 accent-primary"
          />
          continue on error
        </label>
        <label className="flex items-center gap-1.5">
          run if
          <select
            value={step.runIf || ''}
            onChange={(e) => onChange({ runIf: e.target.value as StepSpec['runIf'] })}
            className="rounded border border-border/60 bg-transparent px-1 py-0.5"
          >
            <option value="">always</option>
            <option value="prev-success">previous succeeded</option>
            <option value="prev-failure">previous failed</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          timeout
          <Input
            type="number"
            value={step.timeoutSec ?? ''}
            onChange={(e) => onChange({ timeoutSec: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="default"
            className="h-6 w-20 text-xs"
          />
          s
        </label>
      </div>
    </div>
  )
}
