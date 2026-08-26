import 'package:flutter/material.dart';

import '../../../core/utility/uuid_ulid_generator.dart';
import '../shell/tool_detail_scaffold.dart';

/// Screen for generating UUIDs (v1/v3/v4/v5) and ULIDs, built on the shared
/// [ToolDetailScaffold] split-panel layout: version/mode controls and the
/// Generate button on the left, the latest value plus recent history on the
/// right.
class IdGeneratorScreen extends StatefulWidget {
  const IdGeneratorScreen({super.key});

  @override
  State<IdGeneratorScreen> createState() => _IdGeneratorScreenState();
}

class _IdGeneratorScreenState extends State<IdGeneratorScreen> {
  final UuidUlidGenerator _generator = UuidUlidGenerator();
  final TextEditingController _namespaceController = TextEditingController(
    text: WellKnownNamespace.dns,
  );
  final TextEditingController _nameController = TextEditingController(
    text: 'example.com',
  );

  IdKind _selectedKind = IdKind.uuidV4;
  String? _latestValue;
  String? _errorText;
  final List<UuidUlidResult> _history = [];

  bool get _needsNamespaceAndName =>
      _selectedKind == IdKind.uuidV3 || _selectedKind == IdKind.uuidV5;

  void _generate() {
    setState(() {
      _errorText = null;
      try {
        final result = _generator.execute(
          UuidUlidInput(
            kind: _selectedKind,
            namespace:
                _needsNamespaceAndName ? _namespaceController.text.trim() : null,
            name: _needsNamespaceAndName ? _nameController.text : null,
          ),
        );
        _latestValue = result.value;
        _history.insert(0, result);
        if (_history.length > 20) {
          _history.removeLast();
        }
      } on ArgumentError catch (e) {
        _errorText = e.message?.toString() ?? 'Invalid input';
      }
    });
  }

  @override
  void dispose() {
    _namespaceController.dispose();
    _nameController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ToolDetailScaffold(
      title: 'UUID / ULID Generator',
      copyText: _latestValue,
      inputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Identifier type', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _kindChip(IdKind.uuidV1, 'UUID v1 (time-based)'),
              _kindChip(IdKind.uuidV3, 'UUID v3 (namespace + MD5)'),
              _kindChip(IdKind.uuidV4, 'UUID v4 (random)'),
              _kindChip(IdKind.uuidV5, 'UUID v5 (namespace + SHA-1)'),
              _kindChip(IdKind.ulid, 'ULID'),
            ],
          ),
          if (_needsNamespaceAndName) ...[
            const SizedBox(height: 16),
            TextField(
              controller: _namespaceController,
              decoration: const InputDecoration(
                labelText: 'Namespace UUID',
                helperText: 'e.g. a DNS/URL/OID/X500 namespace UUID, or any custom UUID',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _nameController,
              decoration: const InputDecoration(
                labelText: 'Name',
                border: OutlineInputBorder(),
              ),
            ),
          ],
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: _generate,
            icon: const Icon(Icons.auto_awesome),
            label: const Text('Generate'),
          ),
          if (_errorText != null) ...[
            const SizedBox(height: 12),
            Text(
              _errorText!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
        ],
      ),
      outputPanel: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Generated value', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          SelectableText(
            _latestValue ?? 'Press Generate to create an identifier',
            style: const TextStyle(fontFamily: 'monospace', fontSize: 16),
          ),
          const SizedBox(height: 24),
          if (_history.isNotEmpty) ...[
            Text('Recent', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            ListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: _history.length,
              itemBuilder: (context, index) {
                final entry = _history[index];
                return ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  leading: SizedBox(
                    width: 40,
                    child: Text(
                      _kindLabel(entry.kind),
                      style: Theme.of(context).textTheme.labelSmall,
                    ),
                  ),
                  title: Text(
                    entry.value,
                    style: const TextStyle(fontFamily: 'monospace'),
                  ),
                );
              },
            ),
          ],
        ],
      ),
    );
  }

  Widget _kindChip(IdKind kind, String label) {
    return ChoiceChip(
      label: Text(label),
      selected: _selectedKind == kind,
      onSelected: (_) => setState(() => _selectedKind = kind),
    );
  }

  String _kindLabel(IdKind kind) {
    switch (kind) {
      case IdKind.uuidV1:
        return 'v1';
      case IdKind.uuidV3:
        return 'v3';
      case IdKind.uuidV4:
        return 'v4';
      case IdKind.uuidV5:
        return 'v5';
      case IdKind.ulid:
        return 'ULID';
    }
  }
}
