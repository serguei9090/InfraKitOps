import { ArrowLeft, Download, Eye, Play, Plus, Save, Sparkles, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { AiPanel } from '@/adapters/ui/ai/AiPanel'
import { downloadBlob } from '@/lib/downloadFile'
import { useBackendStore } from '@/stores/backendStore'
import { useRunbookStore } from '@/stores/runbookStore'
import { useShortcut } from '@/hooks/useShortcut'
import * as api from '@/adapters/backend/runbookClient'
import {
  currentSpec,
  emptySpec,
  emptyStep,
  isDirty,
  latestVersion,
  nextVersionNumber,
  reconcileArgs,
  type Runbook,
  type RunbookSpec,
  type StepSpec,
} from '@/core/runbook/runbookModel'
import { StepCard } from '@/adapters/ui/runbook/StepCard'
import type { StepDragProps } from '@/adapters/ui/runbook/StepCard'
import { ArgConfigPanel } from '@/adapters/ui/runbook/ArgConfigPanel'
import { RunbookVersionList } from '@/adapters/ui/runbook/RunbookVersionList'
import { RunbookCompareDialog } from '@/adapters/ui/runbook/RunbookCompareDialog'
import { RunSetupDialog } from '@/adapters/ui/runbook/RunSetupDialog'
import { RunPanel } from '@/adapters/ui/runbook/RunPanel'

export function RunbookEditorScreen() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const refreshLibrary = useRunbookStore((s) => s.refresh)
  const runnable = useBackendStore((s) => s.capabilities?.runbookExecutors)
  const runnableMap = useMemo(() => runnable ?? {}, [runnable])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const [rb, setRb] = useState<Runbook | null>(null)
  const [spec, setSpecState] = useState<RunbookSpec>(() => emptySpec())
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [viewing, setViewing] = useState<number | null>(null)
  const [compareSel, setCompareSel] = useState<number[]>([])
  const [compareOpen, setCompareOpen] = useState(false)
  const [runOpen, setRunOpen] = useState(false)
  const [genOpen, setGenOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    api.getRunbook(id)
      .then((loaded) => {
        setRb(loaded)
        setSpecState(reconcileInto(currentSpec(loaded) ?? emptySpec()))
      })
      .catch((e) => setLoadErr(String(e)))
  }, [id])

  const dirty = rb ? isDirty(rb) || specDiffersFromLatest(spec, rb) : false

  useShortcut('save', () => {
    if (dirty && !saving) void save()
  })
  useShortcut('primaryAction', () => setRunOpen(true))

  function exportJson() {
    const payload = { format: 'infrakit-runbook', v: 1, slug: rb?.slug, spec }
    downloadBlob(
      JSON.stringify(payload, null, 2),
      `${(rb?.slug || 'runbook').replace(/[^\w-]+/g, '_')}.runbook.json`,
      'application/json',
    )
  }

  /** Set the spec, reconcile args, and debounce-save the draft. */
  const setSpec = useCallback(
    (next: RunbookSpec) => {
      const reconciled = reconcileInto(next)
      setSpecState(reconciled)
      if (draftTimer.current) clearTimeout(draftTimer.current)
      draftTimer.current = setTimeout(() => {
        void api.saveDraft(id, reconciled).then(setRb).catch(() => {})
      }, 700)
    },
    [id],
  )

  function patchSpec(p: Partial<RunbookSpec>) {
    setSpec({ ...spec, ...p })
  }
  function patchStep(i: number, p: Partial<StepSpec>) {
    setSpec({ ...spec, steps: spec.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) })
  }
  function moveStep(i: number, dir: -1 | 1) {
    reorderSteps(i, i + dir)
  }
  function reorderSteps(from: number, to: number) {
    if (to < 0 || to >= spec.steps.length || from === to) return
    const steps = [...spec.steps]
    const [moved] = steps.splice(from, 1)
    steps.splice(to, 0, moved)
    setSpec({ ...spec, steps })
  }

  async function save() {
    setSaving(true)
    try {
      // flush any pending draft first
      if (draftTimer.current) clearTimeout(draftTimer.current)
      await api.saveDraft(id, spec)
      const saved = await api.saveVersion(id)
      setRb(saved)
      setSpecState(reconcileInto(latestVersion(saved)?.spec ?? spec))
      setViewing(null)
      void refreshLibrary()
    } finally {
      setSaving(false)
    }
  }

  async function restore(n: number) {
    const updated = await api.versionAction(id, n, 'restore')
    setRb(updated)
    setSpecState(reconcileInto(updated.draft ?? spec))
    setViewing(null)
  }
  async function discardDraft() {
    const updated = await api.discardDraft(id)
    setRb(updated)
    setSpecState(reconcileInto(currentSpec(updated) ?? emptySpec()))
    setViewing(null)
  }
  async function pin(n: number, pinned: boolean) {
    setRb(await api.versionAction(id, n, pinned ? 'pin' : 'unpin'))
  }
  async function delVersion(n: number) {
    try {
      setRb(await api.deleteVersion(id, n))
    } catch (e) {
      setLoadErr(String(e))
    }
  }
  async function togglePublished() {
    if (!rb) return
    const updated = await api.setPublished(id, !rb.published)
    setRb(updated)
    void refreshLibrary()
  }
  async function deleteRunbook() {
    await api.deleteRunbook(id)
    void refreshLibrary()
    navigate('/tools/runbook')
  }

  if (loadErr) {
    return <Centered>Could not load runbook: {loadErr}</Centered>
  }
  if (!rb) {
    return <Centered>Loading…</Centered>
  }

  const viewedSpec = viewing != null ? rb.versions.find((v) => v.version === viewing)?.spec ?? spec : spec
  const readOnly = viewing != null

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-4">
        <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={() => navigate('/tools/runbook')}>
          <ArrowLeft className="size-4" />
        </Button>
        <Input
          value={viewedSpec.name}
          readOnly={readOnly}
          onChange={(e) => patchSpec({ name: e.target.value })}
          className="h-9 max-w-sm border-0 px-1 text-lg font-semibold shadow-none focus-visible:ring-0"
          placeholder="Runbook name"
        />
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          timeout
          <Input
            type="number"
            value={viewedSpec.defaultTimeoutSec}
            readOnly={readOnly}
            onChange={(e) => patchSpec({ defaultTimeoutSec: Number(e.target.value) || 0 })}
            className="h-7 w-20 text-xs"
          />
          s
        </div>
        <label
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          title="A real run waits for a second operator's approval (multi-user mode only)"
        >
          <input
            type="checkbox"
            className="size-3.5 accent-primary"
            checked={!!viewedSpec.requiresApproval}
            disabled={readOnly}
            onChange={(e) => patchSpec({ requiresApproval: e.target.checked })}
          />
          needs approval
        </label>
        <div className="flex-1" />
        <Button
          variant={dirty ? 'default' : 'ghost'}
          size="sm"
          disabled={!dirty || saving || readOnly}
          onClick={() => void save()}
        >
          <Save className="size-4" /> Save · v{nextVersionNumber(rb)}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setRunOpen(true)}>
          <Play className="size-4" /> Run
        </Button>
        <Button variant="ghost" size="sm" onClick={exportJson} aria-label="Export runbook JSON">
          <Download className="size-4" />
        </Button>
        <Button
          variant={rb.published ? 'outline' : 'ghost'}
          size="sm"
          onClick={() => void togglePublished()}
        >
          {rb.published ? 'Published' : 'Publish'}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete runbook"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => void deleteRunbook()}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      {readOnly && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-amber-500/10 px-4 py-2 text-xs">
          <Eye className="size-3.5 text-amber-600 dark:text-amber-500" />
          Viewing v{viewing} — read-only.
          <div className="flex-1" />
          <Button size="xs" variant="outline" onClick={() => void restore(viewing!)}>
            Restore to edit
          </Button>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_320px]">
        <div className="min-h-0 overflow-y-auto p-4">
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            <Input
              value={viewedSpec.description ?? ''}
              readOnly={readOnly}
              onChange={(e) => patchSpec({ description: e.target.value })}
              placeholder="Short description"
              className="h-8"
            />
            {readOnly ? (
              viewedSpec.steps.map((step, i) => (
                <StepCard
                  key={step.id}
                  step={step}
                  index={i}
                  count={viewedSpec.steps.length}
                  readOnly
                  runnable={runnableMap}
                  onChange={() => {}}
                  onMove={() => {}}
                  onDelete={() => {}}
                />
              ))
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(e: DragEndEvent) => {
                  const { active, over } = e
                  if (!over || active.id === over.id) return
                  reorderSteps(
                    spec.steps.findIndex((s) => s.id === active.id),
                    spec.steps.findIndex((s) => s.id === over.id),
                  )
                }}
              >
                <SortableContext
                  items={spec.steps.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="flex flex-col gap-3">
                    {spec.steps.map((step, i) => (
                      <SortableStepCard
                        key={step.id}
                        step={step}
                        index={i}
                        count={spec.steps.length}
                        runnable={runnableMap}
                        onChange={(p) => patchStep(i, p)}
                        onMove={(d) => moveStep(i, d)}
                        onDelete={() => setSpec({ ...spec, steps: spec.steps.filter((_, j) => j !== i) })}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
            {!readOnly && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSpec({ ...spec, steps: [...spec.steps, emptyStep()] })}
                >
                  <Plus className="size-3.5" /> Step
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(genOpen && 'bg-primary/15 text-primary')}
                  onClick={() => setGenOpen((v) => !v)}
                >
                  <Sparkles className="size-3.5" /> Generate step
                </Button>
              </div>
            )}
            {genOpen && !readOnly && (
              <AiPanel
                taskId="runbook.gen-step"
                context={{
                  executor: spec.steps.at(-1)?.executor ?? 'bash',
                  priorSteps: spec.steps.map((s, i) => `${i + 1}. ${s.name || s.script.slice(0, 60)}`).join('\n'),
                }}
                onAcceptJson={(v) => {
                  const o = v as { name?: string; script?: string }
                  if (!o?.script) return
                  const step = emptyStep(spec.steps.at(-1)?.executor ?? 'bash')
                  setSpec({
                    ...spec,
                    steps: [...spec.steps, { ...step, name: o.name ?? 'Generated step', script: o.script }],
                  })
                  setGenOpen(false)
                }}
                onClose={() => setGenOpen(false)}
              />
            )}
          </div>
        </div>

        <aside className="min-h-0 overflow-y-auto border-t border-border/60 bg-card p-3 lg:border-l lg:border-t-0">
          <RunbookVersionList
            runbook={rb}
            viewing={viewing}
            compareSel={compareSel}
            dirty={dirty}
            onView={setViewing}
            onToggleCompare={(n) =>
              setCompareSel((cur) => (cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n].slice(-2)))
            }
            onRestore={(n) => void restore(n)}
            onPin={(n, p) => void pin(n, p)}
            onDelete={(n) => void delVersion(n)}
            onDiscardDraft={() => void discardDraft()}
            onCompare={() => setCompareOpen(true)}
          />
          <div className="mt-4">
            <ArgConfigPanel spec={viewedSpec} onChangeArgs={(args) => !readOnly && patchSpec({ args })} />
          </div>
        </aside>
      </div>

      {compareOpen && compareSel.length === 2 && (
        <RunbookCompareDialog runbook={rb} versions={compareSel} open onOpenChange={setCompareOpen} />
      )}
      {runOpen && (
        <RunSetupDialog runbook={rb} open onOpenChange={setRunOpen} />
      )}
      <RunPanel />
    </div>
  )
}

