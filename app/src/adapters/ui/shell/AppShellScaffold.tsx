import { Lock, MoonStar, Search, SunMedium } from 'lucide-react'
import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { RoutePendingBar } from './RouteFallback'
import { Input } from '@/components/ui/input'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSearchQueryStore } from '@/stores/searchQueryStore'
import { useThemeStore } from '@/stores/themeStore'
import { useAuthStore } from '@/stores/authStore'
import { canSeeModule } from '@/core/auth/authModel'
import { ErrorToaster } from '@/adapters/ui/errors/ErrorToaster'
import { ErrorHistoryButton } from '@/adapters/ui/errors/ErrorHistoryDrawer'
import { RunsButton } from '@/adapters/ui/runs/RunsDrawer'
import { ErrorBoundary } from '@/adapters/ui/errors/ErrorBoundary'
import { UserMenu } from '@/adapters/ui/auth/UserMenu'
import { AppSidebar } from './AppSidebar'
import { DemoBanner } from './DemoBanner'
import { moduleContainingRoute } from './moduleTaxonomy'

/**
 * The persistent chrome around every route: brand mark + search + theme
 * toggle in the top bar, the icon rail + swap pane in AppSidebar (never
 * unmounts), and the routed screen filling the rest. New tools/modules never
 * touch this file.
 *
 * Note: the Flutter reference swaps the inline search box for a modal below
 * a 720px width breakpoint. Deferred here — desktop-first port, see
 * AppSidebar's note.
 */
export function AppShellScaffold() {
  const mode = useThemeStore((s) => s.mode)
  const toggle = useThemeStore((s) => s.toggle)
  const { query, setQuery } = useSearchQueryStore()
  const me = useAuthStore((s) => s.me)
  const location = useLocation()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', mode === 'dark')
  }, [mode])

  // multi-user: block a deep-link into a module this account can't see
  const currentModule = moduleContainingRoute(location.pathname)
  const moduleBlocked = !!(me && currentModule && !canSeeModule(me, currentModule.id))

  return (
    <TooltipProvider delay={300}>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4">
          <div className="flex size-8 items-center justify-center rounded-[9px] bg-gradient-to-br from-primary to-primary/60">
            <span className="text-sm font-bold text-primary-foreground">IK</span>
          </div>
          <span className="truncate text-[15px] font-semibold tracking-tight">InfraKit Studio</span>
          <div className="flex-1" />
          <div className="relative hidden w-96 md:block">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tools, formulas, cheatsheets..."
              className="h-9 pl-9"
            />
          </div>
          <RunsButton />
          <ErrorHistoryButton />
          <button
            type="button"
            aria-label="Toggle theme"
            onClick={toggle}
            className="flex size-9 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
          >
            {mode === 'dark' ? <MoonStar className="size-[18px]" /> : <SunMedium className="size-[18px]" />}
          </button>
          <UserMenu />
        </header>
        <DemoBanner />
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <div className="w-px shrink-0 bg-border/60" />
          <main className="relative flex-1 overflow-auto">
            <RoutePendingBar />
            {moduleBlocked ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
                <Lock className="size-6 text-muted-foreground" />
                <p className="text-sm font-medium">This module isn&rsquo;t enabled for your account</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Ask an administrator to grant you access to{' '}
                  <span className="font-medium">{currentModule?.title}</span>.
                </p>
              </div>
            ) : (
              <ErrorBoundary resetKeys={[location.pathname]}>
                <Outlet />
              </ErrorBoundary>
            )}
          </main>
        </div>
      </div>
      <ErrorToaster />
    </TooltipProvider>
  )
}
