import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/cheatsheets/cheatsheet_content.dart';
import '../shell/app_theme.dart';

/// Cheatsheets (spec Module 5, part 1): fast command/syntax lookup over the
/// static content in lib/core/cheatsheets/cheatsheet_content.dart — Git
/// commands, regex patterns, Linux sysctl parameters, crontab syntax, chmod
/// permissions.
///
/// Deliberately narrow in scope: official docs, curated resource lists, and
/// study material live in their own separate screens (DocumentationScreen,
/// ReferenceListsScreen, StudyPracticeScreen) rather than as tabs here —
/// "quick syntax lookup" and "browse a curated list of learning material"
/// are different tasks with different UX needs, even though an earlier
/// version of this screen lumped them together. See design.md.
class CheatsheetsScreen extends StatefulWidget {
  const CheatsheetsScreen({super.key});

  @override
  State<CheatsheetsScreen> createState() => _CheatsheetsScreenState();
}

class _CheatsheetsScreenState extends State<CheatsheetsScreen> {
  int _selectedIndex = 0;
  final TextEditingController _searchController = TextEditingController();
  String _query = '';

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

  void _selectPage(int index) {
    setState(() {
      _selectedIndex = index;
      _searchController.clear();
      _query = '';
    });
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Cheatsheets')),
      body: LayoutBuilder(
        builder: (context, constraints) {
          final isCompact = constraints.maxWidth < 720;

          final content = Padding(
            padding: const EdgeInsets.all(20),
            child: _buildCheatsheetPage(context, kCheatsheetPages[_selectedIndex]),
          );

          if (isCompact) {
            return Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  child: _buildPageDropdown(context),
                ),
                Expanded(child: SingleChildScrollView(child: content)),
              ],
            );
          }

          return Row(
            children: [
              SizedBox(width: 260, child: _buildSideList(context)),
              VerticalDivider(width: 1, color: scheme.outlineVariant),
              Expanded(child: SingleChildScrollView(child: content)),
            ],
          );
        },
      ),
    );
  }

  Widget _buildSideList(BuildContext context) {
    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: kCheatsheetPages.length,
      itemBuilder: (context, index) {
        return ListTile(
          selected: index == _selectedIndex,
          leading: const Icon(Icons.description_outlined),
          title: Text(kCheatsheetPages[index].title),
          onTap: () => _selectPage(index),
        );
      },
    );
  }

  Widget _buildPageDropdown(BuildContext context) {
    return DropdownButtonFormField<int>(
      initialValue: _selectedIndex,
      isExpanded: true,
      items: [
        for (var i = 0; i < kCheatsheetPages.length; i++)
          DropdownMenuItem(value: i, child: Text(kCheatsheetPages[i].title)),
      ],
      onChanged: (value) {
        if (value != null) _selectPage(value);
      },
    );
  }

  Widget _buildCheatsheetPage(BuildContext context, CheatsheetPage page) {
    final textTheme = Theme.of(context).textTheme;
    final sections = _filterSections(page, _query);
    final hasQuery = _query.trim().isNotEmpty;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(page.title, style: textTheme.headlineSmall),
        const SizedBox(height: 4),
        Text(page.description, style: textTheme.bodyMedium),
        const SizedBox(height: 16),
        TextField(
          controller: _searchController,
          decoration: InputDecoration(
            hintText: 'Filter by command or description…',
            prefixIcon: const Icon(Icons.search),
            suffixIcon: hasQuery
                ? IconButton(icon: const Icon(Icons.clear), onPressed: () => _searchController.clear())
                : null,
          ),
        ),
        const SizedBox(height: 20),
        if (sections.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 24),
            child: Text('No entries match "$_query".', style: textTheme.bodyMedium),
          )
        else
          for (final section in sections) _buildSection(context, section),
      ],
    );
  }

  Widget _buildSection(BuildContext context, CheatsheetSection section) {
    final textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(section.title, style: textTheme.titleMedium),
          const SizedBox(height: 8),
          for (final entry in section.entries) _EntryCard(entry: entry),
        ],
      ),
    );
  }

  List<CheatsheetSection> _filterSections(CheatsheetPage page, String query) {
    final trimmed = query.trim().toLowerCase();
    if (trimmed.isEmpty) return page.sections;

    final filtered = <CheatsheetSection>[];
    for (final section in page.sections) {
      final matches = section.entries
          .where(
            (entry) =>
                entry.command.toLowerCase().contains(trimmed) || entry.description.toLowerCase().contains(trimmed),
          )
          .toList();
      if (matches.isNotEmpty) {
        filtered.add(CheatsheetSection(title: section.title, entries: matches));
      }
    }
    return filtered;
  }
}

/// One reference row: command/pattern in [AppTheme.monospace], description in
/// body text, worked example below, and a copy button for the command.
class _EntryCard extends StatelessWidget {
  const _EntryCard({required this.entry});

  final CheatsheetEntry entry;

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
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SelectableText(entry.command, style: AppTheme.monospace.copyWith(color: scheme.primary)),
                  const SizedBox(height: 6),
                  SelectableText(entry.description, style: textTheme.bodyMedium),
                  const SizedBox(height: 8),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    decoration: BoxDecoration(
                      color: scheme.surfaceContainerHighest.withValues(alpha: 0.4),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: SelectableText(entry.example, style: AppTheme.monospace),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 4),
            IconButton(
              tooltip: 'Copy "${entry.command}" to clipboard',
              icon: const Icon(Icons.copy, size: 18),
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: entry.command));
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Copied "${entry.command}"'), duration: const Duration(seconds: 1)),
                  );
                }
              },
            ),
          ],
        ),
      ),
    );
  }
}