function SortableStepCard(props: {
  step: StepSpec
  index: number
  count: number
  runnable: Record<string, boolean>
  onChange: (patch: Partial<StepSpec>) => void
  onMove: (dir: -1 | 1) => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.step.id,
  })
  const drag: StepDragProps = {
    setNodeRef,
    style: { transform: CSS.Transform.toString(transform), transition },
    isDragging,
    handleProps: { ...attributes, ...listeners },
  }
  return <StepCard {...props} drag={drag} />
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">{children}</div>
}

// keep `spec.args` in sync with the tokens in the scripts
function reconcileInto(spec: RunbookSpec): RunbookSpec {
  const args = reconcileArgs(spec)
  return args === spec.args ? spec : { ...spec, args }
}

// Cheap "does the working spec differ from the latest saved version" check
// (covers the case where the backend draft was already cleared but the form
// still holds edits mid-flush).
function specDiffersFromLatest(spec: RunbookSpec, rb: Runbook): boolean {
  const latest = latestVersion(rb)
  if (!latest) return true
  return JSON.stringify(stripIds(spec)) !== JSON.stringify(stripIds(latest.spec))
}
function stripIds(spec: RunbookSpec) {
  return { ...spec, steps: spec.steps.map(({ id: _id, ...rest }) => rest) }
}
