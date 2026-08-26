/**
 * htpasswd / HTTP Basic auth generator — pure TS, no I/O, no React.
 *
 * Produces the `user:hash` lines that Apache's `mod_authn_file` and nginx's
 * `ngx_http_auth_basic_module` read, plus the `Authorization: Basic …` header
 * that the other half of a Basic-auth debugging session needs.
 *
 * Ported from `lib/core/utility/htpasswd_generator.dart` — see that file for
 * the full rationale on which algorithms are offered (bcrypt default, APR1
 * for legacy Apache compatibility, SHA-1 present only to read/reproduce
 * legacy files) and why plaintext/DES crypt(3) are deliberately not offered.
 *
 * ## APR1 correctness
 *
 * `apr1Crypt` is a direct transliteration of the reference `md5crypt` /
 * `apr_md5_encode` algorithm, including the two details that
 * re-implementations usually get wrong:
 *
 *  1. The digest buffer is zeroed before the `for (i = pwlen; i; i >>= 1)`
 *     loop, so the "bit set" branch appends a **NUL byte**, not a digest byte.
 *  2. The final 16 bytes are emitted in the scrambled order
 *     `0,6,12 / 1,7,13 / 2,8,14 / 3,9,15 / 4,10,5 / 11`, base64-ed with the
 *     `./0-9A-Za-z` alphabet, least-significant group first.
 *
 * The unit tests pin the output against the same reference vectors the Dart
 * version used (`openssl passwd -apr1 -salt <salt> <password>`).
 */

import bcrypt from 'bcryptjs'
import CryptoJS from 'crypto-js'
import type { IToolUseCase } from '../ports/IToolUseCase'

/** bcrypt cost (log2 rounds) bounds, per the algorithm's own spec. */
export const HTPASSWD_MIN_BCRYPT_COST = 4
export const HTPASSWD_MAX_BCRYPT_COST = 31

/** A sane 2020s default: roughly 50-100 ms per hash on server hardware. */
export const HTPASSWD_DEFAULT_BCRYPT_COST = 12

/** Below this, bcrypt stops being meaningfully expensive to brute-force. */
export const HTPASSWD_WEAK_BCRYPT_COST = 10

/** bcrypt ignores everything past the 72nd byte of the password. */
export const BCRYPT_PASSWORD_BYTE_LIMIT = 72

const textEncoder = new TextEncoder()

/** The password-hashing schemes this tool will emit. */
export type HtpasswdAlgorithm = 'bcrypt' | 'apr1' | 'sha1'

interface HtpasswdAlgorithmInfo {
  label: string
  /** The literal marker a hash of this type starts with. */
  prefix: string
  description: string
  /** True for schemes that must not be chosen for new work. */
  isLegacy: boolean
}

export const HTPASSWD_ALGORITHM_INFO: Record<HtpasswdAlgorithm, HtpasswdAlgorithmInfo> = {
  bcrypt: {
    label: 'bcrypt',
    prefix: '$2a$',
    description:
      'Deliberately slow, per-hash random salt, tunable cost factor. The right choice for anything new. ' +
      'Supported by Apache 2.4+ and by nginx on any platform whose crypt(3) understands $2a$/$2y$.',
    isLegacy: false,
  },
  apr1: {
    label: 'Apache MD5 (APR1)',
    prefix: '$apr1$',
    description:
      "Apache's own salted MD5, 1000 rounds. Weak against modern GPU cracking, but it is what `htpasswd -m` " +
      'writes and every Apache build understands it. Use it only for compatibility.',
    isLegacy: false,
  },
  sha1: {
    label: 'SHA-1 ({SHA}) — insecure, legacy only',
    prefix: '{SHA}',
    description:
      'INSECURE: unsalted, single-pass SHA-1. Identical passwords produce identical hashes and a commodity GPU ' +
      'tries billions of candidates per second. Present only for reading and reproducing legacy files — never ' +
      'pick this for a new deployment.',
    isLegacy: true,
  },
}

