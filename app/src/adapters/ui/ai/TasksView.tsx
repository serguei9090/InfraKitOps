import { useEffect, useMemo, useState } from 'react'
import { Cpu, RotateCcw, Wand2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useLlmStore } from '@/stores/llmStore'
import { taskContextKeys, type LlmTask } from '@/core/llm/llmModel'
import { groupTasks, resolveTaskModel } from '@/core/llm/taskGroups'
import { TaskDialog } from './TaskDialog'

export function TasksView() {
  const tasks = useLlmStore((s) => s.tasks)
  const connections = useLlmStore((s) => s.connections)
  const settings = useLlmStore((s) => s.settings)
  const refreshTasks = useLlmStore((s) => s.refreshTasks)
  const refresh = useLlmStore((s) => s.refresh)
  const refreshSettings = useLlmStore((s) => s.refreshSettings)
  const putTask = useLlmStore((s) => s.putTask)
  const resetTask = useLlmStore((s) => s.resetTask)
  const [editing, setEditing] = useState<LlmTask | null>(null)

  useEffect(() => {
    void refreshTasks()
    void refresh()
    void refreshSettings()
  }, [refreshTasks, refresh, refreshSettings])

  const groups = useMemo(() => groupTasks(tasks), [tasks])

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <Wand2 className="size-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          Grounded tasks other modules call via <code className="text-xs">&lt;AiPanel taskId=… /&gt;</code>, grouped by
          the module that uses them. Built-ins ship with the app; customise one to change its behaviour everywhere.
        </span>
      </div>

      <div className="flex flex-col gap-5">
        {groups.map((g) => (
          <section key={g.key}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</h3>
            <ul className="flex flex-col gap-1">
              {g.tasks.map((t) => {
                const m = resolveTaskModel(t, connections, settings)
                return (
                  <li
                    key={t.id}
                    className="flex items-start gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm"
                  >
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
                      <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Cpu className="size-3 shrink-0" />
                        {m.model || '—'} · {m.connection}
                        <Badge variant="outline" className="ml-0.5 px-1 py-0 text-[9px]">
                          {m.scope}
                        </Badge>
                      </p>
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
                )
              })}
            </ul>
          </section>
        ))}
      </div>

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
