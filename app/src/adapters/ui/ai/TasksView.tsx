import { useEffect, useState } from 'react'
import { RotateCcw, Wand2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useLlmStore } from '@/stores/llmStore'
import { taskContextKeys, type LlmTask, type TaskOutputShape } from '@/core/llm/llmModel'

const SHAPES: TaskOutputShape[] = ['text', 'diff', 'json']

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

function TaskDialog({
  draft,
  onClose,
  onSave,
}: {
  draft: LlmTask | null
  onClose: () => void
  onSave: (t: LlmTask) => Promise<void>
}) {
  const [t, setT] = useState<LlmTask | null>(draft)
  if (!t) return null
  const idLocked = draft?.builtin ?? false

  return (
    <Dialog open={draft != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[88vh] w-[calc(100%-2rem)] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>{draft?.builtin && !draft.overridden ? 'Customise task' : 'Edit task'}</DialogTitle>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
          onSubmit={async (e) => {
            e.preventDefault()
            if (t.id && t.title && t.systemTemplate) await onSave(t)
          }}
        >
          <div className="flex gap-2">
            <div className="w-56">
              <Label className="text-xs">Task id</Label>
              <Input
                value={t.id}
                readOnly={idLocked}
                onChange={(e) => setT((c) => ({ ...c!, id: e.target.value }))}
                placeholder="mymodule.dothing"
                className="font-mono text-xs"
              />
            </div>
            <div className="flex-1">
              <Label className="text-xs">Title</Label>
              <Input value={t.title} onChange={(e) => setT((c) => ({ ...c!, title: e.target.value }))} />
            </div>
            <div className="w-28">
              <Label className="text-xs">Output</Label>
              <Select
                value={t.outputShape}
                onValueChange={(v) => v && setT((c) => ({ ...c!, outputShape: v as TaskOutputShape }))}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHAPES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs">Description</Label>
            <Input
              value={t.description ?? ''}
              onChange={(e) => setT((c) => ({ ...c!, description: e.target.value }))}
            />
          </div>

          <div>
            <Label className="text-xs">
              System template — <code className="text-[10px]">{'{{context.*}}'}</code> from the caller,{' '}
              <code className="text-[10px]">{'{{input}}'}</code> from the user
            </Label>
            <Textarea
              value={t.systemTemplate}
              onChange={(e) => setT((c) => ({ ...c!, systemTemplate: e.target.value }))}
              className="min-h-48 resize-y font-mono text-xs"
            />
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <Label className="text-xs">Input label</Label>
              <Input
                value={t.inputLabel ?? ''}
                onChange={(e) => setT((c) => ({ ...c!, inputLabel: e.target.value }))}
                placeholder="What to change (optional)"
              />
            </div>
            <div className="w-24">
              <Label className="text-xs">Temp</Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={t.temperature ?? ''}
                onChange={(e) =>
                  setT((c) => ({ ...c!, temperature: e.target.value ? Number(e.target.value) : undefined }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button type="submit" disabled={!t.id || !t.title || !t.systemTemplate}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
