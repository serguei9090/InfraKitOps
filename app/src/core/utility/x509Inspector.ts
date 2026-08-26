import { KJUR, X509, zulutodate } from 'jsrsasign'
import type { IToolUseCase } from '../ports/IToolUseCase'

/** Where a certificate sits relative to its validity window right now. */
export type CertificateValidityStatus = 'notYetValid' | 'valid' | 'expiringSoon' | 'expired'

/** One relative distinguished name component, e.g. `CN=example.com`. */
export interface DistinguishedNameEntry {
  /**
   * The short label jsrsasign resolves at parse time (`CN`, `O`, `OU`, `C`,
   * `E` for emailAddress, …), or the raw dotted OID when jsrsasign does not
   * recognise it. Unlike the Dart reference (which keys its DN map by OID
   * and maps a handful of well-known ones back to short labels itself),
   * jsrsasign's `X509#getSubject()`/`getIssuer()` already return the
   * resolved short label directly and do not separately expose the OID, so
   * `oid` mirrors `shortName` here rather than being a distinct dotted
   * string — a library-shape difference, not a missing feature.
   */
  oid: string
  shortName: string
  value: string
}

/**
 * A parsed distinguished name: the ordered components plus the familiar
 * single-line rendering.
 */
export interface DistinguishedName {
  entries: DistinguishedNameEntry[]
}

/** e.g. `CN=example.com, O=Example Inc, C=US`. Empty string when the DN carried no recognisable components. */
export function distinguishedNameFormatted(dn: DistinguishedName): string {
  return dn.entries.map((e) => `${e.shortName}=${e.value}`).join(', ')
}

/** The common name, if present. */
export function distinguishedNameCommonName(dn: DistinguishedName): string | null {
  return dn.entries.find((e) => e.shortName === 'CN')?.value ?? null
}

export function distinguishedNameIsEmpty(dn: DistinguishedName): boolean {
  return dn.entries.length === 0
}

/**
 * Everything this tool can report about one certificate. Deliberately a
 * plain data object holding only TS primitive types, so the UI layer never
 * has to import `jsrsasign`.
 */
export interface CertificateInfo {
  /** 0-based position within the parsed bundle. */
  index: number

  subject: DistinguishedName
  issuer: DistinguishedName

  /** Uppercase hex, no separators — matches `openssl x509 -serial`. */
  serialNumberHex: string
  serialNumberDecimal: string

  /** X.509 version number (1, 2 or 3). */
  version: number

  notBefore: Date
  notAfter: Date

  status: CertificateValidityStatus

  /** Milliseconds until expiry; positive while still valid, negative once expired. */
  timeUntilExpiryMs: number
  /** `timeUntilExpiryMs` in whole days; negative once expired. */
  daysUntilExpiry: number

  /**
   * Readable name for the signature algorithm (e.g. `sha256WithRSAEncryption`)
   * where this port's small local OID table recognises jsrsasign's algorithm
   * name, otherwise jsrsasign's own name (e.g. `SHA256withRSA`) verbatim.
   */
  signatureAlgorithm: string
  signatureAlgorithmOid: string

  /** e.g. `rsaEncryption`, `ecPublicKey`. */
  publicKeyAlgorithm: string
  publicKeyOid: string | null

  /** Key size in bits (RSA modulus length / EC field size). Null when it could not be determined. */
  publicKeyBits: number | null

  /** Named curve for EC keys, e.g. `prime256v1`. Null for RSA. */
  publicKeyCurve: string | null

  /** RSA public exponent, e.g. 65537. Null for non-RSA keys. */
  publicKeyExponent: number | null

  /** Uppercase colon-separated hex over the DER encoding — the same value `openssl x509 -fingerprint` prints. */
  sha1Fingerprint: string
  sha256Fingerprint: string
  md5Fingerprint: string

  /** SANs as jsrsasign reports them (DNS names and IP addresses). */
  subjectAlternativeNames: string[]

  /** The `cA` flag of the basic constraints extension. Null when the extension is absent. */
  isCertificateAuthority: boolean | null

  /** `pathLenConstraint` of the basic constraints extension, when present. */
  pathLengthConstraint: number | null

  /** e.g. `digitalSignature`, `keyEncipherment`. */
  keyUsage: string[]

  /** e.g. `serverAuth`, `clientAuth`. */
  extendedKeyUsage: string[]

