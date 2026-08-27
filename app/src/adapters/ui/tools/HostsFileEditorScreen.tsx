import { AlertTriangle, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { backendGet, backendPost, backendRequest } from '@/adapters/backend/backendClient'
import { NetworkToolScaffold, QueryBar, StatusStrip } from '@/adapters/ui/network'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { diffText } from '@/core/network/history'
import type { RunEnvelope } from '@/core/network/history'
import type { HostsFile, HostsLine } from '@/core/network/toolResults'

function render(lines: HostsLine[]): string {
  return lines
    .map((l) => {
      if (l.kind !== 'mapping') return l.raw
      const prefix = l.enabled ? '' : '# '
      const c = l.comment ? `  # ${l.comment}` : ''
      return `${prefix}${l.ip} ${(l.hostnames ?? []).join(' ')}${c}`
    })
    .join('\n')
}

export function HostsFileEditorScreen() {
  const [file, setFile] = useState<HostsFile | null>(null)
  const [draft, setDraft] = useState<HostsLine[]>([])
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'elevation'; text: string } | null>(null)

  const ROW_CAP = 200

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const { envelope } = await backendGet<{ envelope: RunEnvelope }>('/hosts')
      const f = envelope.result as HostsFile
      setFile(f)
      setDraft(f.lines.map((l) => ({ ...l, hostnames: l.hostnames ? [...l.hostnames] : undefined })))
      setPath(f.path)
      setMessage(null)
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const allMappings = useMemo(
    () => draft.map((l, i) => ({ l, i })).filter(({ l }) => l.kind === 'mapping'),
    [draft],
  )
  const mappings = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const matched = f
      ? allMappings.filter(
          ({ l }) => (l.ip ?? '').includes(f) || (l.hostnames ?? []).some((h) => h.toLowerCase().includes(f)),
        )
      : allMappings
    return matched.slice(0, ROW_CAP)
  }, [allMappings, filter])

  const dirty = useMemo(() => {
    if (!file) return false
    return render(file.lines) !== render(draft)
  }, [file, draft])

  const changePreview = useMemo(() => {
    if (!file || !dirty) return null
    return diffText(render(file.lines), render(draft), { normalizeVolatile: false })
  }, [file, draft, dirty])

  function update(index: number, patch: Partial<HostsLine>) {
    setDraft((cur) => cur.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function remove(index: number) {
    setDraft((cur) => cur.filter((_, i) => i !== index))
  }

  function addRow() {
    setDraft((cur) => [...cur, { kind: 'mapping', enabled: true, ip: '', hostnames: [''], comment: '', raw: '' }])
  }

  async function apply() {
    setBusy(true)
    setMessage(null)
    try {
      await backendPost('/hosts', { lines: draft })
      setMessage({ kind: 'ok', text: 'Hosts file updated. A timestamped backup was made.' })
      await load()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setMessage(
        msg.includes('403') || msg.toLowerCase().includes('administrator')
          ? { kind: 'elevation', text: 'Writing the hosts file needs elevated rights. Run InfraKit Studio as administrator / root and try again.' }
          : { kind: 'error', text: msg },
      )
    } finally {
      setBusy(false)
    }
  }

  async function restore() {
    setBusy(true)
    try {
      await backendRequest('POST', '/hosts/restore')
      setMessage({ kind: 'ok', text: 'Restored the most recent backup.' })
      await load()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setMessage(
        msg.includes('403')
          ? { kind: 'elevation', text: 'Restoring needs elevated rights.' }
          : { kind: 'error', text: msg },
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <NetworkToolScaffold
      title="Hosts File Editor"
      toolId="hosts-editor"
      statusStrip={
        <StatusStrip
          running={busy}
          items={[path, `${allMappings.length} entries`, dirty ? 'unsaved changes' : ''].filter(Boolean)}
        />
      }
      queryBar={
        <QueryBar onRun={() => void load()} running={busy} runLabel="Reload">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by IP or hostname…"
              className="w-56"
            />
            <Button type="button" size="sm" variant="outline" onClick={addRow} className="gap-1.5">
              <Plus className="size-4" /> Add entry
            </Button>
            <Button type="button" size="sm" onClick={() => void apply()} disabled={!dirty || busy} className="gap-1.5">
              <Save className="size-4" /> Apply changes
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => void restore()} disabled={busy} className="gap-1.5">
              <RotateCcw className="size-4" /> Restore backup
            </Button>
          </div>
        </QueryBar>
      }
      results={
        <div className="space-y-4">
          {message ? (
            <div
              className={
                'flex items-start gap-2 rounded-lg border p-3 text-sm ' +
                (message.kind === 'ok'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-destructive/30 bg-destructive/10 text-destructive')
              }
            >
              {message.kind !== 'ok' ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : null}
              <span>{message.text}</span>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="w-16 px-3 py-2">Enabled</th>
                  <th className="px-3 py-2">IP address</th>
                  <th className="px-3 py-2">Hostnames</th>
                  <th className="px-3 py-2">Comment</th>
                  <th className="w-10 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {mappings.map(({ l, i }) => (
                  <tr key={i} className="border-b border-border/40 last:border-0">
                    <td className="px-3 py-1.5">
                      <Checkbox checked={l.enabled} onCheckedChange={(v) => update(i, { enabled: Boolean(v) })} />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        value={l.ip ?? ''}
                        onChange={(e) => update(i, { ip: e.target.value })}
                        className="h-7 font-mono text-xs"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        value={(l.hostnames ?? []).join(' ')}
                        onChange={(e) => update(i, { hostnames: e.target.value.split(/\s+/).filter(Boolean) })}
                        className="h-7 font-mono text-xs"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        value={l.comment ?? ''}
                        onChange={(e) => update(i, { comment: e.target.value })}
                        className="h-7 text-xs"
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <button
                        type="button"
                        aria-label="Delete entry"
                        onClick={() => remove(i)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {allMappings.length > mappings.length ? (
            <p className="text-xs text-muted-foreground">
              Showing {mappings.length} of {allMappings.length} entries{filter ? ' (filtered)' : ''}. Use the filter to
              narrow the list.
            </p>
          ) : null}

          {changePreview ? (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Pending changes</p>
              <pre className="overflow-x-auto rounded-lg border border-border/60 bg-card p-2 font-mono text-xs">
                {changePreview.lines
                  .filter((line) => line.type !== 'context')
                  .map((line, k) => (
                    <div
                      key={k}
                      className={
                        line.type === 'add'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-destructive'
                      }
                    >
                      {line.type === 'add' ? '+ ' : '- '}
                      {line.text}
                    </div>
                  ))}
              </pre>
            </div>
          ) : null}
        </div>
      }
    />
  )
}
