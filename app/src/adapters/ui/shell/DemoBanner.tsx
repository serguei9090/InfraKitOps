import { useState } from 'react'
import { X } from 'lucide-react'
import { DEMO_MODE, RELEASES_URL, REPO_URL } from '@/lib/demoMode'

const KEY = 'infrakit:demo-banner-dismissed'

/**
 * Thin strip shown only on the public GitHub Pages demo (`VITE_DEMO_MODE=1`).
 * Says what works here and where the full app is. Dismissible per browser.
 */
export function DemoBanner() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1'
    } catch {
      return false
    }
  })
  if (!DEMO_MODE || hidden) return null

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-primary/10 px-4 py-1.5 text-xs">
      <span className="text-foreground">
        Live demo — the client-side tools work here. Network, Runbooks, Ansible and AI need the{' '}
        <a href={RELEASES_URL} target="_blank" rel="noreferrer" className="font-medium underline">
          downloadable app
        </a>{' '}
        or the{' '}
        <a href={`${REPO_URL}#try-it`} target="_blank" rel="noreferrer" className="font-medium underline">
          container
        </a>
        .
      </span>
      <div className="flex-1" />
      <button
        type="button"
        aria-label="Dismiss"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => {
          setHidden(true)
          try {
            localStorage.setItem(KEY, '1')
          } catch {
            /* private mode */
          }
        }}
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
