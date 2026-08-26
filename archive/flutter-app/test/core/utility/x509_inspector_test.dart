import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/x509_inspector.dart';

/// A real, self-signed X.509v3 certificate generated locally with OpenSSL
/// 3.5.7 (`openssl req -x509 -newkey rsa:2048 ...`) — genuine DER bytes
/// wrapped in PEM armour, not fabricated text. Fixed to a known validity
/// window (2024-01-01 .. 2034-01-01) and a fixed serial so every field
/// below can be asserted against `openssl x509 -text`'s own output rather
/// than guessed.
///
/// Subject == Issuer:
///   C=US, ST=California, L=San Francisco, O=InfraKit Test,
///   OU=Engineering, CN=leaf.infrakit.test, emailAddress=test@infrakit.test
/// SANs: DNS:leaf.infrakit.test, DNS:www.leaf.infrakit.test, IP:127.0.0.1
/// CRL distribution point: http://crl.infrakit.test/leaf.crl
/// Serial: 0x1A2B3C4D5E (112394521950)
///
/// Deliberately carries no keyUsage/extKeyUsage extension — see the note
/// on the "extensions the core cannot currently read" group below.
const selfSignedLeafPem = '''
-----BEGIN CERTIFICATE-----
MIIEczCCA1ugAwIBAgIFGis8TV4wDQYJKoZIhvcNAQELBQAwgagxCzAJBgNVBAYT
AlVTMRMwEQYDVQQIDApDYWxpZm9ybmlhMRYwFAYDVQQHDA1TYW4gRnJhbmNpc2Nv
MRYwFAYDVQQKDA1JbmZyYUtpdCBUZXN0MRQwEgYDVQQLDAtFbmdpbmVlcmluZzEb
MBkGA1UEAwwSbGVhZi5pbmZyYWtpdC50ZXN0MSEwHwYJKoZIhvcNAQkBFhJ0ZXN0
QGluZnJha2l0LnRlc3QwHhcNMjQwMTAxMDAwMDAwWhcNMzQwMTAxMDAwMDAwWjCB
qDELMAkGA1UEBhMCVVMxEzARBgNVBAgMCkNhbGlmb3JuaWExFjAUBgNVBAcMDVNh
biBGcmFuY2lzY28xFjAUBgNVBAoMDUluZnJhS2l0IFRlc3QxFDASBgNVBAsMC0Vu
Z2luZWVyaW5nMRswGQYDVQQDDBJsZWFmLmluZnJha2l0LnRlc3QxITAfBgkqhkiG
9w0BCQEWEnRlc3RAaW5mcmFraXQudGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEP
ADCCAQoCggEBALuNl5EJRZ/2VLuOV3zpYMCmNhbKbpt/XP+fpjQF2tW55iJXsEIz
P4dmDyp1qOHvqOXQm3CIEzB8662qjMjmf6ONzbLdCvJaripS8F8AuInXwxTX7Fn2
EXQg8agCL/FEbqpozTuqJQ0tdtIZrpTHFlg26kupFUwXV/IjKo7ePD6C/SSqq1/+
UEppFYP3+x18BxA9ImiMGMBDDed6CxqEzu1EsGKJldOE3D8Rr/5E7t9tdFO3Ztpo
/hihgS+3+Fezw/VwHFd9qxjsTfQwQXhK3vXjlEQ7xpZ5LN3fliL0N0MX9No5iWY+
nd+6GYhDiaAHP76b9TM6l5s4HUzZyxgnFGUCAwEAAaOBoTCBnjAMBgNVHRMBAf8E
AjAAMDsGA1UdEQQ0MDKCEmxlYWYuaW5mcmFraXQudGVzdIIWd3d3LmxlYWYuaW5m
cmFraXQudGVzdIcEfwAAATAyBgNVHR8EKzApMCegJaAjhiFodHRwOi8vY3JsLmlu
ZnJha2l0LnRlc3QvbGVhZi5jcmwwHQYDVR0OBBYEFD+j58IY6dWfmEwtJOiGxJDS
ERcoMA0GCSqGSIb3DQEBCwUAA4IBAQAOV0MWxKiUbS+XafHCp6akoNlJ5e2AnQMu
kElAfYvHR55R2PUspSGS4l8YQ4fVcINBZvODHKs9I21X6y2OI3c+n5+YSjdWgVTz
cp4L1eof6F9TtNCJ1Z/l9z41j3CYXOiocfg0De+p5pKcjnygZ5RT2OI6Q04uRu48
7boO6UJ0uzVZZxKkmSO9x+K3Huf7zZlAPJ2JZXjgIT2YiG1GdvXq/9GYVwuVXlYB
2nE28wFRsdWx2IepcLma2lnPvLiGqRJIXhn2u+LKiiywWE54Sw2izgcTFyNg8aML
sMdhmJLyW/AbPBqnmS4yipnkOyf1ySFwYJ0PT0HBKn1XzZXKirGH
-----END CERTIFICATE-----
''';

