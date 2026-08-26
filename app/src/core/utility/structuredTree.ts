import { load as loadYaml, YAMLException } from 'js-yaml'
import type { IToolUseCase } from '../ports/IToolUseCase'

/** Which surface syntax the text was parsed as. */
export type StructuredTreeFormat = 'json' | 'yaml' | 'auto'

export const STRUCTURED_TREE_FORMAT_LABELS: Record<StructuredTreeFormat, string> = {
  json: 'JSON',
  yaml: 'YAML',
  /**
   * Try JSON first, fall back to YAML. (Every valid JSON document is also
   * valid YAML 1.2, but the JSON parser gives far better error messages, so
   * it goes first.)
   */
  auto: 'Auto-detect',
}

/** The shape of a node's value. */
export type StructuredNodeKind = 'map' | 'list' | 'scalar'

/** The concrete type of a scalar leaf, for type-badge display. */
export type ScalarType = 'string' | 'number' | 'boolean' | 'nullValue'

/**
 * One node of the normalized document tree.
 *
 * Nodes are immutable and carry their own fully-qualified `path`, so the UI
 * can copy a JSONPath for any row without walking back up the tree.
 */
export interface StructuredTreeNode {
  /**
   * The map key this node was stored under, or the stringified index for a
   * list item. Empty for the root.
   */
  key: string
  kind: StructuredNodeKind
  /** The scalar value; always undefined for `map` and `list` kinds. */
  value: unknown
  /** JSONPath from the document root, e.g. `$.spec.containers[0].image`. */
  path: string
  /** 0 for the root. */
  depth: number
  /**
   * Empty for scalars. Map children keep their document order; list
   * children keep their index order.
   */
  children: StructuredTreeNode[]
  /**
   * True when this node is an element of a list rather than a map entry —
   * the UI labels those `[0]` instead of `key:`.
   */
  isListItem: boolean
}

export function isStructuredLeaf(node: StructuredTreeNode): boolean {
  return node.kind === 'scalar'
}

export function structuredHasChildren(node: StructuredTreeNode): boolean {
  return node.children.length > 0
}

/** The type badge for a scalar leaf. Undefined for containers. */
export function structuredScalarType(node: StructuredTreeNode): ScalarType | undefined {
  if (node.kind !== 'scalar') return undefined
  if (node.value === null || node.value === undefined) return 'nullValue'
  if (typeof node.value === 'boolean') return 'boolean'
  if (typeof node.value === 'number') return 'number'
  return 'string'
}

/**
 * Compact one-line preview: the scalar itself for leaves, or `{3 keys}` /
 * `[5 items]` for containers.
 */
export function structuredDisplayValue(node: StructuredTreeNode): string {
  switch (node.kind) {
    case 'map':
      return node.children.length === 1 ? '{1 key}' : `{${node.children.length} keys}`
    case 'list':
      return node.children.length === 1 ? '[1 item]' : `[${node.children.length} items]`
    case 'scalar':
      if (node.value === null || node.value === undefined) return 'null'
      if (typeof node.value === 'string') return node.value
      return String(node.value)
  }
}

/** The row label: `key` for map entries, `[i]` for list items, `$` for the root. */
export function structuredDisplayKey(node: StructuredTreeNode): string {
  if (node.depth === 0) return '$'
  return node.isListItem ? `[${node.key}]` : node.key
}

/** This node plus every descendant, inclusive. */
export function structuredSubtreeNodeCount(node: StructuredTreeNode): number {
  let total = 1
  for (const child of node.children) {
    total += structuredSubtreeNodeCount(child)
  }
  return total
}

/** Deepest level below this node (0 for a leaf). */
export function structuredSubtreeDepth(node: StructuredTreeNode): number {
  let deepest = 0
  for (const child of node.children) {
    const d = structuredSubtreeDepth(child) + 1
    if (d > deepest) deepest = d
  }
  return deepest
}

/** Pre-order walk over this node and all descendants. */
export function* structuredWalk(node: StructuredTreeNode): Generator<StructuredTreeNode> {
  yield node
  for (const child of node.children) {
    yield* structuredWalk(child)
  }
}

/**
 * Deep structural equality — used by tests asserting that equivalent JSON
 * and YAML documents normalize to the same tree.
 */
