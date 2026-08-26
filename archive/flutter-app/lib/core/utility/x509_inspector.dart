import 'dart:convert';
import 'dart:typed_data';

import 'package:basic_utils/basic_utils.dart' as bu;

import '../ports/i_tool_use_case.dart';

/// Where a certificate sits relative to its validity window right now.
enum CertificateValidityStatus {
  /// `notBefore` is in the future.
  notYetValid,

  /// Inside the window, and more than [X509Inspector.expiringSoonThreshold]
  /// remains.
  valid,

  /// Inside the window, but expiring within
  /// [X509Inspector.expiringSoonThreshold].
  expiringSoon,

  /// `notAfter` is in the past.
  expired,
}

/// One relative distinguished name component, e.g. `CN=example.com`.
class DistinguishedNameEntry {
  const DistinguishedNameEntry({required this.oid, required this.shortName, required this.value});

  /// The dotted OID as reported by `basic_utils`, e.g. `2.5.4.3`.
  final String oid;

  /// Conventional short label (`CN`, `O`, `OU`, `C`, …) or the raw OID when
  /// unrecognised.
  final String shortName;

  final String value;

  @override
  String toString() => '$shortName=$value';
}

/// A parsed distinguished name: the ordered components plus the familiar
/// single-line rendering.
class DistinguishedName {
  const DistinguishedName({required this.entries});

  final List<DistinguishedNameEntry> entries;

  /// e.g. `CN=example.com, O=Example Inc, C=US`. Empty string when the DN
  /// carried no recognisable components.
  String get formatted => entries.map((e) => e.toString()).join(', ');

  /// The common name, if present.
  String? get commonName {
    for (final e in entries) {
      if (e.shortName == 'CN') return e.value;
    }
    return null;
  }

  bool get isEmpty => entries.isEmpty;

  @override
  String toString() => formatted;
}

/// Everything this tool can report about one certificate. Deliberately a
/// plain data class holding only Dart core types, so the UI layer never has
/// to import `basic_utils`.
class CertificateInfo {
  const CertificateInfo({
    required this.index,
    required this.subject,
    required this.issuer,
    required this.serialNumberHex,
    required this.serialNumberDecimal,
    required this.version,
    required this.notBefore,
    required this.notAfter,
    required this.status,
    required this.timeUntilExpiry,
    required this.daysUntilExpiry,
    required this.signatureAlgorithm,
    required this.signatureAlgorithmOid,
    required this.publicKeyAlgorithm,
    required this.publicKeyOid,
    required this.publicKeyBits,
    required this.publicKeyCurve,
    required this.publicKeyExponent,
    required this.sha1Fingerprint,
    required this.sha256Fingerprint,
    required this.md5Fingerprint,
    required this.subjectAlternativeNames,
    required this.isCertificateAuthority,
    required this.pathLengthConstraint,
    required this.keyUsage,
    required this.extendedKeyUsage,
    required this.crlDistributionPoints,
    required this.isSelfSigned,
    required this.pem,
  });

  /// 0-based position within the parsed bundle.
  final int index;

  final DistinguishedName subject;
  final DistinguishedName issuer;

  /// Uppercase hex, no separators — matches `openssl x509 -serial`.
  final String serialNumberHex;
  final String serialNumberDecimal;

  /// X.509 version number (1, 2 or 3).
  final int version;

  final DateTime notBefore;
  final DateTime notAfter;

  final CertificateValidityStatus status;

  /// Positive while still valid, negative once expired.
  final Duration timeUntilExpiry;

  /// [timeUntilExpiry] in whole days; negative once expired.
  final int daysUntilExpiry;

  /// Readable name where `basic_utils` knows the OID (e.g.
  /// `sha256WithRSAEncryption`), otherwise the OID itself.
  final String signatureAlgorithm;
  final String signatureAlgorithmOid;

  /// e.g. `rsaEncryption`, `ecPublicKey`.
  final String publicKeyAlgorithm;
  final String? publicKeyOid;

  /// Key size in bits (RSA modulus length / EC field size). Null when
  /// `basic_utils` could not determine it.
  final int? publicKeyBits;

  /// Named curve for EC keys, e.g. `prime256v1`. Null for RSA.
  final String? publicKeyCurve;

  /// RSA public exponent, e.g. 65537. Null for non-RSA keys.
  final int? publicKeyExponent;

  /// Uppercase colon-separated hex over the DER encoding — the same value
  /// `openssl x509 -fingerprint` prints.
  final String sha1Fingerprint;
  final String sha256Fingerprint;
  final String md5Fingerprint;

  /// SANs as `basic_utils` reports them (DNS names and IP addresses).
  final List<String> subjectAlternativeNames;

  /// The `cA` flag of the basic constraints extension. Null when the
  /// extension is absent.
  final bool? isCertificateAuthority;

