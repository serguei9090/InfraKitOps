import { ArrowLeft, Eye, Play, Plus, Save, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useBackendStore } from '@/stores/backendStore'
import { useRunbookStore } from '@/stores/runbookStore'
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

  const [rb, setRb] = useState<Runbook | null>(null)
  const [spec, setSpecState] = useState<RunbookSpec>(() => emptySpec())
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [viewing, setViewing] = useState<number | null>(null)
  const [compareSel, setCompareSel] = useState<number[]>([])
  const [compareOpen, setCompareOpen] = useState(false)
  const [runOpen, setRunOpen] = useState(false)
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
    const t = i + dir
    if (t < 0 || t >= spec.steps.length) return
    const steps = [...spec.steps]
    ;[steps[i], steps[t]] = [steps[t], steps[i]]
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

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px] overflow-hidden">
        <div className="min-h-0 overflow-y-auto p-4">
          <div className="mx-auto flex max-w-3xl flex-col gap-3">
            <Input
              value={viewedSpec.description ?? ''}
              readOnly={readOnly}
              onChange={(e) => patchSpec({ description: e.target.value })}
              placeholder="Short description"
              className="h-8"
            />
            {viewedSpec.steps.map((step, i) => (
              <StepCard
                key={step.id}
                step={step}
                index={i}
                count={viewedSpec.steps.length}
                readOnly={readOnly}
                runnable={runnableMap}
                onChange={(p) => !readOnly && patchStep(i, p)}
                onMove={(d) => !readOnly && moveStep(i, d)}
                onDelete={() =>
                  !readOnly && setSpec({ ...spec, steps: spec.steps.filter((_, j) => j !== i) })
                }
              />
            ))}
            {!readOnly && (
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => setSpec({ ...spec, steps: [...spec.steps, emptyStep()] })}
              >
                <Plus className="size-3.5" /> Step
              </Button>
            )}
          </div>
        </div>

        <aside className="min-h-0 overflow-y-auto border-l border-border/60 bg-card p-3">
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