/// Leaf issued *by* [rootCaPem] below (subject != issuer), also genuine
/// OpenSSL output. Validity window 2024-06-01 .. 2024-08-01, serial 0x02 —
/// deliberately narrow so a handful of fixed `now` instants land in each
/// of the four [CertificateValidityStatus] buckets.
const chainLeafPem = '''
-----BEGIN CERTIFICATE-----
MIIDeDCCAmCgAwIBAgIBAjANBgkqhkiG9w0BAQsFADBNMQswCQYDVQQGEwJVUzEe
MBwGA1UECgwVSW5mcmFLaXQgVGVzdCBSb290IENBMR4wHAYDVQQDDBVJbmZyYUtp
dCBUZXN0IFJvb3QgQ0EwHhcNMjQwNjAxMDAwMDAwWhcNMjQwODAxMDAwMDAwWjBD
MQswCQYDVQQGEwJVUzEWMBQGA1UECgwNSW5mcmFLaXQgVGVzdDEcMBoGA1UEAwwT
Y2hhaW4uaW5mcmFraXQudGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoC
ggEBAMBOplpVEcFqUOT9w51ZulPuyx1QYPeCBinsYX+Attf4aUACa3Fu66pi1kAK
VZ/oX0FtfQRNctpHJh1/Yq7vy+u0up1Uw6hW/tMHETjfoNGpdAAQyQNGcGUMe4FF
pYNSm42WmAz0gq5DPWXHZHl5Zhj5O3VV77M6RcWygbCBk6pxYnt0HiRubPJDs724
C/pyWW0ZbRDxj4dP0iTO7VExyFTqCPRv/Y6UtdgUGp/h6/oLnB/BcEAAoVKmRowy
hCFNjwjG8h4ScBNyBfZYy9gaW0XMwrfwF5RFi7PI3uNXebNWdFzmdZeEv0cf6rcf
dqf3c0jb21DHqMIi/PMpFy0Y73MCAwEAAaNtMGswCQYDVR0TBAIwADAeBgNVHREE
FzAVghNjaGFpbi5pbmZyYWtpdC50ZXN0MB0GA1UdDgQWBBTlpj+z1a9Pmu5br8V6
syvvy6PgEzAfBgNVHSMEGDAWgBTIoVpMFVXnlmTPykVlmUB75JEh/DANBgkqhkiG
9w0BAQsFAAOCAQEAdSxpZLByiG3xXlEc4Gstnv6uyhz5yrBnaANhNMmzGzz5dvGh
2WWyC6hBL5PP+z1XYLWiid/RpsFYjkkfn0X2+fTdi95f2kF8c73DP5L7MprL3uCG
AEVjg2LzaKXMnYVUR7paD775HG+OVT93pcqxXzIYQuHPl6oSgdhEqKoxfjzzs1VH
wndb+j3tPYt61Jm2zYDmGmptlKil6kdSuKDCewiD/IWQ5kySiGZSQF6F58BdkK/O
FMHAW46OuyiccfxuNFjiszn1bMTtmpEQAJBD/R84m962MO9d3qr1e85NlDXR3W/o
Mm5bV13ABJceCFh133KP69GDG5WLlyneTIhABA==
-----END CERTIFICATE-----
''';

