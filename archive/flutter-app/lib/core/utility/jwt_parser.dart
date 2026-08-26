import 'dart:convert';

import '../ports/i_tool_use_case.dart';

/// The three segments of a JWS Compact Serialization token.
enum JwtSegment { header, payload, signature }

/// Where a token sits relative to its `nbf`/`exp` claims *right now*.
enum JwtTemporalStatus {
  /// Currently inside the validity window (or no time claims at all).
  valid,

  /// `exp` is in the past.
  expired,

  /// `nbf` is in the future.
  notYetValid,
}

/// One registered ("reserved") claim from RFC 7519 section 4.1, paired with
/// the human-readable meaning most people open a JWT debugger to look up.
class JwtRegisteredClaim {
  const JwtRegisteredClaim({
    required this.name,
    required this.label,
    required this.meaning,
    required this.rawValue,
    required this.displayValue,
    this.dateTime,
  });

  /// The claim key as it appears in the payload, e.g. `exp`.
  final String name;

  /// Short human name, e.g. "Expires at".
  final String label;

  /// One-line explanation of what the claim is for.
  final String meaning;

  /// The value exactly as decoded from JSON.
  final Object? rawValue;

  /// Presentation string — for NumericDate claims this is the ISO-8601 UTC
  /// timestamp rather than the raw epoch seconds.
  final String displayValue;

  /// Non-null only for the NumericDate claims (`exp`, `nbf`, `iat`), and only
  /// when the raw value was actually numeric. Always UTC.
  final DateTime? dateTime;
}

class JwtParseInput {
  const JwtParseInput({required this.token, this.now});

  /// The raw compact-serialization token, e.g. `eyJ...` — surrounding
  /// whitespace and a leading `Bearer ` prefix are tolerated.
  final String token;

  /// Reference instant for expiry math. Defaults to [DateTime.now] at parse
  /// time; tests inject a fixed value.
  final DateTime? now;
}

/// The outcome of decoding a token. Either [isValidStructure] is true and the
/// decoded fields are populated, or [errorMessage] explains what was wrong —
/// [JwtParser] never throws.
class JwtParseResult {
  const JwtParseResult._({
    required this.isValidStructure,
    required this.errorMessage,
    required this.header,
    required this.payload,
    required this.headerJson,
    required this.payloadJson,
    required this.signatureBase64Url,
    required this.algorithm,
    required this.tokenType,
    required this.keyId,
    required this.isUnsignedAlgorithm,
    required this.registeredClaims,
    required this.temporalStatus,
    required this.expiresAt,
    required this.notBefore,
    required this.issuedAt,
    required this.timeUntilExpiry,
    required this.timeUntilValid,
    required this.segmentCount,
  });

  /// A structurally sound, fully decoded token.
  factory JwtParseResult.failure(String message, {int segmentCount = 0}) {
    return JwtParseResult._(
      isValidStructure: false,
      errorMessage: message,
      header: const {},
      payload: const {},
      headerJson: '',
      payloadJson: '',
      signatureBase64Url: '',
      algorithm: null,
      tokenType: null,
      keyId: null,
      isUnsignedAlgorithm: false,
      registeredClaims: const [],
      temporalStatus: JwtTemporalStatus.valid,
      expiresAt: null,
      notBefore: null,
      issuedAt: null,
      timeUntilExpiry: null,
      timeUntilValid: null,
      segmentCount: segmentCount,
    );
  }

  final bool isValidStructure;

  /// Null when [isValidStructure] is true.
  final String? errorMessage;

  final Map<String, dynamic> header;
  final Map<String, dynamic> payload;

  /// Pretty-printed (2-space indented) JSON for display in a monospace panel.
  final String headerJson;
  final String payloadJson;

  /// The third segment, still base64url-encoded. Empty for unsecured JWTs.
  final String signatureBase64Url;

  /// The `alg` header value, e.g. `HS256`. Null when the header omits it.
  final String? algorithm;

  /// The `typ` header value, e.g. `JWT`.
  final String? tokenType;

  /// The `kid` header value — which key the issuer says signed this.
  final String? keyId;

  /// True when `alg` is `none` (case-insensitive) or the signature segment is
  /// empty. This is the classic JWT vulnerability (CVE-2015-9235 family): a
  /// server that honours the token's own `alg` will accept an attacker-forged
  /// token with the signature stripped. Surface it loudly.
  final bool isUnsignedAlgorithm;

  /// The RFC 7519 registered claims that were actually present, in the
  /// canonical order iss, sub, aud, exp, nbf, iat, jti.
  final List<JwtRegisteredClaim> registeredClaims;

  final JwtTemporalStatus temporalStatus;

  /// UTC instants from `exp` / `nbf` / `iat`, or null when absent/non-numeric.
  final DateTime? expiresAt;
  final DateTime? notBefore;
  final DateTime? issuedAt;

  /// Positive while the token is still good; negative once it has expired.
  /// Null when there is no usable `exp`.
  final Duration? timeUntilExpiry;

