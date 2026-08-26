import 'dart:convert';
import 'dart:typed_data';

import '../ports/i_tool_use_case.dart';

/// How the Base64 payload should be presented once a file has been encoded.
///
/// The existing `Base64Converter` is UTF-8 *text* only — it round-trips a
/// string through `utf8.encode`/`utf8.decode`, which destroys any byte that
/// is not valid UTF-8. This file covers the binary case instead.
enum Base64Wrapping {
  /// Just the Base64 characters.
  plain('Plain Base64'),

  /// `data:<mime>;base64,<payload>` — what you paste into CSS/HTML/JSON.
  dataUri('Data URI'),

  /// A ready-to-apply `v1/Secret` manifest with the payload as a `data:`
  /// value. Kubernetes requires `data:` values to be single-line Base64,
  /// which is exactly what [Base64FileEncoder] emits by default.
  k8sSecret('Kubernetes Secret');

  const Base64Wrapping(this.label);

  final String label;
}

class Base64FileEncodeInput {
  const Base64FileEncodeInput({
    required this.bytes,
    this.wrapping = Base64Wrapping.plain,
    this.mimeType,
    this.secretName = 'my-secret',
    this.secretKey = 'file',
    this.lineLength,
  });

  final Uint8List bytes;
  final Base64Wrapping wrapping;

  /// MIME type used by [Base64Wrapping.dataUri]. Defaults to
  /// `application/octet-stream` when null.
  final String? mimeType;

  /// `metadata.name` for [Base64Wrapping.k8sSecret].
  final String secretName;

  /// Key under `data:` for [Base64Wrapping.k8sSecret].
  final String secretKey;

  /// Wrap the Base64 at this column (e.g. 76 for MIME style). Null keeps it
  /// on one line, which is what data URIs and k8s secrets require — so this
  /// is ignored for those wrappings.
  final int? lineLength;
}

class Base64FileEncodeResult {
  const Base64FileEncodeResult({
    required this.output,
    required this.base64,
    required this.byteSize,
  });

  /// The text to show/copy, including any wrapping.
  final String output;

  /// The bare single-line Base64 payload, wrapping aside.
  final String base64;

  /// Size of the source bytes.
  final int byteSize;

  /// Length of the bare Base64 payload — roughly 4/3 of [byteSize], which is
  /// the overhead people are usually checking for.
  int get encodedLength => base64.length;
}

class Base64FileDecodeInput {
  const Base64FileDecodeInput({required this.text});

  /// Plain Base64, a data URI, or Base64 pasted with line breaks. The
  /// URL-safe alphabet and missing `=` padding are both tolerated.
  final String text;
}

class Base64FileDecodeResult {
  const Base64FileDecodeResult({required this.bytes, this.mimeType});

  final Uint8List bytes;

  /// MIME type recovered from a data URI prefix, if there was one.
  final String? mimeType;

  int get byteSize => bytes.length;
}

/// Encodes arbitrary file bytes to Base64, optionally wrapped as a data URI
/// or a Kubernetes Secret manifest.
class Base64FileEncoder implements IToolUseCase<Base64FileEncodeInput, Base64FileEncodeResult> {
  const Base64FileEncoder();

  @override
  Base64FileEncodeResult execute(Base64FileEncodeInput input) {
    if (input.bytes.isEmpty) {
      throw ArgumentError('Input is empty');
    }
    if (input.lineLength != null && input.lineLength! < 4) {
      throw ArgumentError('Line length must be at least 4');
    }

    final encoded = base64Encode(input.bytes);

    final String output;
    switch (input.wrapping) {
      case Base64Wrapping.plain:
        output = input.lineLength == null ? encoded : _wrapLines(encoded, input.lineLength!);
      case Base64Wrapping.dataUri:
        output = 'data:${input.mimeType ?? 'application/octet-stream'};base64,$encoded';
      case Base64Wrapping.k8sSecret:
        output = _k8sSecret(encoded, input.secretName, input.secretKey);
    }

    return Base64FileEncodeResult(output: output, base64: encoded, byteSize: input.bytes.length);
  }

  static String _wrapLines(String text, int width) {
    final buffer = StringBuffer();
    for (var i = 0; i < text.length; i += width) {
      if (i > 0) buffer.write('\n');
      buffer.write(text.substring(i, i + width > text.length ? text.length : i + width));
    }
    return buffer.toString();
  }

  static String _k8sSecret(String payload, String name, String key) {
    final safeName = _sanitizeK8sName(name);
    final safeKey = _sanitizeK8sKey(key);
    return 'apiVersion: v1\n'
        'kind: Secret\n'
        'metadata:\n'
        '  name: $safeName\n'
        'type: Opaque\n'
        'data:\n'
        '  $safeKey: $payload\n';
  }

