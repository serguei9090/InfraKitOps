import { GitCompare, Pin, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { latestVersion, type Prompt } from '@/core/prompt/promptModel'
import { usePromptLibraryStore } from '@/stores/promptLibraryStore'
import { cn } from '@/lib/utils'

function relTime(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

interface VersionListProps {
  prompt: Prompt
  onCompare: () => void
}

export function VersionList({ prompt, onCompare }: VersionListProps) {
  const viewingVersion = usePromptLibraryStore((s) => s.viewingVersion)
  const compareSelection = usePromptLibraryStore((s) => s.compareSelection)
  const setViewingVersion = usePromptLibraryStore((s) => s.setViewingVersion)
  const toggleCompareSelection = usePromptLibraryStore((s) => s.toggleCompareSelection)
  const restoreVersion = usePromptLibraryStore((s) => s.restoreVersion)
  const deleteVersion = usePromptLibraryStore((s) => s.deleteVersion)
  const pinVersion = usePromptLibraryStore((s) => s.pinVersion)
  const discardDraft = usePromptLibraryStore((s) => s.discardDraft)

  const versions = [...prompt.versions].sort((a, b) => b.version - a.version)
  const latest = latestVersion(prompt)
  const dirty = prompt.draft != null
  const neverSaved = versions.length === 0

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Versions</p>
        <Button
          size="xs"
          variant="outline"
          disabled={compareSelection.length !== 2}
          onClick={onCompare}
          title={
            compareSelection.length === 2
              ? 'Compare the two selected versions'
              : 'Tick two versions to compare them'
          }
        >
          <GitCompare className="size-3" /> Compare
        </Button>
      </div>

      {neverSaved && !dirty && (
        <p className="text-xs text-muted-foreground">No versions yet. Press Save to create v1.</p>
      )}

      <ul className="flex flex-col gap-0.5">
        {dirty && (
          <li
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs',
              viewingVersion == null ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/40',
            )}
          >
            <button
              type="button"
              onClick={() => setViewingVersion(null)}
              className="flex flex-1 items-center gap-1.5 text-left"
            >
              <span className="size-1.5 rounded-full bg-amber-500" />
              <span className="font-medium">
                {neverSaved ? 'Draft — not saved yet' : 'Unsaved changes'}
              </span>
            </button>
            {!neverSaved && (
              <button
                type="button"
                aria-label="Discard draft"
                title="Discard draft"
                onClick={() => discardDraft(prompt.id)}
                className="text-muted-foreground hover:text-destructive"
              >
                <RotateCcw className="size-3.5" />
              </button>
            )}
          </li>
        )}

        {versions.map((v) => {
          const isLatest = v.version === latest?.version
          const selected = compareSelection.includes(v.version)
          const viewing = viewingVersion === v.version
          return (
            <li
              key={v.version}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs',
                viewing ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/40',
              )}
            >
              <input
                type="checkbox"
                aria-label={`Select v${v.version} to compare`}
                checked={selected}
                onChange={() => toggleCompareSelection(v.version)}
                className="size-3 shrink-0 accent-primary"
              />
              <button
                type="button"
                onClick={() => setViewingVersion(isLatest && !dirty ? null : v.version)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                <span className="font-medium">v{v.version}</span>
                {isLatest && <span className="text-muted-foreground">latest</span>}
                <span className="truncate text-muted-foreground">· {relTime(v.createdAt)}</span>
              </button>
              <button
                type="button"
                aria-label={v.pinned ? `Unpin v${v.version}` : `Pin v${v.version}`}
                onClick={() => pinVersion(prompt.id, v.version, !v.pinned)}
                className={cn(
                  'shrink-0',
                  v.pinned ? 'text-primary' : 'text-muted-foreground/50 hover:text-foreground',
                )}
              >
                <Pin className={cn('size-3.5', v.pinned && 'fill-current')} />
              </button>
              <button
                type="button"
                aria-label={`Restore v${v.version}`}
                title="Restore into draft"
                onClick={() => restoreVersion(prompt.id, v.version)}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Delete v${v.version}`}
                disabled={isLatest || v.pinned}
                onClick={() => deleteVersion(prompt.id, v.version)}
                className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:hover:text-muted-foreground"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          )
        })}
      </ul>

      {compareSelection.length === 1 && (
        <p className="text-[11px] text-muted-foreground">Pick one more version to compare.</p>
      )}
    </div>
  )
}
