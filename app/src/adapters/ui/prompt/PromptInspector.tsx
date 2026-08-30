import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { currentMessages, type Prompt } from '@/core/prompt/promptModel'
import { extractVariables } from '@/core/prompt/variableExtractor'
import { usePromptLibraryStore } from '@/stores/promptLibraryStore'
import { VersionCompareDialog } from './VersionCompareDialog'
import { VersionList } from './VersionList'

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
            {variables.map((name) => (
              <li key={name} className="rounded-md border border-border/60">
                <button
                  type="button"
                  onClick={() => setExpanded((e) => (e === name ? null : name))}
                  className="flex w-full items-center justify-between px-2 py-1.5 text-left font-mono text-xs hover:bg-accent/40"
                >
                  {`{{${name}}}`}
                  {prompt.variables[name]?.defaultValue ? (
                    <span className="truncate pl-2 text-muted-foreground">
                      = {prompt.variables[name]!.defaultValue}
                    </span>
                  ) : null}
                </button>
                {expanded === name && (
                  <div className="flex flex-col gap-2 border-t border-border/60 p-2">
                    <Input
                      placeholder="Description"
                      defaultValue={prompt.variables[name]?.description ?? ''}
                      onBlur={(e) =>
                        setVariableMeta(prompt.id, name, {
                          ...prompt.variables[name],
                          description: e.target.value || undefined,
                        })
                      }
                      className="h-7 text-xs"
                    />
                    <Input
                      placeholder="Default value"
                      defaultValue={prompt.variables[name]?.defaultValue ?? ''}
                      onBlur={(e) =>
                        setVariableMeta(prompt.id, name, {
                          ...prompt.variables[name],
                          defaultValue: e.target.value || undefined,
                        })
                      }
                      className="h-7 text-xs"
                    />
                  </div>
                )}
              </li>
            ))}
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
