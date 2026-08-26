import { Copy } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ToolDetailScaffoldProps {
  title: string
  inputPanel: ReactNode
  outputPanel: ReactNode
  /** Text to copy when the toolbar's copy button is pressed. Undefined hides it. */
  copyText?: string
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
export function ToolDetailScaffold({ title, inputPanel, outputPanel, copyText }: ToolDetailScaffoldProps) {
  return (
    <div className="flex h-full flex-col">
      <ToolScaffoldHeader title={title} copyText={copyText} />
      <div className="flex flex-1 flex-col overflow-auto lg:flex-row">
        <ToolScaffoldPanel label="INPUT PARAMETERS & CONTROLS" className="bg-background">
          {inputPanel}
        </ToolScaffoldPanel>
        <div className="h-px w-full shrink-0 bg-border/60 lg:h-auto lg:w-px" />
        <ToolScaffoldPanel label="GENERATED OUTPUT & LIVE PREVIEW" className="bg-card">
          {outputPanel}
        </ToolScaffoldPanel>
      </div>
    </div>
  )
}

/** Title bar + optional copy-to-clipboard action, shared by all three layout archetypes. */
export function ToolScaffoldHeader({ title, copyText }: { title: string; copyText?: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (!copyText) return
    await navigator.clipboard.writeText(copyText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1000)
  }

  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-5">
      <h1 className="text-[17px] font-semibold tracking-tight">{title}</h1>
      <div className="flex-1" />
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