  /// `pathLenConstraint` of the basic constraints extension, when present.
  final int? pathLengthConstraint;

  /// e.g. `digitalSignature`, `keyEncipherment`.
  final List<String> keyUsage;

  /// e.g. `serverAuth`, `clientAuth`.
  final List<String> extendedKeyUsage;

  final List<String> crlDistributionPoints;

  /// True when subject and issuer DNs match — a self-signed or root
  /// certificate. Note this is a name comparison only; no signature is
  /// verified.
  final bool isSelfSigned;

  /// The single-certificate PEM this entry was parsed from.
  final String pem;

  bool get isExpired => status == CertificateValidityStatus.expired;
  bool get isCurrentlyValid =>
      status == CertificateValidityStatus.valid || status == CertificateValidityStatus.expiringSoon;

  /// Best available display label: CN if present, else the whole subject DN,
  /// else the first SAN, else a positional fallback.
  String get displayName {
    final cn = subject.commonName;
    if (cn != null && cn.isNotEmpty) return cn;
    if (!subject.isEmpty) return subject.formatted;
    if (subjectAlternativeNames.isNotEmpty) return subjectAlternativeNames.first;
    return 'Certificate ${index + 1}';
  }
}

class X509InspectInput {
  const X509InspectInput({this.pemText, this.derBytes, this.now});

  /// PEM text; may contain several `-----BEGIN CERTIFICATE-----` blocks (a
  /// fullchain.pem) and may be interleaved with `openssl x509 -text` style
  /// commentary, which is ignored.
  final String? pemText;

  /// Raw DER bytes for a single certificate. Used when [pemText] is null or
  /// blank. Bytes that are actually PEM text are detected and handled.
  final Uint8List? derBytes;

  /// Reference instant for the validity check. Defaults to now.
  final DateTime? now;
}

/// The outcome of inspecting an input. [certificates] holds every block that
/// parsed; [errors] holds one entry per block that did not, so a chain with
/// one bad member still shows the good ones.
class X509InspectResult {
  const X509InspectResult({
    required this.certificates,
    required this.errors,
    required this.blocksFound,
  });

  final List<CertificateInfo> certificates;

  /// Human-readable messages, e.g. "Certificate 2 could not be parsed: …".
  final List<String> errors;

  /// How many `-----BEGIN CERTIFICATE-----` blocks were seen in the input.
  final int blocksFound;

  bool get hasCertificates => certificates.isNotEmpty;
  bool get isChain => certificates.length > 1;
}

/// Thrown by [X509Inspector.execute] only when the input as a whole is
/// unusable (empty, or containing no certificate block at all). Per-block
/// failures are reported via [X509InspectResult.errors] instead.
class X509InspectException implements Exception {
  const X509InspectException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// Parses X.509 certificates (PEM or DER) and reports the fields an operator
/// actually needs when debugging TLS: who it is for, who signed it, when it
/// expires, how it is keyed, its fingerprints, and its SAN / key-usage
/// extensions.
///
/// Backed by `basic_utils`' `X509Utils`, but every value is copied into the
/// plain data classes above so no `basic_utils` type escapes the core.
///
/// A PEM bundle containing a full chain is parsed member by member; one bad
/// block does not discard the rest.
///
/// Note this inspects a certificate in isolation. It does not verify the
/// signature, check the chain against a trust store, or consult CRL/OCSP —
/// [CertificateInfo.isSelfSigned] is a DN comparison, nothing more.
class X509Inspector implements IToolUseCase<X509InspectInput, X509InspectResult> {
  const X509Inspector();

  /// A certificate inside this window of its `notAfter` is reported as
  /// [CertificateValidityStatus.expiringSoon] — the usual renewal alarm point.
  static const Duration expiringSoonThreshold = Duration(days: 30);

  static const String beginMarker = '-----BEGIN CERTIFICATE-----';
  static const String endMarker = '-----END CERTIFICATE-----';

  @override
  X509InspectResult execute(X509InspectInput input) {
    final now = (input.now ?? DateTime.now()).toUtc();

    final pemText = _resolveSource(input);
    final blocks = extractPemBlocks(pemText);
    if (blocks.isEmpty) {
      throw const X509InspectException(
        'No certificate found. Expected PEM text containing a '
        '"-----BEGIN CERTIFICATE-----" block, or DER bytes.',
      );
    }

    final certificates = <CertificateInfo>[];
    final errors = <String>[];

    for (var i = 0; i < blocks.length; i++) {
      try {
        certificates.add(_inspectOne(blocks[i], certificates.length, now));
      } catch (e) {
        errors.add('Certificate ${i + 1} of ${blocks.length} could not be parsed: ${_messageOf(e)}');
      }
    }

    if (certificates.isEmpty) {
      throw X509InspectException(
        errors.isEmpty ? 'The certificate could not be parsed.' : errors.join('\n'),
      );
    }

    return X509InspectResult(
      certificates: List.unmodifiable(certificates),
      errors: List.unmodifiable(errors),
      blocksFound: blocks.length,
    );
  }

