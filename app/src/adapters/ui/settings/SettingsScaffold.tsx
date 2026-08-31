import { useNavigate, useParams } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { DEFAULT_SECTION, SETTINGS_SECTIONS } from './registry'

/**
 * The Settings page — a plain shell screen (not a T-scaffold): left menu of
 * sections, right pane renders the active one. Route `/settings` and
 * `/settings/:section`. See SETTINGS_MODULE_PLAN.md §5.
 */
export function SettingsScaffold() {
  const { section } = useParams()
  const navigate = useNavigate()
  const activeId = SETTINGS_SECTIONS.some((s) => s.id === section) ? section! : DEFAULT_SECTION
  const active = SETTINGS_SECTIONS.find((s) => s.id === activeId)!

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl">
      <nav className="w-48 shrink-0 border-r border-border/60 p-3">
        <h1 className="mb-3 px-2 text-[15px] font-semibold tracking-tight">Settings</h1>
        <ul className="flex flex-col gap-0.5">
          {SETTINGS_SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => navigate(`/settings/${s.id}`)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                  s.id === activeId
                    ? 'bg-primary/15 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
                )}
              >
                <s.icon className="size-4" />
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl">{active.element}</div>
      </div>
    </div>
  )
}

/** A titled block used by every settings section. */
export function SettingsGroup({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-6">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="mb-2 text-xs text-muted-foreground">{description}</p>}
      <div className={cn('mt-2 flex flex-col gap-3')}>{children}</div>
    </section>
  )
}

/** One label + control row. */
export function SettingsRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