/** Only bcrypt has a tunable work factor. */
export function htpasswdAlgorithmHasCostFactor(algorithm: HtpasswdAlgorithm): boolean {
  return algorithm === 'bcrypt'
}

/** One credential going into the file. */
export interface HtpasswdEntry {
  username: string
  password: string
}

/** One rendered `user:hash` line. */
export interface HtpasswdLine {
  username: string
  /** The hash portion only, e.g. `$2a$12$…`. */
  hash: string
}

/** The complete file line for a `HtpasswdLine`. */
export function htpasswdLineText(line: HtpasswdLine): string {
  return `${line.username}:${line.hash}`
}

export interface HtpasswdGeneratorInput {
  /** Credentials in file order. Must not be empty. */
  entries: HtpasswdEntry[]
  algorithm?: HtpasswdAlgorithm
  /** bcrypt log2 rounds. Ignored by the other algorithms. */
  bcryptCost?: number
  /**
   * Prepend a `#` header. Both `mod_authn_file` and nginx's auth_basic skip
   * lines starting with `#`, but the default is off — a credentials file is
   * usually cleaner without one.
   */
  includeHeaderComment?: boolean
}

export interface HtpasswdGeneratorResult {
  /** The complete file text, newline-terminated. */
  fileContent: string
  /** One entry per credential, in file order. Excludes any header comment. */
  lines: HtpasswdLine[]
  /** Non-fatal advisories (legacy algorithm, weak cost, duplicate user, …). */
  warnings: string[]
  /** Filename to suggest in a native "save as" dialog. */
  suggestedFileName: string
}

/**
 * Generates `.htpasswd` file content from a list of credentials.
 *
 * Every hash is computed here in pure TS; nothing is shelled out to
 * `htpasswd(1)`, so the tool works identically on every platform the app
 * ships to.
 *
 * Invalid usernames throw an `Error` — a username containing `:` would
 * silently corrupt the file's field separator, and a blank one produces a
 * line no server can match. Weak-but-legal choices come back as
 * `HtpasswdGeneratorResult.warnings`.
 */
export class HtpasswdGenerator implements IToolUseCase<HtpasswdGeneratorInput, HtpasswdGeneratorResult> {
  execute(input: HtpasswdGeneratorInput): HtpasswdGeneratorResult {
    if (input.entries.length === 0) {
      throw new Error('Add at least one user to generate an htpasswd file.')
    }
    const algorithm = input.algorithm ?? 'bcrypt'
    const bcryptCost = input.bcryptCost ?? HTPASSWD_DEFAULT_BCRYPT_COST
    if (htpasswdAlgorithmHasCostFactor(algorithm)) {
      checkBcryptCost(bcryptCost)
    }

    const warnings: string[] = []
    const seen = new Set<string>()
    const lines: HtpasswdLine[] = []

    for (const entry of input.entries) {
      const error = validateHtpasswdUsername(entry.username)
      if (error != null) throw new Error(error)

      if (seen.has(entry.username)) {
        warnings.push(
          `Duplicate user "${entry.username}": most servers use the FIRST matching line, so the later one is dead weight.`,
        )
      }
      seen.add(entry.username)
      if (entry.password.length === 0) {
        warnings.push(`User "${entry.username}" has an empty password.`)
      }
      if (algorithm === 'bcrypt' && textEncoder.encode(entry.password).length > BCRYPT_PASSWORD_BYTE_LIMIT) {
        warnings.push(
          `User "${entry.username}": bcrypt ignores everything past ${BCRYPT_PASSWORD_BYTE_LIMIT} bytes, ` +
            'so the tail of this password does not protect anything.',
        )
      }

      lines.push({
        username: entry.username,
        hash: this.hashPassword(entry.password, { algorithm, bcryptCost }),
      })
    }

    if (HTPASSWD_ALGORITHM_INFO[algorithm].isLegacy) {
      warnings.push(
        `${HTPASSWD_ALGORITHM_INFO[algorithm].label}: this hash is unsalted and fast to brute-force. Use it only to ` +
          'reproduce an existing legacy file, never for a new deployment.',
      )
    }
    if (algorithm === 'apr1') {
      warnings.push(
        'APR1 is 1000 rounds of MD5 — orders of magnitude cheaper to crack than bcrypt. Prefer bcrypt unless a ' +
          'legacy Apache build forces your hand.',
      )
    }
    if (htpasswdAlgorithmHasCostFactor(algorithm) && bcryptCost < HTPASSWD_WEAK_BCRYPT_COST) {
      warnings.push(
        `bcrypt cost ${bcryptCost} is low. ${HTPASSWD_WEAK_BCRYPT_COST} is the minimum worth deploying; ` +
          `${HTPASSWD_DEFAULT_BCRYPT_COST} is the current default.`,
      )
    }

    const buffer: string[] = []
    if (input.includeHeaderComment ?? false) {
      buffer.push(
        `# .htpasswd — generated by InfraKit Studio (${HTPASSWD_ALGORITHM_INFO[algorithm].label})`,
        '# Install with mode 0640, owned by root and readable by the web server user.',
        '# Keep it OUTSIDE the document root.',
      )
    }
    for (const line of lines) {
      buffer.push(htpasswdLineText(line))
    }

    return {
      fileContent: buffer.length > 0 ? `${buffer.join('\n')}\n` : '',
      lines,
      warnings,
      suggestedFileName: '.htpasswd',
    }
  }

