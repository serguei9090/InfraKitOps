import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/uuid_ulid_generator.dart';

void main() {
  final generator = UuidUlidGenerator();

  final uuidRegex = RegExp(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    caseSensitive: false,
  );
  final ulidRegex = RegExp(r'^[0-9A-HJKMNP-TV-Z]{26}$', caseSensitive: false);

  void expectUuidShape(String value, int expectedVersionNibble) {
    expect(value, matches(uuidRegex));
    // Version nibble is the first character of the third group.
    expect(value.split('-')[2][0], expectedVersionNibble.toRadixString(16));
    // Variant nibble (first char of the fourth group) must be 8, 9, a, or b.
    final variantNibble = value.split('-')[3][0].toLowerCase();
    expect(['8', '9', 'a', 'b'].contains(variantNibble), isTrue);
  }

  group('UUID v1', () {
    test('has correct shape and version nibble', () {
      final result = generator.execute(const UuidUlidInput(kind: IdKind.uuidV1));
      expectUuidShape(result.value, 1);
    });

    test('generates distinct values across calls', () {
      final a = generator.execute(const UuidUlidInput(kind: IdKind.uuidV1));
      final b = generator.execute(const UuidUlidInput(kind: IdKind.uuidV1));
      expect(a.value, isNot(equals(b.value)));
    });
  });

  group('UUID v4', () {
    test('has correct shape and version nibble', () {
      final result = generator.execute(const UuidUlidInput(kind: IdKind.uuidV4));
      expectUuidShape(result.value, 4);
    });

    test('generates distinct values across calls', () {
      final a = generator.execute(const UuidUlidInput(kind: IdKind.uuidV4));
      final b = generator.execute(const UuidUlidInput(kind: IdKind.uuidV4));
      expect(a.value, isNot(equals(b.value)));
    });
  });

  group('UUID v3', () {
    test('has correct shape and version nibble', () {
      final result = generator.execute(
        const UuidUlidInput(
          kind: IdKind.uuidV3,
          namespace: WellKnownNamespace.dns,
          name: 'example.com',
        ),
      );
      expectUuidShape(result.value, 3);
    });

    test('is deterministic for the same namespace and name', () {
      const input = UuidUlidInput(
        kind: IdKind.uuidV3,
        namespace: WellKnownNamespace.dns,
        name: 'example.com',
      );
      final a = generator.execute(input);
      final b = generator.execute(input);
      expect(a.value, equals(b.value));
    });

    test('differs for a different name', () {
      final a = generator.execute(
        const UuidUlidInput(
          kind: IdKind.uuidV3,
          namespace: WellKnownNamespace.dns,
          name: 'example.com',
        ),
      );
      final b = generator.execute(
        const UuidUlidInput(
          kind: IdKind.uuidV3,
          namespace: WellKnownNamespace.dns,
          name: 'other.com',
        ),
      );
      expect(a.value, isNot(equals(b.value)));
    });

    test('throws when namespace or name is missing', () {
      expect(
        () => generator.execute(
          const UuidUlidInput(kind: IdKind.uuidV3, name: 'example.com'),
        ),
        throwsArgumentError,
      );
      expect(
        () => generator.execute(
          const UuidUlidInput(
            kind: IdKind.uuidV3,
            namespace: WellKnownNamespace.dns,
          ),
        ),
        throwsArgumentError,
      );
    });
  });

  group('UUID v5', () {
    test('has correct shape and version nibble', () {
      final result = generator.execute(
        const UuidUlidInput(
          kind: IdKind.uuidV5,
          namespace: WellKnownNamespace.url,
          name: 'https://example.com',
        ),
      );
      expectUuidShape(result.value, 5);
    });

    test('is deterministic for the same namespace and name', () {
      const input = UuidUlidInput(
        kind: IdKind.uuidV5,
        namespace: WellKnownNamespace.url,
        name: 'https://example.com',
      );
      final a = generator.execute(input);
      final b = generator.execute(input);
      expect(a.value, equals(b.value));
    });

    test('throws when namespace or name is missing', () {
      expect(
        () => generator.execute(const UuidUlidInput(kind: IdKind.uuidV5)),
        throwsArgumentError,
      );
    });
  });

  test('v3 and v5 differ for the same namespace and name', () {
    final v3 = generator.execute(
      const UuidUlidInput(
        kind: IdKind.uuidV3,
        namespace: WellKnownNamespace.dns,
        name: 'example.com',
      ),
    );
    final v5 = generator.execute(
      const UuidUlidInput(
        kind: IdKind.uuidV5,
        namespace: WellKnownNamespace.dns,
        name: 'example.com',
      ),
    );
    expect(v3.value, isNot(equals(v5.value)));
  });

  group('ULID', () {
    test('has the correct 26-character Crockford base32 shape', () {
      final result = generator.execute(const UuidUlidInput(kind: IdKind.ulid));
      expect(result.value, matches(ulidRegex));
    });

    test('generates distinct values across calls', () {
      final a = generator.execute(const UuidUlidInput(kind: IdKind.ulid));
      final b = generator.execute(const UuidUlidInput(kind: IdKind.ulid));
      expect(a.value, isNot(equals(b.value)));
    });
  });
}
