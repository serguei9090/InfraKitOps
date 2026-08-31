import { useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useRunbookStore } from '@/stores/runbookStore'
import { currentSpec } from '@/core/runbook/runbookModel'
import { AiPanel } from '@/adapters/ui/ai/AiPanel'

/**
 * Runbooks Assistant (A2) — chat about a runbook, grounded on its spec. Uses
 * the `runbook.assistant` task through the shared central LLM layer.
 * Step generation + "Explain / Fix" live in the editor (StepCard).
 */
export function AssistantView() {
  const runbooks = useRunbookStore((s) => s.runbooks)
  const [rbId, setRbId] = useState('')

  const rb = useMemo(() => runbooks.find((r) => r.id === rbId), [runbooks, rbId])
  const spec = rb ? currentSpec(rb) : null

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-3 p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-primary" />
        <span className="text-sm font-medium">Runbook assistant</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Pick a runbook to ground the conversation. Step generation and “Explain / Fix” are in the editor.
      </p>

      <Select value={rbId} onValueChange={(v) => v && setRbId(v)}>
        <SelectTrigger size="sm" className="w-72">
          <SelectValue placeholder="Ground on a runbook">
            {(v) => {
              const r = runbooks.find((x) => x.id === v)
              return r ? currentSpec(r)?.name ?? r.slug : 'Ground on a runbook'
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {runbooks.map((r) => (
            <SelectItem key={r.id} value={r.id}>
              {currentSpec(r)?.name ?? r.slug}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {spec ? (
        <AiPanel
          key={rbId}
          taskId="runbook.assistant"
          mode="chat"
          context={{ runbook: JSON.stringify(spec, null, 2) }}
          className="min-h-0 flex-1"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/60 text-xs text-muted-foreground">
          Select a runbook above.
        </div>
      )}
    </div>
  )
}
