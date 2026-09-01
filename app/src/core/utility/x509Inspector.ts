import { AsnParser } from '@peculiar/asn1-schema'
import {
  Certificate,
  CRLDistributionPoints,
  ExtendedKeyUsage,
  BasicConstraints,
  KeyUsage,
  SubjectAlternativeName,
  type GeneralName,
} from '@peculiar/asn1-x509'
import { RSAPublicKey } from '@peculiar/asn1-rsa'
import { ECParameters } from '@peculiar/asn1-ecc'
import { md5, sha1 } from '@noble/hashes/legacy.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { IToolUseCase } from '../ports/IToolUseCase'

/** Where a certificate sits relative to its validity window right now. */
export type CertificateValidityStatus = 'notYetValid' | 'valid' | 'expiringSoon' | 'expired'

/** One relative distinguished name component, e.g. `CN=example.com`. */
export interface DistinguishedNameEntry {
  /** The dotted OID of the attribute type (e.g. `2.5.4.3`). */
  oid: string
  /** Short label (`CN`, `O`, `E`, …) or the raw OID when it isn't a known one. */
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
 * has to import a certificate-parsing library.
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

  /** Readable name, e.g. `sha256WithRSAEncryption`; falls back to the raw OID. */
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

  /** SANs (DNS names, IP addresses, URIs, emails). */
  subjectAlternativeNames: string[]

  /** The `cA` flag of the basic constraints extension. Null when the extension is absent or carries no explicit value. */
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

/** Conventional `openssl`-style ordering for the one-line DN rendering. */
const DN_ORDER: readonly string[] = ['C', 'ST', 'L', 'STREET', 'O', 'OU', 'CN', 'E']

/** X.500 attribute-type OID → short label. Unknown OIDs pass through verbatim. */
const DN_OID_TO_SHORT: Record<string, string> = {
  '2.5.4.3': 'CN',
  '2.5.4.4': 'SN',
  '2.5.4.5': 'serialNumber',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.9': 'STREET',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '2.5.4.12': 'T',
  '2.5.4.42': 'GN',
  '0.9.2342.19200300.100.1.25': 'DC',
  '1.2.840.113549.1.9.1': 'E',
}

/** Signature-algorithm OID → `openssl x509 -text` style name. */
const SIG_OID_TO_NAME: Record<string, string> = {
  '1.2.840.113549.1.1.4': 'md5WithRSAEncryption',
  '1.2.840.113549.1.1.5': 'sha1WithRSAEncryption',
  '1.2.840.113549.1.1.10': 'rsassaPss',
  '1.2.840.113549.1.1.11': 'sha256WithRSAEncryption',
  '1.2.840.113549.1.1.12': 'sha384WithRSAEncryption',
  '1.2.840.113549.1.1.13': 'sha512WithRSAEncryption',
  '1.2.840.10045.4.1': 'ecdsa-with-SHA1',
  '1.2.840.10045.4.3.2': 'ecdsa-with-SHA256',
  '1.2.840.10045.4.3.3': 'ecdsa-with-SHA384',
  '1.2.840.10045.4.3.4': 'ecdsa-with-SHA512',
}

/** Named-curve OID → (name, field size in bits). */
const CURVE_OID: Record<string, { name: string; bits: number }> = {
  '1.2.840.10045.3.1.7': { name: 'prime256v1', bits: 256 },
  '1.3.132.0.10': { name: 'secp256k1', bits: 256 },
  '1.3.132.0.34': { name: 'secp384r1', bits: 384 },
  '1.3.132.0.35': { name: 'secp521r1', bits: 521 },
}

/** Extended-key-usage OID → name. */
const EKU_OID: Record<string, string> = {
  '1.3.6.1.5.5.7.3.1': 'serverAuth',
  '1.3.6.1.5.5.7.3.2': 'clientAuth',
  '1.3.6.1.5.5.7.3.3': 'codeSigning',
  '1.3.6.1.5.5.7.3.4': 'emailProtection',
  '1.3.6.1.5.5.7.3.8': 'timeStamping',
  '1.3.6.1.5.5.7.3.9': 'ocspSigning',
}

const RSA_ENCRYPTION_OID = '1.2.840.113549.1.1.1'
const EC_PUBLIC_KEY_OID = '1.2.840.10045.2.1'

/**
 * Parses X.509 certificates (PEM or DER) and reports the fields an operator
 * actually needs when debugging TLS: who it is for, who signed it, when it
 * expires, how it is keyed, its fingerprints, and its SAN / key-usage
 * extensions.
 *
 * Backed by `@peculiar/asn1-x509` (structure) + `@noble/hashes` (fingerprints)
 * — every value is copied into the plain data objects above so no parser type
 * escapes the core.
 *
 * A PEM bundle containing a full chain is parsed member by member; one bad
 * block does not discard the rest.
 *
 * Note this inspects a certificate in isolation. It does not verify the
 * signature, check the chain against a trust store, or consult CRL/OCSP —
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

  /** Wraps raw DER bytes in PEM armour. */
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
    const der = pemBodyToBytes(pem)
    const cert = AsnParser.parse(der, Certificate)
    const tbs = cert.tbsCertificate

