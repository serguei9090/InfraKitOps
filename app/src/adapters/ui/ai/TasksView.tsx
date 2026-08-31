import { useEffect, useState } from 'react'
import { RotateCcw, Wand2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useLlmStore } from '@/stores/llmStore'
import { taskContextKeys, type LlmTask } from '@/core/llm/llmModel'
import { TaskDialog } from './TaskDialog'

export function TasksView() {
  const tasks = useLlmStore((s) => s.tasks)
  const refreshTasks = useLlmStore((s) => s.refreshTasks)
  const putTask = useLlmStore((s) => s.putTask)
  const resetTask = useLlmStore((s) => s.resetTask)
  const [editing, setEditing] = useState<LlmTask | null>(null)

  useEffect(() => {
    void refreshTasks()
  }, [refreshTasks])

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <Wand2 className="size-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          Grounded tasks other modules call via <code className="text-xs">&lt;AiPanel taskId=… /&gt;</code>. Built-ins
          ship with the app; customise one to change its behaviour everywhere.
        </span>
      </div>

      <ul className="flex flex-col gap-1">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-start gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">{t.title}</span>
                <code className="text-[10px] text-muted-foreground">{t.id}</code>
                <Badge variant="secondary" className="text-[10px]">
                  {t.outputShape}
                </Badge>
                {t.builtin && !t.overridden && (
                  <Badge variant="outline" className="text-[10px]">
                    built-in
                  </Badge>
                )}
                {t.overridden && (
                  <Badge variant="default" className="text-[10px]">
                    customised
                  </Badge>
                )}
              </div>
              {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
              {taskContextKeys(t).length > 0 && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  context: {taskContextKeys(t).map((k) => `{{context.${k}}}`).join(' ')}
                </p>
              )}
            </div>
            <Button size="xs" variant="ghost" onClick={() => setEditing({ ...t })}>
              {t.builtin && !t.overridden ? 'Customise' : 'Edit'}
            </Button>
            {t.overridden && (
              <Button
                size="xs"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => void resetTask(t.id)}
              >
                <RotateCcw className="size-3.5" /> Reset
              </Button>
            )}
          </li>
        ))}
      </ul>

      <TaskDialog
        key={editing?.id ?? 'closed'}
        draft={editing}
        onClose={() => setEditing(null)}
        onSave={async (t) => {
          await putTask(t)
          setEditing(null)
        }}
      />
    </div>
  )
}

