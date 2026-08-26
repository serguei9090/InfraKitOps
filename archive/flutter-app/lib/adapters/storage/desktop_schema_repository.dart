import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../../core/ports/i_schema_repository.dart';

/// Desktop/native [ISchemaRepository] backed by the filesystem: each saved
/// template is written as its own `<name>.json` file inside a
/// `formflow_templates/` subfolder of the platform's application-support
/// directory (see `getApplicationSupportDirectory()`), creating that
/// subfolder on first use if it doesn't already exist.
class DesktopSchemaRepository implements ISchemaRepository {
  DesktopSchemaRepository();

  static const String _subfolder = 'formflow_templates';

  Future<Directory> _templatesDir() async {
    final supportDir = await getApplicationSupportDirectory();
    final dir = Directory(
      '${supportDir.path}${Platform.pathSeparator}$_subfolder',
    );
    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }
    return dir;
  }

  /// Validates that [name] is safe to use as a bare filename component, so
  /// it can never be used to escape the templates directory (e.g. via a
  /// parent-directory segment or an embedded path separator). [name] is
  /// user-supplied, so this is treated as untrusted input rather than
  /// merely rejecting obviously-malformed names. Throws [ArgumentError]
  /// when invalid.
  String _sanitize(String name) {
    if (name.isEmpty) {
      throw ArgumentError.value(
        name,
        'name',
        'Template name must not be empty',
      );
    }
    if (name.trim() != name) {
      throw ArgumentError.value(
        name,
        'name',
        'Template name must not have leading/trailing whitespace',
      );
    }
    final hasParentSegment = name.split(RegExp(r'[\\/]')).contains('..');
    final hasSeparator = name.contains('/') || name.contains('\\');
    final hasDriveMarker = name.contains(':');
    if (hasParentSegment || hasSeparator || hasDriveMarker) {
      throw ArgumentError.value(
        name,
        'name',
        'Template name must not contain path separators or parent-directory segments',
      );
    }
    return name;
  }

  File _fileFor(Directory dir, String safeName) =>
      File('${dir.path}${Platform.pathSeparator}$safeName.json');

  @override
  Future<List<String>> listNames() async {
    final dir = await _templatesDir();
    final names = <String>[];
    await for (final entry in dir.list()) {
      if (entry is File && entry.path.endsWith('.json')) {
        final fileName = entry.uri.pathSegments.last;
        names.add(fileName.substring(0, fileName.length - '.json'.length));
      }
    }
    names.sort();
    return names;
  }

  @override
  Future<String?> load(String name) async {
    final safeName = _sanitize(name);
    final dir = await _templatesDir();
    final file = _fileFor(dir, safeName);
    if (!await file.exists()) {
      return null;
    }
    return file.readAsString();
  }

  @override
  Future<void> save(String name, String schemaJson) async {
    final safeName = _sanitize(name);
    final dir = await _templatesDir();
    final file = _fileFor(dir, safeName);
    await file.writeAsString(schemaJson);
  }

  @override
  Future<void> delete(String name) async {
    final safeName = _sanitize(name);
    final dir = await _templatesDir();
    final file = _fileFor(dir, safeName);
    if (await file.exists()) {
      await file.delete();
    }
  }
}

/// Platform factory entrypoint for the `dart.library.io` branch of the
/// conditional import in schema_repository_factory.dart — this file is only
/// ever selected on platforms where `dart:io` (and thus this repository) is
/// actually usable.
ISchemaRepository createPlatformSchemaRepository() =>
    DesktopSchemaRepository();