  /// Normalises the input into PEM text: uses [X509InspectInput.pemText] when
  /// it has content, otherwise wraps the DER bytes (or decodes them as text
  /// when they turn out to be PEM already).
  String _resolveSource(X509InspectInput input) {
    final text = input.pemText;
    if (text != null && text.trim().isNotEmpty) return text;

    final der = input.derBytes;
    if (der == null || der.isEmpty) {
      throw const X509InspectException('Paste PEM text or load a certificate file first.');
    }

    // A .crt/.cer file may hold either PEM or DER; sniff for the marker.
    if (der.isNotEmpty && der.first == 0x2D) {
      try {
        final decoded = utf8.decode(der, allowMalformed: true);
        if (decoded.contains(beginMarker)) return decoded;
      } catch (_) {
        // fall through to DER handling
      }
    }
    return derToPem(der);
  }

  /// Wraps raw DER bytes in PEM armour so `X509Utils` can read them.
  static String derToPem(Uint8List der) {
    final body = base64.encode(der);
    final buffer = StringBuffer()..writeln(beginMarker);
    for (var i = 0; i < body.length; i += 64) {
      buffer.writeln(body.substring(i, i + 64 > body.length ? body.length : i + 64));
    }
    buffer.write(endMarker);
    return buffer.toString();
  }

  /// Pulls every `BEGIN/END CERTIFICATE` block out of [text], ignoring any
  /// surrounding commentary (a `openssl x509 -text` dump, a Kubernetes
  /// secret listing, plain prose). Returns normalised single-cert PEMs.
  static List<String> extractPemBlocks(String text) {
    final blocks = <String>[];
    var searchFrom = 0;
    while (true) {
      final start = text.indexOf(beginMarker, searchFrom);
      if (start < 0) break;
      final end = text.indexOf(endMarker, start);
      if (end < 0) break;
      final bodyStart = start + beginMarker.length;
      final body = text
          .substring(bodyStart, end)
          .split(RegExp(r'\r?\n'))
          .map((l) => l.trim())
          .where((l) => l.isNotEmpty)
          .join();
      searchFrom = end + endMarker.length;
      if (body.isEmpty) continue;

      final buffer = StringBuffer()..writeln(beginMarker);
      for (var i = 0; i < body.length; i += 64) {
        buffer.writeln(body.substring(i, i + 64 > body.length ? body.length : i + 64));
      }
      buffer.write(endMarker);
      blocks.add(buffer.toString());
    }
    return blocks;
  }

  CertificateInfo _inspectOne(String pem, int index, DateTime now) {
    final data = bu.X509Utils.x509CertificateFromPem(pem);
    final tbs = data.tbsCertificate;
    if (tbs == null) {
      throw const X509InspectException('The certificate body (tbsCertificate) was missing.');
    }

    final validity = tbs.validity;
    final notBefore = validity.notBefore.toUtc();
    final notAfter = validity.notAfter.toUtc();

    final timeUntilExpiry = notAfter.difference(now);
    final CertificateValidityStatus status;
    if (now.isBefore(notBefore)) {
      status = CertificateValidityStatus.notYetValid;
    } else if (timeUntilExpiry.inMicroseconds <= 0) {
      status = CertificateValidityStatus.expired;
    } else if (timeUntilExpiry <= expiringSoonThreshold) {
      status = CertificateValidityStatus.expiringSoon;
    } else {
      status = CertificateValidityStatus.valid;
    }

    final subject = _dnFrom(tbs.subject);
    final issuer = _dnFrom(tbs.issuer);
    final spki = tbs.subjectPublicKeyInfo;
    final ext = tbs.extensions;

    return CertificateInfo(
      index: index,
      subject: subject,
      issuer: issuer,
      serialNumberHex: _serialHex(tbs.serialNumber),
      serialNumberDecimal: tbs.serialNumber.toString(),
      version: tbs.version,
      notBefore: notBefore,
      notAfter: notAfter,
      status: status,
      timeUntilExpiry: timeUntilExpiry,
      daysUntilExpiry: timeUntilExpiry.inDays,
      signatureAlgorithm: tbs.signatureAlgorithmReadableName ?? tbs.signatureAlgorithm,
      signatureAlgorithmOid: tbs.signatureAlgorithm,
      publicKeyAlgorithm: spki.algorithmReadableName ?? spki.algorithm ?? 'unknown',
      publicKeyOid: spki.algorithm,
      publicKeyBits: spki.length,
      publicKeyCurve: spki.parameterReadableName ?? spki.parameter,
      publicKeyExponent: spki.exponent,
      sha1Fingerprint: _colonHex(data.sha1Thumbprint),
      sha256Fingerprint: _colonHex(data.sha256Thumbprint),
      md5Fingerprint: _colonHex(data.md5Thumbprint),
      subjectAlternativeNames: List.unmodifiable(ext?.subjectAlternativNames ?? const <String>[]),
      isCertificateAuthority: ext?.cA,
      pathLengthConstraint: ext?.pathLenConstraint,
      // Explicit type args on the empty-list fallback keep `u` typed (not dynamic) so `.name` resolves.
      keyUsage: List.unmodifiable([for (final u in ext?.keyUsage ?? const <bu.KeyUsage>[]) _camel(u.name)]),
      extendedKeyUsage: List.unmodifiable([
        for (final u in ext?.extKeyUsage ?? const <bu.ExtendedKeyUsage>[]) _camel(u.name),
      ]),
      crlDistributionPoints: List.unmodifiable(ext?.cRLDistributionPoints ?? const <String>[]),
      isSelfSigned: subject.formatted.isNotEmpty && subject.formatted == issuer.formatted,
      pem: pem,
    );
  }