  /**
   * Hashes one password in `algorithm`'s htpasswd encoding (prefix included).
   *
   * `salt` is only honoured by `apr1` and exists so tests can pin the output
   * against a reference vector; leave it undefined in production so a fresh
   * random salt is drawn. bcrypt always generates its own salt, and SHA-1
   * has none — that is the whole problem with it.
   *
   * Note: bcryptjs (unlike Dart's `bcrypt` package) silently truncates
   * passwords over the 72-byte bcrypt limit instead of throwing, so this
   * method enforces the limit itself for the `bcrypt` algorithm to keep the
   * "reject, don't silently weaken" behavior the Dart reference has.
   */
  hashPassword(
    password: string,
    options: { algorithm?: HtpasswdAlgorithm; bcryptCost?: number; salt?: string } = {},
  ): string {
    const algorithm = options.algorithm ?? 'bcrypt'
    const bcryptCost = options.bcryptCost ?? HTPASSWD_DEFAULT_BCRYPT_COST

    switch (algorithm) {
      case 'bcrypt': {
        checkBcryptCost(bcryptCost)
        if (textEncoder.encode(password).length > BCRYPT_PASSWORD_BYTE_LIMIT) {
          throw new Error(
            `Password is longer than the ${BCRYPT_PASSWORD_BYTE_LIMIT}-byte bcrypt limit (bcryptjs would silently ` +
              'truncate it, which is not a safe default here).',
          )
        }
        return bcrypt.hashSync(password, bcrypt.genSaltSync(bcryptCost))
      }
      case 'apr1':
        return apr1Crypt(password, options.salt)
      case 'sha1':
        return `{SHA}${CryptoJS.SHA1(password).toString(CryptoJS.enc.Base64)}`
    }
  }
}

function checkBcryptCost(cost: number): void {
  if (cost < HTPASSWD_MIN_BCRYPT_COST || cost > HTPASSWD_MAX_BCRYPT_COST) {
    throw new Error(`bcryptCost must be between ${HTPASSWD_MIN_BCRYPT_COST} and ${HTPASSWD_MAX_BCRYPT_COST} (got ${cost})`)
  }
}

/**
 * Checks an htpasswd username, returning a human-readable reason it is
 * unusable, or null when it is fine.
 *
 * Exposed separately so the UI can show an inline field error without having
 * to catch an exception.
 */
