import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useOptionalBackend } from '@/adapters/backend/useOptionalBackend'
import { validateConfig, type ConfigCheckKind, type ConfigCheckResult } from '@/adapters/backend/configCheckClient'

const KIND_LABEL: Record<ConfigCheckKind, string> = {
  nginx: 'nginx -t',
  sshd: 'sshd -t',
  ssh: 'ssh -G',
  nftables: 'nft -c',
  fail2ban: 'fail2ban-client -t',
  sysctl: 'sysctl --dry-run',
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'valid'; validator: string }
  | { kind: 'invalid'; result: ConfigCheckResult }
  | { kind: 'unavailable'; validator: string }
  | { kind: 'error'; message: string }

/**
 * Header "Validate" action for the T5 GeneratorScaffold. Runs the matching
 * OS validator on the backend in check-only mode (no writes, no root) and
 * reports the result inline; the message list opens in a dialog. Renders
 * nothing when the backend service is not connected — same rule as the old
 * `ConfigValidateButton` it replaces.
 */
export function HeaderValidate({ kind, text }: { kind: ConfigCheckKind; text: string }) {
  const power = useOptionalBackend('config-validate')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [open, setOpen] = useState(false)
  const revertTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(revertTimer.current), [])

  if (!power.available) return null

  async function run() {
    clearTimeout(revertTimer.current)
    setPhase({ kind: 'checking' })
    try {
      const result = await validateConfig(kind, text)
      if (!result.available) {
        setPhase({ kind: 'unavailable', validator: result.validator })
      } else if (result.ok) {
        setPhase({ kind: 'valid', validator: result.validator })
        revertTimer.current = setTimeout(() => setPhase({ kind: 'idle' }), 4000)
      } else {
        setPhase({ kind: 'invalid', result })
        setOpen(true)
      }
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      setOpen(true)
    }
  }

  const canReopen = phase.kind === 'invalid' || phase.kind === 'error' || phase.kind === 'unavailable'

  function onClick() {
    if (phase.kind === 'checking') return
    if (canReopen) setOpen(true)
    else void run()
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5"
        disabled={phase.kind === 'checking' || !text}
        onClick={onClick}
        title={`Check with ${KIND_LABEL[kind]}`}
      >
        {phase.kind === 'checking' ? (
          <Loader2 className="size-4 animate-spin" />
        ) : phase.kind === 'valid' ? (
          <CheckCircle2 className="size-4 text-emerald-500" />
        ) : phase.kind === 'invalid' || phase.kind === 'error' ? (
          <XCircle className="size-4 text-destructive" />
        ) : (
          <ShieldCheck className="size-4" />
        )}
        {phase.kind === 'valid'
          ? 'Valid'
          : phase.kind === 'invalid'
            ? `${phase.result.messages.length || 'Some'} issue${phase.result.messages.length === 1 ? '' : 's'}`
            : phase.kind === 'error' || phase.kind === 'unavailable'
              ? 'Validator failed'
              : 'Validate'}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[80vh] w-[calc(100%-2rem)] max-w-lg flex-col">
          <DialogHeader>
            <DialogTitle>
              {phase.kind === 'invalid'
                ? `Problems found · ${phase.result.validator}`
                : phase.kind === 'unavailable'
                  ? 'Validator not installed'
                  : 'Validator error'}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto text-sm">
            {phase.kind === 'invalid' ? (
              <ul className="flex flex-col gap-1 font-mono text-xs">
                {phase.result.messages.map((m, i) => (
                  <li key={i}>
                    {m.line ? <span className="opacity-60">L{m.line}: </span> : null}
                    {m.text}
                  </li>
                ))}
              </ul>
            ) : phase.kind === 'unavailable' ? (
              <p className="text-muted-foreground">
                <span className="font-mono">{phase.validator}</span> is not installed on the backend host, so this
                config can't be checked here.
              </p>
            ) : phase.kind === 'error' ? (
              <p className="text-destructive">{phase.message}</p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
