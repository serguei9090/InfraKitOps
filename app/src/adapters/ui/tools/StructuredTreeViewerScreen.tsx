import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Search, X } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { FileDropField } from '@/adapters/ui/FileDropField'
import { cn } from '@/lib/utils'
import {
  StructuredTreeParser,
  structuredHasChildren,
  isStructuredLeaf,
  structuredDisplayKey,
  structuredDisplayValue,
  structuredScalarType,
  collectAllContainerPaths,
  collectMatchingPaths,
  STRUCTURED_TREE_FORMAT_LABELS,
  type StructuredTreeNode,
  type StructuredTreeResult,
  type ScalarType,
} from '@/core/utility/structuredTree'

const parser = new StructuredTreeParser()

function nodeToPlain(node: StructuredTreeNode): unknown {
  if (node.kind === 'map') {
    const out: Record<string, unknown> = {}
    for (const child of node.children) out[child.key] = nodeToPlain(child)
    return out
  }
  if (node.kind === 'list') {
    return node.children.map(nodeToPlain)
  }
  return node.value
}

function scalarColorClass(type: ScalarType | undefined): string {
  switch (type) {
    case 'number':
      return 'text-primary'
    case 'boolean':
      return 'text-amber-600 dark:text-amber-400'
    case 'nullValue':
      return 'text-muted-foreground italic'
    default:
      return 'text-foreground'
  }
}

function Highlighted({ text, query }: { text: string; query: string }) {
  if (query.length === 0) return <>{text}</>
  const lower = text.toLowerCase()
  const needle = query.toLowerCase()
  const index = lower.indexOf(needle)
  if (index < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-primary/30 text-inherit">{text.slice(index, index + needle.length)}</mark>
      {text.slice(index + needle.length)}
    </>
  )
}

