import 'dart:convert';

import 'package:yaml/yaml.dart';

import '../ports/i_tool_use_case.dart';

/// Which surface syntax the text was parsed as.
enum StructuredTreeFormat {
  json('JSON'),
  yaml('YAML'),

  /// Try JSON first, fall back to YAML. (Every valid JSON document is also
  /// valid YAML 1.2, but the JSON parser gives far better error messages, so
  /// it goes first.)
  auto('Auto-detect');

  const StructuredTreeFormat(this.label);

  final String label;
}

/// The shape of a node's value.
enum StructuredNodeKind {
  /// An object / mapping with named children.
  map,

  /// An array / sequence with positional children.
  list,

  /// A leaf: string, number, bool or null.
  scalar,
}

/// The concrete Dart type of a scalar leaf, for type-badge display.
enum ScalarType { string, number, boolean, nullValue }

/// One node of the normalized document tree.
///
/// Nodes are immutable and carry their own fully-qualified [path], so the UI
/// can copy a JSONPath for any row without walking back up the tree.
class StructuredTreeNode {
  StructuredTreeNode._({
    required this.key,
    required this.kind,
    required this.value,
    required this.path,
    required this.depth,
    required this.children,
    required this.isListItem,
  });

  /// The map key this node was stored under, or the stringified index for a
  /// list item. Empty for the root.
  final String key;

  final StructuredNodeKind kind;

  /// The scalar value; always null for [StructuredNodeKind.map] and
  /// [StructuredNodeKind.list].
  final Object? value;

  /// JSONPath from the document root, e.g. `$.spec.containers[0].image`.
  final String path;

  /// 0 for the root.
  final int depth;

  /// Empty for scalars. Map children keep their document order; list children
  /// keep their index order.
  final List<StructuredTreeNode> children;

  /// True when this node is an element of a list rather than a map entry —
  /// the UI labels those `[0]` instead of `key:`.
  final bool isListItem;

  bool get isLeaf => kind == StructuredNodeKind.scalar;
  bool get hasChildren => children.isNotEmpty;

  /// The type badge for a scalar leaf. Null for containers.
  ScalarType? get scalarType {
    if (kind != StructuredNodeKind.scalar) return null;
    if (value == null) return ScalarType.nullValue;
    if (value is bool) return ScalarType.boolean;
    if (value is num) return ScalarType.number;
    return ScalarType.string;
  }

  /// Compact one-line preview: the scalar itself for leaves, or
  /// `{3 keys}` / `[5 items]` for containers.
  String get displayValue {
    switch (kind) {
      case StructuredNodeKind.map:
        return children.length == 1 ? '{1 key}' : '{${children.length} keys}';
      case StructuredNodeKind.list:
        return children.length == 1 ? '[1 item]' : '[${children.length} items]';
      case StructuredNodeKind.scalar:
        if (value == null) return 'null';
        if (value is String) return value as String;
        return value.toString();
    }
  }

  /// The row label: `key` for map entries, `[i]` for list items, `$` for the
  /// root.
  String get displayKey {
    if (depth == 0) return r'$';
    return isListItem ? '[$key]' : key;
  }

  /// This node plus every descendant, inclusive.
  int get subtreeNodeCount {
    var total = 1;
    for (final child in children) {
      total += child.subtreeNodeCount;
    }
    return total;
  }

  /// Deepest level below this node (0 for a leaf).
  int get subtreeDepth {
    var deepest = 0;
    for (final child in children) {
      final d = child.subtreeDepth + 1;
      if (d > deepest) deepest = d;
    }
    return deepest;
  }

  /// Pre-order walk over this node and all descendants.
  Iterable<StructuredTreeNode> walk() sync* {
    yield this;
    for (final child in children) {
      yield* child.walk();
    }
  }

  /// Deep structural equality — used by tests asserting that equivalent JSON
  /// and YAML documents normalize to the same tree.
  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    if (other is! StructuredTreeNode) return false;
    if (key != other.key || kind != other.kind || path != other.path) return false;
    if (isListItem != other.isListItem || depth != other.depth) return false;
    if (value != other.value) return false;
    if (children.length != other.children.length) return false;
    for (var i = 0; i < children.length; i++) {
      if (children[i] != other.children[i]) return false;
    }
    return true;
  }

  @override
  int get hashCode => Object.hash(key, kind, path, depth, isListItem, value, children.length);

  @override
  String toString() => '$path (${kind.name})';
}

class StructuredTreeInput {
  const StructuredTreeInput({required this.source, this.format = StructuredTreeFormat.auto});

  final String source;
  final StructuredTreeFormat format;
}

class StructuredTreeResult {
  const StructuredTreeResult({
    required this.root,
    required this.detectedFormat,
    required this.nodeCount,
    required this.maxDepth,
    required this.leafCount,
  });

