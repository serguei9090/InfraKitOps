import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../../core/ports/i_schema_repository.dart';

/// Web [ISchemaRepository] backed by `shared_preferences` (LocalStorage on
/// web). `shared_preferences` only offers flat key-value storage, so this
/// adapter keeps its own index alongside the data: [_namesKey] holds a
/// JSON-encoded list of every saved template name, and each template's JSON
/// is stored under its own `formflow_template_<name>` key. `save`/`delete`
/// keep the index and the per-template keys in sync.
///
/// Note: this adapter isn't covered by `flutter test`, which runs on the
/// Dart VM and has no real browser LocalStorage backing `shared_preferences`
/// — it's exercised via the running web app instead.
class WebSchemaRepository implements ISchemaRepository {
  WebSchemaRepository();

  static const String _namesKey = 'formflow_template_names';

  String _templateKey(String name) => 'formflow_template_$name';

  Future<List<String>> _readNames(SharedPreferences prefs) async {
    final raw = prefs.getString(_namesKey);
    if (raw == null) return [];
    final decoded = jsonDecode(raw) as List<Object?>;
    return decoded.cast<String>();
  }

  Future<void> _writeNames(SharedPreferences prefs, List<String> names) =>
      prefs.setString(_namesKey, jsonEncode(names));

  @override
  Future<List<String>> listNames() async {
    final prefs = await SharedPreferences.getInstance();
    final names = await _readNames(prefs);
    return names..sort();
  }

  @override
  Future<String?> load(String name) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_templateKey(name));
  }

  @override
  Future<void> save(String name, String schemaJson) async {
    final prefs = await SharedPreferences.getInstance();
    final names = await _readNames(prefs);
    if (!names.contains(name)) {
      names.add(name);
      await _writeNames(prefs, names);
    }
    await prefs.setString(_templateKey(name), schemaJson);
  }

  @override
  Future<void> delete(String name) async {
    final prefs = await SharedPreferences.getInstance();
    final names = await _readNames(prefs);
    if (names.remove(name)) {
      await _writeNames(prefs, names);
    }
    await prefs.remove(_templateKey(name));
  }
}
