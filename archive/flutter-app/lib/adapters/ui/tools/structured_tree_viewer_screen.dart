import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/utility/structured_tree.dart';
import '../shell/app_theme.dart';
import '../shell/tool_detail_scaffold.dart';

/// "JSON/YAML Structured Tree Viewer" tool screen.
///
/// Left panel: raw JSON or YAML text. Right panel: a collapsible tree with
/// expand/collapse-all controls, a filter box that narrows the tree to
/// matching keys/values (highlighting the match), and the selected node's
/// JSONPath shown copyable.
///
/// ## Why this stays responsive on large documents
/// [StructuredTreeParser] builds the *whole* immutable tree once, but the
/// widget layer never touches more of it than is on screen: each rebuild
/// calls [flattenVisibleNodes] to turn the (small) set of expanded paths
/// into a flat list of just the currently-visible rows, and that list feeds
/// a [ListView.builder] with a fixed `itemExtent` inside a bounded-height
/// box — so Flutter's sliver machinery only ever builds the rows in (and
/// just around) the viewport, never the collapsed or off-screen parts of a
/// 10,000-node document.
class StructuredTreeViewerScreen extends StatefulWidget {
  const StructuredTreeViewerScreen({super.key});

  @override
  State<StructuredTreeViewerScreen> createState() => _StructuredTreeViewerScreenState();
}

class _StructuredTreeViewerScreenState extends State<StructuredTreeViewerScreen> {
  static const _parser = StructuredTreeParser();

  final _sourceController = TextEditingController();
  final _filterController = TextEditingController();

  StructuredTreeResult? _result;
  String? _error;
  Set<String> _expandedPaths = {};
  String? _selectedPath;

  @override
  void initState() {
    super.initState();
    _sourceController.addListener(_recompute);
    _filterController.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _sourceController.dispose();
    _filterController.dispose();
    super.dispose();
  }

  void _recompute() {
    final text = _sourceController.text;
    if (text.trim().isEmpty) {
      setState(() {
        _result = null;
        _error = null;
        _expandedPaths = {};
        _selectedPath = null;
      });
      return;
    }
    try {
      final result = _parser.execute(StructuredTreeInput(source: text));
      setState(() {
        _result = result;
        _error = null;
        // The document may have changed shape entirely, so start fresh
        // rather than trying to preserve expansion state across an edit.
        _expandedPaths = {result.root.path};
        _selectedPath = null;
      });
    } catch (e) {
      // Malformed JSON/YAML, or anything else the parser throws, must never
      // reach the widget tree unhandled.
      setState(() {
        _result = null;
        _error = _describeError(e);
      });
    }
  }

  String _describeError(Object e) {
    if (e is FormatException) return e.message;
    return e.toString();
  }

  List<VisibleTreeRow> get _visibleRows {
    final result = _result;
    if (result == null) return const [];
    final query = _filterController.text.trim();
    if (query.isEmpty) {
      return flattenVisibleNodes(result.root, expandedPaths: _expandedPaths);
    }
    // While filtering, force every ancestor open so matches are always
    // reachable regardless of the user's manual collapse state; the
    // manual state in [_expandedPaths] itself is left untouched and comes
    // back as soon as the filter is cleared.
    final matches = collectMatchingPaths(result.root, query);
    return flattenVisibleNodes(
      result.root,
      expandedPaths: collectAllContainerPaths(result.root),
      matchingPaths: matches,
    );
  }

  void _toggle(String path) {
    setState(() {
      if (!_expandedPaths.remove(path)) _expandedPaths.add(path);
    });
  }

  void _expandAll() {
    final result = _result;
    if (result == null) return;
    setState(() => _expandedPaths = collectAllContainerPaths(result.root));
  }

  void _collapseAll() {
    final result = _result;
    if (result == null) return;
    setState(() => _expandedPaths = {result.root.path});
  }

