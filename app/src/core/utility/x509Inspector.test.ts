import { describe, expect, it } from 'vitest'
import {
  distinguishedNameCommonName,
  distinguishedNameFormatted,
  X509InspectException,
  X509Inspector,
} from './x509Inspector'

/**
 * A real, self-signed X.509v3 certificate generated locally with OpenSSL
 * 3.5.7 (`openssl req -x509 -newkey rsa:2048 ...`) — genuine DER bytes
 * wrapped in PEM armour, not fabricated text. Same fixture the Dart
 * reference test suite uses, fixed to a known validity window
 * (2024-01-01 .. 2034-01-01) and a fixed serial.
 *
 * Subject == Issuer:
 *   C=US, ST=California, L=San Francisco, O=InfraKit Test,
 *   OU=Engineering, CN=leaf.infrakit.test, emailAddress=test@infrakit.test
 * SANs: DNS:leaf.infrakit.test, DNS:www.leaf.infrakit.test, IP:127.0.0.1
 * CRL distribution point: http://crl.infrakit.test/leaf.crl
 * Serial: 0x1A2B3C4D5E (112394521950)
 *
 * Deliberately carries no keyUsage/extKeyUsage extension.
 */
const selfSignedLeafPem = `-----BEGIN CERTIFICATE-----
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
`

/**
 * Leaf issued *by* `rootCaPem` below (subject != issuer). Validity window
 * 2024-06-01 .. 2024-08-01, serial 0x02 -- deliberately narrow so a handful
 * of fixed `now` instants land in each of the four validity-status buckets.
 */
const chainLeafPem = `-----BEGIN CERTIFICATE-----
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
`

/**
 * The root CA that signed `chainLeafPem` — self-signed, CA:TRUE, pathlen:0,
 * validity 2023-01-01 .. 2033-01-01, serial 0x01.
 */
const rootCaPem = `-----BEGIN CERTIFICATE-----
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
`

const inspector = new X509Inspector()

function inspect(pem: string, now?: Date) {
  return inspector.execute({ pemText: pem, now })
}