  crlDistributionPoints: string[]

  /**
   * True when subject and issuer DNs match — a self-signed or root
   * certificate. Note this is a name comparison only; no signature is
   * verified.
   */
  isSelfSigned: boolean

  /** The single-certificate PEM this entry was parsed from. */
  pem: string

  isExpired: boolean
  isCurrentlyValid: boolean

  /** Best available display label: CN if present, else the whole subject DN, else the first SAN, else a positional fallback. */
  displayName: string
}

export interface X509InspectInput {
  /**
   * PEM text; may contain several `-----BEGIN CERTIFICATE-----` blocks (a
   * fullchain.pem) and may be interleaved with `openssl x509 -text` style
   * commentary, which is ignored.
   */
  pemText?: string
  /**
   * Raw DER bytes for a single certificate. Used when `pemText` is null or
   * blank. Bytes that are actually PEM text are detected and handled.
   */
  derBytes?: Uint8Array
  /** Reference instant for the validity check. Defaults to now. */
  now?: Date
}

/**
 * The outcome of inspecting an input. `certificates` holds every block that
 * parsed; `errors` holds one entry per block that did not, so a chain with
 * one bad member still shows the good ones.
 */
export interface X509InspectResult {
  certificates: CertificateInfo[]
  /** Human-readable messages, e.g. "Certificate 2 could not be parsed: …". */
  errors: string[]
  /** How many `-----BEGIN CERTIFICATE-----` blocks were seen in the input. */
  blocksFound: number
  hasCertificates: boolean
  isChain: boolean
}

/**
 * Thrown by `X509Inspector.execute` only when the input as a whole is
 * unusable (empty, or containing no certificate block at all). Per-block
 * failures are reported via `X509InspectResult.errors` instead.
 */
export class X509InspectException extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'X509InspectException'
  }
}

const BEGIN_MARKER = '-----BEGIN CERTIFICATE-----'
const END_MARKER = '-----END CERTIFICATE-----'

/** A certificate inside this window of its `notAfter` is reported as `expiringSoon`. */
const EXPIRING_SOON_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000

/**
 * jsrsasign keys its DN entries by short label already (e.g. `CN`, `O`,
 * `E` for emailAddress) rather than by OID, so -- unlike the Dart reference,
 * which keeps its own OID -> short-label table -- there is no separate
 * mapping step here. This is just the conventional `openssl`-style ordering
 * for the one-line rendering. `E` (jsrsasign's short label for
 * emailAddress) sits where Dart's `emailAddress` did.
 */
const DN_ORDER: readonly string[] = ['C', 'ST', 'L', 'STREET', 'O', 'OU', 'CN', 'E']

/**
 * Best-effort local table mapping jsrsasign's `getSignatureAlgorithmField()`
 * names (e.g. `SHA256withRSA`) to the OpenSSL-style readable name and OID
 * `openssl x509 -text` prints (e.g. `sha256WithRSAEncryption`). jsrsasign
 * does not expose the AlgorithmIdentifier OID as a simple getter the way
 * Dart's `basic_utils` does, so this small table covers the common RSA/ECDSA
 * combinations; anything outside it falls back to jsrsasign's own name
 * verbatim (see `resolveSignatureAlgorithm`).
 */
const SIGNATURE_ALGORITHM_INFO: Record<string, { name: string; oid: string }> = {
  MD5withRSA: { name: 'md5WithRSAEncryption', oid: '1.2.840.113549.1.1.4' },
  SHA1withRSA: { name: 'sha1WithRSAEncryption', oid: '1.2.840.113549.1.1.5' },
  SHA256withRSA: { name: 'sha256WithRSAEncryption', oid: '1.2.840.113549.1.1.11' },
  SHA384withRSA: { name: 'sha384WithRSAEncryption', oid: '1.2.840.113549.1.1.12' },
  SHA512withRSA: { name: 'sha512WithRSAEncryption', oid: '1.2.840.113549.1.1.13' },
  SHA1withECDSA: { name: 'ecdsa-with-SHA1', oid: '1.2.840.10045.4.1' },
  SHA256withECDSA: { name: 'ecdsa-with-SHA256', oid: '1.2.840.10045.4.3.2' },
  SHA384withECDSA: { name: 'ecdsa-with-SHA384', oid: '1.2.840.10045.4.3.3' },
  SHA512withECDSA: { name: 'ecdsa-with-SHA512', oid: '1.2.840.10045.4.3.4' },
}