  Future<void> _copyPath(String path) async {
    await Clipboard.setData(ClipboardData(text: path));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Path copied to clipboard'), duration: Duration(seconds: 1)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'JSON/YAML Structured Tree Viewer',
      inputPanel: _buildInputPanel(context),
      outputPanel: _buildOutputPanel(context),
    );
  }

  Widget _buildInputPanel(BuildContext context) {
    final result = _result;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Document', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        TextField(
          controller: _sourceController,
          maxLines: 20,
          minLines: 12,
          style: AppTheme.monospace,
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            hintText: '{\n  "key": "value"\n}\n\n— or —\n\nkey: value',
            alignLabelWithHint: true,
          ),
        ),
        if (result != null) ...[
          const SizedBox(height: 10),
          Text(
            '${result.detectedFormat.label} · ${result.nodeCount} nodes · '
            '${result.leafCount} leaves · depth ${result.maxDepth}',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
          ),
        ],
      ],
    );
  }

  Widget _buildOutputPanel(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final error = _error;
    final result = _result;

    if (error != null) return _errorBanner(context, error);
    if (result == null) {
      return Text('Paste JSON or YAML to explore it as a tree here.', style: textTheme.bodyMedium);
    }

    final rows = _visibleRows;
    final query = _filterController.text.trim();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _filterController,
                decoration: InputDecoration(
                  isDense: true,
                  prefixIcon: const Icon(Icons.search, size: 18),
                  hintText: 'Filter keys or values…',
                  suffixIcon: query.isEmpty
                      ? null
                      : IconButton(
                          icon: const Icon(Icons.clear, size: 16),
                          onPressed: () => _filterController.clear(),
                        ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            IconButton(
              tooltip: 'Expand all',
              onPressed: _expandAll,
              icon: const Icon(Icons.unfold_more),
            ),
            IconButton(
              tooltip: 'Collapse all',
              onPressed: _collapseAll,
              icon: const Icon(Icons.unfold_less),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (query.isNotEmpty && rows.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text('No keys or values match "$query".', style: textTheme.bodyMedium),
          )
        else
          _TreeList(
            rows: rows,
            query: query,
            selectedPath: _selectedPath,
            onToggle: _toggle,
            onSelect: (path) => setState(() => _selectedPath = path),
          ),
        const SizedBox(height: 12),
        _SelectedPathBar(path: _selectedPath, onCopy: _copyPath),
      ],
    );
  }

  Widget _errorBanner(BuildContext context, String message) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      color: scheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.error_outline, color: scheme.onErrorContainer),
            const SizedBox(width: 8),
            Expanded(child: Text(message, style: TextStyle(color: scheme.onErrorContainer))),
          ],
        ),
      ),
    );
  }
}

/// The lazily-built, fixed-extent, independently-scrolling tree list. Bounded
/// height is what lets [ListView.builder] virtualize properly even though
/// [ToolDetailScaffold] puts this whole panel inside its own outer
/// `SingleChildScrollView`.
class _TreeList extends StatelessWidget {
  const _TreeList({
    required this.rows,
    required this.query,
    required this.selectedPath,
    required this.onToggle,
    required this.onSelect,
  });

  final List<VisibleTreeRow> rows;
  final String query;
  final String? selectedPath;
  final ValueChanged<String> onToggle;
  final ValueChanged<String> onSelect;

  static const double _rowHeight = 34;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final height = (rows.length * _rowHeight).clamp(_rowHeight, 560).toDouble();
    return Container(
      height: height,
      decoration: BoxDecoration(
        border: Border.all(color: scheme.outlineVariant),
        borderRadius: BorderRadius.circular(10),
      ),
      clipBehavior: Clip.antiAlias,
      child: ListView.builder(
        itemCount: rows.length,
        itemExtent: _rowHeight,
        itemBuilder: (context, index) {
          final row = rows[index];
          return _TreeRowWidget(
            row: row,
            query: query,
            selected: row.node.path == selectedPath,
            onToggle: () => onToggle(row.node.path),
            onSelect: () => onSelect(row.node.path),
          );
        },
      ),
    );
  }
}

class _TreeRowWidget extends StatelessWidget {
  const _TreeRowWidget({
    required this.row,
    required this.query,
    required this.selected,
    required this.onToggle,
    required this.onSelect,
  });

