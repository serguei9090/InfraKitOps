import 'dart:io';
import 'dart:typed_data';

/// Real desktop implementation — selected via local_file_access.dart's
/// conditional export whenever dart:io is available.
Future<bool> localFileExists(String path) => File(path).exists();

Future<Uint8List> readLocalFileBytes(String path) async => Uint8List.fromList(await File(path).readAsBytes());

Future<void> writeLocalFileBytes(String path, List<int> bytes) => File(path).writeAsBytes(bytes);
