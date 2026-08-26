import 'package:flutter/material.dart';

import '../../../core/cheatsheets/cheatsheet_content.dart';
import 'resource_link_list_view.dart';

/// Hands-on learning material — exercises/practice repos and roadmaps —
/// things you work *through* to build a skill, distinct from reference
/// material you just browse or look up. See design.md.
class StudyPracticeScreen extends StatelessWidget {
  const StudyPracticeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final links = kExternalResourceLinks
        .where((l) => l.type == ResourceType.exercise || l.type == ResourceType.roadmap)
        .toList();

    return Scaffold(
      appBar: AppBar(title: const Text('Study & Practice')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: ResourceLinkListView(
          description: 'Exercises, practice repos, and roadmaps — material meant to be worked through, not just '
              'referenced.',
          links: links,
          groupByType: true,
        ),
      ),
    );
  }
}
