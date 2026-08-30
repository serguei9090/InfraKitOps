import { FilePlus2, LayoutTemplate } from 'lucide-react'
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
      <DialogContent className="flex max-h-[85vh] w-[calc(100%-2rem)] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>New prompt</DialogTitle>
        </DialogHeader>

        <button
          type="button"
          onClick={() => {
            createPrompt(folderId)
            onOpenChange(false)
          }}
          className="flex items-center gap-3 rounded-lg border border-border/60 bg-card p-3 text-left hover:border-primary/60"
        >
          <FilePlus2 className="size-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Start from scratch</p>
            <p className="text-xs text-muted-foreground">One empty system + user message.</p>
          </div>
        </button>

        <div className="flex items-center gap-2 pt-1 text-xs font-medium tracking-wide text-muted-foreground">
          <LayoutTemplate className="size-3.5" />
          OR START FROM A TEMPLATE
        </div>

        <TemplateGallery
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
