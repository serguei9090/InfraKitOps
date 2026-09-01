import { useEffect, useMemo, useState } from 'react'
import { Loader2, MessageSquareText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useMcpStore } from '@/stores/mcpStore'
import type { McpPrompt } from '@/core/mcp/mcpModel'

interface Props {
  open: boolean
  onClose: () => void
  /** the rendered prompt text, ready to drop into the composer */
  onPicked: (text: string) => void
}

/** Flatten prompt messages to composer text; prefix non-user roles. */
function messagesToText(messages: { role: string; text: string }[]): string {
  const parts = messages.filter((m) => m.text.trim())
  if (parts.length === 1 && parts[0].role === 'user') return parts[0].text
  return parts.map((m) => (m.role === 'user' ? m.text : `[${m.role}]\n${m.text}`)).join('\n\n')
}

export function PromptPickerDialog({ open, onClose, onPicked }: Props) {
  const prompts = useMcpStore((s) => s.prompts)
  const loaded = useMcpStore((s) => s.promptsLoaded)
  const loadPrompts = useMcpStore((s) => s.loadPrompts)
  const getPrompt = useMcpStore((s) => s.getPrompt)

  const [q, setQ] = useState('')
  const [sel, setSel] = useState<McpPrompt | null>(null)
  const [args, setArgs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) void loadPrompts()
  }, [open, loadPrompts])
  useEffect(() => {
    if (!open) {
      setSel(null)
      setArgs({})
      setQ('')
    }
  }, [open])

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase()
    return prompts.filter(
      (p) => !n || p.name.toLowerCase().includes(n) || (p.description ?? '').toLowerCase().includes(n),
    )
  }, [q, prompts])

  const missingRequired = (sel?.arguments ?? []).some((a) => a.required && !args[a.name]?.trim())

  async function run() {
    if (!sel) return
    setBusy(true)
    try {
      const res = await getPrompt(sel.server, sel.name, args)
      if (!res) return
      onPicked(messagesToText(res.messages))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{sel ? sel.name : 'Insert a server prompt'}</DialogTitle>
        </DialogHeader>

        {!sel ? (
          <>
            <Input
              autoFocus
              placeholder="Search prompts…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="mb-2"
            />
            <div className="max-h-[50vh] overflow-y-auto">
              {!loaded && (
                <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading prompts…
                </p>
              )}
              {loaded && filtered.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No prompts exposed by the enabled MCP servers.
                </p>
              )}
              <ul className="flex flex-col gap-1">
                {filtered.map((p) => (
                  <li key={`${p.server}|${p.name}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setSel(p)
                        setArgs({})
                      }}
                      className="flex w-full items-start gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-left text-sm hover:bg-accent/40"
                    >
                      <MessageSquareText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{p.title || p.name}</span>
                        {p.description && (
                          <span className="block truncate text-[11px] text-muted-foreground">{p.description}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{p.serverName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            {sel.description && <p className="text-sm text-muted-foreground">{sel.description}</p>}
            {(sel.arguments ?? []).map((a) => (
              <div key={a.name}>
                <Label className="text-xs">
                  {a.name}
                  {a.required && <span className="text-destructive"> *</span>}
                </Label>
                {a.description && <p className="mb-1 text-[11px] text-muted-foreground">{a.description}</p>}
                <Input
                  value={args[a.name] ?? ''}
                  onChange={(e) => setArgs((m) => ({ ...m, [a.name]: e.target.value }))}
                />
              </div>
            ))}
            {(sel.arguments ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">This prompt takes no arguments.</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSel(null)}>
                Back
              </Button>
              <Button size="sm" disabled={missingRequired || busy} onClick={() => void run()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : 'Insert'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
