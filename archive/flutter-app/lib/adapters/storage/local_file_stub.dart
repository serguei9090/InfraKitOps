import 'dart:typed_data';

/// Web-safe stub — dart:io isn't available on web, so local file-path
/// access (used by the PDF/image tools' path-field fallback, since no
/// file-picker dependency is installed) simply isn't supported there.
/// Selected via local_file_access.dart's conditional export.
Future<bool> localFileExists(String path) async => false;

Future<Uint8List> readLocalFileBytes(String path) async =>
    throw UnsupportedError('Local file access is desktop-only in this build.');

Future<void> writeLocalFileBytes(String path, List<int> bytes) async =>
    throw UnsupportedError('Local file access is desktop-only in this build.');