  final VisibleTreeRow row;
  final String query;
  final bool selected;
  final VoidCallback onToggle;
  final VoidCallback onSelect;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final node = row.node;

    return Material(
      color: selected ? AppTheme.selectedIndicatorColor(scheme) : Colors.transparent,
      child: InkWell(
        onTap: onSelect,
        child: Padding(
          padding: EdgeInsets.only(left: 8.0 + node.depth * 18, right: 10),
          child: Row(
            children: [
              SizedBox(
                width: 22,
                child: node.hasChildren
                    ? InkResponse(
                        onTap: onToggle,
                        radius: 14,
                        child: Icon(
                          row.isExpanded ? Icons.keyboard_arrow_down : Icons.chevron_right,
                          size: 18,
                          color: scheme.onSurfaceVariant,
                        ),
                      )
                    : null,
              ),
              Flexible(
                flex: 0,
                child: _highlighted(
                  context,
                  node.displayKey,
                  query,
                  style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w700, fontSize: 13),
                ),
              ),
              if (node.isLeaf) ...[
                Text('  :  ', style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12)),
                Flexible(
                  child: _highlighted(
                    context,
                    node.displayValue,
                    query,
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 12.5,
                      color: _scalarColor(node.scalarType, scheme),
                      fontStyle: node.scalarType == ScalarType.nullValue ? FontStyle.italic : null,
                    ),
                  ),
                ),
              ] else
                Padding(
                  padding: const EdgeInsets.only(left: 8),
                  child: Text(
                    node.displayValue,
                    style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 12),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Color _scalarColor(ScalarType? type, ColorScheme scheme) {
    switch (type) {
      case ScalarType.string:
        return scheme.onSurface;
      case ScalarType.number:
        return scheme.primary;
      case ScalarType.boolean:
        return scheme.tertiary;
      case ScalarType.nullValue:
        return scheme.onSurfaceVariant;
      case null:
        return scheme.onSurface;
    }
  }

  /// Splits [text] on a case-insensitive match of [query] and wraps the hit
  /// in a highlight background — the filter box's "highlights matching
  /// keys or values" behaviour.
  Widget _highlighted(BuildContext context, String text, String query, {required TextStyle style}) {
    if (query.isEmpty) return Text(text, style: style, overflow: TextOverflow.ellipsis);

    final lower = text.toLowerCase();
    final needle = query.toLowerCase();
    final index = lower.indexOf(needle);
    if (index < 0) return Text(text, style: style, overflow: TextOverflow.ellipsis);

    final scheme = Theme.of(context).colorScheme;
    final before = text.substring(0, index);
    final match = text.substring(index, index + needle.length);
    final after = text.substring(index + needle.length);

    return Text.rich(
      TextSpan(
        children: [
          TextSpan(text: before, style: style),
          TextSpan(
            text: match,
            style: style.copyWith(backgroundColor: scheme.primary.withValues(alpha: 0.28)),
          ),
          TextSpan(text: after, style: style),
        ],
      ),
      overflow: TextOverflow.ellipsis,
    );
  }
}

class _SelectedPathBar extends StatelessWidget {
  const _SelectedPathBar({required this.path, required this.onCopy});

  final String? path;
  final ValueChanged<String> onCopy;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.4),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Row(
        children: [
          Icon(Icons.route_outlined, size: 16, color: scheme.onSurfaceVariant),
          const SizedBox(width: 8),
          Expanded(
            child: SelectableText(
              path ?? 'Select a node to see its path here.',
              style: AppTheme.monospace.copyWith(
                fontSize: 12.5,
                color: path == null ? scheme.onSurfaceVariant : scheme.onSurface,
              ),
            ),
          ),
          if (path != null)
            IconButton(
              tooltip: 'Copy path',
              icon: const Icon(Icons.copy, size: 16),
              onPressed: () => onCopy(path!),
              visualDensity: VisualDensity.compact,
            ),
        ],
      ),
    );
  }
}
