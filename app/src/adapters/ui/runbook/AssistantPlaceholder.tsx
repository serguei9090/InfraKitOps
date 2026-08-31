import { Sparkles } from 'lucide-react'

export function AssistantPlaceholder() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <Sparkles className="size-8 text-muted-foreground/50" />
      <p className="max-w-sm text-sm text-muted-foreground">
        Generate a step script from a plain-English description. Lands in R4 — it
        reuses the Prompt Library's model connections once those exist.
      </p>
    </div>
  )
}
