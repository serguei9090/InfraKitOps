import { useEffect, useMemo, useState } from 'react'
import { FileText, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useMcpStore } from '@/stores/mcpStore'
import { isTextResource, type McpContextBlock } from '@/core/mcp/mcpModel'

interface Props {
  open: boolean
  onClose: () => void
  /** URIs already attached — shown as "added" */
  attached: string[]
  onAdd: (block: McpContextBlock) => void
}

export function ContextPickerDialog({ open, onClose, attached, onAdd }: Props) {
  const resources = useMcpStore((s) => s.resources)
  const templates = useMcpStore((s) => s.resourceTemplates)
  const loaded = useMcpStore((s) => s.resourcesLoaded)
  const loadResources = useMcpStore((s) => s.loadResources)
  const readResource = useMcpStore((s) => s.readResource)

  const [q, setQ] = useState('')
  const [busyUri, setBusyUri] = useState('')
  const [tmplUri, setTmplUri] = useState<Record<string, string>>({})

  useEffect(() => {
    if (open) void loadResources()
  }, [open, loadResources])

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase()
    const match = (s: string) => !n || s.toLowerCase().includes(n)
    return {
      resources: resources.filter((r) => match(r.name) || match(r.uri) || match(r.description ?? '')),
      templates: templates.filter((t) => match(t.name) || match(t.uriTemplate) || match(t.description ?? '')),
    }
  }, [q, resources, templates])

  async function add(server: string, uri: string, name: string, mime?: string) {
    if (!isTextResource(mime)) return
    setBusyUri(uri)
    try {
      const read = await readResource(server, uri)
      if (!read) return
      const text = read.contents.map((c) => c.text).join('\n\n')
      onAdd({ uri, name: name || uri, text, truncated: read.truncated })
    } finally {
      setBusyUri('')
    }
  }

  const nothing = loaded && filtered.resources.length === 0 && filtered.templates.length === 0

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Attach context</DialogTitle>
        </DialogHeader>

        <Input
          autoFocus
          placeholder="Search resources…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="mb-2"
        />

        <div className="max-h-[50vh] overflow-y-auto">
          {!loaded && (
            <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading resources…
            </p>
          )}

          {nothing && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No resources exposed by the enabled MCP servers.
            </p>
          )}

          {filtered.resources.length > 0 && (
            <ul className="flex flex-col gap-1">
              {filtered.resources.map((r) => {
                const isAttached = attached.includes(r.uri)
                const text = isTextResource(r.mimeType)
                return (
                  <li
                    key={r.uri}
                    className="flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-sm"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{r.title || r.name}</div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">{r.uri}</div>
                      {!text && (
                        <div className="text-[11px] text-amber-600 dark:text-amber-500">
                          binary ({r.mimeType}) — not supported yet
                        </div>
                      )}
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{r.serverName}</span>
                    <Button
                      size="xs"
                      variant={isAttached ? 'ghost' : 'secondary'}
                      disabled={isAttached || !text || busyUri === r.uri}
                      onClick={() => void add(r.server, r.uri, r.name, r.mimeType)}
                    >
                      {busyUri === r.uri ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : isAttached ? (
                        'added'
                      ) : (
                        <Plus className="size-3.5" />
                      )}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}

          {filtered.templates.length > 0 && (
            <>
              <div className="mt-3 mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Templates — fill in the URI
              </div>
              <ul className="flex flex-col gap-1">
                {filtered.templates.map((t) => {
                  const key = `${t.server}|${t.uriTemplate}`
                  const val = tmplUri[key] ?? t.uriTemplate
                  const ready = val && !/[{}]/.test(val)
                  return (
                    <li
                      key={key}
                      className="flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{t.title || t.name}</div>
                        <Input
                          value={val}
                          onChange={(e) => setTmplUri((m) => ({ ...m, [key]: e.target.value }))}
                          className="mt-1 h-7 font-mono text-[11px]"
                        />
                      </div>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{t.serverName}</span>
                      <Button
                        size="xs"
                        variant="secondary"
                        disabled={!ready || busyUri === val}
                        onClick={() => void add(t.server, val, t.name, t.mimeType)}
                      >
                        {busyUri === val ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