  final StructuredTreeNode root;

  /// The format actually used — resolves [StructuredTreeFormat.auto].
  final StructuredTreeFormat detectedFormat;

  /// Every node in the tree including the root.
  final int nodeCount;

  /// Depth of the deepest node (root is 0).
  final int maxDepth;

  /// Scalar leaves only.
  final int leafCount;
}

/// Turns JSON or YAML text into a generic, immutable tree of
/// [StructuredTreeNode]s with precomputed JSONPaths and node counts.
///
/// Reuses the same parsers the rest of the app already relies on —
/// `dart:convert` for JSON and `package:yaml` for YAML — and normalizes both
/// into plain Dart `Map`/`List`/scalar values first (the same canonicalisation
/// `DataFormatConverter` performs), so two documents that mean the same thing
/// produce identical trees regardless of which syntax they arrived in.
///
/// Pure Dart, no Flutter, no I/O. Invalid input throws [FormatException] with
/// a message safe to show inline; callers catch it rather than letting it
/// reach the UI.
class StructuredTreeParser implements IToolUseCase<StructuredTreeInput, StructuredTreeResult> {
  const StructuredTreeParser();

  @override
  StructuredTreeResult execute(StructuredTreeInput input) {
    if (input.source.trim().isEmpty) {
      throw const FormatException('Enter or load a JSON or YAML document.');
    }

    final (tree, format) = _decode(input.source, input.format);
    final root = _build(key: '', value: tree, path: r'$', depth: 0, isListItem: false);

    var leaves = 0;
    var nodes = 0;
    var maxDepth = 0;
    for (final node in root.walk()) {
      nodes++;
      if (node.isLeaf) leaves++;
      if (node.depth > maxDepth) maxDepth = node.depth;
    }

    return StructuredTreeResult(
      root: root,
      detectedFormat: format,
      nodeCount: nodes,
      maxDepth: maxDepth,
      leafCount: leaves,
    );
  }

  (Object?, StructuredTreeFormat) _decode(String source, StructuredTreeFormat format) {
    switch (format) {
      case StructuredTreeFormat.json:
        return (_normalize(_decodeJson(source)), StructuredTreeFormat.json);
      case StructuredTreeFormat.yaml:
        return (_normalize(_decodeYaml(source)), StructuredTreeFormat.yaml);
      case StructuredTreeFormat.auto:
        final trimmed = source.trimLeft();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try {
            return (_normalize(_decodeJson(source)), StructuredTreeFormat.json);
          } on FormatException {
            // A JSON-looking document that does not parse as JSON may still be
            // flow-style YAML; fall through.
          }
        }
        return (_normalize(_decodeYaml(source)), StructuredTreeFormat.yaml);
    }
  }

  Object? _decodeJson(String source) {
    try {
      return jsonDecode(source);
    } on FormatException catch (e) {
      throw FormatException('Invalid JSON: ${e.message}');
    } catch (e) {
      throw FormatException('Invalid JSON: $e');
    }
  }

  Object? _decodeYaml(String source) {
    try {
      return loadYaml(source);
    } on YamlException catch (e) {
      throw FormatException('Invalid YAML: ${e.message}');
    } catch (e) {
      throw FormatException('Invalid YAML: $e');
    }
  }

  /// Collapses `YamlMap`/`YamlList` (and any other `Map`/`Iterable`) into
  /// plain `Map<String, Object?>` / `List<Object?>`, stringifying keys and any
  /// scalar type that is neither String, num, bool nor null.
  static Object? _normalize(Object? value) {
    if (value is Map) {
      final out = <String, Object?>{};
      for (final entry in value.entries) {
        out[entry.key?.toString() ?? 'null'] = _normalize(entry.value);
      }
      return out;
    }
    if (value is Iterable) {
      return [for (final item in value) _normalize(item)];
    }
    if (value == null || value is String || value is num || value is bool) {
      return value;
    }
    // DateTime and friends from YAML have no JSON equivalent.
    return value.toString();
  }

  StructuredTreeNode _build({
    required String key,
    required Object? value,
    required String path,
    required int depth,
    required bool isListItem,
  }) {
    if (value is Map<String, Object?>) {
      final children = <StructuredTreeNode>[];
      value.forEach((childKey, childValue) {
        children.add(
          _build(
            key: childKey,
            value: childValue,
            path: joinPath(path, childKey),
            depth: depth + 1,
            isListItem: false,
          ),
        );
      });
      return StructuredTreeNode._(
        key: key,
        kind: StructuredNodeKind.map,
        value: null,
        path: path,
        depth: depth,
        children: List.unmodifiable(children),
        isListItem: isListItem,
      );
    }

    if (value is List<Object?>) {
      final children = <StructuredTreeNode>[];
      for (var i = 0; i < value.length; i++) {
        children.add(
          _build(
            key: '$i',
            value: value[i],
            path: '$path[$i]',
            depth: depth + 1,
            isListItem: true,
          ),
        );
      }
      return StructuredTreeNode._(
        key: key,
        kind: StructuredNodeKind.list,
        value: null,
        path: path,
        depth: depth,
        children: List.unmodifiable(children),
        isListItem: isListItem,
      );
    }

    return StructuredTreeNode._(
      key: key,
      kind: StructuredNodeKind.scalar,
      value: value,
      path: path,
      depth: depth,
      children: const [],
      isListItem: isListItem,
    );
  }

  /// Appends a map key to a JSONPath, using bracket notation for keys that
  /// are not bare identifiers (`$.metadata["app.kubernetes.io/name"]`).
  static String joinPath(String parentPath, String key) {
    final isBareIdentifier = RegExp(r'^[A-Za-z_][A-Za-z0-9_]*$').hasMatch(key);
    if (isBareIdentifier) return '$parentPath.$key';
    return '$parentPath[${jsonEncode(key)}]';
  }
}

