import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

/** Monospace block for text-shaped tool results (whois, dig +trace, geo block). */
export function TextResultView({ text, title }: { text: string; title?: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="rounded-lg border border-border/60 bg-card">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">{title ?? 'Response'}</span>
        <Button variant="ghost" size="xs" onClick={copy} className="gap-1">
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="max-h-[60vh] overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
        {text}
      </pre>
    </div>
  )
}
