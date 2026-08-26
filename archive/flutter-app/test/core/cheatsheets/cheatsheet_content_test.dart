import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/cheatsheets/cheatsheet_content.dart';

void main() {
  group('kCheatsheetPages structural integrity', () {
    test('has at least one page', () {
      expect(kCheatsheetPages, isNotEmpty);
    });

    test('includes the five expected pages by id', () {
      final ids = kCheatsheetPages.map((p) => p.id).toSet();
      expect(ids, containsAll(['git', 'regex', 'sysctl', 'crontab', 'chmod']));
    });

    test('page ids are unique', () {
      final ids = kCheatsheetPages.map((p) => p.id).toList();
      expect(ids.toSet().length, ids.length, reason: 'duplicate page id found: $ids');
    });

    test('every page has a non-empty id, title, and description', () {
      for (final page in kCheatsheetPages) {
        expect(page.id.trim(), isNotEmpty, reason: 'page with title "${page.title}" has an empty id');
        expect(page.title.trim(), isNotEmpty, reason: 'page id "${page.id}" has an empty title');
        expect(page.description.trim(), isNotEmpty, reason: 'page "${page.id}" has an empty description');
      }
    });

    test('every page has at least one section', () {
      for (final page in kCheatsheetPages) {
        expect(page.sections, isNotEmpty, reason: 'page "${page.id}" has no sections');
      }
    });

    test('every section has a non-empty title', () {
      for (final page in kCheatsheetPages) {
        for (final section in page.sections) {
          expect(section.title.trim(), isNotEmpty, reason: 'a section in page "${page.id}" has an empty title');
        }
      }
    });

    test('every section has at least one entry', () {
      for (final page in kCheatsheetPages) {
        for (final section in page.sections) {
          expect(
            section.entries,
            isNotEmpty,
            reason: 'section "${section.title}" in page "${page.id}" has no entries',
          );
        }
      }
    });

    test('every entry has non-empty command, description, and example text', () {
      for (final page in kCheatsheetPages) {
        for (final section in page.sections) {
          for (final entry in section.entries) {
            expect(
              entry.command.trim(),
              isNotEmpty,
              reason: 'an entry in "${page.id}" / "${section.title}" has an empty command',
            );
            expect(
              entry.description.trim(),
              isNotEmpty,
              reason: 'entry "${entry.command}" in "${page.id}" / "${section.title}" has an empty description',
            );
            expect(
              entry.example.trim(),
              isNotEmpty,
              reason: 'entry "${entry.command}" in "${page.id}" / "${section.title}" has an empty example',
            );
          }
        }
      }
    });

    test('each page has a genuinely useful amount of content (at least 8 entries)', () {
      for (final page in kCheatsheetPages) {
        final totalEntries = page.sections.fold<int>(0, (sum, s) => sum + s.entries.length);
        expect(
          totalEntries,
          greaterThanOrEqualTo(8),
          reason: 'page "${page.id}" only has $totalEntries entries total — too thin to be a useful reference',
        );
      }
    });

    test('sysctl page cross-references the real keys used by LinuxSysctlTuner', () {
      final sysctlPage = kCheatsheetPages.firstWhere((p) => p.id == 'sysctl');
      final allCommands = sysctlPage.sections.expand((s) => s.entries).map((e) => e.command).toSet();

      // These are the exact sysctl keys lib/core/tuning/linux_sysctl_tuner.dart
      // writes into its generated config — the cheatsheet must document them
      // with the same spelling, not an invented variant.
      const tunerKeys = [
        'net.core.somaxconn',
        'net.ipv4.tcp_max_syn_backlog',
        'net.ipv4.tcp_tw_reuse',
        'net.core.default_qdisc',
        'net.ipv4.tcp_congestion_control',
        'net.core.rmem_max',
        'net.core.wmem_max',
        'net.ipv4.tcp_rmem',
        'net.ipv4.tcp_wmem',
      ];

      expect(allCommands, containsAll(tunerKeys));
    });
  });

  group('kExternalResourceLinks structural integrity', () {
    test('is not empty', () {
      expect(kExternalResourceLinks, isNotEmpty);
    });

    test('includes references for Zabbix, Ceph, PostgreSQL, Kubernetes, and the Linux Kernel', () {
      final names = kExternalResourceLinks.map((r) => r.name).toSet();
      expect(names, containsAll(['Zabbix', 'Ceph', 'PostgreSQL', 'Kubernetes', 'Linux Kernel']));
    });

    test('every link has a non-empty name, valid-looking https URL, and description', () {
      for (final link in kExternalResourceLinks) {
        expect(link.name.trim(), isNotEmpty);
        expect(link.url.trim(), isNotEmpty);
        expect(link.url, startsWith('https://'), reason: '${link.name} URL should be https');
        expect(Uri.tryParse(link.url), isNotNull, reason: '${link.name} URL "${link.url}" is not a valid URI');
        expect(link.description.trim(), isNotEmpty);
      }
    });

    test('link names are unique', () {
      final names = kExternalResourceLinks.map((r) => r.name).toList();
      expect(names.toSet().length, names.length);
    });

    test('has at least 34 entries (5 original docs links + 29 newly added resources)', () {
      expect(kExternalResourceLinks.length, greaterThanOrEqualTo(34));
    });

    test('every entry has at least one non-empty tag', () {
      for (final link in kExternalResourceLinks) {
        expect(link.tags, isNotEmpty, reason: '${link.name} has no tags');
        for (final tag in link.tags) {
          expect(tag.trim(), isNotEmpty, reason: '${link.name} has a blank tag');
        }
      }
    });

    test('at least one entry exists for every ResourceType', () {
      final typesPresent = kExternalResourceLinks.map((r) => r.type).toSet();
      expect(
        typesPresent,
        containsAll(ResourceType.values),
        reason: 'missing entries for: ${ResourceType.values.toSet().difference(typesPresent)}',
      );
    });
  });
}