  /// Positive while `nbf` is still in the future. Null otherwise.
  final Duration? timeUntilValid;

  /// How many dot-separated segments the input had (2 is a valid unsecured
  /// JWT with the trailing dot omitted; 3 is normal).
  final int segmentCount;

  bool get isExpired => temporalStatus == JwtTemporalStatus.expired;
  bool get isNotYetValid => temporalStatus == JwtTemporalStatus.notYetValid;

  /// Always false. This tool decodes; it does not verify. Kept as an explicit
  /// field (rather than left implicit) so that any UI binding to a result
  /// cannot accidentally imply the signature checked out.
  bool get signatureVerified => false;

  /// The disclaimer the UI must display verbatim alongside any decoded token.
  static const String signatureNotice =
      'Signature NOT verified. This tool only decodes the token — no key was '
      'supplied and no cryptographic check was performed. A token shown here '
      'may be forged, tampered with, or signed by an untrusted key.';
}

/// Decodes a JSON Web Token (JWS Compact Serialization, RFC 7515/7519) into
/// its header, payload and signature parts, surfaces the registered claims
/// with human-readable meanings, and reports whether the token is currently
/// expired or not yet valid.
///
/// ## This decodes; it does NOT verify
///
/// No signing key is accepted and no signature check is performed. A result
/// from this class says nothing whatsoever about a token's authenticity — the
/// payload is attacker-controlled data until something with the key says
/// otherwise. Every result carries [JwtParseResult.signatureNotice] and
/// [JwtParseResult.signatureVerified] is hard-wired to `false` so that no UI
/// can imply validation happened. Never use this to make an auth decision.
///
/// Pure Dart, no packages beyond `dart:convert`, no I/O, no Flutter. Malformed
/// input returns [JwtParseResult.failure]; nothing throws.
class JwtParser implements IToolUseCase<JwtParseInput, JwtParseResult> {
  const JwtParser();

  /// Registered claim metadata, in RFC 7519 section 4.1 order.
  static const List<({String name, String label, String meaning})> registeredClaimSpecs = [
    (name: 'iss', label: 'Issuer', meaning: 'Who created and signed this token.'),
    (name: 'sub', label: 'Subject', meaning: 'Who or what the token is about — usually the user id.'),
    (name: 'aud', label: 'Audience', meaning: 'Who the token is intended for; recipients must reject others.'),
    (name: 'exp', label: 'Expires at', meaning: 'Do not accept the token at or after this time.'),
    (name: 'nbf', label: 'Not before', meaning: 'Do not accept the token before this time.'),
    (name: 'iat', label: 'Issued at', meaning: 'When the token was created; used to judge token age.'),
    (name: 'jti', label: 'JWT ID', meaning: 'Unique token identifier, used to prevent replay.'),
  ];

  @override
  JwtParseResult execute(JwtParseInput input) {
    final now = (input.now ?? DateTime.now()).toUtc();

    var token = input.token.trim();
    if (token.isEmpty) {
      return JwtParseResult.failure('Enter a JWT to decode.');
    }
    // Tolerate a pasted Authorization header.
    if (token.length > 7 && token.substring(0, 7).toLowerCase() == 'bearer ') {
      token = token.substring(7).trim();
    }
    // Tolerate line wrapping from a terminal copy/paste.
    token = token.replaceAll(RegExp(r'\s+'), '');

    final segments = token.split('.');
    if (segments.length < 2 || segments.length > 3) {
      return JwtParseResult.failure(
        'A JWT has 3 dot-separated segments (header.payload.signature); '
        'this input has ${segments.length}.',
        segmentCount: segments.length,
      );
    }
    if (segments[0].isEmpty || segments[1].isEmpty) {
      return JwtParseResult.failure(
        'The header and payload segments must not be empty.',
        segmentCount: segments.length,
      );
    }

    final Map<String, dynamic> header;
    try {
      header = _decodeJsonSegment(segments[0], JwtSegment.header);
    } on FormatException catch (e) {
      return JwtParseResult.failure(e.message, segmentCount: segments.length);
    }

    final Map<String, dynamic> payload;
    try {
      payload = _decodeJsonSegment(segments[1], JwtSegment.payload);
    } on FormatException catch (e) {
      return JwtParseResult.failure(e.message, segmentCount: segments.length);
    }

    final signature = segments.length == 3 ? segments[2] : '';
    final algorithm = _stringOrNull(header['alg']);
    final isUnsigned = (algorithm != null && algorithm.toLowerCase() == 'none') || signature.isEmpty;

    final expiresAt = _numericDate(payload['exp']);
    final notBefore = _numericDate(payload['nbf']);
    final issuedAt = _numericDate(payload['iat']);

    var status = JwtTemporalStatus.valid;
    Duration? timeUntilExpiry;
    Duration? timeUntilValid;

    if (expiresAt != null) {
      timeUntilExpiry = expiresAt.difference(now);
      // `exp` is "MUST NOT be accepted on or after", so <= 0 means expired.
      if (timeUntilExpiry.inMicroseconds <= 0) status = JwtTemporalStatus.expired;
    }
    if (notBefore != null) {
      final delta = notBefore.difference(now);
      if (delta.inMicroseconds > 0) {
        timeUntilValid = delta;
        // Expiry wins when a token is somehow both — it can never be used.
        if (status == JwtTemporalStatus.valid) status = JwtTemporalStatus.notYetValid;
      }
    }

    final claims = <JwtRegisteredClaim>[];
    for (final spec in registeredClaimSpecs) {
      if (!payload.containsKey(spec.name)) continue;
      final raw = payload[spec.name];
      final date = _numericDate(raw);
      claims.add(
        JwtRegisteredClaim(
          name: spec.name,
          label: spec.label,
          meaning: spec.meaning,
          rawValue: raw,
          displayValue: date != null ? _formatUtc(date) : _formatScalar(raw),
          dateTime: date,
        ),
      );
    }

    const encoder = JsonEncoder.withIndent('  ');
    return JwtParseResult._(
      isValidStructure: true,
      errorMessage: null,
      header: header,
      payload: payload,
      headerJson: encoder.convert(header),
      payloadJson: encoder.convert(payload),
      signatureBase64Url: signature,
      algorithm: algorithm,
      tokenType: _stringOrNull(header['typ']),
      keyId: _stringOrNull(header['kid']),
      isUnsignedAlgorithm: isUnsigned,
      registeredClaims: List.unmodifiable(claims),
      temporalStatus: status,
      expiresAt: expiresAt,
      notBefore: notBefore,
      issuedAt: issuedAt,
      timeUntilExpiry: timeUntilExpiry,
      timeUntilValid: timeUntilValid,
      segmentCount: segments.length,
    );
  }

