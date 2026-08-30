import { BookmarkPlus, Check, Copy, FileText, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { currentMessages, isDirty, nextVersionNumber } from '@/core/prompt/promptModel'
import { usePromptLibraryStore } from '@/stores/promptLibraryStore'
import { FillAndCopyDialog } from './FillAndCopyDialog'
import { NewPromptDialog } from './NewPromptDialog'
import { PromptEditor } from './PromptEditor'
import { PromptInspector } from './PromptInspector'
import { PromptTreePane } from './PromptTreePane'

/**
 * T6 "Library Workspace" archetype — tree | editor | inspector. Built to sit
 * inside the app shell's `<main>`, same as the T4 Network console.
 * See PROMPT_MODULE_PLAN.md §2.
 */
export function PromptLibraryScaffold() {
  const prompts = usePromptLibraryStore((s) => s.prompts)
  const selectedPromptId = usePromptLibraryStore((s) => s.selectedPromptId)
  const duplicatePrompt = usePromptLibraryStore((s) => s.duplicatePrompt)
  const deletePrompt = usePromptLibraryStore((s) => s.deletePrompt)
  const saveVersion = usePromptLibraryStore((s) => s.saveVersion)
  const promoteToTemplate = usePromptLibraryStore((s) => s.promoteToTemplate)

  const prompt = prompts.find((p) => p.id === selectedPromptId) ?? null
  const dirty = prompt ? isDirty(prompt) : false
  const [fillOpen, setFillOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [promoted, setPromoted] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === 's') {
        e.preventDefault()
        if (prompt && isDirty(prompt)) saveVersion(prompt.id)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (prompt) setFillOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prompt, saveVersion])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-1.5 border-b border-border/60 bg-background px-5">
        <h1 className="text-[17px] font-semibold tracking-tight">Prompt Library</h1>
        <div className="flex-1" />
        {prompt && (
          <>
            <Button
              variant={dirty ? 'default' : 'ghost'}
              size="sm"
              disabled={!dirty}
              onClick={() => saveVersion(prompt.id)}
            >
              <Save className="size-4" /> Save · v{nextVersionNumber(prompt)}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setFillOpen(true)}>
              <Copy className="size-4" /> Fill &amp; Copy
            </Button>
            <Button variant="ghost" size="sm" onClick={() => duplicatePrompt(prompt.id)}>
              <FileText className="size-4" /> Duplicate
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                promoteToTemplate(prompt.id)
                setPromoted(true)
                setTimeout(() => setPromoted(false), 1500)
              }}
            >
              {promoted ? <Check className="size-4 text-emerald-500" /> : <BookmarkPlus className="size-4" />}
              {promoted ? 'Saved' : 'Save as template'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => deletePrompt(prompt.id)}
            >
              <Trash2 className="size-4" /> Delete
            </Button>
          </>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-64 shrink-0 border-r border-border/60 bg-card">
          <PromptTreePane />
        </aside>

        <div className="min-w-0 flex-1">
          {prompt ? (
            <PromptEditor key={prompt.id} prompt={prompt} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <FileText className="size-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                {prompts.length === 0
                  ? 'No prompts yet.'
                  : 'Select a prompt from the left, or create a new one.'}
              </p>
              <Button size="sm" onClick={() => setNewOpen(true)}>
                New prompt
              </Button>
            </div>
          )}
        </div>

        {prompt && (
          <aside className="w-72 shrink-0 border-l border-border/60 bg-card">
            <PromptInspector prompt={prompt} onFillAndCopy={() => setFillOpen(true)} />
          </aside>
        )}
      </div>

      {prompt && (
        <FillAndCopyDialog
          key={prompt.id}
          prompt={prompt}
          messages={currentMessages(prompt)}
          open={fillOpen}
          onOpenChange={setFillOpen}
        />
      )}

      <NewPromptDialog open={newOpen} onOpenChange={setNewOpen} folderId={null} />
    </div>
  )
}