function TreeNodeView({
  node,
  expandedPaths,
  onToggle,
  selectedPath,
  onSelect,
  query,
  visiblePaths,
}: {
  node: StructuredTreeNode
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  selectedPath: string | null
  onSelect: (path: string) => void
  query: string
  visiblePaths: Set<string> | null
}) {
  const hasChildren = structuredHasChildren(node)
  const isLeaf = isStructuredLeaf(node)
  const isOpen = expandedPaths.has(node.path)
  const isSelected = node.path === selectedPath
  const scalarType = structuredScalarType(node)

  const visibleChildren = node.children.filter((c) => visiblePaths === null || visiblePaths.has(c.path))

  const contentRow = (
    <div
      className={cn(
        'flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-sm hover:bg-muted/60',
        isSelected && 'bg-primary/10',
      )}
      onClick={() => onSelect(node.path)}
    >
      <span className="shrink-0 font-mono text-xs font-semibold">
        <Highlighted text={structuredDisplayKey(node)} query={query} />
      </span>
      {isLeaf ? (
        <>
          <span className="shrink-0 text-xs text-muted-foreground">:</span>
          <span className={cn('truncate font-mono text-xs', scalarColorClass(scalarType))}>
            <Highlighted text={structuredDisplayValue(node)} query={query} />
          </span>
        </>
      ) : (
        <span className="truncate text-xs text-muted-foreground">{structuredDisplayValue(node)}</span>
      )}
    </div>
  )

  if (!hasChildren) {
    return (
      <div className="flex items-center gap-1.5" style={{ paddingLeft: node.depth * 16 }}>
        <span className="size-4 shrink-0" />
        {contentRow}
      </div>
    )
  }

  return (
    <Collapsible open={isOpen} onOpenChange={() => onToggle(node.path)}>
      <div className="flex items-center gap-1.5" style={{ paddingLeft: node.depth * 16 }}>
        <CollapsibleTrigger className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
          {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </CollapsibleTrigger>
        {contentRow}
      </div>
      <CollapsibleContent>
        {visibleChildren.map((child) => (
          <TreeNodeView
            key={child.path}
            node={child}
            expandedPaths={expandedPaths}
            onToggle={onToggle}
            selectedPath={selectedPath}
            onSelect={onSelect}
            query={query}
            visiblePaths={visiblePaths}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function StructuredTreeViewerScreen() {
  const [source, setSource] = useState('')
  const [filter, setFilter] = useState('')
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  const result = useMemo<{ value: StructuredTreeResult | null; error: string | null }>(() => {
    if (source.trim().length === 0) return { value: null, error: null }
    try {
      return { value: parser.execute({ source }), error: null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [source])

  // Mirrors the Dart reference: every successful reparse starts expansion
  // fresh (root only) rather than trying to preserve state across an edit
  // that may have changed the document's shape entirely.
  useEffect(() => {
    setSelectedPath(null)
    setExpandedPaths(result.value ? new Set([result.value.root.path]) : new Set())
  }, [result.value])

  const trimmedFilter = filter.trim()
  const matchingPaths = useMemo(() => {
    if (!result.value || trimmedFilter.length === 0) return null
    return collectMatchingPaths(result.value.root, trimmedFilter)
  }, [result.value, trimmedFilter])

  const effectiveExpandedPaths = useMemo(() => {
    if (!result.value) return expandedPaths
    if (trimmedFilter.length === 0) return expandedPaths
    // While filtering, force every ancestor open so matches stay reachable
    // regardless of manual collapse state; manual state itself is untouched.
    return collectAllContainerPaths(result.value.root)
  }, [result.value, trimmedFilter, expandedPaths])

  function toggle(path: string) {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function expandAll() {
    if (!result.value) return
    setExpandedPaths(collectAllContainerPaths(result.value.root))
  }

  function collapseAll() {
    if (!result.value) return
    setExpandedPaths(new Set([result.value.root.path]))
  }

  async function copyPath(path: string) {
    await navigator.clipboard.writeText(path)
  }

  const copyText = result.value ? JSON.stringify(nodeToPlain(result.value.root), null, 2) : undefined
  const noMatches = matchingPaths !== null && matchingPaths.size === 0

  return (
    <ToolDetailScaffold
      title="JSON/YAML Structured Tree Viewer"
      copyText={copyText}
      inputPanel={
        <div className="flex max-w-xl flex-col gap-3">
          <Label htmlFor="tree-document">Document</Label>
          <FileDropField
            id="tree-document"
            accept=".json,.yaml,.yml,.toml,.xml"
            rows={20}
            className="font-mono text-sm"
            placeholder={'{\n  "key": "value"\n}\n\n— or —\n\nkey: value'}
            value={source}
            onChange={setSource}
          />
          {result.value ? (
            <p className="text-xs text-muted-foreground">
              {STRUCTURED_TREE_FORMAT_LABELS[result.value.detectedFormat]} · {result.value.nodeCount} nodes ·{' '}
              {result.value.leafCount} leaves · depth {result.value.maxDepth}
            </p>
          ) : null}
        </div>
      }
      outputPanel={
        result.error ? (
          <p className="text-sm text-destructive">{result.error}</p>
        ) : !result.value ? (
          <p className="text-sm text-muted-foreground">Paste JSON or YAML to explore it as a tree here.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-7"
                  placeholder="Filter keys or values…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                {filter.length > 0 ? (
                  <button
                    type="button"
                    className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setFilter('')}
                    aria-label="Clear filter"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : null}
              </div>
              <Button type="button" size="sm" variant="outline" onClick={expandAll}>
                Expand all
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={collapseAll}>
                Collapse all
              </Button>
            </div>

            {noMatches ? (
              <p className="py-3 text-sm text-muted-foreground">No keys or values match "{trimmedFilter}".</p>
            ) : (
              <div className="max-h-[560px] overflow-auto rounded-lg border border-border p-1">
                <TreeNodeView
                  node={result.value.root}
                  expandedPaths={effectiveExpandedPaths}
                  onToggle={toggle}
                  selectedPath={selectedPath}
                  onSelect={setSelectedPath}
                  query={trimmedFilter}
                  visiblePaths={matchingPaths}
                />
              </div>
            )}

            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                {selectedPath ?? 'Select a node to see its path here.'}
              </span>
              {selectedPath ? (
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Copy path"
                  onClick={() => copyPath(selectedPath)}
                >
                  <Copy className="size-3.5" />
                </Button>
              ) : null}
            </div>
          </div>
        )
      }
    />
  )
}
