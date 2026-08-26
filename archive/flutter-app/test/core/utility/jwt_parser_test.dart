import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/jwt_parser.dart';

/// `{"alg":"HS256","typ":"JWT"}`
const headerHs256 = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';

/// `{"alg":"none","typ":"JWT"}` — 35 chars, so base64url padding is missing.
const headerNone = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0';

/// The canonical jwt.io demo payload:
/// `{"sub":"1234567890","name":"John Doe","iat":1516239022}`
const payloadClassic = 'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ';

/// All seven registered claims; `exp` = 1600000000 (2020-09-13T12:26:40Z).
const payloadAllClaims =
    'eyJpc3MiOiJodHRwczovL2F1dGguaW5mcmFraXQudGVzdC8iLCJzdWIiOiJ1c2VyLTQyIiwiYXVkIjoiaW5mcmFraXQt'
    'YXBpIiwiZXhwIjoxNjAwMDAwMDAwLCJuYmYiOjE1MDAwMDAwMDAsImlhdCI6MTUwMDAwMDAwMCwianRpIjoiYWJjLTEyMyJ9';

/// `exp` = 4102444800 (2100-01-01T00:00:00Z).
const payloadFarFuture =
    'eyJpc3MiOiJodHRwczovL2F1dGguaW5mcmFraXQudGVzdC8iLCJzdWIiOiJ1c2VyLTQyIiwiZXhwIjo0MTAyNDQ0ODAwLCJpYXQiOjE1MDAwMDAwMDB9';

/// `{"sub":"early","nbf":4102444800,"exp":4102531200}`
const payloadNotYetValid = 'eyJzdWIiOiJlYXJseSIsIm5iZiI6NDEwMjQ0NDgwMCwiZXhwIjo0MTAyNTMxMjAwfQ';

/// `[1,2,3]` — valid base64url, valid JSON, but not a JSON *object*.
const payloadJsonArray = 'WzEsMiwzXQ';

const signature = 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

/// A fixed "now" so expiry assertions never depend on the wall clock.
final now = DateTime.utc(2024, 6, 1, 12);

JwtParseResult parse(String token) =>
    const JwtParser().execute(JwtParseInput(token: token, now: now));

