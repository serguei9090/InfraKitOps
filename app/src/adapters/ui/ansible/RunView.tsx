import { useState } from 'react'
import { CheckCircle2, ChevronRight, CircleDot, Loader2, MinusCircle, PlugZap, RotateCw, X, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAnsibleStore } from '@/stores/ansibleStore'
import type { HostState, TaskNode } from '@/core/ansible/ansibleModel'

const STATE_STYLE: Record<HostState, { cls: string; label: string }> = {
  ok: { cls: 'text-emerald-600 dark:text-emerald-400', label: 'OK' },
  changed: { cls: 'text-amber-600 dark:text-amber-400', label: 'CHANGED' },
  failed: { cls: 'text-red-600 dark:text-red-400', label: 'FAILED' },
  skipped: { cls: 'text-muted-foreground', label: 'SKIPPED' },
  unreachable: { cls: 'text-fuchsia-600 dark:text-fuchsia-400', label: 'UNREACHABLE' },
}

function hostBadge(state: HostState, changed: boolean) {
  const s = changed && state === 'ok' ? STATE_STYLE.changed : STATE_STYLE[state]
  return <span className={cn('font-mono text-[10px] font-semibold', s.cls)}>{s.label}</span>
}

/**
 * Live play → task → host tree for the currently streaming (or just-finished)
 * run. Rendered as a bottom sheet over the console workspace. AN0 milestone:
 * "watch the play/task/host tree." See ANSIBLE_MODULE_PLAN.md.
 */
export function RunView() {
  const live = useAnsibleStore((s) => s.live)
  const replaying = useAnsibleStore((s) => s.replaying)
  const clear = useAnsibleStore((s) => s.clearLive)
  const rerun = useAnsibleStore((s) => s.rerun)
  const lastSpec = useAnsibleStore((s) => s.lastSpec)
  const [showConsole, setShowConsole] = useState(false)
  if (!live) return null

  const running = !replaying && (live.status === 'starting' || live.status === 'running')

  return (
    <div className="absolute inset-x-0 bottom-8 top-14 z-20 flex flex-col border-t border-border bg-background shadow-2xl">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-4">
        {running ? (
          <Loader2 className="size-4 animate-spin text-primary" />
        ) : live.status === 'ok' ? (
          <CheckCircle2 className="size-4 text-emerald-500" />
        ) : (
          <XCircle className="size-4 text-red-500" />
        )}
        <span className="text-sm font-medium">
          {replaying ? 'Replay' : running ? 'Running' : live.status === 'ok' ? 'Completed' : live.status}
        </span>
        {live.runId != null && <span className="text-xs text-muted-foreground">run #{live.runId}</span>}
        {live.error && <span className="truncate text-xs text-red-500">{live.error}</span>}
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setShowConsole((v) => !v)}>
          <PlugZap className="size-4" /> {showConsole ? 'Tree' : 'Console'}
        </Button>
        {running ? (
          <Button variant="outline" size="sm" onClick={() => live.abort()}>
            Stop
          </Button>
        ) : (
          <>
            {!replaying && lastSpec && (
              <Button variant="outline" size="sm" onClick={rerun}>
                <RotateCw className="size-4" /> Re-run
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={clear} aria-label="Close">
              <X className="size-4" />
            </Button>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {showConsole ? (
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
            {live.console.map((l, i) => (
              <span key={i} className={l.stream === 'stderr' ? 'text-red-500' : undefined}>
                {l.text}
                {'\n'}
              </span>
            ))}
          </pre>
        ) : (
          <div className="space-y-4">
            {live.plays.length === 0 && (
              <p className="text-sm text-muted-foreground">Waiting for the first play…</p>
            )}
            {live.plays.map((play, pi) => (
              <div key={pi} className="rounded-lg border border-border/60">
                <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-1.5">
                  <CircleDot className="size-3.5 text-primary" />
                  <span className="text-sm font-semibold">{play.name}</span>
                  {play.hosts.length > 0 && (
                    <span className="text-xs text-muted-foreground">{play.hosts.join(', ')}</span>
                  )}
                </div>
                <div className="divide-y divide-border/40">
                  {play.tasks.map((task) => (
                    <TaskRow key={task.uuid} task={task} />
                  ))}
                </div>
              </div>
            ))}

            {live.recap && (
              <div className="rounded-lg border border-border/60 p-3">
                <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Recap</div>
                <div className="space-y-1">
                  {Object.entries(live.recap.hosts).map(([host, c]) => (
                    <div key={host} className="flex items-center gap-3 font-mono text-xs">
                      <span className="w-40 truncate font-medium">{host}</span>
                      <span className="text-emerald-600 dark:text-emerald-400">ok={c.ok}</span>
                      <span className="text-amber-600 dark:text-amber-400">changed={c.changed}</span>
                      <span className={c.failures ? 'text-red-500' : 'text-muted-foreground'}>
                        failed={c.failures}
                      </span>
                      <span className={c.unreachable ? 'text-fuchsia-500' : 'text-muted-foreground'}>
                        unreachable={c.unreachable}
                      </span>
                      <span className="text-muted-foreground">skipped={c.skipped}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function TaskRow({ task }: { task: TaskNode }) {
  const [open, setOpen] = useState(true)
  const hosts = Object.entries(task.hosts)
  const anyFail = hosts.some(([, h]) => h.state === 'failed' || h.state === 'unreachable')
  return (
    <div className="px-3 py-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left text-sm"
      >
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        {anyFail ? (
          <XCircle className="size-3.5 text-red-500" />
        ) : hosts.length ? (
          <CheckCircle2 className="size-3.5 text-emerald-500" />
        ) : (
          <MinusCircle className="size-3.5 text-muted-foreground" />
        )}
        <span className="font-medium">{task.name || task.action}</span>
        <span className="text-xs text-muted-foreground">{task.action}</span>
      </button>
      {open && hosts.length > 0 && (
        <div className="ml-6 mt-1 space-y-0.5">
          {hosts.map(([host, h]) => (
            <div key={host} className="flex items-center gap-2 text-xs">
              <span className="w-36 truncate font-mono">{host}</span>
              {hostBadge(h.state, h.changed)}
              {h.msg && <span className="truncate text-muted-foreground">{h.msg}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
