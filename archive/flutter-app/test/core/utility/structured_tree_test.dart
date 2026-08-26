import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/structured_tree.dart';

const _parser = StructuredTreeParser();

StructuredTreeResult parse(String source, {StructuredTreeFormat format = StructuredTreeFormat.auto}) =>
    _parser.execute(StructuredTreeInput(source: source, format: format));

void main() {
  group('equivalent JSON and YAML normalize to the same tree', () {
    const json = '''
{
  "name": "server1",
  "ports": [80, 443],
  "labels": {"app.kubernetes.io/name": "server1"},
  "nested": {"a": {"b": [1, {"c": 2}]}},
  "enabled": true,
  "note": null
}
''';

    const yaml = '''
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
''';

    final jsonResult = parse(json);
    final yamlResult = parse(yaml);

    test('each document is detected as its own format', () {
      expect(jsonResult.detectedFormat, StructuredTreeFormat.json);
      expect(yamlResult.detectedFormat, StructuredTreeFormat.yaml);
    });

    test('the two trees are structurally identical', () {
      expect(jsonResult.root, yamlResult.root);
    });

    test('node/leaf/depth summary counts agree', () {
      expect(jsonResult.nodeCount, yamlResult.nodeCount);
      expect(jsonResult.leafCount, yamlResult.leafCount);
      expect(jsonResult.maxDepth, yamlResult.maxDepth);
    });

    test('a leaf found by walking one tree has an identical counterpart in the other', () {
      final jsonPorts = jsonResult.root.children.firstWhere((n) => n.key == 'ports');
      final yamlPorts = yamlResult.root.children.firstWhere((n) => n.key == 'ports');
      expect(jsonPorts.children.map((c) => c.value), [80, 443]);
      expect(yamlPorts.children.map((c) => c.value), [80, 443]);
      expect(jsonPorts, yamlPorts);
    });
  });

  group('nested maps/lists: child counts and exact JSONPath format', () {
    const source = '''
{
  "name": "server1",
  "ports": [80, 443],
  "labels": {"app.kubernetes.io/name": "server1"},
  "nested": {"a": {"b": [1, {"c": 2}]}}
}
''';
    final result = parse(source, format: StructuredTreeFormat.json);
    final root = result.root;

    test('root is a map at depth 0 with path "\$"', () {
      expect(root.kind, StructuredNodeKind.map);
      expect(root.depth, 0);
      expect(root.path, r'$');
      expect(root.children, hasLength(4));
      expect(root.children.map((c) => c.key), ['name', 'ports', 'labels', 'nested']);
    });

    test('a scalar leaf carries its dotted path and value', () {
      final name = root.children.firstWhere((n) => n.key == 'name');
      expect(name.kind, StructuredNodeKind.scalar);
      expect(name.path, r'$.name');
      expect(name.value, 'server1');
      expect(name.isLeaf, isTrue);
      expect(name.hasChildren, isFalse);
    });

    test('a list uses bracket-index paths for its children', () {
      final ports = root.children.firstWhere((n) => n.key == 'ports');
      expect(ports.kind, StructuredNodeKind.list);
      expect(ports.path, r'$.ports');
      expect(ports.children, hasLength(2));
      expect(ports.children[0].path, r'$.ports[0]');
      expect(ports.children[0].isListItem, isTrue);
      expect(ports.children[0].displayKey, '[0]');
      expect(ports.children[1].path, r'$.ports[1]');
      expect(ports.children.map((c) => c.value), [80, 443]);
    });

    test('a key that is not a bare identifier gets bracket-quoted path notation', () {
      final labels = root.children.firstWhere((n) => n.key == 'labels');
      expect(labels.children, hasLength(1));
      final child = labels.children.single;
      expect(child.key, 'app.kubernetes.io/name');
      expect(child.path, r'$.labels["app.kubernetes.io/name"]');
      expect(child.isListItem, isFalse);
      expect(child.displayKey, 'app.kubernetes.io/name');
    });

    test('deep mixed map/list nesting produces the expected compound path', () {
      final nested = root.children.firstWhere((n) => n.key == 'nested');
      final a = nested.children.single;
      final b = a.children.single;
      expect(a.path, r'$.nested.a');
      expect(b.path, r'$.nested.a.b');
      expect(b.kind, StructuredNodeKind.list);
      expect(b.children, hasLength(2));

      final first = b.children[0];
      final second = b.children[1];
      expect(first.path, r'$.nested.a.b[0]');
      expect(first.value, 1);

      expect(second.path, r'$.nested.a.b[1]');
      expect(second.kind, StructuredNodeKind.map);
      final c = second.children.single;
      expect(c.path, r'$.nested.a.b[1].c');
      expect(c.value, 2);
    });

    test('subtreeNodeCount and subtreeDepth are correct at every level', () {
      final ports = root.children.firstWhere((n) => n.key == 'ports');
      expect(ports.subtreeNodeCount, 3); // ports + 2 scalars
      expect(ports.subtreeDepth, 1);

      final nested = root.children.firstWhere((n) => n.key == 'nested');
      // nested + a + b + b[0] + b[1] + b[1].c = 6
      expect(nested.subtreeNodeCount, 6);
      expect(nested.subtreeDepth, 4);
    });

    test('result-level node/leaf/depth summary matches a manual walk', () {
      // root, name(leaf), ports, ports[0..1](2 leaves), labels, labels-child(leaf),
      // nested, nested.a, nested.a.b, nested.a.b[0](leaf), nested.a.b[1], nested.a.b[1].c(leaf)
      expect(result.nodeCount, 13);
      expect(result.leafCount, 6);
      expect(result.maxDepth, 5);
    });

    test('displayValue summarizes containers by child count', () {
      final ports = root.children.firstWhere((n) => n.key == 'ports');
      expect(ports.displayValue, '[2 items]');
      final labels = root.children.firstWhere((n) => n.key == 'labels');
      expect(labels.displayValue, '{1 key}');
    });
  });

  group('invalid input errors cleanly', () {
    test('empty source throws a friendly FormatException', () {
      expect(
        () => parse(''),
        throwsA(isA<FormatException>().having((e) => e.message, 'message', contains('Enter or load'))),
      );
      expect(() => parse('   \n  '), throwsFormatException);
    });

    test('explicit JSON format rejects malformed JSON with a prefixed message', () {
      expect(
        () => parse('{"a": ', format: StructuredTreeFormat.json),
        throwsA(isA<FormatException>().having((e) => e.message, 'message', contains('Invalid JSON'))),
      );
    });

    test('explicit YAML format rejects malformed YAML with a prefixed message', () {
      const badYaml = 'a: [1, 2\nb: 3';
      expect(
        () => parse(badYaml, format: StructuredTreeFormat.yaml),
        throwsA(isA<FormatException>().having((e) => e.message, 'message', contains('Invalid YAML'))),
      );
    });

    test('auto-detect: JSON-looking input that is not valid JSON falls back to YAML and still errors', () {
      // Starts with '{' but is neither valid JSON flow mapping nor sensible
      // YAML, so it should fail rather than silently succeed with garbage.
      expect(() => parse('{not: [valid, json'), throwsFormatException);
    });

    test('a bare scalar document is valid (both JSON and YAML allow it)', () {
      final result = parse('42', format: StructuredTreeFormat.json);
      expect(result.root.kind, StructuredNodeKind.scalar);
      expect(result.root.value, 42);
    });
  });

  group('flattenVisibleNodes: lazy visible-row computation', () {
    const source = '{"a": {"b": 1, "c": 2}, "d": [1, 2, 3]}';
    final result = parse(source, format: StructuredTreeFormat.json);
    final root = result.root;

    test('with nothing expanded, only the root row shows', () {
      final rows = flattenVisibleNodes(root, expandedPaths: {});
      expect(rows, hasLength(1));
      expect(rows.single.node.path, r'$');
      expect(rows.single.isExpanded, isFalse);
    });

    test('expanding the root reveals its immediate children only', () {
      final rows = flattenVisibleNodes(root, expandedPaths: {r'$'});
      expect(rows.map((r) => r.node.path), [r'$', r'$.a', r'$.d']);
      expect(rows.first.isExpanded, isTrue);
    });

    test('expanding a nested container reveals only its own children, not siblings', () {
      final rows = flattenVisibleNodes(root, expandedPaths: {r'$', r'$.a'});
      expect(rows.map((r) => r.node.path), [r'$', r'$.a', r'$.a.b', r'$.a.c', r'$.d']);
    });

    test('collectAllContainerPaths yields every map/list path, not leaves', () {
      final all = collectAllContainerPaths(root);
      expect(all, {r'$', r'$.a', r'$.d'});
    });

    test('expanding every container path shows every node', () {
      final rows = flattenVisibleNodes(root, expandedPaths: collectAllContainerPaths(root));
      expect(rows, hasLength(root.subtreeNodeCount));
    });
  });

  group('collectMatchingPaths / nodeMatches: the filter box', () {
    const source = '{"name": "server1", "region": "us-east", "count": 3, "child": {"name": "inner"}}';
    final result = parse(source, format: StructuredTreeFormat.json);
    final root = result.root;

    test('an empty query matches everything', () {
      expect(collectMatchingPaths(root, ''), collectAllPaths(root));
    });

    test('a query matching a key keeps that node, its ancestors, and its subtree', () {
      final matches = collectMatchingPaths(root, 'region');
      expect(matches, containsAll([r'$', r'$.region']));
      expect(matches, isNot(contains(r'$.name')));
    });

    test('a query matching a value keeps the matching leaf and its ancestors', () {
      final matches = collectMatchingPaths(root, 'us-east');
      expect(matches, containsAll([r'$', r'$.region']));
    });

    test('a nested match keeps the whole ancestor chain reachable', () {
      final matches = collectMatchingPaths(root, 'inner');
      expect(matches, containsAll([r'$', r'$.child', r'$.child.name']));
    });

    test('a query matching nothing returns an empty set', () {
      expect(collectMatchingPaths(root, 'no-such-value-anywhere'), isEmpty);
    });

    test('matching is case-insensitive', () {
      final lower = collectMatchingPaths(root, 'region');
      final upper = collectMatchingPaths(root, 'REGION');
      expect(lower, upper);
    });

    test('nodeMatches checks key and, for leaves, the display value', () {
      final regionNode = root.children.firstWhere((n) => n.key == 'region');
      expect(nodeMatches(regionNode, 'region'), isTrue);
      expect(nodeMatches(regionNode, 'us-east'), isTrue);
      expect(nodeMatches(regionNode, 'nope'), isFalse);
    });
  });
}