  /// base64url-decodes [segment] (JWTs strip the `=` padding, so it is
  /// restored here) and parses the bytes as a UTF-8 JSON object.
  Map<String, dynamic> _decodeJsonSegment(String segment, JwtSegment which) {
    final label = which.name;
    final List<int> bytes;
    try {
      bytes = decodeBase64Url(segment);
    } on FormatException {
      throw FormatException('The $label segment is not valid base64url.');
    }

    final String text;
    try {
      text = utf8.decode(bytes);
    } catch (_) {
      throw FormatException('The $label segment did not decode to valid UTF-8 text.');
    }

    final Object? decoded;
    try {
      decoded = jsonDecode(text);
    } catch (_) {
      throw FormatException('The $label segment is not valid JSON.');
    }

    if (decoded is! Map) {
      throw FormatException('The $label segment must be a JSON object.');
    }
    return {for (final e in decoded.entries) e.key.toString(): e.value};
  }

  /// base64url decode that tolerates the missing `=` padding JWTs always
  /// strip (RFC 7515 appendix C). Throws [FormatException] on bad input.
  static List<int> decodeBase64Url(String input) {
    final normalized = input.replaceAll('-', '+').replaceAll('_', '/');
    final remainder = normalized.length % 4;
    if (remainder == 1) {
      throw const FormatException('Invalid base64url length');
    }
    final padded = remainder == 0 ? normalized : normalized.padRight(normalized.length + (4 - remainder), '=');
    return base64.decode(padded);
  }

  /// RFC 7519 NumericDate: seconds (possibly fractional) since the epoch, UTC.
  static DateTime? _numericDate(Object? value) {
    if (value is int) {
      return DateTime.fromMillisecondsSinceEpoch(value * 1000, isUtc: true);
    }
    if (value is double) {
      if (value.isNaN || value.isInfinite) return null;
      return DateTime.fromMillisecondsSinceEpoch((value * 1000).round(), isUtc: true);
    }
    return null;
  }

  static String? _stringOrNull(Object? value) => value is String && value.isNotEmpty ? value : null;

  static String _formatScalar(Object? value) {
    if (value == null) return 'null';
    if (value is List) return value.map(_formatScalar).join(', ');
    return value.toString();
  }

  static String _formatUtc(DateTime value) {
    final iso = value.toUtc().toIso8601String();
    // Drop the millisecond noise NumericDate never carries.
    return iso.endsWith('.000Z') ? '${iso.substring(0, iso.length - 5)}Z UTC' : '$iso UTC';
  }
}

/// Renders a [Duration] as "2 days, 3 hours" / "in 5 minutes" style text for
/// the expiry countdown. Lives here (not in the UI) so it is unit-testable.
String formatJwtDuration(Duration duration) {
  final d = duration.isNegative ? -duration : duration;
  if (d.inSeconds < 60) return '${d.inSeconds}s';

  final parts = <String>[];
  final days = d.inDays;
  final hours = d.inHours % 24;
  final minutes = d.inMinutes % 60;

  if (days > 0) parts.add('${days}d');
  if (hours > 0) parts.add('${hours}h');
  if (minutes > 0 && days == 0) parts.add('${minutes}m');
  if (parts.isEmpty) parts.add('${d.inMinutes}m');
  return parts.join(' ');
}
