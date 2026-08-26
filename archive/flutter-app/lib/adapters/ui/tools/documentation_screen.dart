import 'package:flutter/material.dart';

import '../../../core/cheatsheets/cheatsheet_content.dart';
import 'resource_link_list_view.dart';

/// Official project documentation (Zabbix, Ceph, PostgreSQL, Kubernetes,
/// Linux Kernel, ...) — kept separate from curated "awesome-X" lists and
/// from cheatsheets, since those are different kinds of thing even though
/// all three used to be crammed into one screen. See design.md.
class DocumentationScreen extends StatelessWidget {
  const DocumentationScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final links = kExternalResourceLinks.where((l) => l.type == ResourceType.documentation).toList();

    return Scaffold(
      appBar: AppBar(title: const Text('Documentation')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: ResourceLinkListView(
          description: 'Official documentation for the systems this app targets — the authoritative source, not a '
              'third-party summary.',
          links: links,
        ),
      ),
    );
  }
}