const RSA_ENCRYPTION_OID = '1.2.840.113549.1.1.1'
const EC_PUBLIC_KEY_OID = '1.2.840.10045.2.1'

/**
 * Parses X.509 certificates (PEM or DER) and reports the fields an operator
 * actually needs when debugging TLS: who it is for, who signed it, when it
 * expires, how it is keyed, its fingerprints, and its SAN / key-usage
 * extensions.
 *
 * Ported from `lib/core/utility/x509_inspector.dart`, which was backed by
 * `package:basic_utils`. This port is backed by `jsrsasign`'s `X509` class
 * instead (the closest browser-safe equivalent among this batch's allowed
 * packages) — every value is still copied into the plain data objects above
 * so no `jsrsasign` type escapes the core. See the field-level doc comments
 * above for the handful of places the two libraries' output shapes genuinely
 * differ (DN short-label spelling for emailAddress, signature-algorithm
 * naming, EC key introspection).
 *
 * A PEM bundle containing a full chain is parsed member by member; one bad
 * block does not discard the rest.
 *
 * Note this inspects a certificate in isolation. It does not verify the
 * signature, check the chain against a trust store, or consult CRL/OCSP --
 * `CertificateInfo.isSelfSigned` is a DN comparison, nothing more.
 */
export class X509Inspector implements IToolUseCase<X509InspectInput, X509InspectResult> {
  static readonly expiringSoonThresholdMs = EXPIRING_SOON_THRESHOLD_MS
  static readonly beginMarker = BEGIN_MARKER
  static readonly endMarker = END_MARKER

  execute(input: X509InspectInput): X509InspectResult {
    const now = input.now ?? new Date()

    const pemText = this.resolveSource(input)
    const blocks = X509Inspector.extractPemBlocks(pemText)
    if (blocks.length === 0) {
      throw new X509InspectException(
        'No certificate found. Expected PEM text containing a ' +
          '"-----BEGIN CERTIFICATE-----" block, or DER bytes.',
      )
    }

    const certificates: CertificateInfo[] = []
    const errors: string[] = []

    for (let i = 0; i < blocks.length; i++) {
      try {
        certificates.push(this.inspectOne(blocks[i], certificates.length, now))
      } catch (e) {
        errors.push(`Certificate ${i + 1} of ${blocks.length} could not be parsed: ${messageOf(e)}`)
      }
    }

    if (certificates.length === 0) {
      throw new X509InspectException(errors.length === 0 ? 'The certificate could not be parsed.' : errors.join('\n'))
    }

    return {
      certificates,
      errors,
      blocksFound: blocks.length,
      hasCertificates: certificates.length > 0,
      isChain: certificates.length > 1,
    }
  }

  /**
   * Normalises the input into PEM text: uses `X509InspectInput.pemText` when
   * it has content, otherwise wraps the DER bytes (or decodes them as text
   * when they turn out to be PEM already).
   */
  private resolveSource(input: X509InspectInput): string {
    const text = input.pemText
    if (text != null && text.trim().length > 0) return text

    const der = input.derBytes
    if (der == null || der.length === 0) {
      throw new X509InspectException('Paste PEM text or load a certificate file first.')
    }

    // A .crt/.cer file may hold either PEM or DER; sniff for the marker.
    if (der.length > 0 && der[0] === 0x2d) {
      try {
        const decoded = new TextDecoder('utf-8', { fatal: false }).decode(der)
        if (decoded.includes(BEGIN_MARKER)) return decoded
      } catch {
        // fall through to DER handling
      }
    }
    return X509Inspector.derToPem(der)
  }

  /** Wraps raw DER bytes in PEM armour so `X509` can read them. */
  static derToPem(der: Uint8Array): string {
    const body = bytesToBase64(der)
    const lines = [BEGIN_MARKER]
    for (let i = 0; i < body.length; i += 64) {
      lines.push(body.slice(i, Math.min(i + 64, body.length)))
    }
    lines.push(END_MARKER)
    return lines.join('\n')
  }

