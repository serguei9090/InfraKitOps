import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { BookOpen, CheckCircle2, FileCode2, Loader2, Save, ShieldCheck, TriangleAlert, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import * as api from '@/adapters/backend/ansibleClient'
import { useAnsibleStore } from '@/stores/ansibleStore'

const isYaml = (f: string) => /\.(ya?ml)$/i.test(f) || f === 'ansible.cfg'

export function EditorView() {
  const selectedId = useAnsibleStore((s) => s.selectedId)
  const tree = useAnsibleStore((s) => s.tree)

  const files = useMemo(() => {
    const set = new Set<string>([
      ...(tree?.playbooks ?? []),
      ...(tree?.inventories ?? []).filter(isYaml),
      'ansible.cfg',
      'requirements.yml',
      'group_vars/all.yml',
      'site.yml',
    ])
    return [...set]
  }, [tree])

  const [path, setPath] = useState('')
  const chosen = path || files[0] || 'site.yml'

  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [check, setCheck] = useState<api.CheckResult | null>(null)
  const [busy, setBusy] = useState<'' | 'save' | 'syntax' | 'lint'>('')

  useEffect(() => {
    if (!selectedId) return
    setLoading(true)
    setErr(null)
    setCheck(null)
    api
      .readProjectFile(selectedId, chosen)
      .then((r) => {
        setContent(r.content)
        setDirty(false)
      })
      .catch((e) => {
        setContent('')
        setErr(e instanceof Error ? e.message : String(e))
      })
      .finally(() => setLoading(false))
  }, [selectedId, chosen])

  if (!selectedId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a project on the Projects tab first
      </div>
    )
  }

  async function save() {
    if (!selectedId) return
    setBusy('save')
    try {
      await api.writeProjectFile(selectedId, chosen, content)
      setDirty(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  async function runSyntax() {
    if (!selectedId) return
    setBusy('syntax')
    try {
      if (dirty) await api.writeProjectFile(selectedId, chosen, content)
      setDirty(false)
      setCheck(await api.syntaxCheck(selectedId, chosen))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  async function runLint() {
    if (!selectedId) return
    setBusy('lint')
    try {
      if (dirty) await api.writeProjectFile(selectedId, chosen, content)
      setDirty(false)
      setCheck(await api.lint(selectedId, chosen))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[1fr_300px]">
      <div className="flex min-h-0 flex-col p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <FileCode2 className="size-4 text-muted-foreground" />
          <Select value={chosen} onValueChange={(v) => v && setPath(v)}>
            <SelectTrigger size="sm" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {files.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={save} disabled={!dirty || busy === 'save'}>
            {busy === 'save' ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
          </Button>
          <Button size="sm" variant="outline" onClick={runSyntax} disabled={!!busy}>
            {busy === 'syntax' ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            Syntax check
          </Button>
          <Button size="sm" variant="outline" onClick={runLint} disabled={!!busy}>
            {busy === 'lint' ? <Loader2 className="size-4 animate-spin" /> : <TriangleAlert className="size-4" />}
            Lint
          </Button>
        </div>

        {err && (
          <p className="mb-2 rounded-md bg-red-500/10 px-2 py-1 text-xs text-red-600 dark:text-red-400">{err}</p>
        )}

        <div className="min-h-0 flex-1">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">loading…</div>
          ) : (
            <LazyEditor
              value={content}
              onChange={(v) => {
                setContent(v)
                setDirty(true)
              }}
              onSave={save}
            />
          )}
        </div>

        {check && <CheckPanel result={check} />}
      </div>

      <div className="min-h-0 overflow-auto border-l border-border/60 p-4">
        <DocPanel />
      </div>
    </div>
  )
}

// CodeMirror is heavy; only pull it in when the Editor tab is actually opened.
const CodeEditor = lazy(() => import('./CodeEditor').then((m) => ({ default: m.CodeEditor })))
function LazyEditor(props: { value: string; onChange: (v: string) => void; onSave: () => void }) {
  return (
    <Suspense fallback={<div className="h-full rounded-md border border-border/60 bg-muted/20" />}>
      <CodeEditor {...props} />
    </Suspense>
  )
}

function CheckPanel({ result }: { result: api.CheckResult }) {
  if (!result.ran) {
    return (
      <div className="mt-2 rounded-md border border-border/60 bg-muted/30 p-2 text-xs text-muted-foreground">
        {result.reason ?? 'tool not available'}
      </div>
    )
  }
  return (
    <div className="mt-2 max-h-44 overflow-auto rounded-md border border-border/60 p-2 text-xs">
      <div className="mb-1 flex items-center gap-1.5 font-medium">
        {result.ok ? (
          <CheckCircle2 className="size-3.5 text-emerald-500" />
        ) : (
          <XCircle className="size-3.5 text-red-500" />
        )}
        {result.kind === 'syntax' ? 'Syntax check' : 'ansible-lint'} — {result.ok ? 'passed' : 'issues'}
      </div>
      {result.issues && result.issues.length > 0 ? (
        <ul className="space-y-1">
          {result.issues.map((i, n) => (
            <li key={n} className="flex gap-2">
              <span className="font-mono text-muted-foreground">L{i.line || '?'}</span>
              <span>
                <span className="font-medium">{i.rule}</span> — {i.message}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        result.output && <pre className="whitespace-pre-wrap font-mono">{result.output}</pre>
      )}
    </div>
  )
}

function DocPanel() {
  const [q, setQ] = useState('')
  const [doc, setDoc] = useState<api.ModuleDoc | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function look(e: React.FormEvent) {
    e.preventDefault()
    if (!q.trim()) return
    setBusy(true)
    setErr(null)
    try {
      setDoc(await api.moduleDoc(q.trim()))
    } catch (e) {
      setDoc(null)
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase text-muted-foreground">
        <BookOpen className="size-3.5" /> ansible-doc
      </div>
      <form onSubmit={look} className="flex gap-1.5">
        <Input
          className="h-8 text-xs"
          placeholder="ansible.builtin.copy"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button size="sm" type="submit" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : 'Look up'}
        </Button>
      </form>
      {err && <p className="text-xs text-red-500">{err}</p>}
      {doc && (
        <div className="space-y-2 text-xs">
          <div>
            <div className="font-mono font-semibold">{doc.module}</div>
            <p className="text-muted-foreground">{doc.shortDescription}</p>
          </div>
          {doc.description.map((d, i) => (
            <p key={i}>{d}</p>
          ))}
          {Object.keys(doc.options).length > 0 && (
            <div>
              <div className="mb-1 font-semibold">Options</div>
              <ul className="space-y-1">
                {Object.entries(doc.options).map(([name, o]) => (
                  <li key={name}>
                    <span className={cn('font-mono', o.required && 'text-red-500')}>{name}</span>
                    {o.type ? <span className="text-muted-foreground"> ({o.type})</span> : null}
                    {o.description[0] ? <span className="text-muted-foreground"> — {o.description[0]}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
