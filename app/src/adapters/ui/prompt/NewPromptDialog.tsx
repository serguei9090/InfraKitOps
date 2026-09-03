import { FilePlus2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { mergeTemplates, type SeedTemplate } from '@/core/prompt/templates/index'
import { usePromptLibraryStore } from '@/stores/promptLibraryStore'
import { downloadBlob } from '@/lib/downloadFile'
import { TemplateGallery } from './TemplateGallery'

interface NewPromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Folder the new prompt lands in (`null` = Unfiled). */
  folderId: string | null
}

const slug = (s: string) => s.replace(/[^\w-]+/g, '_') || 'template'

export function NewPromptDialog({ open, onOpenChange, folderId }: NewPromptDialogProps) {
  const createPrompt = usePromptLibraryStore((s) => s.createPrompt)
  const userTemplates = usePromptLibraryStore((s) => s.userTemplates)
  const deleteUserTemplate = usePromptLibraryStore((s) => s.deleteUserTemplate)
  const exportUserTemplates = usePromptLibraryStore((s) => s.exportUserTemplates)
  const importTemplatesFromJson = usePromptLibraryStore((s) => s.importTemplatesFromJson)

  const templates = useMemo(() => mergeTemplates(userTemplates), [userTemplates])
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  async function onImportFile(file: File) {
    try {
      const { added } = importTemplatesFromJson(await file.text())
      setMsg({ kind: 'ok', text: `Imported ${added} template${added === 1 ? '' : 's'}.` })
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Import failed.' })
    }
  }

  function onExportAll() {
    downloadBlob(exportUserTemplates(), 'prompt-templates.json', 'application/json')
  }

  function onExportOne(t: SeedTemplate) {
    downloadBlob(exportUserTemplates([t]), `${slug(t.name)}.template.json`, 'application/json')
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-6xl flex-col gap-0 p-0 sm:max-w-6xl">
        <DialogHeader className="shrink-0 border-b border-border/60 px-5 py-3.5">
          <DialogTitle>New prompt</DialogTitle>
        </DialogHeader>

        <div className="shrink-0 px-5 pt-4">
          <button
            type="button"
            onClick={() => {
              createPrompt(folderId)
              onOpenChange(false)
            }}
            className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card p-3.5 text-left transition-colors hover:border-primary/60 hover:bg-accent/30"
          >
            <FilePlus2 className="size-5 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Start from scratch</p>
              <p className="text-xs text-muted-foreground">One empty system + user message.</p>
            </div>
          </button>

          <p className="mt-4 mb-1 text-xs font-medium tracking-wide text-muted-foreground">
            OR START FROM A TEMPLATE
          </p>
        </div>

        <TemplateGallery
          className="min-h-0 flex-1 px-5 pb-5"
          templates={templates}
          onUse={(t) => {
            createPrompt(folderId, { fromTemplate: t })
            onOpenChange(false)
          }}
          onRemove={deleteUserTemplate}
          onImportFile={onImportFile}
          onExportAll={onExportAll}
          onExportOne={onExportOne}
        />
      </DialogContent>
    </Dialog>

    <Dialog open={msg != null} onOpenChange={(o) => !o && setMsg(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{msg?.kind === 'ok' ? 'Import complete' : 'Import failed'}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{msg?.text}</p>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">OK</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