    const notBefore = timeToDate(tbs.validity.notBefore)
    const notAfter = timeToDate(tbs.validity.notAfter)

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

    const subject = dnFrom(tbs.subject)
    const issuer = dnFrom(tbs.issuer)

    const serialNumberHex = bytesToHex(new Uint8Array(tbs.serialNumber)).replace(/^0+(?=.)/, '').toUpperCase() || '0'
    const serialNumberDecimal = BigInt(`0x${serialNumberHex}`).toString(10)

    const sigOid = cert.signatureAlgorithm.algorithm
    const signatureAlgorithm = SIG_OID_TO_NAME[sigOid] ?? sigOid

    const pubkeyInfo = publicKeyInfoFrom(tbs.subjectPublicKeyInfo)

    const ext = new ExtensionSet(tbs.extensions ?? [])
    const bc = ext.basicConstraints()

    const subjectFormatted = distinguishedNameFormatted(subject)
    const issuerFormatted = distinguishedNameFormatted(issuer)

    const daysUntilExpiry = Math.trunc(timeUntilExpiryMs / 86_400_000)
    const isExpired = status === 'expired'
    const isCurrentlyValid = status === 'valid' || status === 'expiringSoon'

    const subjectAlternativeNames = ext.subjectAltNames()

    const commonName = distinguishedNameCommonName(subject)
    const displayName =
      commonName != null && commonName.length > 0
        ? commonName
        : subjectFormatted.length > 0
          ? subjectFormatted
          : subjectAlternativeNames.length > 0
            ? subjectAlternativeNames[0]
            : `Certificate ${index + 1}`

    const derFull = new Uint8Array(der)

