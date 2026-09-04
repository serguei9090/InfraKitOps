import { isAborted } from '@/core/errors/appError'
import { reportError } from '@/stores/errorStore'

let installed = false

/**
 * Catch-all: any promise rejection a module did NOT handle itself (no
 * `.catch`, no try/await/catch) is classified and shown in the toaster. A
 * module that handles its own errors is unaffected. See
 * ERROR_HANDLING_PLAN.md §5.5.
 */
export function installErrorHandlers() {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('unhandledrejection', (ev) => {
    if (isAborted(ev.reason)) return
    reportError(ev.reason)
  })

  // Synchronous errors outside React's tree (event handlers, timers, module
  // eval). React render errors are caught by <ErrorBoundary>.
  window.addEventListener('error', (ev) => {
    // Resource load failures (<img>/<script>/<link>) surface here with no
    // `error` object — ignore them, they're not app crashes.
    if (!ev.error) return
    if (isAborted(ev.error)) return
    const msg = String(ev.error?.message ?? ev.message ?? '')
    if (msg.includes('ResizeObserver loop')) return // benign browser noise
    reportError(ev.error, 'script')
  })
}
