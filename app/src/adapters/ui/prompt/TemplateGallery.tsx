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

interface TemplateGalleryProps {
  templates: SeedTemplate[]
  onUse: (template: SeedTemplate) => void
  onRemove?: (templateId: string) => void
}

export function TemplateGallery({ templates, onUse, onRemove }: TemplateGalleryProps) {
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
    <div className="flex min-h-0 flex-col gap-3">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search templates"
        className="h-8"
      />
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((tg) => (
            <button
              key={tg}
              type="button"
              onClick={() => setTag((t) => (t === tg ? null : tg))}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px]',
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

      <div className="grid min-h-0 gap-2 overflow-y-auto sm:grid-cols-2">
        {shown.length === 0 ? (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
            No templates match.
          </p>
        ) : (
          shown.map((t) => (
            <div
              key={t.id}
              className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{t.name}</p>
                {t.userDefined && onRemove && (
                  <button
                    type="button"
                    aria-label={`Remove template ${t.name}`}
                    onClick={() => onRemove(t.id)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">{composition(t)}</p>
              <div className="flex flex-wrap gap-1">
                {t.tags.map((tg) => (
                  <Badge key={tg} variant="secondary" className="text-[10px]">
                    {tg}
                  </Badge>
                ))}
              </div>
              <div className="flex-1" />
              <Button size="xs" className="self-start" onClick={() => onUse(t)}>
                Use template
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
