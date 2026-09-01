import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useLlmStore } from '@/stores/llmStore'
import { useMcpStore } from '@/stores/mcpStore'
import type { LlmTask, TaskOutputShape } from '@/core/llm/llmModel'

const SHAPES: TaskOutputShape[] = ['text', 'diff', 'json']
const INHERIT = '__inherit__'

interface Props {
  draft: LlmTask | null
  onClose: () => void
  onSave: (t: LlmTask) => Promise<void>
}

/** Editor for a grounding task — shared by AI Hub → Tasks and Settings → AI. */
export function TaskDialog({ draft, onClose, onSave }: Props) {
  const connections = useLlmStore((s) => s.connections)
  const models = useLlmStore((s) => s.models)
  const loadModels = useLlmStore((s) => s.loadModels)
  const mcpServers = useMcpStore((s) => s.servers)
  const refreshMcp = useMcpStore((s) => s.refresh)
  const [t, setT] = useState<LlmTask | null>(draft)

  useEffect(() => {
    if (t?.preferredConnectionId) void loadModels(t.preferredConnectionId)
  }, [t?.preferredConnectionId, loadModels])

  useEffect(() => {
    void refreshMcp()
  }, [refreshMcp])

  if (!t) return null
  const idLocked = draft?.builtin ?? false
  const prefModels = t.preferredConnectionId ? (models[t.preferredConnectionId] ?? []) : []

  return (
    <Dialog open={draft != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[88vh] w-[calc(100%-2rem)] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>{draft?.builtin && !draft.overridden ? 'Customise task' : 'Edit task'}</DialogTitle>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={async (e) => {
            e.preventDefault()
            if (t.id && t.title && t.systemTemplate) await onSave(t)
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
          <div className="flex flex-wrap gap-2">
            <div className="w-full sm:w-56">
              <Label className="text-xs">Task id</Label>
              <Input
                value={t.id}
                readOnly={idLocked}
                onChange={(e) => setT((c) => ({ ...c!, id: e.target.value }))}
                placeholder="mymodule.dothing"
                className="font-mono text-xs"
              />
            </div>
            <div className="min-w-0 flex-1">
              <Label className="text-xs">Title</Label>
              <Input value={t.title} onChange={(e) => setT((c) => ({ ...c!, title: e.target.value }))} />
            </div>
            <div className="w-28 shrink-0">
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

          <div className="flex flex-wrap gap-2">
            <div className="min-w-0 flex-1">
              <Label className="text-xs">Input label</Label>
              <Input
                value={t.inputLabel ?? ''}
                onChange={(e) => setT((c) => ({ ...c!, inputLabel: e.target.value }))}
                placeholder="What to change (optional)"
              />
            </div>
            <div className="w-24 shrink-0">
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

          <div className="flex flex-wrap gap-2">
            <div className="min-w-0 flex-1 basis-48">
              <Label className="text-xs">Preferred connection</Label>
              <Select
                value={t.preferredConnectionId || INHERIT}
                onValueChange={(v) => {
                  if (!v) return
                  const id = String(v)
                  setT((c) => ({
                    ...c!,
                    preferredConnectionId: id === INHERIT ? undefined : id,
                    preferredModel: id === INHERIT ? undefined : c!.preferredModel,
                  }))
                }}
              >
                <SelectTrigger size="sm" className="text-xs">
                  <SelectValue>
                    {(v) =>
                      v === INHERIT || !v
                        ? 'use the global default'
                        : (connections.find((c) => c.id === v)?.name ?? 'use the global default')
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={INHERIT}>use the global default</SelectItem>
                  {connections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 flex-1 basis-48">
              <Label className="text-xs">Preferred model</Label>
              <Select
                value={t.preferredModel || INHERIT}
                onValueChange={(v) => {
                  if (!v) return
                  const m = String(v)
                  setT((c) => ({ ...c!, preferredModel: m === INHERIT ? undefined : m }))
                }}
                disabled={!t.preferredConnectionId}
              >
                <SelectTrigger size="sm" className="text-xs">
                  <SelectValue>{(v) => (v === INHERIT || !v ? 'connection default' : String(v))}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={INHERIT}>connection default</SelectItem>
                  {prefModels.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs">MCP tools</Label>
            <p className="mb-1.5 text-[11px] text-muted-foreground">
              Let this task&rsquo;s model call tools to look things up. Read-only tools run automatically; others
              ask first. Add servers in AI Hub → MCP.
            </p>
            {mcpServers.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No MCP servers configured.</p>
            ) : (
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-primary"
                    checked={(t.tools ?? []).includes('all')}
                    onChange={(e) =>
                      setT((c) => ({ ...c!, tools: e.target.checked ? ['all'] : [] }))
                    }
                  />
                  All servers
                </label>
                {mcpServers.map((s) => {
                  const all = (t.tools ?? []).includes('all')
                  const on = all || (t.tools ?? []).includes(s.id)
                  return (
                    <label key={s.id} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        className="size-3.5 accent-primary"
                        disabled={all}
                        checked={on}
                        onChange={(e) =>
                          setT((c) => {
                            const cur = (c!.tools ?? []).filter((x) => x !== 'all')
                            return {
                              ...c!,
                              tools: e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id),
                            }
                          })
                        }
                      />
                      {s.name}
                      {!s.enabled && <span className="text-[10px] text-muted-foreground">(disabled)</span>}
                    </label>
                  )
                })}
              </div>
            )}
          </div>

          </div>

          <DialogFooter className="mt-4">
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
