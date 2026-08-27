import { useState } from 'react'
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useOptionalBackend } from '@/adapters/backend/useOptionalBackend'
import {
  validateConfig,
  type ConfigCheckKind,
  type ConfigCheckResult,
} from '@/adapters/backend/configCheckClient'

const KIND_LABEL: Record<ConfigCheckKind, string> = {
  nginx: 'nginx -t',
  sshd: 'sshd -t',
  ssh: 'ssh -G',
  nftables: 'nft -c',
  fail2ban: 'fail2ban-client -t',
  sysctl: 'sysctl --dry-run',
}

/**
 * Optional "Validate" affordance for the config builders. Renders nothing when
 * the backend service is not connected; otherwise a button that runs the
 * matching OS validator in check-only mode (no writes, no root) and shows the
 * result. See TOOL_STRATEGY_REVIEW.md bucket 2.
 */
export function ConfigValidateButton({
  kind,
  text,
  disabled,
}: {
  kind: ConfigCheckKind
  text: string | null | undefined
  disabled?: boolean
}) {
  const power = useOptionalBackend('config-validate')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ConfigCheckResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!power.available) return null

  async function run() {
    if (!text) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(await validateConfig(kind, text))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-fit gap-1.5"
        disabled={busy || disabled || !text}
        onClick={() => void run()}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
        Validate with {KIND_LABEL[kind]}
      </Button>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {result && !result.available ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{result.validator}</span> is not installed on the backend host — cannot
          validate here.
        </p>
      ) : null}

      {result && result.available ? (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            result.ok
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-destructive/40 bg-destructive/10 text-destructive'
          }`}
        >
          <p className="mb-1 flex items-center gap-1.5 font-medium">
            {result.ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
            {result.ok ? 'Valid' : 'Problems found'}
            <span className="font-mono font-normal opacity-70">· {result.validator}</span>
          </p>
          <ul className="flex flex-col gap-0.5">
            {result.messages.map((m, i) => (
              <li key={i} className="font-mono">
                {m.line ? <span className="opacity-60">L{m.line}: </span> : null}
                {m.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
