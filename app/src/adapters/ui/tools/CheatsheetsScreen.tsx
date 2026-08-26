import { useMemo, useState } from 'react'
import { Copy, FileText, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { cn } from '@/lib/utils'
import { CHEATSHEET_PAGES, type CheatsheetEntry, type CheatsheetSection } from '@/core/cheatsheets/cheatsheetContent'

/**
 * Fast command/syntax lookup over the static cheatsheet content — Git,
 * Regex, Sysctl, Crontab, Chmod, and friends. Deliberately narrow in scope:
 * official docs, curated resource lists, and study material live in their
 * own screens (DocumentationScreen / ReferenceListsScreen /
 * StudyPracticeScreen) rather than as tabs here. See design.md's
 * "Knowledge Hub: four tools, not one with tabs" section.
 *
 * Reuses ToolDetailScaffold, but reinterprets its two panels: the page
 * picker + filter box live in the input panel, the selected page's content
 * lives in the output panel — there's no single "copy the output" action
 * here (each entry has its own copy button), so the scaffold's toolbar copy
 * button is left off.
 */
export function CheatsheetsScreen() {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [query, setQuery] = useState('')

  const page = CHEATSHEET_PAGES[selectedIndex]

  const sections = useMemo(() => filterSections(page, query), [page, query])

  function selectPage(index: number) {
    setSelectedIndex(index)
    setQuery('')
  }

  return (
    <ToolDetailScaffold
      title="Cheatsheets"
      inputPanel={
        <div className="flex flex-col gap-4">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by command or description…"
              className="h-9 pl-9"
            />
          </div>
          <nav className="flex flex-col gap-0.5">
            {CHEATSHEET_PAGES.map((p, index) => (
              <button
                key={p.id}
                type="button"
                onClick={() => selectPage(index)}
                className={cn(
                  'flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-sm',
                  index === selectedIndex
                    ? 'bg-primary/15 font-medium text-primary'
                    : 'text-foreground hover:bg-accent/40',
                )}
              >
                <FileText className="size-4 shrink-0" />
                <span className="flex-1 truncate">{p.title}</span>
              </button>
            ))}
          </nav>
        </div>
      }
      outputPanel={
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">{page.title}</h2>
          <p className="mb-3 text-sm text-muted-foreground">{page.description}</p>
          {sections.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">No entries match "{query}".</p>
          ) : (
            sections.map((section) => (
              <div key={section.title} className="mb-5">
                <p className="mb-2 text-sm font-semibold">{section.title}</p>
                <div className="flex flex-col gap-2.5">
                  {section.entries.map((entry) => (
                    <EntryCard key={entry.command} entry={entry} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      }
    />
  )
}

function EntryCard({ entry }: { entry: CheatsheetEntry }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(entry.command)
    setCopied(true)
    setTimeout(() => setCopied(false), 1000)
  }

  return (
    <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-background p-3.5">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-sm text-primary">{entry.command}</p>
        <p className="mt-1.5 text-sm">{entry.description}</p>
        <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre rounded-md bg-muted/40 px-2.5 py-2 font-mono text-xs">
          {entry.example}
        </pre>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={handleCopy} className="shrink-0 gap-1.5" title={`Copy "${entry.command}"`}>
        <Copy className="size-3.5" />
        {copied ? 'Copied' : ''}
      </Button>
    </div>
  )
}

function filterSections(page: (typeof CHEATSHEET_PAGES)[number], query: string): CheatsheetSection[] {
  const trimmed = query.trim().toLowerCase()
  if (trimmed.length === 0) return page.sections

  const filtered: CheatsheetSection[] = []
  for (const section of page.sections) {
    const matches = section.entries.filter(
      (entry) => entry.command.toLowerCase().includes(trimmed) || entry.description.toLowerCase().includes(trimmed),
    )
    if (matches.length > 0) {
      filtered.push({ title: section.title, entries: matches })
    }
  }
  return filtered
}
