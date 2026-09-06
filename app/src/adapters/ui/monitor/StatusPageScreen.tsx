import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, CircleAlert, CircleDashed } from 'lucide-react'
import { publicStatus } from '@/adapters/backend/monitorClient'
import {
  fmtDuration,
  fmtUptime,
  uptimeTone,
  type PublicStatusPage,
} from '@/core/monitor/monitorModel'
import { cn } from '@/lib/utils'

/**
 * Public status page (MONITORS_MODULE_PLAN.md M5). Standalone — no app shell,
 * no auth. Reached at `/status/:token`; the backend serves a stripped payload
 * (name / status / uptime only).
 */
export function StatusPageScreen() {
  const { token = '' } = useParams()
  const [page, setPage] = useState<PublicStatusPage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const load = () =>
      publicStatus(token)
        .then((p) => live && (setPage(p), setError(null)))
        .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
    void load()
    const t = setInterval(load, 30_000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [token])

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-5 py-12">
      {error && !page ? (
        <p className="rounded-lg border border-border/60 bg-card p-6 text-center text-sm text-muted-foreground">
          {error}
        </p>
      ) : !page ? (
        <p className="text-center text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <header className="mb-8 flex items-center gap-3">
            {page.ok ? (
              <CheckCircle2 className="size-7 text-emerald-500" />
            ) : (
              <CircleAlert className="size-7 text-destructive" />
            )}
            <div>
              <h1 className="text-lg font-semibold">{page.title || 'Service status'}</h1>
              <p className="text-sm text-muted-foreground">
                {page.ok ? 'All systems operational' : `${page.incidents.length || 'Some components'} affected`}
              </p>
            </div>
          </header>

          {page.incidents.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-2 text-xs font-medium uppercase text-muted-foreground">Active incidents</h2>
              <ul className="space-y-1.5">
                {page.incidents.map((i, n) => (
                  <li
                    key={n}
                    className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
                  >
                    <CircleAlert className="size-4 shrink-0 text-destructive" />
                    <span className="font-medium">{i.name}</span>
                    <span className="text-muted-foreground">
                      down {fmtDuration(Date.now() - i.startedAt)} · since {new Date(i.startedAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-xs font-medium uppercase text-muted-foreground">Components</h2>
            <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
              {page.components.length === 0 ? (
                <li className="px-4 py-3 text-sm text-muted-foreground">No components published.</li>
              ) : (
                page.components.map((c, n) => (
                  <li key={n} className="flex items-center gap-3 px-4 py-3">
                    {c.status === 'up' ? (
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                    ) : c.status === 'down' ? (
                      <CircleAlert className="size-4 shrink-0 text-destructive" />
                    ) : (
                      <CircleDashed className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="flex-1 text-sm font-medium">{c.name}</span>
                    <span className={cn('text-xs tabular-nums', uptimeTone(c.uptime['30d']))} title="30-day uptime">
                      {fmtUptime(c.uptime['30d'])}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </section>

          <footer className="mt-8 text-center text-[11px] text-muted-foreground">
            Updated {new Date(page.generatedAt).toLocaleString()}
          </footer>
        </>
      )}
    </div>
  )
}