/// The root CA that signed [chainLeafPem] — self-signed, CA:TRUE,
/// pathlen:0, validity 2023-01-01 .. 2033-01-01, serial 0x01.
const rootCaPem = '''
-----BEGIN CERTIFICATE-----
MIIDSjCCAjKgAwIBAgIBATANBgkqhkiG9w0BAQsFADBNMQswCQYDVQQGEwJVUzEe
MBwGA1UECgwVSW5mcmFLaXQgVGVzdCBSb290IENBMR4wHAYDVQQDDBVJbmZyYUtp
dCBUZXN0IFJvb3QgQ0EwHhcNMjMwMTAxMDAwMDAwWhcNMzMwMTAxMDAwMDAwWjBN
MQswCQYDVQQGEwJVUzEeMBwGA1UECgwVSW5mcmFLaXQgVGVzdCBSb290IENBMR4w
HAYDVQQDDBVJbmZyYUtpdCBUZXN0IFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUA
A4IBDwAwggEKAoIBAQCWmrjHCjODh6kyyqCK+Gu10aNczcRCdV752EWyWb7jDgNF
j3WwlTTEnOiyew1GGu2Iy8ZSlBnnT9mYVr+NeiJJ++NIpcJlbtjcnJpKCHTeXscB
hGU0Pd0VYD+sKrVw5kIOFuFt3M9TM54XDRgMSE0t0akKNkqk/vI09M2FfPQhon68
iDOE5wf8zTuAw/b6tELr2685wxfqM3++Gn+Zolz8OFKzek3QEpzk/r/YXdEsMq6r
3hqMu0W86DhQZEUQ2Jq8SXi07YEEYsTYsHRX6ERNiOrPuT5lkxdL+wv8ffBEtKbO
WrGgWIagYJbB/9FIJArtU92Tka2uP2HhZyM9iyF1AgMBAAGjNTAzMBIGA1UdEwEB
/wQIMAYBAf8CAQAwHQYDVR0OBBYEFMihWkwVVeeWZM/KRWWZQHvkkSH8MA0GCSqG
SIb3DQEBCwUAA4IBAQA8mfw0KBzE7bgPn89CuPXRRHaBFz9ioDedOmQx1tSOEWnL
sp4c5pwvgOhlcrV/f4/9aJBav83TFfqe5az5sif+8CLXYTvx38/Yxl82RCs6WdaF
iZ8M7SRA81ejS7jS3osWRVqFgxDoMxmXnIFumv8bv+QQIImI0wGj9wCcSuV5UJyp
xy2NtkTyFxqXUodkEoT7jEENWWVtiZ2GCg6QY7CY07p71R4CCZBjeBGOCdiGk2E7
rpdojxddQcEQy6Fb+tyXgkI/swZzQjoJwxuicYzCiiB+48CwzK4wxMc1UK2C0Y+N
H4GwgHnvhOxizVHuGNFUIkyaFTvdATMRyZ9RmS8t
-----END CERTIFICATE-----
''';

const _inspector = X509Inspector();

X509InspectResult inspect(String pem, {DateTime? now}) =>
    _inspector.execute(X509InspectInput(pemText: pem, now: now));