  /// RFC 1123 subdomain, which is what `metadata.name` must be.
  static String _sanitizeK8sName(String name) {
    var s = name.toLowerCase().replaceAll(RegExp(r'[^a-z0-9.-]'), '-');
    s = s.replaceAll(RegExp(r'^[^a-z0-9]+|[^a-z0-9]+$'), '');
    return s.isEmpty ? 'my-secret' : s;
  }

  /// Secret `data:` keys allow alphanumerics, `-`, `_` and `.`.
  static String _sanitizeK8sKey(String key) {
    final s = key.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '-');
    return s.isEmpty ? 'file' : s;
  }
}

/// Decodes Base64 (plain, wrapped, URL-safe or data-URI) back into the
/// original file bytes.
class Base64FileDecoder implements IToolUseCase<Base64FileDecodeInput, Base64FileDecodeResult> {
  const Base64FileDecoder();

  static final RegExp _dataUri = RegExp(r'^data:([^;,]*)((?:;[^;,]*)*);base64,', caseSensitive: false);

  @override
  Base64FileDecodeResult execute(Base64FileDecodeInput input) {
    var text = input.text.trim();
    if (text.isEmpty) {
      throw ArgumentError('Input is empty');
    }

    String? mimeType;
    final match = _dataUri.firstMatch(text);
    if (match != null) {
      final declared = match.group(1)?.trim();
      mimeType = declared == null || declared.isEmpty ? 'text/plain' : declared;
      text = text.substring(match.end);
    } else if (text.toLowerCase().startsWith('data:')) {
      throw const FormatException(
        'That looks like a data URI but it is not Base64-encoded (no ";base64," marker).',
      );
    }

    final bytes = decodeToBytes(text);
    return Base64FileDecodeResult(bytes: bytes, mimeType: mimeType);
  }

  /// Bare Base64 → bytes, tolerating whitespace/newlines, the URL-safe
  /// alphabet (`-_`) and missing `=` padding.
  static Uint8List decodeToBytes(String text) {
    final cleaned = text.replaceAll(RegExp(r'\s'), '').replaceAll('-', '+').replaceAll('_', '/');
    if (cleaned.isEmpty) {
      throw ArgumentError('Input is empty');
    }
    final padded =
        cleaned.length % 4 == 0 ? cleaned : cleaned.padRight(cleaned.length + (4 - cleaned.length % 4), '=');
    try {
      return base64Decode(padded);
    } on FormatException catch (e) {
      throw FormatException('Invalid Base64 input: ${e.message}');
    }
  }
}

/// Filename-extension → MIME type lookup, so the data-URI wrapping can be
/// filled in automatically for a dropped file instead of always saying
/// `application/octet-stream`.
String guessMimeType(String fileName) {
  final dot = fileName.lastIndexOf('.');
  if (dot < 0 || dot == fileName.length - 1) return 'application/octet-stream';
  final extension = fileName.substring(dot + 1).toLowerCase();
  return const {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'bmp': 'image/bmp',
    'svg': 'image/svg+xml',
    'ico': 'image/x-icon',
    'tif': 'image/tiff',
    'tiff': 'image/tiff',
    'pdf': 'application/pdf',
    'json': 'application/json',
    'yaml': 'application/yaml',
    'yml': 'application/yaml',
    'xml': 'application/xml',
    'zip': 'application/zip',
    'gz': 'application/gzip',
    'tar': 'application/x-tar',
    'txt': 'text/plain',
    'md': 'text/markdown',
    'csv': 'text/csv',
    'html': 'text/html',
    'htm': 'text/html',
    'css': 'text/css',
    'js': 'text/javascript',
    'crt': 'application/x-x509-ca-cert',
    'pem': 'application/x-pem-file',
    'key': 'application/x-pem-file',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    'ttf': 'font/ttf',
    'otf': 'font/otf',
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'mp4': 'video/mp4',
    'webm': 'video/webm',
  }[extension] ??
      'application/octet-stream';
}

/// Best-effort extension for a MIME type recovered from a data URI, used to
/// suggest a filename in the Save-As dialog.
String extensionForMimeType(String? mimeType) {
  if (mimeType == null) return 'bin';
  final normalized = mimeType.toLowerCase().trim();
  const known = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'image/x-icon': 'ico',
    'image/tiff': 'tif',
    'application/pdf': 'pdf',
    'application/json': 'json',
    'application/yaml': 'yaml',
    'application/xml': 'xml',
    'application/zip': 'zip',
    'application/gzip': 'gz',
    'application/x-tar': 'tar',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'text/csv': 'csv',
    'text/html': 'html',
    'text/css': 'css',
    'text/javascript': 'js',
    'font/woff': 'woff',
    'font/woff2': 'woff2',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  };
  return known[normalized] ?? 'bin';
}
