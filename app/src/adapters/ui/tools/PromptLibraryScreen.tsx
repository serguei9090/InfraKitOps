import { useEffect } from 'react'
import { PromptLibraryScaffold } from '@/adapters/ui/prompt/PromptLibraryScaffold'
import { usePromptLibraryStore } from '@/stores/promptLibraryStore'

export function PromptLibraryScreen() {
  const hydrate = usePromptLibraryStore((s) => s.hydrate)
  const loaded = usePromptLibraryStore((s) => s.loaded)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  if (!loaded) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>
  }
  return <PromptLibraryScaffold />
}