export function validateHtpasswdUsername(username: string): string | null {
  if (username.length === 0) return 'Username must not be empty.'
  if (username.includes(':')) {
    return 'Username must not contain ":" — that character separates the username from the hash, so a colon here ' +
      'silently corrupts the file.'
  }
  if (username.includes('\n') || username.includes('\r')) {
    return 'Username must be a single line.'
  }
  if (username.trim() !== username) {
    return 'Username must not start or end with whitespace — the server will not match it.'
  }
  for (let i = 0; i < username.length; i++) {
    const c = username.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return 'Username must not contain control characters.'
  }
  if (username.length > 255) {
    return 'Username must be at most 255 characters.'
  }
  return null
}

// ----------------------------------------------------------------------
// HTTP Basic authorization header
// ----------------------------------------------------------------------

export interface BasicAuthHeaderInput {
  username: string
  password: string
}

export interface BasicAuthHeaderResult {
  /** base64(`user:password`), UTF-8 encoded before base64 per RFC 7617. */
  credentialsBase64: string
}

/** The header *value*: `Basic <base64>`. */
export function basicAuthHeaderValue(result: BasicAuthHeaderResult): string {
  return `Basic ${result.credentialsBase64}`
}

/** The complete header line, ready to paste into a request. */
export function basicAuthHeaderLine(result: BasicAuthHeaderResult): string {
  return `Authorization: ${basicAuthHeaderValue(result)}`
}

/**
 * Builds the `Authorization: Basic …` value for a username and password.
 *
 * RFC 7617 leaves the credential charset up to the server but recommends
 * UTF-8, which is what browsers send and what this uses. A username
 * containing `:` is rejected: the server splits on the *first* colon, so
 * `a:b` + password `c` is indistinguishable from user `a` with password
 * `b:c`.
 */
export class BasicAuthHeaderBuilder implements IToolUseCase<BasicAuthHeaderInput, BasicAuthHeaderResult> {
  execute(input: BasicAuthHeaderInput): BasicAuthHeaderResult {
    if (input.username.includes(':')) {
      throw new Error(
        'Username must not contain ":" — HTTP Basic splits the credentials on the first colon, so the server ' +
          'would read the wrong username and password.',
      )
    }
    if (input.username.includes('\n') || input.password.includes('\n')) {
      throw new Error('Credentials must be single-line.')
    }
    return { credentialsBase64: bytesToBase64(textEncoder.encode(`${input.username}:${input.password}`)) }
  }
}

// ----------------------------------------------------------------------
// APR1 (Apache MD5)
// ----------------------------------------------------------------------

/**
 * The crypt(3) base64 alphabet — note it is NOT standard base64, and the
 * digits come before the letters.
 */
export const CRYPT_BASE64_ALPHABET = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

const APR1_MAGIC = '$apr1$'

/** APR1 salts are at most 8 characters from `CRYPT_BASE64_ALPHABET`. */
export const APR1_SALT_LENGTH = 8

/** Generates a random APR1-compatible salt. */
export function generateApr1Salt(): string {
  const buffer = new Uint32Array(APR1_SALT_LENGTH)
  crypto.getRandomValues(buffer)
  let out = ''
  for (let i = 0; i < APR1_SALT_LENGTH; i++) {
    out += CRYPT_BASE64_ALPHABET[buffer[i] % CRYPT_BASE64_ALPHABET.length]
  }
  return out
}

/**
 * Computes an Apache APR1 (`$apr1$salt$hash`) password hash.
 *
 * `salt` must consist of `CRYPT_BASE64_ALPHABET` characters and is truncated
 * to `APR1_SALT_LENGTH`; a random one is drawn when it is undefined. A full
 * `$apr1$salt$hash` string may also be passed as `salt`, so an existing hash
 * can be reproduced (which is how you verify a password against one).
 */
