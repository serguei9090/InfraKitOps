/// Outbound port: generic key/value persistence for user settings and
/// favorites. Web adapter backs this with LocalStorage/IndexedDB, desktop
/// adapter backs this with the native file system.
abstract interface class IStoragePort {
  Future<String?> read(String key);

  Future<void> write(String key, String value);

  Future<void> delete(String key);
}
