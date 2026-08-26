import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/cheatsheets/cheatsheet_content.dart';
import '../shell/app_theme.dart';

/// Shared search + tag-filter + card list for a subset of
/// kExternalResourceLinks. Used by DocumentationScreen, ReferenceListsScreen,
/// and StudyPracticeScreen so the three "kind of external resource" screens
/// (split apart per design.md's Knowledge Hub restructure — see that file
/// for why they're separate screens rather than tabs inside one) share one
/// implementation instead of three copies.
class ResourceLinkListView extends StatefulWidget {
  const ResourceLinkListView({
    super.key,
    required this.description,
    required this.links,
    this.groupByType = false,
  });

  /// Explains what this category is, shown above the search box.
  final String description;

  /// Already filtered to the relevant ResourceType(s) by the caller.
  final List<ReferenceLink> links;

  /// When true, results are grouped under a header per ResourceType present
  /// in [links] — useful when a screen covers more than one type (e.g.
  /// Study & Practice covers both exercise and roadmap). Screens covering
  /// exactly one type should leave this false to avoid a redundant header.
  final bool groupByType;

  @override
  State<ResourceLinkListView> createState() => _ResourceLinkListViewState();
}

class _ResourceLinkListViewState extends State<ResourceLinkListView> {
  final _searchController = TextEditingController();
  String _query = '';
  final Set<String> _selectedTags = {};

  static const _typeLabels = {
    ResourceType.documentation: 'Documentation',
    ResourceType.curatedList: 'Curated Resource Lists',
    ResourceType.exercise: 'Exercises & Practice',
    ResourceType.roadmap: 'Roadmaps',
  };

  @override
  void initState() {
    super.initState();
    _searchController.addListener(() {
      setState(() => _query = _searchController.text);
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _toggleTag(String tag) {
    setState(() {
      if (!_selectedTags.remove(tag)) _selectedTags.add(tag);
    });
  }

  List<String> get _allTags {
    final tags = <String>{};
    for (final link in widget.links) {
      tags.addAll(link.tags);
    }
    return tags.toList()..sort();
  }

  List<ReferenceLink> _filtered() {
    final trimmed = _query.trim().toLowerCase();
    return widget.links.where((link) {
      final matchesQuery =
          trimmed.isEmpty ||
          link.name.toLowerCase().contains(trimmed) ||
          link.description.toLowerCase().contains(trimmed) ||
          link.tags.any((tag) => tag.toLowerCase().contains(trimmed));
      final matchesTags = _selectedTags.isEmpty || _selectedTags.every(link.tags.contains);
      return matchesQuery && matchesTags;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final tags = _allTags;
    final filtered = _filtered();
    final hasFilter = _query.trim().isNotEmpty || _selectedTags.isNotEmpty;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(widget.description, style: textTheme.bodyMedium),
        const SizedBox(height: 16),
        TextField(
          controller: _searchController,
          decoration: InputDecoration(
            hintText: 'Search by name, description, or tag…',
            prefixIcon: const Icon(Icons.search),
            suffixIcon: hasFilter
                ? IconButton(
                    icon: const Icon(Icons.clear),
                    onPressed: () => setState(() {
                      _searchController.clear();
                      _selectedTags.clear();
                    }),
                  )
                : null,
          ),
        ),
        if (tags.isNotEmpty) ...[
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final tag in tags)
                FilterChip(label: Text(tag), selected: _selectedTags.contains(tag), onSelected: (_) => _toggleTag(tag)),
            ],
          ),
        ],
        const SizedBox(height: 20),
        if (filtered.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 24),
            child: Text('No resources match your search or selected tags.', style: textTheme.bodyMedium),
          )
        else if (!widget.groupByType)
          for (final link in filtered) ResourceLinkCard(link: link)
        else
          for (final type in ResourceType.values) ...[
            if (filtered.any((link) => link.type == type)) ...[
              Text(_typeLabels[type]!, style: textTheme.titleMedium),
              const SizedBox(height: 8),
              for (final link in filtered.where((link) => link.type == type)) ResourceLinkCard(link: link),
              const SizedBox(height: 12),
            ],
          ],
      ],
    );
  }
}

/// One resource row: name, description, tags, and the URL as
/// selectable/copyable text (`url_launcher` isn't a dependency of this app,
/// so there's no built-in way to open it — users copy the URL manually).
class ResourceLinkCard extends StatelessWidget {
  const ResourceLinkCard({super.key, required this.link});

  final ReferenceLink link;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.menu_book, color: scheme.primary),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(link.name, style: textTheme.titleMedium),
                  const SizedBox(height: 4),
                  Text(link.description, style: textTheme.bodyMedium),
                  const SizedBox(height: 6),
                  SelectableText(link.url, style: AppTheme.monospace.copyWith(color: scheme.primary)),
                  if (link.tags.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        for (final tag in link.tags)
                          Chip(
                            label: Text(tag, style: textTheme.labelSmall),
                            visualDensity: VisualDensity.compact,
                            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 4),
            IconButton(
              tooltip: 'Copy URL to clipboard',
              icon: const Icon(Icons.copy, size: 18),
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: link.url));
                if (context.mounted) {
                  ScaffoldMessenger.of(
                    context,
                  ).showSnackBar(const SnackBar(content: Text('Copied URL'), duration: Duration(seconds: 1)));
                }
              },
            ),
          ],
        ),
      ),
    );
  }
}