    return {
      index,
      subject,
      issuer,
      serialNumberHex,
      serialNumberDecimal,
      version: (tbs.version ?? 0) + 1,
      notBefore,
      notAfter,
      status,
      timeUntilExpiryMs,
      daysUntilExpiry,
      signatureAlgorithm,
      signatureAlgorithmOid: sigOid,
      publicKeyAlgorithm: pubkeyInfo.algorithm,
      publicKeyOid: pubkeyInfo.oid,
      publicKeyBits: pubkeyInfo.bits,
      publicKeyCurve: pubkeyInfo.curve,
      publicKeyExponent: pubkeyInfo.exponent,
      sha1Fingerprint: colonHex(bytesToHex(sha1(derFull))),
      sha256Fingerprint: colonHex(bytesToHex(sha256(derFull))),
      md5Fingerprint: colonHex(bytesToHex(md5(derFull))),
      subjectAlternativeNames,
      isCertificateAuthority: bc.ca,
      pathLengthConstraint: bc.pathLen,
      keyUsage: ext.keyUsage(),
      extendedKeyUsage: ext.extendedKeyUsage(),
      crlDistributionPoints: ext.crlDistributionPoints(),
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

function publicKeyInfoFrom(spki: {
  algorithm: { algorithm: string; parameters?: ArrayBuffer | null }
  subjectPublicKey: ArrayBuffer
}): PublicKeyInfo {
  const oid = spki.algorithm.algorithm

  if (oid === RSA_ENCRYPTION_OID) {
    let bits: number | null = null
    let exponent: number | null = null
    try {
      const rsa = AsnParser.parse(spki.subjectPublicKey, RSAPublicKey)
      bits = bigIntFromBytes(new Uint8Array(rsa.modulus)).toString(2).length
      const e = bigIntFromBytes(new Uint8Array(rsa.publicExponent))
      exponent = e <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(e) : null
    } catch {
      /* leave nulls */
    }
    return { algorithm: 'rsaEncryption', oid: RSA_ENCRYPTION_OID, bits, curve: null, exponent }
  }

  if (oid === EC_PUBLIC_KEY_OID) {
    let curve: string | null = null
    let bits: number | null = null
    if (spki.algorithm.parameters) {
      try {
        const params = AsnParser.parse(spki.algorithm.parameters, ECParameters)
        if (params.namedCurve) {
          const info = CURVE_OID[params.namedCurve]
          curve = info?.name ?? params.namedCurve
          bits = info?.bits ?? null
        }
      } catch {
        /* leave nulls */
      }
    }
    return { algorithm: 'ecPublicKey', oid: EC_PUBLIC_KEY_OID, bits, curve, exponent: null }
  }

  return { algorithm: oid, oid, bits: null, curve: null, exponent: null }
}

/** Wraps the extension list with typed accessors. */
class ExtensionSet {
  private byOid = new Map<string, ArrayBuffer>()

  constructor(exts: Array<{ extnID: string; extnValue: { buffer: ArrayBuffer } | ArrayBuffer }>) {
    for (const e of exts) {
      const v = e.extnValue
      this.byOid.set(e.extnID, 'buffer' in v ? v.buffer : v)
    }
  }

  basicConstraints(): { ca: boolean | null; pathLen: number | null } {
    const raw = this.byOid.get('2.5.29.19')
    if (!raw) return { ca: null, pathLen: null }
    const bytes = new Uint8Array(raw)
    // An empty `SEQUENCE {}` (30 00) means cA carried no explicit value — a
    // leaf's basicConstraints. Report that as null rather than the DEFAULT.
    const empty = bytes.length === 2 && bytes[0] === 0x30 && bytes[1] === 0x00
    try {
      const bc = AsnParser.parse(raw, BasicConstraints)
      return {
        ca: empty ? null : (bc.cA ?? false),
        pathLen: bc.pathLenConstraint ?? null,
      }
    } catch {
      return { ca: null, pathLen: null }
    }
  }

  keyUsage(): string[] {
    const raw = this.byOid.get('2.5.29.15')
    if (!raw) return []
    try {
      return AsnParser.parse(raw, KeyUsage).toJSON()
    } catch {
      return []
    }
  }

  extendedKeyUsage(): string[] {
    const raw = this.byOid.get('2.5.29.37')
    if (!raw) return []
    try {
      return [...AsnParser.parse(raw, ExtendedKeyUsage)].map((o) => EKU_OID[o] ?? o)
    } catch {
      return []
    }
  }

  subjectAltNames(): string[] {
    const raw = this.byOid.get('2.5.29.17')
    if (!raw) return []
    try {
      return AsnParser.parse(raw, SubjectAlternativeName).map(generalNameToString).filter((s): s is string => s != null)
    } catch {
      return []
    }
  }

  crlDistributionPoints(): string[] {
    const raw = this.byOid.get('2.5.29.31')
    if (!raw) return []
    try {
      const out: string[] = []
      for (const point of AsnParser.parse(raw, CRLDistributionPoints)) {
        for (const gn of point.distributionPoint?.fullName ?? []) {
          const s = generalNameToString(gn)
          if (s != null) out.push(s)
        }
      }
      return out
    } catch {
      return []
    }
  }
}

function generalNameToString(gn: GeneralName): string | null {
  if (gn.dNSName != null) return gn.dNSName
  if (gn.iPAddress != null) return typeof gn.iPAddress === 'string' ? gn.iPAddress : ipFromBytes(gn.iPAddress)
  if (gn.rfc822Name != null) return gn.rfc822Name
  if (gn.uniformResourceIdentifier != null) return gn.uniformResourceIdentifier
  return null
}

function ipFromBytes(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf)
  if (b.length === 4) return b.join('.')
  if (b.length === 16) {
    const parts: string[] = []
    for (let i = 0; i < 16; i += 2) parts.push(((b[i] << 8) | b[i + 1]).toString(16))
    return parts.join(':')
  }
  return bytesToHex(b)
}

function dnFrom(name: Array<Array<{ type: string; value: { toString(): string } }>>): DistinguishedName {
  const entries: DistinguishedNameEntry[] = []
  for (const rdn of name) {
    for (const atv of rdn) {
      const value = atv.value.toString()
      if (value.length === 0) continue
      entries.push({ oid: atv.type, shortName: DN_OID_TO_SHORT[atv.type] ?? atv.type, value })
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

function timeToDate(t: { utcTime?: Date | null; generalTime?: Date | null }): Date {
  return t.utcTime ?? t.generalTime ?? new Date(NaN)
}

function bigIntFromBytes(bytes: Uint8Array): bigint {
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  return n
}

/** Colon-separated uppercase hex, as `openssl x509 -fingerprint` prints. */
function colonHex(hex: string): string {
  if (hex.length === 0) return ''
  const upper = hex.toUpperCase()
  const pairs: string[] = []
  for (let i = 0; i + 1 < upper.length; i += 2) {
    pairs.push(upper.slice(i, i + 2))
  }
  return pairs.join(':')
}

function pemBodyToBytes(pem: string): Uint8Array {
  const body = pem
    .replace(BEGIN_MARKER, '')
    .replace(END_MARKER, '')
    .replace(/\s+/g, '')
  const binary = atob(body)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
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