export function apr1Crypt(password: string, salt?: string): string {
  const saltText = normalizeApr1Salt(salt)
  const pw = [...textEncoder.encode(password)]
  const sp = [...textEncoder.encode(saltText)]
  const magic = [...textEncoder.encode(APR1_MAGIC)]

  // MD5(password + salt + password) — the "alternate" digest whose bytes are
  // folded in below.
  const alternate = md5Bytes([...pw, ...sp, ...pw])

  const context: number[] = [...pw, ...magic, ...sp]
  for (let remaining = pw.length; remaining > 0; remaining -= 16) {
    context.push(...alternate.slice(0, remaining > 16 ? 16 : remaining))
  }

  // The reference implementation zeroes the digest buffer at this point, so
  // the "bit is set" branch contributes a NUL byte. Getting this wrong is the
  // classic way an APR1 re-implementation ends up subtly incompatible.
  for (let i = pw.length; i !== 0; i >>= 1) {
    context.push(i % 2 === 1 ? 0 : pw[0])
  }

  let digest = md5Bytes(context)

  // 1000 deliberately awkward rounds. The odd/3/7 pattern is load-bearing:
  // it is what makes the hash unreproducible by a naive MD5 loop.
  for (let i = 0; i < 1000; i++) {
    const round: number[] = []
    round.push(...(i % 2 === 1 ? pw : digest))
    if (i % 3 !== 0) round.push(...sp)
    if (i % 7 !== 0) round.push(...pw)
    round.push(...(i % 2 === 1 ? digest : pw))
    digest = md5Bytes(round)
  }

  const encoded =
    to64((digest[0] << 16) | (digest[6] << 8) | digest[12], 4) +
    to64((digest[1] << 16) | (digest[7] << 8) | digest[13], 4) +
    to64((digest[2] << 16) | (digest[8] << 8) | digest[14], 4) +
    to64((digest[3] << 16) | (digest[9] << 8) | digest[15], 4) +
    to64((digest[4] << 16) | (digest[10] << 8) | digest[5], 4) +
    to64(digest[11], 2)

  return `${APR1_MAGIC}${saltText}$${encoded}`
}

/**
 * Verifies `password` against an existing `$apr1$…` hash by recomputing it
 * with the salt embedded in `hash`.
 */
export function apr1Verify(password: string, hash: string): boolean {
  if (!hash.startsWith(APR1_MAGIC)) return false
  try {
    return apr1Crypt(password, hash) === hash
  } catch {
    return false
  }
}

function normalizeApr1Salt(salt: string | undefined): string {
  if (salt == null) return generateApr1Salt()

  let text = salt
  if (text.startsWith(APR1_MAGIC)) {
    text = text.slice(APR1_MAGIC.length)
    const end = text.indexOf('$')
    if (end >= 0) text = text.slice(0, end)
  }
  if (text.length > APR1_SALT_LENGTH) text = text.slice(0, APR1_SALT_LENGTH)
  if (text.length === 0) {
    throw new Error('APR1 salt must not be empty.')
  }
  for (const ch of text) {
    if (!CRYPT_BASE64_ALPHABET.includes(ch)) {
      throw new Error(`APR1 salt may only contain the characters "${CRYPT_BASE64_ALPHABET}" (got "${salt}").`)
    }
  }
  return text
}

/** crypt(3)-style base64: `count` characters, least-significant 6 bits first. */
function to64(value: number, count: number): string {
  let out = ''
  let remaining = value
  for (let i = 0; i < count; i++) {
    out += CRYPT_BASE64_ALPHABET[remaining & 0x3f]
    remaining >>>= 6
  }
  return out
}

// ----------------------------------------------------------------------
// crypto-js <-> byte array helpers
// ----------------------------------------------------------------------

function md5Bytes(bytes: number[]): number[] {
  const wordArray = CryptoJS.lib.WordArray.create(Uint8Array.from(bytes) as unknown as number[])
  const digest = CryptoJS.MD5(wordArray)
  const out: number[] = []
  for (let i = 0; i < digest.sigBytes; i++) {
    out.push((digest.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff)
  }
  return out
}

/** Encodes bytes as standard base64, browser-safe (no `Buffer`). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}
