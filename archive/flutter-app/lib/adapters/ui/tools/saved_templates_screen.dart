import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/form_flow/schema_model.dart';
import '../../storage/schema_repository_factory.dart';

/// FormFlow's "Sidebar Template Library" browser (spec: Module 4, "Custom
/// Saved Templates") — lists every template persisted through
/// [createSchemaRepository]. "Load" navigates to the FormFlow builder route
/// passing the deserialized template via go_router's `extra`; "Delete" is
/// gated behind a confirmation dialog.
class SavedTemplatesScreen extends StatefulWidget {
  const SavedTemplatesScreen({super.key});

  @override
  State<SavedTemplatesScreen> createState() => _SavedTemplatesScreenState();
}

class _SavedTemplatesScreenState extends State<SavedTemplatesScreen> {
  final _repository = createSchemaRepository();

  late Future<List<String>> _namesFuture;

  @override
  void initState() {
    super.initState();
    _namesFuture = _repository.listNames();
  }

  void _refresh() {
    setState(() {
      _namesFuture = _repository.listNames();
    });
  }

  Future<void> _load(String name) async {
    final raw = await _repository.load(name);
    if (!mounted) return;

    if (raw == null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('"$name" no longer exists')));
      _refresh();
      return;
    }

    final template = SavedFormFlowTemplate.fromJson(jsonDecode(raw) as Map<String, Object?>);
    context.push('/tools/formflow-builder', extra: template);
  }

  Future<void> _confirmDelete(String name) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Delete template?'),
        content: Text(
          '"$name" will be permanently deleted. This cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    await _repository.delete(name);
    if (!mounted) return;
    _refresh();
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('Deleted "$name"')));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Saved Templates')),
      body: FutureBuilder<List<String>>(
        future: _namesFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  'Could not load saved templates: ${snapshot.error}',
                ),
              ),
            );
          }

          final names = snapshot.data ?? const <String>[];
          if (names.isEmpty) {
            return _EmptyState(onRefresh: _refresh);
          }

          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: names.length,
            itemBuilder: (context, index) {
              final name = names[index];
              return Card(
                child: ListTile(
                  leading: const Icon(Icons.description_outlined),
                  title: Text(name),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      TextButton.icon(
                        onPressed: () => _load(name),
                        icon: const Icon(Icons.open_in_new),
                        label: const Text('Load'),
                      ),
                      IconButton(
                        tooltip: 'Delete',
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () => _confirmDelete(name),
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onRefresh});

  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.folder_special_outlined,
              size: 48,
              color: Theme.of(context).colorScheme.outline,
            ),
            const SizedBox(height: 16),
            Text(
              'No saved templates yet',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              'Templates you save from the FormFlow designer will show up '
              'here.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: onRefresh,
              icon: const Icon(Icons.refresh),
              label: const Text('Refresh'),
            ),
          ],
        ),
      ),
    );
  }
}
