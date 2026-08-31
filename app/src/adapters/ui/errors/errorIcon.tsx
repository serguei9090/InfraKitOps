import { AlertTriangle, Ban, Clock, KeyRound, Lock, Plug, ShieldAlert, XCircle } from 'lucide-react'
import type { ErrorCode } from '@/core/errors/appError'

/** One icon per error code — shared by the toaster and the inline alert. */
export function ErrorIcon({ code, className }: { code: ErrorCode; className?: string }) {
  switch (code) {
    case 'auth_failed':
      return <KeyRound className={className} />
    case 'unreachable':
    case 'backend_down':
      return <Plug className={className} />
    case 'timeout':
    case 'rate_limited':
      return <Clock className={className} />
    case 'locked':
      return <Lock className={className} />
    case 'permission':
      return <ShieldAlert className={className} />
    case 'validation':
      return <Ban className={className} />
    case 'not_found':
    case 'conflict':
      return <XCircle className={className} />
    default:
      return <AlertTriangle className={className} />
  }
}
