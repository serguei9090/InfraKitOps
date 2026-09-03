import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { currentMessages, type Prompt } from '@/core/prompt/promptModel'
import { extractVariables } from '@/core/prompt/variableExtractor'
import { usePromptLibraryStore } from '@/stores/promptLibraryStore'
import { VariableMetaEditor } from './VariableMetaEditor'
import { VersionCompareDialog } from './VersionCompareDialog'
import { VersionList } from './VersionList'

const KIND_BADGE: Record<string, string> = {
  textarea: 'long text',
  select: 'dropdown',
  boolean: 'yes/no',
  number: 'number',
}

interface PromptInspectorProps {
  prompt: Prompt
  onFillAndCopy: () => void
}

export function PromptInspector({ prompt, onFillAndCopy }: PromptInspectorProps) {
  const setVariableMeta = usePromptLibraryStore((s) => s.setVariableMeta)
  const messages = currentMessages(prompt)
  const variables = useMemo(() => extractVariables(messages), [messages])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)

  const orphaned = Object.keys(prompt.variables).filter((n) => !variables.includes(n))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/60 p-3">
        <VersionList prompt={prompt} onCompare={() => setCompareOpen(true)} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Variables</p>
        {variables.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Add {'{{VARIABLE}}'} to any message and it appears here.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {variables.map((name) => {
              const meta = prompt.variables[name]
              const badge = meta?.kind ? KIND_BADGE[meta.kind] : undefined
              return (
                <li key={name} className="rounded-md border border-border/60">
                  <button
                    type="button"
                    onClick={() => setExpanded((e) => (e === name ? null : name))}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left font-mono text-xs hover:bg-accent/40"
                  >
                    <span className="shrink-0">{`{{${name}}}`}</span>
                    {badge && (
                      <span className="shrink-0 rounded bg-muted px-1 py-px font-sans text-[10px] text-muted-foreground">
                        {badge}
                      </span>
                    )}
                    {meta?.required && (
                      <span className="shrink-0 font-sans text-[10px] text-amber-600 dark:text-amber-500">
                        required
                      </span>
                    )}
                    {meta?.defaultValue ? (
                      <span className="ml-auto truncate pl-2 text-muted-foreground">
                        = {meta.defaultValue}
                      </span>
                    ) : null}
                  </button>
                  {expanded === name && (
                    <VariableMetaEditor
                      variableName={name}
                      meta={meta ?? {}}
                      onChange={(m) => setVariableMeta(prompt.id, name, m)}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {orphaned.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] text-muted-foreground">Unused metadata</p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {orphaned.map((name) => (
                <li
                  key={name}
                  className="flex items-center justify-between rounded-md px-2 py-1 font-mono text-[11px] text-muted-foreground"
                >
                  {`{{${name}}}`}
                  <button
                    type="button"
                    onClick={() => setVariableMeta(prompt.id, name, {})}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border/60 p-3">
        <Button className="w-full" onClick={onFillAndCopy}>
          Fill &amp; Copy
        </Button>
      </div>

      <VersionCompareDialog prompt={prompt} open={compareOpen} onOpenChange={setCompareOpen} />
    </div>
  )
}
