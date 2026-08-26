import { describe, expect, it } from 'vitest'
import {
  collectAllContainerPaths,
  collectAllPaths,
  collectMatchingPaths,
  flattenVisibleNodes,
  nodeMatches,
  structuredDisplayKey,
  structuredDisplayValue,
  structuredNodesEqual,
  structuredSubtreeDepth,
  structuredSubtreeNodeCount,
  StructuredTreeParser,
  type StructuredTreeFormat,
  type StructuredTreeNode,
  type StructuredTreeResult,
} from './structuredTree'

const parser = new StructuredTreeParser()

function parse(source: string, format: StructuredTreeFormat = 'auto'): StructuredTreeResult {
  return parser.execute({ source, format })
}

function child(node: StructuredTreeNode, key: string): StructuredTreeNode {
  const found = node.children.find((c) => c.key === key)
  if (found === undefined) throw new Error(`no child "${key}"`)
  return found
}

describe('StructuredTreeParser', () => {
  describe('equivalent JSON and YAML normalize to the same tree', () => {
    const json = `
{
  "name": "server1",
  "ports": [80, 443],
  "labels": {"app.kubernetes.io/name": "server1"},
  "nested": {"a": {"b": [1, {"c": 2}]}},
  "enabled": true,
  "note": null
}
`

    const yaml = `
name: server1
ports:
  - 80
  - 443
labels:
  app.kubernetes.io/name: server1
nested:
  a:
    b:
      - 1
      - c: 2
enabled: true
note: null
`

    const jsonResult = parse(json)
    const yamlResult = parse(yaml)

    it('each document is detected as its own format', () => {
      expect(jsonResult.detectedFormat).toBe('json')
      expect(yamlResult.detectedFormat).toBe('yaml')
    })

    it('the two trees are structurally identical', () => {
      expect(structuredNodesEqual(jsonResult.root, yamlResult.root)).toBe(true)
    })

    it('node/leaf/depth summary counts agree', () => {
      expect(jsonResult.nodeCount).toBe(yamlResult.nodeCount)
      expect(jsonResult.leafCount).toBe(yamlResult.leafCount)
      expect(jsonResult.maxDepth).toBe(yamlResult.maxDepth)
    })

    it('a leaf found by walking one tree has an identical counterpart in the other', () => {
      const jsonPorts = child(jsonResult.root, 'ports')
      const yamlPorts = child(yamlResult.root, 'ports')
      expect(jsonPorts.children.map((c) => c.value)).toEqual([80, 443])
      expect(yamlPorts.children.map((c) => c.value)).toEqual([80, 443])
      expect(structuredNodesEqual(jsonPorts, yamlPorts)).toBe(true)
    })
  })

  describe('nested maps/lists: child counts and exact JSONPath format', () => {
    const source = `
{
  "name": "server1",
  "ports": [80, 443],
  "labels": {"app.kubernetes.io/name": "server1"},
  "nested": {"a": {"b": [1, {"c": 2}]}}
}
`
    const result = parse(source, 'json')
    const root = result.root

    it('root is a map at depth 0 with path "$"', () => {
      expect(root.kind).toBe('map')
      expect(root.depth).toBe(0)
      expect(root.path).toBe('$')
      expect(root.children).toHaveLength(4)
      expect(root.children.map((c) => c.key)).toEqual(['name', 'ports', 'labels', 'nested'])
    })

    it('a scalar leaf carries its dotted path and value', () => {
      const name = child(root, 'name')
      expect(name.kind).toBe('scalar')
      expect(name.path).toBe('$.name')
      expect(name.value).toBe('server1')
      expect(name.kind === 'scalar').toBe(true)
      expect(name.children).toHaveLength(0)
    })

    it('a list uses bracket-index paths for its children', () => {
      const ports = child(root, 'ports')
      expect(ports.kind).toBe('list')
      expect(ports.path).toBe('$.ports')
      expect(ports.children).toHaveLength(2)
      expect(ports.children[0].path).toBe('$.ports[0]')
      expect(ports.children[0].isListItem).toBe(true)
      expect(structuredDisplayKey(ports.children[0])).toBe('[0]')
      expect(ports.children[1].path).toBe('$.ports[1]')
      expect(ports.children.map((c) => c.value)).toEqual([80, 443])
    })

    it('a key that is not a bare identifier gets bracket-quoted path notation', () => {
      const labels = child(root, 'labels')
      expect(labels.children).toHaveLength(1)
      const c = labels.children[0]
      expect(c.key).toBe('app.kubernetes.io/name')
      expect(c.path).toBe('$.labels["app.kubernetes.io/name"]')
      expect(c.isListItem).toBe(false)
      expect(structuredDisplayKey(c)).toBe('app.kubernetes.io/name')
    })

    it('deep mixed map/list nesting produces the expected compound path', () => {
      const nested = child(root, 'nested')
      const a = nested.children[0]
      const b = a.children[0]
      expect(a.path).toBe('$.nested.a')
      expect(b.path).toBe('$.nested.a.b')
      expect(b.kind).toBe('list')
      expect(b.children).toHaveLength(2)

      const first = b.children[0]
      const second = b.children[1]
      expect(first.path).toBe('$.nested.a.b[0]')
      expect(first.value).toBe(1)

      expect(second.path).toBe('$.nested.a.b[1]')
      expect(second.kind).toBe('map')
      const c = second.children[0]
      expect(c.path).toBe('$.nested.a.b[1].c')
      expect(c.value).toBe(2)
    })

    it('subtreeNodeCount and subtreeDepth are correct at every level', () => {
      const ports = child(root, 'ports')
      expect(structuredSubtreeNodeCount(ports)).toBe(3) // ports + 2 scalars
      expect(structuredSubtreeDepth(ports)).toBe(1)

      const nested = child(root, 'nested')
      // nested + a + b + b[0] + b[1] + b[1].c = 6
      expect(structuredSubtreeNodeCount(nested)).toBe(6)
      expect(structuredSubtreeDepth(nested)).toBe(4)
    })

    it('result-level node/leaf/depth summary matches a manual walk', () => {
      expect(result.nodeCount).toBe(13)
      expect(result.leafCount).toBe(6)
      expect(result.maxDepth).toBe(5)
    })

    it('displayValue summarizes containers by child count', () => {
      const ports = child(root, 'ports')
      expect(structuredDisplayValue(ports)).toBe('[2 items]')
      const labels = child(root, 'labels')
      expect(structuredDisplayValue(labels)).toBe('{1 key}')
    })
  })

  describe('invalid input errors cleanly', () => {
    it('empty source throws a friendly error', () => {
      expect(() => parse('')).toThrow(/Enter or load/)
      expect(() => parse('   \n  ')).toThrow()
    })

    it('explicit JSON format rejects malformed JSON with a prefixed message', () => {
      expect(() => parse('{"a": ', 'json')).toThrow(/Invalid JSON/)
    })

    it('explicit YAML format rejects malformed YAML with a prefixed message', () => {
      const badYaml = 'a: [1, 2\nb: 3'
      expect(() => parse(badYaml, 'yaml')).toThrow(/Invalid YAML/)
    })

    it('auto-detect: JSON-looking input that is not valid JSON falls back to YAML and still errors', () => {
      expect(() => parse('{not: [valid, json')).toThrow()
    })

    it('a bare scalar document is valid (both JSON and YAML allow it)', () => {
      const result = parse('42', 'json')
      expect(result.root.kind).toBe('scalar')
      expect(result.root.value).toBe(42)
    })
  })

  describe('flattenVisibleNodes: lazy visible-row computation', () => {
    const source = '{"a": {"b": 1, "c": 2}, "d": [1, 2, 3]}'
    const result = parse(source, 'json')
    const root = result.root

    it('with nothing expanded, only the root row shows', () => {
      const rows = flattenVisibleNodes(root, { expandedPaths: new Set() })
      expect(rows).toHaveLength(1)
      expect(rows[0].node.path).toBe('$')
      expect(rows[0].isExpanded).toBe(false)
    })

    it('expanding the root reveals its immediate children only', () => {
      const rows = flattenVisibleNodes(root, { expandedPaths: new Set(['$']) })
      expect(rows.map((r) => r.node.path)).toEqual(['$', '$.a', '$.d'])
      expect(rows[0].isExpanded).toBe(true)
    })

    it('expanding a nested container reveals only its own children, not siblings', () => {
      const rows = flattenVisibleNodes(root, { expandedPaths: new Set(['$', '$.a']) })
      expect(rows.map((r) => r.node.path)).toEqual(['$', '$.a', '$.a.b', '$.a.c', '$.d'])
    })

    it('collectAllContainerPaths yields every map/list path, not leaves', () => {
      const all = collectAllContainerPaths(root)
      expect(all).toEqual(new Set(['$', '$.a', '$.d']))
    })

    it('expanding every container path shows every node', () => {
      const rows = flattenVisibleNodes(root, { expandedPaths: collectAllContainerPaths(root) })
      expect(rows).toHaveLength(structuredSubtreeNodeCount(root))
    })
  })

  describe('collectMatchingPaths / nodeMatches: the filter box', () => {
    const source = '{"name": "server1", "region": "us-east", "count": 3, "child": {"name": "inner"}}'
    const result = parse(source, 'json')
    const root = result.root

    it('an empty query matches everything', () => {
      expect(collectMatchingPaths(root, '')).toEqual(collectAllPaths(root))
    })

    it('a query matching a key keeps that node, its ancestors, and its subtree', () => {
      const matches = collectMatchingPaths(root, 'region')
      expect(matches.has('$')).toBe(true)
      expect(matches.has('$.region')).toBe(true)
      expect(matches.has('$.name')).toBe(false)
    })

    it('a query matching a value keeps the matching leaf and its ancestors', () => {
      const matches = collectMatchingPaths(root, 'us-east')
      expect(matches.has('$')).toBe(true)
      expect(matches.has('$.region')).toBe(true)
    })

    it('a nested match keeps the whole ancestor chain reachable', () => {
      const matches = collectMatchingPaths(root, 'inner')
      expect(matches.has('$')).toBe(true)
      expect(matches.has('$.child')).toBe(true)
      expect(matches.has('$.child.name')).toBe(true)
    })

    it('a query matching nothing returns an empty set', () => {
      expect(collectMatchingPaths(root, 'no-such-value-anywhere').size).toBe(0)
    })

    it('matching is case-insensitive', () => {
      const lower = collectMatchingPaths(root, 'region')
      const upper = collectMatchingPaths(root, 'REGION')
      expect(lower).toEqual(upper)
    })

    it('nodeMatches checks key and, for leaves, the display value', () => {
      const regionNode = child(root, 'region')
      expect(nodeMatches(regionNode, 'region')).toBe(true)
      expect(nodeMatches(regionNode, 'us-east')).toBe(true)
      expect(nodeMatches(regionNode, 'nope')).toBe(false)
    })
  })
})
