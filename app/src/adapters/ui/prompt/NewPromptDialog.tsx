import { FilePlus2 } from 'lucide-react'
import { useMemo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { mergeTemplates } from '@/core/prompt/templates/index'
import { usePromptLibraryStore } from '@/stores/promptLibraryStore'
import { TemplateGallery } from './TemplateGallery'

interface NewPromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Folder the new prompt lands in (`null` = Unfiled). */
  folderId: string | null
}

export function NewPromptDialog({ open, onOpenChange, folderId }: NewPromptDialogProps) {
  const createPrompt = usePromptLibraryStore((s) => s.createPrompt)
  const userTemplates = usePromptLibraryStore((s) => s.userTemplates)
  const deleteUserTemplate = usePromptLibraryStore((s) => s.deleteUserTemplate)

  const templates = useMemo(() => mergeTemplates(userTemplates), [userTemplates])

  return (
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
        />
      </DialogContent>
    </Dialog>
  )
}
