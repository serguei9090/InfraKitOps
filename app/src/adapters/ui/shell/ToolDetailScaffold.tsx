import { Copy, Download, Eye } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { downloadBlob } from '@/lib/downloadFile'
import { cn } from '@/lib/utils'

interface ToolDetailScaffoldProps {
  title: string
  inputPanel: ReactNode
  outputPanel: ReactNode
  /** Text to copy when the toolbar's copy button is pressed. Undefined hides it. */
  copyText?: string
  /** Opens `preview.content` in a modal from a header button. Undefined hides it. */
  preview?: ToolScaffoldPreview
  /** Downloads `download.content` as a file from a header button. Undefined hides it. */
  download?: ToolScaffoldDownload
}

/**
 * Shared "Tool Detail Split Panel" layout — T1 (Compact Side-by-Side)
 * archetype: inputs on the left, live generated output on the right, with a
 * copy-to-clipboard action. Use for tools with minimalist inputs (<6 params)
 * and a single output block. Built from the same header/panel primitives
 * `BalancedFlowScaffold` (T2) and `StepperWorkspaceScaffold` (T3) use, so all
 * three archetypes stay visually consistent as more tools are added
 * independently.
 */
export function ToolDetailScaffold({ title, inputPanel, outputPanel, copyText, preview, download }: ToolDetailScaffoldProps) {
  return (
    <div className="flex min-h-full flex-col">
      <ToolScaffoldHeader title={title} copyText={copyText} preview={preview} download={download} />
      <div className="flex flex-1 flex-col gap-4 p-5 lg:flex-row">
        <ToolScaffoldPanel label="INPUT PARAMETERS & CONTROLS" bordered className="bg-background">
          {inputPanel}
        </ToolScaffoldPanel>
        <ToolScaffoldPanel label="GENERATED OUTPUT & LIVE PREVIEW" bordered className="bg-card">
          {outputPanel}
        </ToolScaffoldPanel>
      </div>
    </div>
  )
}

interface ToolScaffoldPreview {
  label: string
  content: ReactNode
}

interface ToolScaffoldDownload {
  fileName: string
  content: string
  mimeType?: string
}

/**
 * Title bar with optional Download / Preview / Copy actions, shared by all
 * three layout archetypes. All stay reachable without scrolling — the
 * header sits outside the scaffold's scrollable body — which matters most
 * for `StepperWorkspaceScaffold` (T3), where a long dynamic rule/row list
 * can otherwise push the generated output far below the fold.
 */
export function ToolScaffoldHeader({
  title,
  copyText,
  preview,
  download,
}: {
  title: string
  copyText?: string
  preview?: ToolScaffoldPreview
  download?: ToolScaffoldDownload
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (!copyText) return
    await navigator.clipboard.writeText(copyText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1000)
  }

  return (
    <div className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-5">
      <h1 className="text-[17px] font-semibold tracking-tight">{title}</h1>
      <div className="flex-1" />
      {download ? (
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => downloadBlob(download.content, download.fileName, download.mimeType)}
        >
          <Download className="size-4" />
          Download
        </Button>
      ) : null}
      {preview ? (
        <Dialog>
          <DialogTrigger render={<Button variant="ghost" size="sm" className="gap-1.5" />}>
            <Eye className="size-4" />
            Preview
          </DialogTrigger>
          <DialogContent className="flex max-h-[85vh] w-[calc(100%-2rem)] max-w-[calc(100%-2rem)] flex-col sm:max-w-2xl md:max-w-4xl lg:max-w-5xl">
            <DialogHeader>
              <DialogTitle>{preview.label}</DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-auto">{preview.content}</div>
          </DialogContent>
        </Dialog>
      ) : null}
      {copyText !== undefined ? (
        <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-1.5">
          <Copy className="size-4" />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      ) : null}
    </div>
  )
}

/** Bordered, labeled panel/card surface shared by all three layout archetypes. */
export function ToolScaffoldPanel({
  label,
  className,
  bordered,
  children,
}: {
  label: string
  className?: string
  /** Draw a full rounded border (card look) instead of the flush edge-to-edge T1 style. */
  bordered?: boolean
  children: ReactNode
}) {
  return (
    <div className={cn('w-full min-w-0 flex-1 p-5', bordered && 'rounded-lg border border-border/60', className)}>
      <p className="text-xs font-medium tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-3.5">{children}</div>
    </div>
  )
}