  /**
   * Pulls every `BEGIN/END CERTIFICATE` block out of `text`, ignoring any
   * surrounding commentary (a `openssl x509 -text` dump, a Kubernetes
   * secret listing, plain prose). Returns normalised single-cert PEMs.
   */
  static extractPemBlocks(text: string): string[] {
    const blocks: string[] = []
    let searchFrom = 0
    while (true) {
      const start = text.indexOf(BEGIN_MARKER, searchFrom)
      if (start < 0) break
      const end = text.indexOf(END_MARKER, start)
      if (end < 0) break
      const bodyStart = start + BEGIN_MARKER.length
      const body = text
        .slice(bodyStart, end)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .join('')
      searchFrom = end + END_MARKER.length
      if (body.length === 0) continue

      const lines = [BEGIN_MARKER]
      for (let i = 0; i < body.length; i += 64) {
        lines.push(body.slice(i, Math.min(i + 64, body.length)))
      }
      lines.push(END_MARKER)
      blocks.push(lines.join('\n'))
    }
    return blocks
  }

  private inspectOne(pem: string, index: number, now: Date): CertificateInfo {
    const x = new X509(pem)

    const notBefore = zulutodate(x.getNotBefore())
    const notAfter = zulutodate(x.getNotAfter())

    const timeUntilExpiryMs = notAfter.getTime() - now.getTime()
    let status: CertificateValidityStatus
    if (now.getTime() < notBefore.getTime()) {
      status = 'notYetValid'
    } else if (timeUntilExpiryMs <= 0) {
      status = 'expired'
    } else if (timeUntilExpiryMs <= EXPIRING_SOON_THRESHOLD_MS) {
      status = 'expiringSoon'
    } else {
      status = 'valid'
    }

    const subject = dnFrom(x.getSubject())
    const issuer = dnFrom(x.getIssuer())

    const serialNumberHex = x.getSerialNumberHex().toUpperCase()
    const serialNumberDecimal = BigInt(`0x${serialNumberHex}`).toString(10)

    const sigAlgRaw = x.getSignatureAlgorithmField()
    const sigAlgInfo = SIGNATURE_ALGORITHM_INFO[sigAlgRaw] ?? { name: sigAlgRaw, oid: sigAlgRaw }

    const pubkeyInfo = publicKeyInfoFrom(x)

    const bc = x.getExtBasicConstraints()
    const ku = x.getExtKeyUsage()
    const eku = x.getExtExtKeyUsage()
    const san = x.getExtSubjectAltName()
    const cdp = x.getExtCRLDistributionPoints()

    const subjectFormatted = distinguishedNameFormatted(subject)
    const issuerFormatted = distinguishedNameFormatted(issuer)

    const daysUntilExpiry = Math.trunc(timeUntilExpiryMs / 86_400_000)
    const isExpired = status === 'expired'
    const isCurrentlyValid = status === 'valid' || status === 'expiringSoon'

    const subjectAlternativeNames = subjectAltNamesFrom(san)

    const commonName = distinguishedNameCommonName(subject)
    const displayName =
      commonName != null && commonName.length > 0
        ? commonName
        : subjectFormatted.length > 0
          ? subjectFormatted
          : subjectAlternativeNames.length > 0
            ? subjectAlternativeNames[0]
            : `Certificate ${index + 1}`

    return {
      index,
      subject,
      issuer,
      serialNumberHex,
      serialNumberDecimal,
      version: x.getVersion(),
      notBefore,
      notAfter,
      status,
      timeUntilExpiryMs,
      daysUntilExpiry,
      signatureAlgorithm: sigAlgInfo.name,
      signatureAlgorithmOid: sigAlgInfo.oid,
      publicKeyAlgorithm: pubkeyInfo.algorithm,
      publicKeyOid: pubkeyInfo.oid,
      publicKeyBits: pubkeyInfo.bits,
      publicKeyCurve: pubkeyInfo.curve,
      publicKeyExponent: pubkeyInfo.exponent,
      sha1Fingerprint: colonHex(KJUR.crypto.Util.hashHex(x.hex, 'sha1')),
      sha256Fingerprint: colonHex(KJUR.crypto.Util.hashHex(x.hex, 'sha256')),
      md5Fingerprint: colonHex(KJUR.crypto.Util.hashHex(x.hex, 'md5')),
      subjectAlternativeNames,
      isCertificateAuthority: bc?.cA ?? null,
      pathLengthConstraint: bc?.pathLen ?? null,
      keyUsage: ku?.names ?? [],
      extendedKeyUsage: eku?.array ?? [],
      crlDistributionPoints: crlUrisFrom(cdp),
      isSelfSigned: subjectFormatted.length > 0 && subjectFormatted === issuerFormatted,
      pem,
      isExpired,
      isCurrentlyValid,
      displayName,
    }
  }
}

