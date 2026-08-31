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
}
