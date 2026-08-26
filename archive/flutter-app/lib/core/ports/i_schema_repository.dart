/// Outbound port: persistence for user-saved FormFlow schemas/templates.
abstract interface class ISchemaRepository {
  Future<List<String>> listNames();

  Future<String?> load(String name);

  Future<void> save(String name, String schemaJson);

  Future<void> delete(String name);
}
