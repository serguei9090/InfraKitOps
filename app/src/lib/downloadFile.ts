/**
 * Triggers a browser/webview file download from in-memory content.
 *
 * The anchor must be attached to the document for `.click()` to reliably
 * trigger a save in every engine (including the Tauri/WebView2 desktop
 * shell) — an unattached anchor silently no-ops in some of them. The
 * object URL is revoked on a delay rather than immediately after `.click()`,
 * since the browser's download handling is asynchronous and revoking too
 * early can invalidate the URL before the download actually starts.
 */
export function downloadBlob(content: BlobPart, fileName: string, mimeType?: string) {
  const blob = new Blob([content], mimeType ? { type: mimeType } : undefined)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
