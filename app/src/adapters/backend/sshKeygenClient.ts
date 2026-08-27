import { backendPost } from './backendClient'
import type { SshKeyType } from '@/core/utility/sshKeyGenerator'

export interface BackendSshKeyResult {
  keyType: string
  publicKeyLine: string
  privateKeyPem: string
  fingerprintSha256: string
  encrypted: boolean
}

/** Maps the UI's key-type slug to the backend's { type, bits/curve } request. */
export function generateSshKey(
  keyType: SshKeyType,
  comment: string,
  passphrase: string,
  signal?: AbortSignal,
): Promise<BackendSshKeyResult> {
  let body: { type: string; bits?: number; curve?: number; comment: string; passphrase: string }
  if (keyType.startsWith('rsa-')) {
    body = { type: 'rsa', bits: Number(keyType.slice(4)), comment, passphrase }
  } else if (keyType.startsWith('ecdsa-p')) {
    body = { type: 'ecdsa', curve: Number(keyType.slice(7)), comment, passphrase }
  } else {
    body = { type: 'ed25519', comment, passphrase }
  }
  return backendPost<BackendSshKeyResult>('/ssh-keygen', body, signal)
}
