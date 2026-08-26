import { ed25519 } from '@noble/curves/ed25519.js'
import type { IToolUseCase } from '../ports/IToolUseCase'

/** Key algorithms this tool can be asked to generate. */
export type SshKeyType = 'ed25519' | 'rsa4096'

export const SSH_KEY_TYPE_LABELS: Record<SshKeyType, string> = {
  ed25519: 'Ed25519',
  rsa4096: 'RSA-4096',
}

export interface SshKeyGenInput {
  keyType: SshKeyType
  /**
   * Free-text comment appended to the public key line (e.g. `user@host`).
   * May be empty. Any newlines are stripped since the public key must stay
   * a single line and the comment is also embedded as a length-prefixed
   * field inside the private key container.
   */
  comment?: string
}

/** Which on-disk container the private key material was encoded into. */
export type SshPrivateKeyFormat = 'opensshV1'

export interface SshKeyGenResult {
  keyType: SshKeyType
  /**
   * Standard OpenSSH wire-format public key line, e.g.
   * `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... comment`.
   */
  publicKeyLine: string
  /** PEM-armored private key text in `privateKeyFormat`. */
  privateKeyPem: string
  privateKeyFormat: SshPrivateKeyFormat
}

const textEncoder = new TextEncoder()

/**
 * Generates SSH key pairs and renders them in standard OpenSSH text formats.
 *
 * Ported from `lib/core/utility/ssh_key_generator.dart`. This is a pure
 * core component: no React, no file I/O. It hands back text the adapter
 * layer can display and let the user copy into their own `~/.ssh/` files.
 *
 * ## Output formats
 * - Public key: hand-rolled standard OpenSSH wire format -- the string
 *   `"ssh-ed25519"` and the 32-byte public key, each length-prefixed with a
 *   4-byte big-endian length, concatenated and base64-encoded. This is the
 *   exact format `ssh-keygen`/`authorized_keys`/`~/.ssh/config` expect.
 * - Private key: hand-rolled unencrypted `openssh-key-v1` PEM container
 *   (cipher "none", kdf "none"). The byte layout (magic `"openssh-key-v1\0"`,
 *   cipher/kdf/kdfoptions strings, key count, the public key blob, then a
 *   checkint-doubled, sequentially-padded private section holding
 *   keytype/pubkey/`seed+pubkey`/comment) is copied field-for-field from the
 *   Dart reference implementation, which was itself verified against real
 *   `ssh-keygen -t ed25519` output.
 *
 * ## Known limitation: RSA-4096 is not implemented
 * Same limitation as the Dart reference: there is no browser-safe, purely
 * synchronous-friendly RSA-4096 keypair generator among this batch's
 * allowed packages (`@noble/curves` covers elliptic curves, not RSA). Rather
 * than fake it, `execute` throws an error with a clear explanation whenever
 * `rsa4096` is requested; callers (the UI) should catch this and show it as
 * a documented limitation, pointing users at `ssh-keygen -t rsa -b 4096` for
 * RSA keys in the meantime.
 */
export class SshKeyGenerator implements IToolUseCase<SshKeyGenInput, SshKeyGenResult> {
  execute(input: SshKeyGenInput): SshKeyGenResult {
    switch (input.keyType) {
      case 'ed25519':
        return this.generateEd25519(input.comment ?? '')
      case 'rsa4096':
        throw new Error(
          'RSA-4096 key generation is not available in this build: there is no browser-safe, ' +
            'synchronous RSA keypair generator among this tool\'s allowed dependencies. Use ' +
            '"ssh-keygen -t rsa -b 4096" on the command line instead, or pick Ed25519 here.',
        )
    }
  }

  private generateEd25519(rawComment: string): SshKeyGenResult {
    const comment = rawComment.replace(/\n/g, ' ').replace(/\r/g, ' ').trim()

    const { secretKey: seed, publicKey } = ed25519.keygen() // seed: 32 bytes, publicKey: 32 bytes

    const publicBlob = ed25519PublicKeyBlob(publicKey)
    const publicKeyLine = ['ssh-ed25519', bytesToBase64(publicBlob), ...(comment.length > 0 ? [comment] : [])].join(
      ' ',
    )

    const privateKeyPem = buildOpenSshPrivateKeyPem({
      publicKeyBlob: publicBlob,
      seed,
      publicKey,
      comment,
    })

    return {
      keyType: 'ed25519',
      publicKeyLine,
      privateKeyPem,
      privateKeyFormat: 'opensshV1',
    }
  }
}

// ---- OpenSSH wire-format helpers ----

/**
 * Length-prefixes `data` with a 4-byte big-endian length, per the SSH wire
 * format ("string" type in RFC 4251 section 5).
 */
function packString(data: Uint8Array): number[] {
  return [...packUint32(data.length), ...data]
}

function packUint32(value: number): number[] {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value, false)
  return [...out]
}

/** `ssh-ed25519` public key wire blob: string "ssh-ed25519" + string pub(32). */
function ed25519PublicKeyBlob(publicKey: Uint8Array): Uint8Array {
  return Uint8Array.from([...packString(textEncoder.encode('ssh-ed25519')), ...packString(publicKey)])
}

/**
 * Builds the unencrypted `openssh-key-v1` private key PEM container.
 *
 * See the class doc for the source of this byte layout. `seed` is the
 * 32-byte Ed25519 private seed; OpenSSH stores the "private key" field as
 * 64 bytes = seed(32) + publicKey(32).
 */
function buildOpenSshPrivateKeyPem(params: {
  publicKeyBlob: Uint8Array
  seed: Uint8Array
  publicKey: Uint8Array
  comment: string
}): string {
  const { publicKeyBlob, seed, publicKey, comment } = params
  const checkInt = randomCheckInt()
  const priv64 = [...seed, ...publicKey]

  const privSection: number[] = [
    ...packUint32(checkInt),
    ...packUint32(checkInt),
    ...packString(textEncoder.encode('ssh-ed25519')),
    ...packString(publicKey),
    ...packString(Uint8Array.from(priv64)),
    ...packString(textEncoder.encode(comment)),
  ]

  // "none" cipher still requires the private section to be padded to a
  // multiple of the (trivial, block-size-1-equivalent-of-8) block size,
  // with sequential bytes 1,2,3,...
  let padByte = 1
  while (privSection.length % 8 !== 0) {
    privSection.push(padByte)
    padByte++
  }

  const body: number[] = [
    ...textEncoder.encode('openssh-key-v1'),
    0x00,
    ...packString(textEncoder.encode('none')), // cipher name
    ...packString(textEncoder.encode('none')), // kdf name
    ...packString(new Uint8Array(0)), // kdf options (empty)
    ...packUint32(1), // number of keys
    ...packString(publicKeyBlob),
    ...packString(Uint8Array.from(privSection)),
  ]

  const b64 = bytesToBase64(Uint8Array.from(body))
  const lines: string[] = []
  for (let i = 0; i < b64.length; i += 70) {
    lines.push(b64.slice(i, Math.min(i + 70, b64.length)))
  }

  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines.join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`
}

function randomCheckInt(): number {
  // Only used to fill the "none"-cipher check-int pair; does not need to be
  // cryptographically unpredictable (there is nothing it is protecting),
  // just present and equal in both slots as the format requires.
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return buffer[0] & 0x7fffffff
}

/** Encodes bytes as standard base64, browser-safe (no `Buffer`). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}
