import 'package:flutter/material.dart';

import '../../../core/cheatsheets/cheatsheet_content.dart';
import 'resource_link_list_view.dart';

/// Curated "awesome-X" style reference lists — collections of links
/// compiled by the community, distinct from official documentation (a
/// single authoritative source) and from cheatsheets (a quick lookup this
/// app generates itself). See design.md.
class ReferenceListsScreen extends StatelessWidget {
  const ReferenceListsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final links = kExternalResourceLinks.where((l) => l.type == ResourceType.curatedList).toList();

    return Scaffold(
      appBar: AppBar(title: const Text('Reference Lists')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: ResourceLinkListView(
          description: 'Curated, community-maintained collections of links — a starting point to browse from, not '
              'a single authoritative doc.',
          links: links,
        ),
      ),
    );
  }
}
