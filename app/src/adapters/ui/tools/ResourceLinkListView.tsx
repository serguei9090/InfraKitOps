import { useMemo, useState } from 'react'
import { ArrowUpRight, Check, Copy, Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { RESOURCE_TYPES, type ReferenceLink, type ResourceType } from '@/core/cheatsheets/cheatsheetContent'

const TYPE_LABELS: Record<ResourceType, string> = {
  documentation: 'Documentation',
  curatedList: 'Curated Resource Lists',
  exercise: 'Exercises & Practice',
  roadmap: 'Roadmaps',
}

interface ResourceLinkListViewProps {
  /** Explains what this category is, shown above the search box. */
  description: string
  /** Already filtered to the relevant ResourceType(s) by the caller. */
  links: ReferenceLink[]
  /**
   * When true, results are grouped under a header per ResourceType present in
   * `links` — useful when a screen covers more than one type (e.g. Study &
   * Practice covers both exercise and roadmap). Screens covering exactly one
   * type should leave this false to avoid a redundant header.
   */
  groupByType?: boolean
}

/**
 * Shared search + tag-filter + card list for a subset of
 * EXTERNAL_RESOURCE_LINKS. Used by DocumentationScreen, ReferenceListsScreen,
 * and StudyPracticeScreen so the three "kind of external resource" screens
 * share one implementation instead of three copies. Ported from
 * lib/adapters/ui/tools/resource_link_list_view.dart.
 */
export function ResourceLinkListView({ description, links, groupByType = false }: ResourceLinkListViewProps) {
  const [query, setQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())

  const allTags = useMemo(() => {
    const tags = new Set<string>()
    for (const link of links) {
      for (const tag of link.tags) tags.add(tag)
    }
    return Array.from(tags).sort()
  }, [links])

  function toggleTag(tag: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) {
        next.delete(tag)
      } else {
        next.add(tag)
      }
      return next
    })
  }

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    return links.filter((link) => {
      const matchesQuery =
        trimmed.length === 0 ||
        link.name.toLowerCase().includes(trimmed) ||
        link.description.toLowerCase().includes(trimmed) ||
        link.tags.some((tag) => tag.toLowerCase().includes(trimmed))
      const matchesTags = selectedTags.size === 0 || Array.from(selectedTags).every((tag) => link.tags.includes(tag))
      return matchesQuery && matchesTags
    })
  }, [links, query, selectedTags])

  const hasFilter = query.trim().length > 0 || selectedTags.size > 0

  function clearFilters() {
    setQuery('')
    setSelectedTags(new Set())
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{description}</p>

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, description, or tag…"
          className="h-9 pl-9"
        />
        {hasFilter ? (
          <button
            type="button"
            onClick={clearFilters}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Clear search and filters"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {allTags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((tag) => (
            <Button
              key={tag}
              type="button"
              size="sm"
              variant={selectedTags.has(tag) ? 'default' : 'outline'}
              className="h-6 rounded-full px-2.5 text-xs"
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </Button>
          ))}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">No resources match your search or selected tags.</p>
      ) : !groupByType ? (
        <CardGrid links={filtered} />
      ) : (
        <div className="flex flex-col gap-6">
          {RESOURCE_TYPES.map((type) => {
            const linksOfType = filtered.filter((link) => link.type === type)
            if (linksOfType.length === 0) return null
            return (
              <div key={type} className="flex flex-col gap-2.5">
                <p className="text-sm font-semibold">
                  {TYPE_LABELS[type]}
                  <span className="ml-1.5 font-normal text-muted-foreground">{linksOfType.length}</span>
                </p>
                <CardGrid links={linksOfType} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CardGrid({ links }: { links: ReferenceLink[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {links.map((link) => (
        <ResourceLinkCard key={link.url} link={link} />
      ))}
    </div>
  )
}

/** github.com/owner/repo → "owner/repo"; anything else → its bare hostname. */
function sourceLabel(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if ((host === 'github.com' || host === 'gitlab.com') && u.pathname.length > 1) {
      const parts = u.pathname.split('/').filter(Boolean)
      if (parts.length >= 2) return `${parts[0]}/${parts[1]}`
      if (parts.length === 1) return `${host}/${parts[0]}`
    }
    return host
  } catch {
    return url
  }
}

/**
 * One resource as a uniform card: name, description (clamped so every card in
 * a row is the same height), tags, and a footer with the source repo/host and
 * a copy-URL button. The whole card is a link — an overlay `<a>` opens the URL
 * in a new tab on web; on the Tauri desktop build a `target="_blank"` link
 * opens in the system browser via the shell plugin's default handler.
 */
function ResourceLinkCard({ link }: { link: ReferenceLink }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    await navigator.clipboard.writeText(link.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="group relative flex h-full flex-col gap-2 rounded-lg border border-border/60 bg-background p-4 transition-colors hover:border-primary/40 hover:bg-accent/30">
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={link.name}
        className="absolute inset-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      />

      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm font-medium leading-snug">{link.name}</p>
        <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary" />
      </div>

      <p className="line-clamp-3 flex-1 text-sm text-muted-foreground">{link.description}</p>

      {link.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {link.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-2">
        <span className="truncate font-mono text-xs text-muted-foreground" title={link.url}>
          {sourceLabel(link.url)}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          title="Copy URL"
          aria-label="Copy URL"
          className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  )
}
