import { useMemo, useState } from 'react'
import { Copy, Search, X } from 'lucide-react'
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
        <div className="flex flex-col gap-2.5">
          {filtered.map((link) => (
            <ResourceLinkCard key={link.url} link={link} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {RESOURCE_TYPES.map((type) => {
            const linksOfType = filtered.filter((link) => link.type === type)
            if (linksOfType.length === 0) return null
            return (
              <div key={type} className="flex flex-col gap-2.5">
                <p className="text-sm font-semibold">{TYPE_LABELS[type]}</p>
                {linksOfType.map((link) => (
                  <ResourceLinkCard key={link.url} link={link} />
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * One resource row: name, description, tags, and the URL as selectable /
 * copyable text (this app has no `url_launcher`-equivalent dependency, so
 * there is no built-in way to open the link — users copy the URL manually).
 */
function ResourceLinkCard({ link }: { link: ReferenceLink }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(link.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1000)
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-background p-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{link.name}</p>
        <p className="mt-1 text-sm text-muted-foreground">{link.description}</p>
        <p className="mt-1.5 truncate font-mono text-xs text-primary">{link.url}</p>
        {link.tags.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {link.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={handleCopy} className="shrink-0 gap-1.5" title="Copy URL to clipboard">
        <Copy className="size-3.5" />
        {copied ? 'Copied' : ''}
      </Button>
    </div>
  )
}
