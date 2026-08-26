import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as crypto;
import 'package:ulid/ulid.dart';
import 'package:uuid/uuid.dart';

import '../ports/i_tool_use_case.dart';

/// Supported identifier kinds this generator can produce.
enum IdKind {
  /// RFC 4122 version 1: time-based (timestamp + clock sequence + node id).
  uuidV1,

  /// RFC 4122 version 3: namespace + name, hashed with MD5. Deterministic --
  /// the same namespace and name always produce the same UUID.
  uuidV3,

  /// RFC 4122 version 4: cryptographically random.
  uuidV4,

  /// RFC 4122 version 5: namespace + name, hashed with SHA-1. Deterministic --
  /// the same namespace and name always produce the same UUID.
  uuidV5,

  /// Universally Unique Lexicographically Sortable Identifier: a 48-bit
  /// millisecond timestamp plus 80 random bits, Crockford base32 encoded.
  ulid,
}

/// Well-known RFC 4122 namespace UUIDs, usable as [UuidUlidInput.namespace]
/// for v3/v5 generation. Callers may also supply any other valid UUID string
/// as a custom namespace.
class WellKnownNamespace {
  const WellKnownNamespace._();

  static const String dns = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  static const String url = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
  static const String oid = '6ba7b812-9dad-11d1-80b4-00c04fd430c8';
  static const String x500 = '6ba7b814-9dad-11d1-80b4-00c04fd430c8';
}

class UuidUlidInput {
  const UuidUlidInput({required this.kind, this.namespace, this.name});

  final IdKind kind;

  /// Required for [IdKind.uuidV3] and [IdKind.uuidV5]: the namespace UUID
  /// string (see [WellKnownNamespace] for the RFC-provided ones).
  final String? namespace;

  /// Required for [IdKind.uuidV3] and [IdKind.uuidV5]: the name to hash.
  final String? name;
}

class UuidUlidResult {
  const UuidUlidResult({required this.kind, required this.value});

  final IdKind kind;
  final String value;
}

/// Generates UUIDs (v1/v3/v4/v5) and ULIDs.
///
/// Pure Dart: built on the `uuid` and `ulid` packages, plus `crypto`'s MD5 for
/// v3. Note that the `uuid` package (4.x) dropped its own v3 implementation
/// (it only ships v1/v4/v5/v6/v7/v8), so v3 is implemented here directly,
/// mirroring the exact byte construction the package uses for v5 -- namespace
/// bytes concatenated with the UTF-8 name, hashed, then version/variant bits
/// patched into the digest -- substituting MD5 for SHA-1 per the v3 spec.
class UuidUlidGenerator
    implements IToolUseCase<UuidUlidInput, UuidUlidResult> {
  UuidUlidGenerator({Uuid? uuid}) : _uuid = uuid ?? const Uuid();

  final Uuid _uuid;

  @override
  UuidUlidResult execute(UuidUlidInput input) {
    switch (input.kind) {
      case IdKind.uuidV1:
        return UuidUlidResult(kind: input.kind, value: _uuid.v1());
      case IdKind.uuidV4:
        return UuidUlidResult(kind: input.kind, value: _uuid.v4());
      case IdKind.uuidV5:
        _requireNamespaceAndName(input);
        return UuidUlidResult(
          kind: input.kind,
          value: _uuid.v5(input.namespace, input.name),
        );
      case IdKind.uuidV3:
        _requireNamespaceAndName(input);
        return UuidUlidResult(
          kind: input.kind,
          value: _generateV3(input.namespace!, input.name!),
        );
      case IdKind.ulid:
        return UuidUlidResult(kind: input.kind, value: Ulid().toCanonical());
    }
  }

  void _requireNamespaceAndName(UuidUlidInput input) {
    if (input.namespace == null || input.namespace!.isEmpty) {
      throw ArgumentError('namespace is required for ${input.kind}');
    }
    if (input.name == null || input.name!.isEmpty) {
      throw ArgumentError('name is required for ${input.kind}');
    }
    if (!Uuid.isValidUUID(fromString: input.namespace!)) {
      throw ArgumentError('namespace must be a valid UUID string');
    }
  }

  /// RFC 4122 version 3: MD5(namespace bytes ++ UTF-8 name bytes), with the
  /// version nibble set to 3 and the variant bits set to RFC4122 (10xx).
  String _generateV3(String namespace, String name) {
    final namespaceBytes = Uuid.parse(namespace);
    final nameBytes = utf8.encode(name);
    final digest =
        crypto.md5.convert([...namespaceBytes, ...nameBytes]).bytes;

    final bytes = Uint8List.fromList(digest.sublist(0, 16));
    bytes[6] = (bytes[6] & 0x0f) | 0x30; // version 3
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant RFC4122

    return Uuid.unparse(bytes);
  }
}
