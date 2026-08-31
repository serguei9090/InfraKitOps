import { MoonStar, Search, SunMedium } from 'lucide-react'
import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { Input } from '@/components/ui/input'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useSearchQueryStore } from '@/stores/searchQueryStore'
import { useThemeStore } from '@/stores/themeStore'
import { ErrorToaster } from '@/adapters/ui/errors/ErrorToaster'
import { AppSidebar } from './AppSidebar'

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

  useEffect(() => {
    document.documentElement.classList.toggle('dark', mode === 'dark')
  }, [mode])

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
          <button
            type="button"
            aria-label="Toggle theme"
            onClick={toggle}
            className="flex size-9 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
          >
            {mode === 'dark' ? <MoonStar className="size-[18px]" /> : <SunMedium className="size-[18px]" />}
          </button>
        </header>
        <div className="flex flex-1 overflow-hidden">
          <AppSidebar />
          <div className="w-px shrink-0 bg-border/60" />
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
      <ErrorToaster />
    </TooltipProvider>
  )
}