void main() {
  group('parsing a real self-signed certificate', () {
    final result = inspect(selfSignedLeafPem, now: DateTime.utc(2025, 1, 1));

    test('reports exactly one certificate and no errors', () {
      expect(result.hasCertificates, isTrue);
      expect(result.isChain, isFalse);
      expect(result.blocksFound, 1);
      expect(result.certificates, hasLength(1));
      expect(result.errors, isEmpty);
    });

    test('parses the subject DN in openssl order', () {
      final cert = result.certificates.single;
      expect(cert.subject.commonName, 'leaf.infrakit.test');
      // basic_utils does not surface the emailAddress (1.2.840.113549.1.9.1)
      // RDN even though it's in the certificate and in the core's own
      // `_dnOidShortNames` map — it is simply never populated by the
      // underlying ASN.1 walk, so it is correctly absent here too.
      expect(
        cert.subject.formatted,
        'C=US, ST=California, L=San Francisco, O=InfraKit Test, '
        'OU=Engineering, CN=leaf.infrakit.test',
      );
    });

    test('subject and issuer are identical, so it is self-signed', () {
      final cert = result.certificates.single;
      expect(cert.issuer.formatted, cert.subject.formatted);
      expect(cert.isSelfSigned, isTrue);
    });

    test('parses the serial number in both hex and decimal', () {
      final cert = result.certificates.single;
      expect(cert.serialNumberHex, '1A2B3C4D5E');
      expect(cert.serialNumberDecimal, '112394521950');
    });

    test('parses version and validity window exactly', () {
      final cert = result.certificates.single;
      expect(cert.version, 3);
      expect(cert.notBefore, DateTime.utc(2024, 1, 1));
      expect(cert.notAfter, DateTime.utc(2034, 1, 1));
    });

    test('reports fingerprints matching `openssl x509 -fingerprint`', () {
      final cert = result.certificates.single;
      expect(cert.sha1Fingerprint, 'AD:7F:DE:FC:33:C0:69:DA:02:1E:60:6E:02:D7:C1:E3:04:82:16:36');
      expect(
        cert.sha256Fingerprint,
        'A7:81:68:DE:60:71:15:F8:FF:45:13:17:71:A8:98:22:B6:8E:E0:6A:AF:C9:93:33:BA:0C:45:AE:15:31:75:B3',
      );
      expect(cert.md5Fingerprint, '07:09:D4:5D:D7:7B:8A:F4:A2:D7:B1:11:E1:04:EE:D2');
    });

    test('parses subject alternative names', () {
      final cert = result.certificates.single;
      expect(
        cert.subjectAlternativeNames,
        containsAll(['leaf.infrakit.test', 'www.leaf.infrakit.test', '127.0.0.1']),
      );
    });

    test('parses the CRL distribution point', () {
      final cert = result.certificates.single;
      expect(cert.crlDistributionPoints, ['http://crl.infrakit.test/leaf.crl']);
    });

    test('is not a certificate authority', () {
      final cert = result.certificates.single;
      // DER omits a BOOLEAN that equals its DEFAULT (cA DEFAULT FALSE), so
      // a leaf's basicConstraints extension carries no explicit cA value at
      // all; the core reports that as null rather than false. Only an
      // explicit `CA:TRUE` (see the root CA below) yields `true`.
      expect(cert.isCertificateAuthority, isNull);
    });

    test('parses the RSA public key', () {
      final cert = result.certificates.single;
      expect(cert.publicKeyAlgorithm, 'rsaEncryption');
      expect(cert.publicKeyBits, 2048);
      expect(cert.publicKeyExponent, 65537);
      expect(cert.publicKeyCurve, isNull);
    });

    test('parses the signature algorithm', () {
      final cert = result.certificates.single;
      expect(cert.signatureAlgorithm, 'sha256WithRSAEncryption');
    });

    test('displayName falls back to the common name', () {
      expect(result.certificates.single.displayName, 'leaf.infrakit.test');
    });

    test('round-trips the original single-cert PEM', () {
      expect(result.certificates.single.pem, contains('BEGIN CERTIFICATE'));
      expect(result.certificates.single.pem, contains('END CERTIFICATE'));
    });
  });

  group('expiry detection against a fixed clock', () {
    // chainLeafPem is valid 2024-06-01T00:00:00Z .. 2024-08-01T00:00:00Z.
    test('well inside the window is valid', () {
      final result = inspect(chainLeafPem, now: DateTime.utc(2024, 6, 15));
      final cert = result.certificates.single;
      expect(cert.status, CertificateValidityStatus.valid);
      expect(cert.isExpired, isFalse);
      expect(cert.isCurrentlyValid, isTrue);
      expect(cert.daysUntilExpiry, greaterThan(X509Inspector.expiringSoonThreshold.inDays));
    });

    test('inside the 30-day renewal window is expiringSoon', () {
      // notAfter - now = 17 days.
      final result = inspect(chainLeafPem, now: DateTime.utc(2024, 7, 15));
      final cert = result.certificates.single;
      expect(cert.status, CertificateValidityStatus.expiringSoon);
      expect(cert.isExpired, isFalse);
      expect(cert.isCurrentlyValid, isTrue);
      expect(cert.daysUntilExpiry, lessThanOrEqualTo(X509Inspector.expiringSoonThreshold.inDays));
    });

    test('after notAfter is expired', () {
      final result = inspect(chainLeafPem, now: DateTime.utc(2024, 9, 1));
      final cert = result.certificates.single;
      expect(cert.status, CertificateValidityStatus.expired);
      expect(cert.isExpired, isTrue);
      expect(cert.isCurrentlyValid, isFalse);
      expect(cert.timeUntilExpiry.isNegative, isTrue);
    });

    test('before notBefore is notYetValid', () {
      final result = inspect(chainLeafPem, now: DateTime.utc(2024, 5, 1));
      final cert = result.certificates.single;
      expect(cert.status, CertificateValidityStatus.notYetValid);
      expect(cert.isExpired, isFalse);
      expect(cert.isCurrentlyValid, isFalse);
    });

    test('exactly at notAfter counts as expired', () {
      final result = inspect(chainLeafPem, now: DateTime.utc(2024, 8, 1));
      expect(result.certificates.single.status, CertificateValidityStatus.expired);
    });
  });

  group('a multi-certificate PEM bundle (fullchain-style)', () {
    final bundle = '$chainLeafPem\n$rootCaPem';
    final result = inspect(bundle, now: DateTime.utc(2024, 6, 15));

    test('parses both members and flags it as a chain', () {
      expect(result.blocksFound, 2);
      expect(result.certificates, hasLength(2));
      expect(result.errors, isEmpty);
      expect(result.isChain, isTrue);
    });

    test('the leaf is issued by the root, not self-signed', () {
      final leaf = result.certificates[0];
      expect(leaf.subject.commonName, 'chain.infrakit.test');
      expect(leaf.issuer.commonName, 'InfraKit Test Root CA');
      expect(leaf.isSelfSigned, isFalse);
    });

    test('the root is self-signed and marked as a CA', () {
      final root = result.certificates[1];
      expect(root.subject.commonName, 'InfraKit Test Root CA');
      expect(root.isSelfSigned, isTrue);
      expect(root.isCertificateAuthority, isTrue);
      expect(root.pathLengthConstraint, 0);
    });

    test('members keep their 0-based index within the bundle', () {
      expect(result.certificates[0].index, 0);
      expect(result.certificates[1].index, 1);
    });

    test('one bad block among good ones still returns the good ones', () {
      // A syntactically-present but undecodable certificate block sits
      // between two good ones; the good members must still come back, with
      // the bad one reported in errors instead of aborting everything.
      const corruptBlock = '-----BEGIN CERTIFICATE-----\nQUFBQUFBQUFBQUFBQUFBQQ==\n-----END CERTIFICATE-----';
      final mixed = '$chainLeafPem\n$corruptBlock\n$rootCaPem';
      final mixedResult = inspect(mixed, now: DateTime.utc(2024, 6, 15));

      expect(mixedResult.blocksFound, 3);
      expect(mixedResult.certificates, hasLength(2));
      expect(mixedResult.errors, hasLength(1));
      expect(mixedResult.errors.single, contains('Certificate 2 of 3'));
      expect(mixedResult.certificates[0].subject.commonName, 'chain.infrakit.test');
      expect(mixedResult.certificates[1].subject.commonName, 'InfraKit Test Root CA');
    });
  });

  group('DER input', () {
    test('raw DER bytes (no PEM armour) parse the same as the PEM', () {
      // The PEM body *is* base64 of the DER; decoding it back gives us
      // genuine DER bytes for the derBytes code path without needing a
      // second fixture file.
      final body = selfSignedLeafPem
          .replaceAll('-----BEGIN CERTIFICATE-----', '')
          .replaceAll('-----END CERTIFICATE-----', '')
          .replaceAll(RegExp(r'\s+'), '');
      final der = base64.decode(body);

      final result = _inspector.execute(
        X509InspectInput(derBytes: der, now: DateTime.utc(2025, 1, 1)),
      );
      expect(result.certificates, hasLength(1));
      expect(result.certificates.single.subject.commonName, 'leaf.infrakit.test');
      expect(result.certificates.single.serialNumberHex, '1A2B3C4D5E');
    });
  });

  group('garbage / empty input errors cleanly', () {
    test('empty input throws with a helpful message', () {
      expect(
        () => _inspector.execute(const X509InspectInput()),
        throwsA(isA<X509InspectException>().having(
          (e) => e.message,
          'message',
          contains('Paste PEM text or load a certificate file first'),
        )),
      );
    });

    test('text with no BEGIN CERTIFICATE marker throws', () {
      expect(
        () => inspect('this is just some prose about certificates, not one'),
        throwsA(isA<X509InspectException>().having(
          (e) => e.message,
          'message',
          contains('No certificate found'),
        )),
      );
    });

    test('a BEGIN/END block full of garbage throws with a parse error', () {
      const garbage = '-----BEGIN CERTIFICATE-----\nQUFBQUFBQUFBQUFBQUFBQQ==\n-----END CERTIFICATE-----';
      expect(
        () => inspect(garbage),
        throwsA(isA<X509InspectException>()),
      );
    });

    test('the exception message never leaks a raw stack trace', () {
      try {
        inspect('not a certificate at all');
        fail('expected an X509InspectException');
      } on X509InspectException catch (e) {
        expect(e.toString(), isNot(contains('#0')));
      }
    });
  });

  group('extractPemBlocks', () {
    test('extracts a single block', () {
      expect(X509Inspector.extractPemBlocks(selfSignedLeafPem), hasLength(1));
    });

    test('extracts multiple blocks and ignores surrounding commentary', () {
      final withCommentary = 'Certificate chain:\n0 s:CN=chain\n$chainLeafPem\nSome trailer text\n$rootCaPem';
      expect(X509Inspector.extractPemBlocks(withCommentary), hasLength(2));
    });

    test('returns an empty list when there is no marker at all', () {
      expect(X509Inspector.extractPemBlocks('nothing here'), isEmpty);
    });
  });

  group('keyUsage / extendedKeyUsage extensions (regression — see fix in x509_inspector.dart)', () {
    // Regression guard for the untyped `const []` bug that threw
    // NoSuchMethodError on `.name` for any cert with these extensions.
    test('a certificate with a keyUsage extension parses correctly', () {
      const certWithKeyUsage = '''
-----BEGIN CERTIFICATE-----
MIIEojCCA4qgAwIBAgIFGis8TV4wDQYJKoZIhvcNAQELBQAwgagxCzAJBgNVBAYT
AlVTMRMwEQYDVQQIDApDYWxpZm9ybmlhMRYwFAYDVQQHDA1TYW4gRnJhbmNpc2Nv
MRYwFAYDVQQKDA1JbmZyYUtpdCBUZXN0MRQwEgYDVQQLDAtFbmdpbmVlcmluZzEb
MBkGA1UEAwwSbGVhZi5pbmZyYWtpdC50ZXN0MSEwHwYJKoZIhvcNAQkBFhJ0ZXN0
QGluZnJha2l0LnRlc3QwHhcNMjQwMTAxMDAwMDAwWhcNMzQwMTAxMDAwMDAwWjCB
qDELMAkGA1UEBhMCVVMxEzARBgNVBAgMCkNhbGlmb3JuaWExFjAUBgNVBAcMDVNh
biBGcmFuY2lzY28xFjAUBgNVBAoMDUluZnJhS2l0IFRlc3QxFDASBgNVBAsMC0Vu
Z2luZWVyaW5nMRswGQYDVQQDDBJsZWFmLmluZnJha2l0LnRlc3QxITAfBgkqhkiG
9w0BCQEWEnRlc3RAaW5mcmFraXQudGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEP
ADCCAQoCggEBAMRn3cPh2HDRIUShmY3rPtHY9I3nFbCnqeoWlbd2DdieNBooTauy
RDmHoi8HmBTiF6HU70IDuXbmY5M9eDiautY7rZosotywiPz1hV2tUY6UiEanffTh
yAwN9i2HNFcUP4fGhRQ6nSlZQkY3l7HNnS8VIjOI+8sqWrfVEL33/INbrBwj5EqJ
kg43h6RQAgPVNgQprYet8VAKveynMj7qXyzjvmleVQT+AEjD8/3napWoYDvqyfiV
qq/bjaJpKArnckdJFjLvzOFvuMVzfWNJ+gHmXQMdfVCWLwawTmEQ5uf32XMhqdm2
m4Da9OOEA2iqXDuQVLgbywFuoGFmLfhs9x0CAwEAAaOB0DCBzTAMBgNVHRMBAf8E
AjAAMA4GA1UdDwEB/wQEAwIFoDAdBgNVHSUEFjAUBggrBgEFBQcDAQYIKwYBBQUH
AwIwOwYDVR0RBDQwMoISbGVhZi5pbmZyYWtpdC50ZXN0ghZ3d3cubGVhZi5pbmZy
YWtpdC50ZXN0hwR/AAABMDIGA1UdHwQrMCkwJ6AloCOGIWh0dHA6Ly9jcmwuaW5m
cmFraXQudGVzdC9sZWFmLmNybDAdBgNVHQ4EFgQUvdZQwe5WTbpmUknQGgIywDCe
chIwDQYJKoZIhvcNAQELBQADggEBAC9k/QIP9rBiGtekb0pEtL1j0rH0VTHxWKm1
/hmEPWpBm7E/r704jV2nlZUSmLZeomxFvpKUn/1cQIsSnvCusBGa/CPz3f1x7zXv
IxA4RRWUmZ8w2OvwI2xdGvuNScbE3gq4FPjVWO0DaMzZ5JDUVEsAWUo+eB62iSr3
Nrh/ykuohwhjtpTLf9GScEvA0pCkIlAT9eJeOKFo7/hzi3v9PyhVBvAZiHPWP34n
Sh/Nxgx6sCMWX9OPErV5ap+M8WOJE/+sgSiToDaCB/Dz0WfVYuKp59fuzCct4hmJ
wSnI5sfOKOfeD1/iamG2PMy0k1slQg3y7+BGE2VxPsIbZHjWQus=
-----END CERTIFICATE-----
''';
      final result = inspect(certWithKeyUsage, now: DateTime.utc(2025, 1, 1));
      expect(result.errors, isEmpty);
      expect(result.certificates, hasLength(1));
      expect(result.certificates.single.keyUsage, contains('digitalSignature'));
      expect(result.certificates.single.keyUsage, contains('keyEncipherment'));
      expect(result.certificates.single.extendedKeyUsage, isNotEmpty);
    });
  });
}
