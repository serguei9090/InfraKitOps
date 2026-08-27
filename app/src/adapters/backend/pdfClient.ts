import { backendUpload, backendUploadForBlob } from './backendClient'

/** Trimmed pdfcpu PDFInfo — matches `pdftool.Info` on the backend. */
export interface BackendPdfInfo {
  version: string
  pageCount: number
  pageSizes: string[]
  title?: string
  author?: string
  subject?: string
  creator?: string
  producer?: string
  creationDate?: string
  modificationDate?: string
  keywords?: string[]
  encrypted: boolean
  permissions: number
  tagged: boolean
  linearized: boolean
  form: boolean
  signatures: boolean
  watermarked: boolean
  bookmarks: boolean
  usingXRefStreams: boolean
  valid: boolean
  validationMessage?: string
}

export type PdfTransformOp = 'optimize' | 'encrypt' | 'decrypt'

export interface PdfTransformResult {
  bytes: Uint8Array
  bytesIn: number
  bytesOut: number
}

function fileForm(bytes: Uint8Array, name = 'input.pdf'): FormData {
  const form = new FormData()
  form.append('file', new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' }), name)
  return form
}

/** POST /pdf/inspect — richer than the client-side pdf-lib inspector. */
export async function pdfInspect(bytes: Uint8Array, signal?: AbortSignal): Promise<BackendPdfInfo> {
  const { info } = await backendUpload<{ info: BackendPdfInfo }>('/pdf/inspect', fileForm(bytes), signal)
  return info
}

/** POST /pdf/transform — optimize / encrypt / decrypt, returns the new PDF bytes. */
export async function pdfTransform(
  bytes: Uint8Array,
  op: PdfTransformOp,
  params: { userPw?: string; ownerPw?: string; password?: string },
  signal?: AbortSignal,
): Promise<PdfTransformResult> {
  const form = fileForm(bytes)
  form.append('op', op)
  if (params.userPw) form.append('userPw', params.userPw)
  if (params.ownerPw) form.append('ownerPw', params.ownerPw)
  if (params.password) form.append('password', params.password)
  const { blob, headers } = await backendUploadForBlob('/pdf/transform', form, signal)
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    bytesIn: Number(headers.get('X-Pdf-Bytes-In') ?? bytes.length),
    bytesOut: Number(headers.get('X-Pdf-Bytes-Out') ?? blob.size),
  }
}
