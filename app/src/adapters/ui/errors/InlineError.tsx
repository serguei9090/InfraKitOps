import { Loader2, RefreshCw } from 'lucide-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { AppError } from '@/core/errors/appError'
import { ErrorIcon } from './errorIcon'

interface Props {
  error: AppError | null | undefined
  onRetry?: () => void
  retrying?: boolean
  className?: string
}

/**
 * In-place error for a module pane — a classified `AppError` with a title,
 * hint, the raw detail, and an optional Retry. See ERROR_HANDLING_PLAN.md §5.3.
 */
export function InlineError({ error, onRetry, retrying, className }: Props) {
  if (!error) return null

  return (
    <Alert variant="destructive" className={className}>
      <ErrorIcon code={error.code} />
      <AlertTitle>{error.title}</AlertTitle>
      <AlertDescription>
        {error.hint && <p>{error.hint}</p>}
        {error.detail && error.detail !== error.title && (
          <p className="mt-0.5 font-mono text-[11px] opacity-80">{error.detail}</p>
        )}
      </AlertDescription>
      {onRetry && (
        <AlertAction>
          <Button size="xs" variant="outline" onClick={onRetry} disabled={retrying}>
            {retrying ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Retry
          </Button>
        </AlertAction>
      )}
    </Alert>
  )
}