interface PublicKeyInfo {
  algorithm: string
  oid: string | null
  bits: number | null
  curve: string | null
  exponent: number | null
}

/**
 * Discriminates RSA vs. EC public keys off the shape jsrsasign hands back
 * (`RSAKey` instances expose `n`/`e`; `KJUR.crypto.ECDSA` instances expose
 * `curveName`). The EC branch has no test fixture in this batch to verify
 * against (no EC certificate was supplied) -- flagged as best-effort.
 */
function publicKeyInfoFrom(x: X509): PublicKeyInfo {
  const pk = x.getPublicKey() as unknown as {
    n?: { bitLength(): number }
    e?: number
    curveName?: string
  }

  if (pk.n != null && typeof pk.n.bitLength === 'function') {
    return {
      algorithm: 'rsaEncryption',
      oid: RSA_ENCRYPTION_OID,
      bits: pk.n.bitLength(),
      curve: null,
      exponent: pk.e ?? null,
    }
  }

  return {
    algorithm: 'ecPublicKey',
    oid: EC_PUBLIC_KEY_OID,
    bits: null,
    curve: pk.curveName ?? null,
    exponent: null,
  }
}

function dnFrom(parsed: { array: Array<Array<{ type: string; value: string }>> }): DistinguishedName {
  const entries: DistinguishedNameEntry[] = []
  for (const group of parsed.array) {
    for (const ava of group) {
      if (ava.value == null || ava.value.length === 0) continue
      entries.push({ oid: ava.type, shortName: ava.type, value: ava.value })
    }
  }

  entries.sort((a, b) => {
    const ia = DN_ORDER.indexOf(a.shortName)
    const ib = DN_ORDER.indexOf(b.shortName)
    if (ia === ib) return a.shortName.localeCompare(b.shortName)
    if (ia < 0) return 1
    if (ib < 0) return -1
    return ia - ib
  })

  return { entries }
}

/**
 * jsrsasign's own `GeneralName` type (see `@types/jsrsasign`'s `X509.d.ts`)
 * is a discriminated union of single-key objects — and, since a `GeneralName`
 * slot can be empty, `undefined` is one of its members. `Record<string,
 * string>` can't structurally match that (an object type never accepts a
 * bare `undefined`), so this mirrors the real union shape instead.
 */
type GeneralNameLike =
  | { dns: string }
  | { ip: string }
  | { rfc822: string }
  | { uri: string }
  | { dn: unknown }
  | { other: unknown }
  | undefined

function subjectAltNamesFrom(san: { array: GeneralNameLike[] } | undefined): string[] {
  if (san == null) return []
  const out: string[] = []
  for (const entry of san.array) {
    if (entry == null) continue
    if ('dns' in entry) out.push(entry.dns)
    else if ('ip' in entry) out.push(entry.ip)
    else if ('rfc822' in entry) out.push(entry.rfc822)
    else if ('uri' in entry) out.push(entry.uri)
  }
  return out
}

function crlUrisFrom(
  cdp: { array: Array<{ dpname?: { full?: GeneralNameLike[] } }> } | undefined,
): string[] {
  if (cdp == null) return []
  const out: string[] = []
  for (const point of cdp.array) {
    for (const gn of point.dpname?.full ?? []) {
      if (gn != null && 'uri' in gn) out.push(gn.uri)
    }
  }
  return out
}

/**
 * jsrsasign's `KJUR.crypto.Util.hashHex` returns thumbprints as unbroken
 * lowercase hex; insert the colons and uppercase operators expect when
 * comparing against `openssl` output.
 */
function colonHex(hex: string): string {
  if (hex.length === 0) return ''
  const upper = hex.toUpperCase()
  const pairs: string[] = []
  for (let i = 0; i + 1 < upper.length; i += 2) {
    pairs.push(upper.slice(i, i + 2))
  }
  return pairs.join(':')
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function messageOf(e: unknown): string {
  if (e instanceof X509InspectException) return e.message
  if (e instanceof Error) return e.message
  return String(e)
}
