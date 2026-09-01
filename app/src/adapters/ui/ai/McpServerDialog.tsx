import { useState } from 'react'
import { CheckCircle2, Loader2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { testServer } from '@/adapters/backend/mcpClient'
import { useMcpStore } from '@/stores/mcpStore'
import { TRANSPORT_LABEL, type McpServer, type McpTool, type McpTransport } from '@/core/mcp/mcpModel'
import { SecretPicker } from '@/adapters/ui/runbook/SecretPicker'
import { InlineError } from '@/adapters/ui/errors/InlineError'
import { classify, type AppError } from '@/core/errors/appError'

type Draft = Partial<McpServer>

interface Props {
  draft: Draft | null
  onClose: () => void
}

export function McpServerDialog({ draft, onClose }: Props) {
  const putServer = useMcpStore((s) => s.putServer)
  const [d, setD] = useState<Draft | null>(draft)
  const [test, setTest] = useState<{ state: 'idle' | 'running' | 'ok' | 'err'; tools?: McpTool[]; error?: AppError }>({
    state: 'idle',
  })

  if (!d) return null
  const transport = (d.transport ?? 'stdio') as McpTransport
  const envRows = Object.entries(d.env ?? {})

  function setEnv(next: [string, string][]) {
    setD((c) => ({ ...c!, env: Object.fromEntries(next.filter(([k]) => k)) }))
  }

  async function runTest(id: string) {
    setTest({ state: 'running' })
    try {
      const r = await testServer(id)
      if (r.ok) setTest({ state: 'ok', tools: r.tools })
      else setTest({ state: 'err', error: classify({ error: r.error, code: r.code, hint: r.hint }, 'AI Hub') })
    } catch (e) {
      setTest({ state: 'err', error: classify(e, 'AI Hub') })
    }
  }

  return (
    <Dialog open={draft != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100%-2rem)] max-w-xl flex-col">
        <DialogHeader>
          <DialogTitle>{draft?.id ? 'Edit MCP server' : 'Add MCP server'}</DialogTitle>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={async (e) => {
            e.preventDefault()
            const id = await putServer(d)
            if (id) onClose()
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
            <div className="flex flex-col gap-3 sm:flex-row sm:gap-2">
              <div className="min-w-0 flex-1">
                <Label className="text-xs">Name</Label>
                <Input
                  value={d.name ?? ''}
                  onChange={(e) => setD((c) => ({ ...c!, name: e.target.value }))}
                  placeholder="Context7"
                  autoFocus
                />
              </div>
              <div className="sm:w-56 sm:shrink-0">
                <Label className="text-xs">Transport</Label>
                <Select
                  value={transport}
                  onValueChange={(v) => v && setD((c) => ({ ...c!, transport: v as McpTransport }))}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue>{(v) => TRANSPORT_LABEL[v as McpTransport] ?? v}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(['stdio', 'http'] as McpTransport[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {TRANSPORT_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {transport === 'stdio' ? (
              <>
                <div className="flex flex-col gap-3 sm:flex-row sm:gap-2">
                  <div className="sm:w-40 sm:shrink-0">
                    <Label className="text-xs">Command</Label>
                    <Input
                      value={d.command ?? ''}
                      onChange={(e) => setD((c) => ({ ...c!, command: e.target.value }))}
                      placeholder="npx"
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Label className="text-xs">Arguments (space-separated)</Label>
                    <Input
                      value={(d.args ?? []).join(' ')}
                      onChange={(e) =>
                        setD((c) => ({ ...c!, args: e.target.value.split(/\s+/).filter(Boolean) }))
                      }
                      placeholder="-y @upstash/context7-mcp"
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
                <p className="-mt-1 text-[11px] text-muted-foreground">
                  The command must be on your PATH. It runs as a child process — only add servers you trust.
                </p>

                <div>
                  <Label className="text-xs">Environment</Label>
                  <div className="flex flex-col gap-1.5">
                    {envRows.map(([k, v], i) => (
                      <div key={i} className="flex gap-2">
                        <Input
                          value={k}
                          onChange={(e) => {
                            const next = [...envRows] as [string, string][]
                            next[i] = [e.target.value, v]
                            setEnv(next)
                          }}
                          placeholder="KEY"
                          className="w-40 font-mono text-xs"
                        />
                        <Input
                          value={v}
                          onChange={(e) => {
                            const next = [...envRows] as [string, string][]
                            next[i] = [k, e.target.value]
                            setEnv(next)
                          }}
                          placeholder="value or {{secret:NAME}}"
                          className="min-w-0 flex-1 font-mono text-xs"
                        />
                        <button
                          type="button"
                          aria-label="Remove"
                          onClick={() => setEnv(envRows.filter((_, j) => j !== i) as [string, string][])}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      className="self-start"
                      onClick={() => setEnv([...envRows, ['', '']] as [string, string][])}
                    >
                      <Plus className="size-3.5" /> Variable
                    </Button>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Use <code>{'{{secret:NAME}}'}</code> to pull a value from the Vault instead of storing it here.
                  </p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <Label className="text-xs">Endpoint URL</Label>
                  <Input
                    value={d.url ?? ''}
                    onChange={(e) => setD((c) => ({ ...c!, url: e.target.value }))}
                    placeholder="https://mcp.example.com/sse"
                    className="w-full font-mono text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs">Auth token (optional)</Label>
                  <SecretPicker
                    by="id"
                    value={d.authSecretId ?? ''}
                    onChange={(id) => setD((c) => ({ ...c!, authSecretId: id }))}
                    kinds={['api-key', 'token', 'password', 'other']}
                    placeholder="pick a bearer token from the Vault"
                  />
                </div>
              </>
            )}

            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={d.enabled ?? true}
                onChange={(e) => setD((c) => ({ ...c!, enabled: e.target.checked }))}
              />
              Enabled — its tools are offered to the model when a task or the Playground has tools on
            </label>

            {d.id && (
              <div>
                <Button type="button" size="xs" variant="outline" onClick={() => void runTest(d.id!)}>
                  {test.state === 'running' ? <Loader2 className="size-3.5 animate-spin" /> : 'Test — connect & list tools'}
                </Button>
                {test.state === 'ok' && (
                  <div className="mt-2">
                    <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-500">
                      <CheckCircle2 className="size-3.5" /> {test.tools?.length ?? 0} tool
                      {test.tools?.length === 1 ? '' : 's'}
                    </p>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {(test.tools ?? []).map((t) => (
                        <li key={t.qualifiedName} className="flex items-center gap-2 text-[11px]">
                          <span className="font-mono">{t.name}</span>
                          {t.readOnly ? (
                            <span className="rounded bg-emerald-500/15 px-1 text-emerald-700 dark:text-emerald-400">
                              read-only
                            </span>
                          ) : (
                            <span className="rounded bg-amber-500/15 px-1 text-amber-700 dark:text-amber-400">
                              confirm
                            </span>
                          )}
                          <span className="truncate text-muted-foreground">{t.description}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {test.state === 'err' && <InlineError error={test.error} className="mt-1.5" />}
              </div>
            )}
            {!d.id && (
              <p className="text-xs text-muted-foreground">Save first, then Test to connect and list its tools.</p>
            )}
          </div>

          <DialogFooter className="mt-4">
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button type="submit" disabled={!d.name}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