describe('X509Inspector', () => {
  describe('parsing a real self-signed certificate', () => {
    const result = inspect(selfSignedLeafPem, new Date(Date.UTC(2025, 0, 1)))

    it('reports exactly one certificate and no errors', () => {
      expect(result.hasCertificates).toBe(true)
      expect(result.isChain).toBe(false)
      expect(result.blocksFound).toBe(1)
      expect(result.certificates).toHaveLength(1)
      expect(result.errors).toEqual([])
    })

    it('parses the subject DN in openssl order', () => {
      const cert = result.certificates[0]
      expect(distinguishedNameCommonName(cert.subject)).toBe('leaf.infrakit.test')
      // Unlike Dart's `basic_utils` (which never populates the emailAddress
      // RDN even though the OID is in its own short-name table), jsrsasign
      // *does* surface it, as the short label "E". Same certificate, same
      // field, genuinely different library behavior -- so this assertion
      // includes it where the Dart original didn't.
      expect(distinguishedNameFormatted(cert.subject)).toBe(
        'C=US, ST=California, L=San Francisco, O=InfraKit Test, ' +
          'OU=Engineering, CN=leaf.infrakit.test, E=test@infrakit.test',
      )
    })

    it('subject and issuer are identical, so it is self-signed', () => {
      const cert = result.certificates[0]
      expect(distinguishedNameFormatted(cert.issuer)).toBe(distinguishedNameFormatted(cert.subject))
      expect(cert.isSelfSigned).toBe(true)
    })

    it('parses the serial number in both hex and decimal', () => {
      const cert = result.certificates[0]
      expect(cert.serialNumberHex).toBe('1A2B3C4D5E')
      expect(cert.serialNumberDecimal).toBe('112394521950')
    })

    it('parses version and validity window exactly', () => {
      const cert = result.certificates[0]
      expect(cert.version).toBe(3)
      expect(cert.notBefore.getTime()).toBe(Date.UTC(2024, 0, 1))
      expect(cert.notAfter.getTime()).toBe(Date.UTC(2034, 0, 1))
    })

    it('reports fingerprints matching `openssl x509 -fingerprint`', () => {
      const cert = result.certificates[0]
      expect(cert.sha1Fingerprint).toBe('AD:7F:DE:FC:33:C0:69:DA:02:1E:60:6E:02:D7:C1:E3:04:82:16:36')
      expect(cert.sha256Fingerprint).toBe(
        'A7:81:68:DE:60:71:15:F8:FF:45:13:17:71:A8:98:22:B6:8E:E0:6A:AF:C9:93:33:BA:0C:45:AE:15:31:75:B3',
      )
      expect(cert.md5Fingerprint).toBe('07:09:D4:5D:D7:7B:8A:F4:A2:D7:B1:11:E1:04:EE:D2')
    })

    it('parses subject alternative names', () => {
      const cert = result.certificates[0]
      expect(cert.subjectAlternativeNames).toEqual(
        expect.arrayContaining(['leaf.infrakit.test', 'www.leaf.infrakit.test', '127.0.0.1']),
      )
    })

    it('parses the CRL distribution point', () => {
      const cert = result.certificates[0]
      expect(cert.crlDistributionPoints).toEqual(['http://crl.infrakit.test/leaf.crl'])
    })

    it('is not a certificate authority', () => {
      const cert = result.certificates[0]
      // DER omits a BOOLEAN that equals its DEFAULT (cA DEFAULT FALSE), so a
      // leaf's basicConstraints extension carries no explicit cA value at
      // all; the core reports that as null rather than false.
      expect(cert.isCertificateAuthority).toBeNull()
    })

    it('parses the RSA public key', () => {
      const cert = result.certificates[0]
      expect(cert.publicKeyAlgorithm).toBe('rsaEncryption')
      expect(cert.publicKeyBits).toBe(2048)
      expect(cert.publicKeyExponent).toBe(65537)
      expect(cert.publicKeyCurve).toBeNull()
    })

    it('parses the signature algorithm', () => {
      const cert = result.certificates[0]
      expect(cert.signatureAlgorithm).toBe('sha256WithRSAEncryption')
    })

    it('displayName falls back to the common name', () => {
      expect(result.certificates[0].displayName).toBe('leaf.infrakit.test')
    })

    it('round-trips the original single-cert PEM', () => {
      expect(result.certificates[0].pem).toContain('BEGIN CERTIFICATE')
      expect(result.certificates[0].pem).toContain('END CERTIFICATE')
    })
  })

  describe('expiry detection against a fixed clock', () => {
    // chainLeafPem is valid 2024-06-01T00:00:00Z .. 2024-08-01T00:00:00Z.
    it('well inside the window is valid', () => {
      const result = inspect(chainLeafPem, new Date(Date.UTC(2024, 5, 15)))
      const cert = result.certificates[0]
      expect(cert.status).toBe('valid')
      expect(cert.isExpired).toBe(false)
      expect(cert.isCurrentlyValid).toBe(true)
      expect(cert.daysUntilExpiry).toBeGreaterThan(X509Inspector.expiringSoonThresholdMs / 86_400_000)
    })

    it('inside the 30-day renewal window is expiringSoon', () => {
      // notAfter - now = 17 days.
      const result = inspect(chainLeafPem, new Date(Date.UTC(2024, 6, 15)))
      const cert = result.certificates[0]
      expect(cert.status).toBe('expiringSoon')
      expect(cert.isExpired).toBe(false)
      expect(cert.isCurrentlyValid).toBe(true)
      expect(cert.daysUntilExpiry).toBeLessThanOrEqual(X509Inspector.expiringSoonThresholdMs / 86_400_000)
    })

    it('after notAfter is expired', () => {
      const result = inspect(chainLeafPem, new Date(Date.UTC(2024, 8, 1)))
      const cert = result.certificates[0]
      expect(cert.status).toBe('expired')
      expect(cert.isExpired).toBe(true)
      expect(cert.isCurrentlyValid).toBe(false)
      expect(cert.timeUntilExpiryMs).toBeLessThan(0)
    })

    it('before notBefore is notYetValid', () => {
      const result = inspect(chainLeafPem, new Date(Date.UTC(2024, 4, 1)))
      const cert = result.certificates[0]
      expect(cert.status).toBe('notYetValid')
      expect(cert.isExpired).toBe(false)
      expect(cert.isCurrentlyValid).toBe(false)
    })

    it('exactly at notAfter counts as expired', () => {
      const result = inspect(chainLeafPem, new Date(Date.UTC(2024, 7, 1)))
      expect(result.certificates[0].status).toBe('expired')
    })
  })

  describe('a multi-certificate PEM bundle (fullchain-style)', () => {
    const bundle = `${chainLeafPem}\n${rootCaPem}`
    const result = inspect(bundle, new Date(Date.UTC(2024, 5, 15)))

    it('parses both members and flags it as a chain', () => {
      expect(result.blocksFound).toBe(2)
      expect(result.certificates).toHaveLength(2)
      expect(result.errors).toEqual([])
      expect(result.isChain).toBe(true)
    })

    it('the leaf is issued by the root, not self-signed', () => {
      const leaf = result.certificates[0]
      expect(distinguishedNameCommonName(leaf.subject)).toBe('chain.infrakit.test')
      expect(distinguishedNameCommonName(leaf.issuer)).toBe('InfraKit Test Root CA')
      expect(leaf.isSelfSigned).toBe(false)
    })

    it('the root is self-signed and marked as a CA', () => {
      const root = result.certificates[1]
      expect(distinguishedNameCommonName(root.subject)).toBe('InfraKit Test Root CA')
      expect(root.isSelfSigned).toBe(true)
      expect(root.isCertificateAuthority).toBe(true)
      expect(root.pathLengthConstraint).toBe(0)
    })

    it('members keep their 0-based index within the bundle', () => {
      expect(result.certificates[0].index).toBe(0)
      expect(result.certificates[1].index).toBe(1)
    })

    it('one bad block among good ones still returns the good ones', () => {
      // A syntactically-present but undecodable certificate block sits
      // between two good ones; the good members must still come back, with
      // the bad one reported in errors instead of aborting everything.
      const corruptBlock = '-----BEGIN CERTIFICATE-----\nQUFBQUFBQUFBQUFBQUFBQQ==\n-----END CERTIFICATE-----'
      const mixed = `${chainLeafPem}\n${corruptBlock}\n${rootCaPem}`
      const mixedResult = inspect(mixed, new Date(Date.UTC(2024, 5, 15)))

      expect(mixedResult.blocksFound).toBe(3)
      expect(mixedResult.certificates).toHaveLength(2)
      expect(mixedResult.errors).toHaveLength(1)
      expect(mixedResult.errors[0]).toContain('Certificate 2 of 3')
      expect(distinguishedNameCommonName(mixedResult.certificates[0].subject)).toBe('chain.infrakit.test')
      expect(distinguishedNameCommonName(mixedResult.certificates[1].subject)).toBe('InfraKit Test Root CA')
    })
  })

  describe('DER input', () => {
    it('raw DER bytes (no PEM armour) parse the same as the PEM', () => {
      // The PEM body *is* base64 of the DER; decoding it back gives us
      // genuine DER bytes for the derBytes code path without needing a
      // second fixture file.
      const body = selfSignedLeafPem
        .replaceAll('-----BEGIN CERTIFICATE-----', '')
        .replaceAll('-----END CERTIFICATE-----', '')
        .replaceAll(/\s+/g, '')
      const binary = atob(body)
      const der = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) der[i] = binary.charCodeAt(i)

      const result = inspector.execute({ derBytes: der, now: new Date(Date.UTC(2025, 0, 1)) })
      expect(result.certificates).toHaveLength(1)
      expect(distinguishedNameCommonName(result.certificates[0].subject)).toBe('leaf.infrakit.test')
      expect(result.certificates[0].serialNumberHex).toBe('1A2B3C4D5E')
    })
  })

  describe('garbage / empty input errors cleanly', () => {
    it('empty input throws with a helpful message', () => {
      expect(() => inspector.execute({})).toThrow(/Paste PEM text or load a certificate file first/)
    })

    it('text with no BEGIN CERTIFICATE marker throws', () => {
      expect(() => inspect('this is just some prose about certificates, not one')).toThrow(/No certificate found/)
    })

    it('a BEGIN/END block full of garbage throws with a parse error', () => {
      const garbage = '-----BEGIN CERTIFICATE-----\nQUFBQUFBQUFBQUFBQUFBQQ==\n-----END CERTIFICATE-----'
      expect(() => inspect(garbage)).toThrow(X509InspectException)
    })

    it('the exception message never leaks a raw stack trace', () => {
      try {
        inspect('not a certificate at all')
        expect.unreachable('expected an X509InspectException')
      } catch (e) {
        expect(e).toBeInstanceOf(X509InspectException)
        expect(String((e as X509InspectException).toString())).not.toContain('#0')
      }
    })
  })

  describe('extractPemBlocks', () => {
    it('extracts a single block', () => {
      expect(X509Inspector.extractPemBlocks(selfSignedLeafPem)).toHaveLength(1)
    })

    it('extracts multiple blocks and ignores surrounding commentary', () => {
      const withCommentary = `Certificate chain:\n0 s:CN=chain\n${chainLeafPem}\nSome trailer text\n${rootCaPem}`
      expect(X509Inspector.extractPemBlocks(withCommentary)).toHaveLength(2)
    })

    it('returns an empty list when there is no marker at all', () => {
      expect(X509Inspector.extractPemBlocks('nothing here')).toEqual([])
    })
  })

  describe('keyUsage / extendedKeyUsage extensions', () => {
    it('a certificate with a keyUsage extension parses correctly', () => {
      const certWithKeyUsage = `-----BEGIN CERTIFICATE-----
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
`
      const result = inspect(certWithKeyUsage, new Date(Date.UTC(2025, 0, 1)))
      expect(result.errors).toEqual([])
      expect(result.certificates).toHaveLength(1)
      expect(result.certificates[0].keyUsage).toContain('digitalSignature')
      expect(result.certificates[0].keyUsage).toContain('keyEncipherment')
      expect(result.certificates[0].extendedKeyUsage.length).toBeGreaterThan(0)
    })
  })
})
