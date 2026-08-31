import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { StepSpec } from '@/core/runbook/runbookModel'

type Py = NonNullable<StepSpec['python']>

interface Props {
  step: StepSpec
  readOnly?: boolean
  onChange: (patch: Partial<StepSpec>) => void
}

/**
 * Python executor step (R4). The script runs through `uv run` in an ephemeral
 * environment — no global Python needed. Dependencies are PEP 508 strings, one
 * per line or comma-separated; the interpreter version is optional.
 */
export function PythonStepForm({ step, readOnly, onChange }: Props) {
  const py: Py = step.python ?? {}
  const deps = py.dependencies ?? []

  function patch(p: Partial<Py>) {
    onChange({ python: { ...py, ...p } })
  }

  return (
    <div className="flex flex-col">
      <Textarea
        value={step.script}
        readOnly={readOnly}
        onChange={(e) => onChange({ script: e.target.value })}
        placeholder={"import sys, json\nprint(json.dumps({'ok': True}))   # {{ARG}}, {{secret:NAME}}, {{steps.1.stdout}}"}
        className="min-h-28 resize-y rounded-none border-0 bg-transparent font-mono text-[13px] focus-visible:ring-0"
      />
      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-3 py-2 text-xs">
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">python</span>
          <Input
            value={py.pyVersion ?? ''}
            readOnly={readOnly}
            onChange={(e) => patch({ pyVersion: e.target.value || undefined })}
            placeholder="3.12"
            className="h-6 w-16 text-xs"
          />
        </label>
        <label className="flex flex-1 items-center gap-1.5">
          <span className="text-muted-foreground">deps</span>
          <Input
            value={deps.join(', ')}
            readOnly={readOnly}
            onChange={(e) =>
              patch({
                dependencies: e.target.value
                  .split(/[,\n]/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            placeholder="httpx, rich>=13"
            className="h-6 flex-1 font-mono text-xs"
          />
        </label>
      </div>
    </div>
  )
}