export function structuredNodesEqual(a: StructuredTreeNode, b: StructuredTreeNode): boolean {
  if (a === b) return true
  if (a.key !== b.key || a.kind !== b.kind || a.path !== b.path) return false
  if (a.isListItem !== b.isListItem || a.depth !== b.depth) return false
  if (a.value !== b.value) return false
  if (a.children.length !== b.children.length) return false
  for (let i = 0; i < a.children.length; i++) {
    if (!structuredNodesEqual(a.children[i], b.children[i])) return false
  }
  return true
}

export interface StructuredTreeInput {
  source: string
  format?: StructuredTreeFormat
}

export interface StructuredTreeResult {
  root: StructuredTreeNode
  /** The format actually used — resolves `'auto'`. */
  detectedFormat: StructuredTreeFormat
  /** Every node in the tree including the root. */
  nodeCount: number
  /** Depth of the deepest node (root is 0). */
  maxDepth: number
  /** Scalar leaves only. */
  leafCount: number
}

/**
 * Turns JSON or YAML text into a generic, immutable tree of
 * `StructuredTreeNode`s with precomputed JSONPaths and node counts.
 *
 * Uses `JSON.parse` for JSON and `js-yaml`'s `load` for YAML, and normalizes
 * both into plain JS object/array/scalar values first, so two documents
 * that mean the same thing produce identical trees regardless of which
 * syntax they arrived in.
 *
 * Browser-safe, no Node APIs. Invalid input throws an `Error` with a message
 * safe to show inline; callers catch it rather than letting it reach the UI.
 */
export class StructuredTreeParser implements IToolUseCase<StructuredTreeInput, StructuredTreeResult> {
  execute(input: StructuredTreeInput): StructuredTreeResult {
    if (input.source.trim().length === 0) {
      throw new Error('Enter or load a JSON or YAML document.')
    }

    const [tree, format] = decode(input.source, input.format ?? 'auto')
    const root = build('', tree, '$', 0, false)

    let leaves = 0
    let nodes = 0
    let maxDepth = 0
    for (const node of structuredWalk(root)) {
      nodes++
      if (isStructuredLeaf(node)) leaves++
      if (node.depth > maxDepth) maxDepth = node.depth
    }

    return { root, detectedFormat: format, nodeCount: nodes, maxDepth, leafCount: leaves }
  }
}

function decode(source: string, format: StructuredTreeFormat): [unknown, StructuredTreeFormat] {
  switch (format) {
    case 'json':
      return [normalize(decodeJson(source)), 'json']
    case 'yaml':
      return [normalize(decodeYamlSource(source)), 'yaml']
    case 'auto': {
      const trimmed = source.replace(/^\s+/, '')
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          return [normalize(decodeJson(source)), 'json']
        } catch {
          // A JSON-looking document that does not parse as JSON may still be
          // flow-style YAML; fall through.
        }
      }
      return [normalize(decodeYamlSource(source)), 'yaml']
    }
  }
}