  /// `basic_utils` keys its DN maps by dotted OID; map the well-known ones
  /// back to their conventional short labels so the output reads like
  /// `openssl`'s.
  static const Map<String, String> _dnOidShortNames = {
    '2.5.4.3': 'CN',
    '2.5.4.4': 'SN',
    '2.5.4.5': 'serialNumber',
    '2.5.4.6': 'C',
    '2.5.4.7': 'L',
    '2.5.4.8': 'ST',
    '2.5.4.9': 'STREET',
    '2.5.4.10': 'O',
    '2.5.4.11': 'OU',
    '2.5.4.12': 'title',
    '2.5.4.15': 'businessCategory',
    '2.5.4.17': 'postalCode',
    '2.5.4.42': 'GN',
    '2.5.4.43': 'initials',
    '2.5.4.44': 'generationQualifier',
    '2.5.4.46': 'dnQualifier',
    '2.5.4.65': 'pseudonym',
    '2.5.4.97': 'organizationIdentifier',
    '1.2.840.113549.1.9.1': 'emailAddress',
    '0.9.2342.19200300.100.1.1': 'UID',
    '0.9.2342.19200300.100.1.25': 'DC',
  };

  /// Conventional ordering used by `openssl` when printing a DN one-liner.
  static const List<String> _dnOrder = [
    'C',
    'ST',
    'L',
    'STREET',
    'O',
    'OU',
    'CN',
    'emailAddress',
  ];

  static DistinguishedName _dnFrom(Map<String, String?> raw) {
    final entries = <DistinguishedNameEntry>[];
    raw.forEach((oid, value) {
      if (value == null || value.isEmpty) return;
      entries.add(
        DistinguishedNameEntry(oid: oid, shortName: _dnOidShortNames[oid] ?? oid, value: value),
      );
    });

    entries.sort((a, b) {
      final ia = _dnOrder.indexOf(a.shortName);
      final ib = _dnOrder.indexOf(b.shortName);
      if (ia == ib) return a.shortName.compareTo(b.shortName);
      if (ia < 0) return 1;
      if (ib < 0) return -1;
      return ia.compareTo(ib);
    });

    return DistinguishedName(entries: List.unmodifiable(entries));
  }

  static String _serialHex(BigInt serial) {
    var hex = serial.toRadixString(16).toUpperCase();
    if (hex.length.isOdd) hex = '0$hex';
    return hex;
  }

  /// `basic_utils` returns thumbprints as unbroken uppercase hex; insert the
  /// colons operators expect when comparing against `openssl` output.
  static String _colonHex(String? hex) {
    if (hex == null || hex.isEmpty) return '';
    final upper = hex.toUpperCase().replaceAll(':', '');
    final pairs = <String>[];
    for (var i = 0; i + 1 < upper.length; i += 2) {
      pairs.add(upper.substring(i, i + 2));
    }
    return pairs.join(':');
  }

  /// `DIGITAL_SIGNATURE` -> `digitalSignature`, matching X.509 naming.
  static String _camel(String screamingSnake) {
    final parts = screamingSnake.toLowerCase().split('_');
    if (parts.isEmpty) return screamingSnake;
    return parts.first +
        parts.skip(1).map((p) => p.isEmpty ? p : p[0].toUpperCase() + p.substring(1)).join();
  }

  static String _messageOf(Object e) {
    if (e is X509InspectException) return e.message;
    if (e is FormatException) return e.message;
    if (e is ArgumentError) return e.message?.toString() ?? e.toString();
    return e.toString();
  }
}
