// path_provider_platform_interface and plugin_platform_interface are
// transitive deps (pulled in by path_provider, already in pubspec.yaml) used
// here only to fake the app-support directory for this test; not worth
// promoting to direct dependencies for one test file.
// ignore_for_file: depend_on_referenced_packages
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/adapters/storage/desktop_schema_repository.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';

/// Fake `path_provider` backend that points `getApplicationSupportDirectory`
/// at a temp directory instead of the real OS-specific app-support folder,
/// so [DesktopSchemaRepository] can be exercised against real `dart:io`
/// file access under `flutter test` without touching the real filesystem
/// location.
class _FakePathProviderPlatform extends PathProviderPlatform
    with MockPlatformInterfaceMixin {
  _FakePathProviderPlatform(this._supportPath);

  final String _supportPath;

  @override
  Future<String?> getApplicationSupportPath() async => _supportPath;
}

void main() {
  late Directory tempDir;
  late DesktopSchemaRepository repository;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('formflow_repo_test_');
    PathProviderPlatform.instance = _FakePathProviderPlatform(tempDir.path);
    repository = DesktopSchemaRepository();
  });

  tearDown(() async {
    if (await tempDir.exists()) {
      await tempDir.delete(recursive: true);
    }
  });

  group('DesktopSchemaRepository', () {
    test('listNames returns empty list when no templates saved', () async {
      expect(await repository.listNames(), isEmpty);
    });

    test('save then load round-trips the exact JSON content', () async {
      const json = '{"name":"my-template","schema":{"format":"json"}}';

      await repository.save('my-template', json);
      final loaded = await repository.load('my-template');

      expect(loaded, equals(json));
    });

    test('save writes into a formflow_templates subfolder', () async {
      await repository.save('demo', '{"a":1}');

      final expectedFile = File(
        '${tempDir.path}${Platform.pathSeparator}formflow_templates'
        '${Platform.pathSeparator}demo.json',
      );
      expect(await expectedFile.exists(), isTrue);
      expect(await expectedFile.readAsString(), '{"a":1}');
    });

    test('listNames lists saved template names without .json extension', () async {
      await repository.save('alpha', '{}');
      await repository.save('beta', '{}');

      final names = await repository.listNames();

      expect(names, containsAll(['alpha', 'beta']));
      expect(names.every((n) => !n.endsWith('.json')), isTrue);
    });

    test('load returns null for a name that was never saved', () async {
      expect(await repository.load('does-not-exist'), isNull);
    });

    test('delete removes a saved template so load returns null', () async {
      await repository.save('to-delete', '{"x":true}');
      expect(await repository.load('to-delete'), isNotNull);

      await repository.delete('to-delete');

      expect(await repository.load('to-delete'), isNull);
      expect(await repository.listNames(), isNot(contains('to-delete')));
    });

    test('delete on a nonexistent name is a no-op, not an error', () async {
      await repository.delete('never-existed');
      expect(await repository.listNames(), isEmpty);
    });

    test('save overwrites an existing template with the same name', () async {
      await repository.save('overwrite-me', '{"v":1}');
      await repository.save('overwrite-me', '{"v":2}');

      expect(await repository.load('overwrite-me'), '{"v":2}');
      expect(await repository.listNames(), ['overwrite-me']);
    });

    group('path traversal protection', () {
      test('rejects a name containing ".."', () async {
        expect(
          () => repository.save('../escape', '{}'),
          throwsArgumentError,
        );
      });

      test('rejects a name containing a forward slash', () async {
        expect(
          () => repository.save('sub/name', '{}'),
          throwsArgumentError,
        );
      });

      test('rejects a name containing a backslash', () async {
        expect(
          () => repository.save('sub\\name', '{}'),
          throwsArgumentError,
        );
      });

      test('rejects an empty name', () async {
        expect(() => repository.save('', '{}'), throwsArgumentError);
      });

      test('load also rejects a traversal name rather than reading outside '
          'the templates directory', () async {
        // Plant a file one level above the templates directory to prove a
        // successful traversal would have been able to read it.
        final secretFile = File(
          '${tempDir.path}${Platform.pathSeparator}secret.json',
        );
        await secretFile.writeAsString('{"leaked":true}');

        expect(
          () => repository.load('../secret'),
          throwsArgumentError,
        );
      });

      test('delete also rejects a traversal name', () async {
        expect(
          () => repository.delete('../../etc/passwd'),
          throwsArgumentError,
        );
      });
    });
  });
}