/// A node paired with its current expansion state, ready for lazy rendering.
///
/// [flattenVisibleNodes] produces one of these per *visible* row, so a
/// `ListView.builder` can render a 10,000-node document without ever building
/// the collapsed parts of the tree.
class VisibleTreeRow {
  const VisibleTreeRow({required this.node, required this.isExpanded});

  final StructuredTreeNode node;

  /// Whether this node's children are currently shown. Always false for
  /// leaves.
  final bool isExpanded;
}

/// Walks [root] and emits one [VisibleTreeRow] per row that should currently
/// be on screen: a node's children are included only when its path is in
/// [expandedPaths].
///
/// When [matchingPaths] is non-null, only nodes in that set (which callers
/// build with [collectMatchingPaths], so ancestors of a hit are retained) are
/// emitted — that is the filter behaviour.
///
/// This is the whole reason the viewer stays responsive: rebuilding the
/// flattened list is O(visible nodes), and the widget layer never holds more
/// than a screenful of widgets.
List<VisibleTreeRow> flattenVisibleNodes(
  StructuredTreeNode root, {
  required Set<String> expandedPaths,
  Set<String>? matchingPaths,
}) {
  final rows = <VisibleTreeRow>[];

  void visit(StructuredTreeNode node) {
    if (matchingPaths != null && !matchingPaths.contains(node.path)) return;
    final expanded = node.hasChildren && expandedPaths.contains(node.path);
    rows.add(VisibleTreeRow(node: node, isExpanded: expanded));
    if (!expanded) return;
    for (final child in node.children) {
      visit(child);
    }
  }

  visit(root);
  return rows;
}

/// Every path in the tree — what "expand all" needs.
Set<String> collectAllContainerPaths(StructuredTreeNode root) {
  return {for (final node in root.walk()) if (node.hasChildren) node.path};
}

/// Paths of nodes whose key or value contains [query] (case-insensitive),
/// plus every ancestor of a match so the hits stay reachable in the tree.
///
/// Returns an empty set when nothing matches; callers treat that as "no
/// results" rather than "show everything".
Set<String> collectMatchingPaths(StructuredTreeNode root, String query) {
  final needle = query.trim().toLowerCase();
  if (needle.isEmpty) return collectAllPaths(root);

  final keep = <String>{};

  bool visit(StructuredTreeNode node, List<StructuredTreeNode> ancestors) {
    final selfMatches = nodeMatches(node, needle);
    var anyDescendantMatches = false;
    final nextAncestors = [...ancestors, node];
    for (final child in node.children) {
      if (visit(child, nextAncestors)) anyDescendantMatches = true;
    }
    if (selfMatches || anyDescendantMatches) {
      for (final a in nextAncestors) {
        keep.add(a.path);
      }
      // A matching node keeps its whole subtree visible so the value can be
      // read in context.
      if (selfMatches) {
        for (final d in node.walk()) {
          keep.add(d.path);
        }
      }
      return true;
    }
    return false;
  }

  visit(root, const []);
  return keep;
}

/// True when [node]'s key or scalar value contains the already-lowercased
/// [lowercaseNeedle].
bool nodeMatches(StructuredTreeNode node, String lowercaseNeedle) {
  if (node.key.toLowerCase().contains(lowercaseNeedle)) return true;
  if (node.isLeaf && node.displayValue.toLowerCase().contains(lowercaseNeedle)) return true;
  return false;
}

/// Every node path in the tree, containers and leaves alike.
Set<String> collectAllPaths(StructuredTreeNode root) {
  return {for (final node in root.walk()) node.path};
}