function decodeJson(source: string): unknown {
  try {
    return JSON.parse(source)
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`)
  }
}

function decodeYamlSource(source: string): unknown {
  try {
    return loadYaml(source)
  } catch (e) {
    if (e instanceof YAMLException) {
      throw new Error(`Invalid YAML: ${e.message}`)
    }
    throw new Error(`Invalid YAML: ${(e as Error).message ?? String(e)}`)
  }
}

/**
 * Collapses any `Map`/plain-object and array into plain
 * `Record<string, unknown>` / `unknown[]`, stringifying keys and any scalar
 * type that is neither string, number, boolean nor null.
 */
function normalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(normalize)
  }
  if (value instanceof Map) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of value) {
      out[k === null || k === undefined ? 'null' : String(k)] = normalize(v)
    }
    return out
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = normalize((value as Record<string, unknown>)[key])
    }
    return out
  }
  // Date and friends from YAML have no JSON equivalent.
  return String(value)
}

function build(key: string, value: unknown, path: string, depth: number, isListItem: boolean): StructuredTreeNode {
  if (isPlainRecord(value)) {
    const children: StructuredTreeNode[] = []
    for (const [childKey, childValue] of Object.entries(value)) {
      children.push(build(childKey, childValue, joinPath(path, childKey), depth + 1, false))
    }
    return { key, kind: 'map', value: undefined, path, depth, children, isListItem }
  }

  if (Array.isArray(value)) {
    const children: StructuredTreeNode[] = []
    for (let i = 0; i < value.length; i++) {
      children.push(build(`${i}`, value[i], `${path}[${i}]`, depth + 1, true))
    }
    return { key, kind: 'list', value: undefined, path, depth, children, isListItem }
  }

  return { key, kind: 'scalar', value, path, depth, children: [], isListItem }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Appends a map key to a JSONPath, using bracket notation for keys that are
 * not bare identifiers (`$.metadata["app.kubernetes.io/name"]`).
 */
export function joinPath(parentPath: string, key: string): string {
  const isBareIdentifier = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
  if (isBareIdentifier) return `${parentPath}.${key}`
  return `${parentPath}[${JSON.stringify(key)}]`
}

/**
 * A node paired with its current expansion state, ready for lazy rendering.
 *
 * `flattenVisibleNodes` produces one of these per *visible* row, so a
 * virtualized list can render a 10,000-node document without ever building
 * the collapsed parts of the tree.
 */
export interface VisibleTreeRow {
  node: StructuredTreeNode
  /** Whether this node's children are currently shown. Always false for leaves. */
  isExpanded: boolean
}

/**
 * Walks `root` and emits one `VisibleTreeRow` per row that should currently
 * be on screen: a node's children are included only when its path is in
 * `expandedPaths`.
 *
 * When `matchingPaths` is provided, only nodes in that set (which callers
 * build with `collectMatchingPaths`, so ancestors of a hit are retained) are
 * emitted — that is the filter behaviour.
 */
export function flattenVisibleNodes(
  root: StructuredTreeNode,
  options: { expandedPaths: Set<string>; matchingPaths?: Set<string> },
): VisibleTreeRow[] {
  const rows: VisibleTreeRow[] = []

  const visit = (node: StructuredTreeNode) => {
    if (options.matchingPaths !== undefined && !options.matchingPaths.has(node.path)) return
    const expanded = structuredHasChildren(node) && options.expandedPaths.has(node.path)
    rows.push({ node, isExpanded: expanded })
    if (!expanded) return
    for (const child of node.children) {
      visit(child)
    }
  }

  visit(root)
  return rows
}

/** Every path in the tree — what "expand all" needs. */
export function collectAllContainerPaths(root: StructuredTreeNode): Set<string> {
  const out = new Set<string>()
  for (const node of structuredWalk(root)) {
    if (structuredHasChildren(node)) out.add(node.path)
  }
  return out
}

/**
 * Paths of nodes whose key or value contains `query` (case-insensitive),
 * plus every ancestor of a match so the hits stay reachable in the tree.
 *
 * Returns an empty set when nothing matches; callers treat that as "no
 * results" rather than "show everything".
 */
export function collectMatchingPaths(root: StructuredTreeNode, query: string): Set<string> {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return collectAllPaths(root)

  const keep = new Set<string>()

  const visit = (node: StructuredTreeNode, ancestors: StructuredTreeNode[]): boolean => {
    const selfMatches = nodeMatches(node, needle)
    let anyDescendantMatches = false
    const nextAncestors = [...ancestors, node]
    for (const child of node.children) {
      if (visit(child, nextAncestors)) anyDescendantMatches = true
    }
    if (selfMatches || anyDescendantMatches) {
      for (const a of nextAncestors) {
        keep.add(a.path)
      }
      // A matching node keeps its whole subtree visible so the value can be
      // read in context.
      if (selfMatches) {
        for (const d of structuredWalk(node)) {
          keep.add(d.path)
        }
      }
      return true
    }
    return false
  }

  visit(root, [])
  return keep
}

/** True when `node`'s key or scalar value contains the already-lowercased `lowercaseNeedle`. */
export function nodeMatches(node: StructuredTreeNode, lowercaseNeedle: string): boolean {
  if (node.key.toLowerCase().includes(lowercaseNeedle)) return true
  if (isStructuredLeaf(node) && structuredDisplayValue(node).toLowerCase().includes(lowercaseNeedle)) return true
  return false
}

/** Every node path in the tree, containers and leaves alike. */
export function collectAllPaths(root: StructuredTreeNode): Set<string> {
  const out = new Set<string>()
  for (const node of structuredWalk(root)) out.add(node.path)
  return out
}