void main() {
  group('decoding a known token', () {
    final result = parse('$headerHs256.$payloadClassic.$signature');

    test('reports a structurally valid token', () {
      expect(result.isValidStructure, isTrue);
      expect(result.errorMessage, isNull);
      expect(result.segmentCount, 3);
    });

    test('decodes the header to the expected map', () {
      expect(result.header, {'alg': 'HS256', 'typ': 'JWT'});
      expect(result.algorithm, 'HS256');
      expect(result.tokenType, 'JWT');
      expect(result.keyId, isNull);
    });

    test('decodes the payload to the expected map', () {
      expect(result.payload, {'sub': '1234567890', 'name': 'John Doe', 'iat': 1516239022});
    });

    test('pretty-prints both segments as indented JSON', () {
      expect(result.headerJson, contains('"alg": "HS256"'));
      expect(result.payloadJson, contains('"sub": "1234567890"'));
      expect(result.payloadJson, contains('\n'));
    });

    test('keeps the signature segment intact but does not verify it', () {
      expect(result.signatureBase64Url, signature);
      expect(result.signatureVerified, isFalse);
    });

    test('converts iat to a real DateTime', () {
      expect(result.issuedAt, DateTime.utc(2018, 1, 18, 1, 30, 22));
    });

    test('tolerates a Bearer prefix and wrapped whitespace', () {
      final prefixed = parse('  Bearer $headerHs256.\n$payloadClassic.\n$signature  ');
      expect(prefixed.isValidStructure, isTrue);
      expect(prefixed.payload['sub'], '1234567890');
    });
  });

  group('base64url without padding', () {
    test('decodes a 35-character segment that needs one "=" restored', () {
      // headerNone.length % 4 == 3, so the raw string is not valid base64.
      expect(headerNone.length % 4, 3);
      final result = parse('$headerNone.$payloadClassic.');
      expect(result.isValidStructure, isTrue);
      expect(result.header['alg'], 'none');
    });

    test('decodeBase64Url restores padding directly', () {
      // "eyJhIjoxfQ" is `{"a":1}` with the padding stripped.
      expect(String.fromCharCodes(JwtParser.decodeBase64Url('eyJhIjoxfQ')), '{"a":1}');
    });

    test('decodes base64url -/_ characters, not just +/', () {
      final decoded = JwtParser.decodeBase64Url('-_-_');
      expect(decoded, [251, 255, 191]);
    });
  });

  group('registered claims', () {
    final result = parse('$headerHs256.$payloadAllClaims.$signature');

    test('surfaces all seven in canonical order', () {
      expect(
        result.registeredClaims.map((c) => c.name).toList(),
        ['iss', 'sub', 'aud', 'exp', 'nbf', 'iat', 'jti'],
      );
    });

    test('each carries a human-readable label and meaning', () {
      for (final claim in result.registeredClaims) {
        expect(claim.label, isNotEmpty);
        expect(claim.meaning, isNotEmpty);
      }
      final exp = result.registeredClaims.firstWhere((c) => c.name == 'exp');
      expect(exp.label, 'Expires at');
      expect(exp.meaning, contains('accept'));
    });

    test('NumericDate claims become DateTimes and display as ISO-8601 UTC', () {
      final exp = result.registeredClaims.firstWhere((c) => c.name == 'exp');
      expect(exp.dateTime, DateTime.utc(2020, 9, 13, 12, 26, 40));
      expect(exp.displayValue, '2020-09-13T12:26:40Z UTC');
      expect(exp.rawValue, 1600000000);
    });

    test('non-date claims keep their raw string value', () {
      final iss = result.registeredClaims.firstWhere((c) => c.name == 'iss');
      expect(iss.dateTime, isNull);
      expect(iss.displayValue, 'https://auth.infrakit.test/');
    });

    test('claims that are absent are not invented', () {
      final classic = parse('$headerHs256.$payloadClassic.$signature');
      expect(classic.registeredClaims.map((c) => c.name), ['sub', 'iat']);
    });
  });

  group('expiry detection', () {
    test('an exp in the past is reported as expired with a negative remainder', () {
      final result = parse('$headerHs256.$payloadAllClaims.$signature');
      expect(result.temporalStatus, JwtTemporalStatus.expired);
      expect(result.isExpired, isTrue);
      expect(result.expiresAt, DateTime.utc(2020, 9, 13, 12, 26, 40));
      expect(result.timeUntilExpiry!.isNegative, isTrue);
    });

    test('an exp in the future is still valid with a positive remainder', () {
      final result = parse('$headerHs256.$payloadFarFuture.$signature');
      expect(result.temporalStatus, JwtTemporalStatus.valid);
      expect(result.isExpired, isFalse);
      expect(result.expiresAt, DateTime.utc(2100));
      expect(result.timeUntilExpiry!.isNegative, isFalse);
      expect(result.timeUntilExpiry!.inDays, greaterThan(27000));
    });

    test('an nbf in the future is reported as not-yet-valid', () {
      final result = parse('$headerHs256.$payloadNotYetValid.$signature');
      expect(result.temporalStatus, JwtTemporalStatus.notYetValid);
      expect(result.isNotYetValid, isTrue);
      expect(result.timeUntilValid, isNotNull);
      expect(result.timeUntilValid!.isNegative, isFalse);
    });

    test('a token with no time claims at all is not called expired', () {
      final result = parse('$headerHs256.$payloadClassic.$signature');
      expect(result.temporalStatus, JwtTemporalStatus.valid);
      expect(result.expiresAt, isNull);
      expect(result.timeUntilExpiry, isNull);
    });

    test('exp exactly at "now" counts as expired', () {
      final at = DateTime.utc(2020, 9, 13, 12, 26, 40);
      final result = const JwtParser().execute(
        JwtParseInput(token: '$headerHs256.$payloadAllClaims.$signature', now: at),
      );
      expect(result.temporalStatus, JwtTemporalStatus.expired);
    });

    test('formatJwtDuration renders a readable countdown', () {
      expect(formatJwtDuration(const Duration(seconds: 45)), '45s');
      expect(formatJwtDuration(const Duration(minutes: 90)), '1h 30m');
      expect(formatJwtDuration(const Duration(days: 2, hours: 3)), '2d 3h');
      expect(formatJwtDuration(const Duration(days: -2)), '2d');
    });
  });

  group('alg: none is flagged', () {
    test('an unsecured JWT with an empty signature is flagged', () {
      final result = parse('$headerNone.$payloadClassic.');
      expect(result.isValidStructure, isTrue);
      expect(result.algorithm, 'none');
      expect(result.isUnsignedAlgorithm, isTrue);
    });

    test('alg "NONE" in any casing is flagged', () {
      // {"alg":"None"} base64url-encoded.
      const mixedCase = 'eyJhbGciOiJOb25lIn0';
      final result = parse('$mixedCase.$payloadClassic.');
      expect(result.isUnsignedAlgorithm, isTrue);
    });

    test('a missing third segment counts as unsigned', () {
      final result = parse('$headerHs256.$payloadClassic');
      expect(result.isValidStructure, isTrue);
      expect(result.segmentCount, 2);
      expect(result.isUnsignedAlgorithm, isTrue);
    });

    test('a normal HS256 token is not flagged', () {
      final result = parse('$headerHs256.$payloadClassic.$signature');
      expect(result.isUnsignedAlgorithm, isFalse);
    });
  });

  group('signature is never verified', () {
    test('signatureVerified is false even for a well-formed token', () {
      expect(parse('$headerHs256.$payloadClassic.$signature').signatureVerified, isFalse);
    });

    test('the notice says so plainly', () {
      expect(JwtParseResult.signatureNotice, contains('NOT verified'));
      expect(JwtParseResult.signatureNotice, contains('only decodes'));
      expect(JwtParseResult.signatureNotice.toLowerCase(), contains('forged'));
    });
  });

  group('malformed input errors cleanly, never throws', () {
    void expectsFailure(String token, {String? containing}) {
      final result = parse(token);
      expect(result.isValidStructure, isFalse, reason: 'expected failure for "$token"');
      expect(result.errorMessage, isNotNull);
      expect(result.errorMessage, isNotEmpty);
      if (containing != null) expect(result.errorMessage, contains(containing));
    }

    test('empty input', () => expectsFailure('', containing: 'Enter a JWT'));
    test('whitespace only', () => expectsFailure('   \n  '));

    test('one segment', () => expectsFailure('notajwt', containing: '3 dot-separated'));

    test('four segments', () {
      expectsFailure('$headerHs256.$payloadClassic.$signature.extra', containing: '3 dot-separated');
    });

    test('empty header segment', () => expectsFailure('.$payloadClassic.$signature'));

    test('bad base64 in the header', () {
      expectsFailure('!!!not-base64!!!.$payloadClassic.$signature', containing: 'base64url');
    });

    test('bad base64 in the payload', () {
      expectsFailure('$headerHs256.!!!nope!!!.$signature', containing: 'base64url');
    });

    test('valid base64 that is not JSON', () {
      // "aGVsbG8gd29ybGQ" is "hello world".
      expectsFailure('aGVsbG8gd29ybGQ.$payloadClassic.$signature', containing: 'not valid JSON');
    });

    test('JSON that is not an object', () {
      expectsFailure('$headerHs256.$payloadJsonArray.$signature', containing: 'must be a JSON object');
    });

    test('failures carry no half-populated decoded data', () {
      final result = parse('nope');
      expect(result.header, isEmpty);
      expect(result.payload, isEmpty);
      expect(result.registeredClaims, isEmpty);
      expect(result.headerJson, '');
      expect(result.signatureVerified, isFalse);
    });
  });
}
