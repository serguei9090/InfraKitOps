import { Package } from 'lucide-react'

export function PackagesView() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <Package className="size-8 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">
        Tool detection + assisted install (winget / choco / brew / apt …) and the
        <span className="font-mono"> uv </span> bootstrap land in R3.
      </p>
    </div>
  )
}
