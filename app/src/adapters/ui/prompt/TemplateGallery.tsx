import { Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { templateTagList, type SeedTemplate } from '@/core/prompt/templates/index'
import { cn } from '@/lib/utils'

/** "system · user" plus a "few-shot" note when the template has assistant turns. */
function composition(t: SeedTemplate): string {
  const roles = t.messages.map((m) => m.role)
  const uniq = [...new Set(roles)]
  const fewShot = roles.filter((r) => r === 'assistant').length > 0
  return uniq.join(' · ') + (fewShot ? ' · few-shot' : '')
}

function systemPreview(t: SeedTemplate): string {
  const sys = t.messages.find((m) => m.role === 'system')?.content ?? t.messages[0]?.content ?? ''
  return sys.replace(/\s+/g, ' ').trim().slice(0, 180)
}

interface TemplateGalleryProps {
  templates: SeedTemplate[]
  onUse: (template: SeedTemplate) => void
  onRemove?: (templateId: string) => void
  className?: string
}

export function TemplateGallery({ templates, onUse, onRemove, className }: TemplateGalleryProps) {
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)

  const tags = useMemo(() => templateTagList(templates), [templates])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return templates.filter((t) => {
      if (tag && !t.tags.includes(tag)) return false
      if (!q) return true
      return (
        t.name.toLowerCase().includes(q) ||
        t.tags.some((x) => x.includes(q)) ||
        t.messages.some((m) => m.content.toLowerCase().includes(q))
      )
    })
  }, [templates, query, tag])

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="shrink-0 space-y-2 pb-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search templates"
          className="h-9"
        />
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tg) => (
              <button
                key={tg}
                type="button"
                onClick={() => setTag((t) => (t === tg ? null : tg))}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                  tag === tg
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {tg}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
        {shown.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No templates match.</p>
        ) : (
          <div className="grid gap-2.5 pb-1 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((t) => (
              <div
                key={t.id}
                className="group flex min-h-[10.5rem] flex-col gap-2 rounded-xl border border-border/60 bg-card p-3.5 transition-colors hover:border-primary/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold leading-snug">{t.name}</p>
                  {t.userDefined && onRemove && (
                    <button
                      type="button"
                      aria-label={`Remove template ${t.name}`}
                      onClick={() => onRemove(t.id)}
                      className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>

                <p className="text-[11px] font-medium text-muted-foreground">{composition(t)}</p>

                <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground/85">
                  {systemPreview(t)}…
                </p>

                <div className="flex-1" />

                <div className="flex flex-wrap gap-1">
                  {t.tags.map((tg) => (
                    <Badge key={tg} variant="secondary" className="text-[10px]">
                      {tg}
                    </Badge>
                  ))}
                </div>

                <Button size="sm" className="mt-1 w-full" onClick={() => onUse(t)}>
                  Use template
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
