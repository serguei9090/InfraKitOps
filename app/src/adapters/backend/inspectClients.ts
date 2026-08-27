import { backendPost, backendUpload } from './backendClient'

// --- QR decode (gozxing) ---

export interface BackendQrResult {
  text: string
  format: string
}

export async function qrDecodeViaBackend(file: File, signal?: AbortSignal): Promise<BackendQrResult> {
  const form = new FormData()
  form.append('file', file, file.name || 'image')
  return backendUpload<BackendQrResult>('/qr/decode', form, signal)
}

// --- X.509 live fetch ---

export interface BackendX509FetchResult {
  host: string
  pem: string
  certCount: number
  trusted: boolean
  verifyError?: string
  tlsVersion: string
  cipherSuite: string
  serverName: string
}

export function x509FetchViaBackend(host: string, signal?: AbortSignal): Promise<BackendX509FetchResult> {
  return backendPost<BackendX509FetchResult>('/x509/fetch', { host }, signal)
}
