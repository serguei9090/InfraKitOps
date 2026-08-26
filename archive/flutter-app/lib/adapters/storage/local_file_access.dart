/// Facade for the path-field file I/O fallback used by tools that need
/// local file bytes (PDF split/merge/inspect, image converter/EXIF viewer)
/// but have no file-picker dependency installed. Same conditional-import
/// technique as schema_repository_factory.dart / main.dart's serve_stub —
/// desktop gets real dart:io access, web gets a stub that throws
/// UnsupportedError (surfaced as normal inline error text by callers).
library;

export 'local_file_stub.dart' if (dart.library.io) 'local_file_io.dart';
