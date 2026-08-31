import { CheckCircle2, Download, Loader2, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { installPackage, listPackages, type PackageTool } from '@/adapters/backend/runbookClient'
import { cn } from '@/lib/utils'

export function PackagesView() {
  const [tools, setTools] = useState<PackageTool[]>([])
  const [extra, setExtra] = useState('')
  const [busy, setBusy] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [log, setLog] = useState<string>('')

  async function refresh(withExtra?: string[]) {
    setBusy(true)
    try {
      setTools(await listPackages(withExtra))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void refresh()
  }, [])

  function install(t: PackageTool) {
    if (!t.manager) return
    setInstalling(t.name)
    setLog(`$ ${t.installCmd}\n`)
    const abort = installPackage(t.name, t.manager, {
      onEvent: (name, data) => {
        const d = data as { text?: string; error?: string }
        if (name === 'line' && d.text) setLog((l) => l + d.text)
        if (name === 'error' && d.error) setLog((l) => l + `\nerror: ${d.error}`)
        if (name === 'done') {
          setLog((l) => l + '\n✓ done')
          setInstalling(null)
          void refresh()
        }
      },
      onError: (e) => {
        setLog((l) => l + `\n${e.message}`)
        setInstalling(null)
      },
      onClose: () => setInstalling((cur) => (cur === t.name ? null : cur)),
    })
    void abort
  }

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          Tools your runbooks call. Missing ones show the install command for this host's package manager.
        </span>
        <div className="flex-1" />
        <Input
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && refresh(extra.split(',').map((s) => s.trim()).filter(Boolean))}
          placeholder="check another tool…"
          className="h-8 w-48"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-border/60">
        <table className="w-full text-sm">
          <tbody>
            {tools.map((t) => (
              <tr key={t.name} className="border-b border-border/40 last:border-0">
                <td className="w-6 px-3 py-2">
                  {t.present ? (
                    <CheckCircle2 className="size-4 text-emerald-500" />
                  ) : (
                    <XCircle className="size-4 text-muted-foreground/50" />
                  )}
                </td>
                <td className="px-2 py-2 font-mono">{t.name}</td>
                <td className="px-2 py-2 text-muted-foreground">
                  {t.present ? t.version || 'installed' : 'not found'}
                </td>
                <td className="px-2 py-2 text-right">
                  {!t.present && t.installCmd && (
                    <div className="flex items-center justify-end gap-2">
                      <code className="hidden truncate text-[11px] text-muted-foreground md:inline-block md:max-w-xs">
                        {t.installCmd}
                      </code>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={installing != null}
                        onClick={() => install(t)}
                      >
                        {installing === t.name ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Download className="size-3" />
                        )}
                        {t.needsSudo ? `${t.manager} (sudo)` : t.manager}
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {busy && <p className="mt-2 text-xs text-muted-foreground">detecting…</p>}

      {log && (
        <pre
          className={cn(
            'mt-4 max-h-64 overflow-auto rounded-lg border border-border/60 bg-background p-3 font-mono text-[12px]',
          )}
        >
          {log}
        </pre>
      )}
    </div>
  )
}
