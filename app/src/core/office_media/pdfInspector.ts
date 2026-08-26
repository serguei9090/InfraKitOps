import { PDFDocument } from 'pdf-lib'
import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * PDF inspection/metadata logic built on `pdf-lib` — see the library-level
 * doc comment in `pdfSplitMerge.ts` for why this port is structurally
 * simpler than the Flutter/Syncfusion original.
 *
 * ## Encryption detection: real, but different from the Dart version
 * The Dart core (`lib/core/office_media/pdf_inspector.dart`) has an
 * extensive comment explaining that Syncfusion's `PdfDocument` never
 * exposes an `isEncrypted` boolean publicly, so it had to infer encryption
 * indirectly from whether loading without a password threw. `pdf-lib` does
 * not have that problem — `PDFDocument.isEncrypted` is a real public
 * property, so this port reads it directly.
 *
 * What *is* different, and worth stating plainly the same way the Dart
 * comment did: `pdf-lib` has no support for supplying a password to
 * decrypt a PDF at all. Every load here passes `ignoreEncryption: true`,
 * which makes `pdf-lib` parse the document's structure (page tree, object
 * streams, document-info dictionary) without attempting to decrypt
 * anything. In practice this means:
 * - A PDF encrypted only with an *owner* password (no password needed to
 *   view/open it, only to change permissions) inspects exactly like an
 *   unencrypted one — same as the Dart version's documented limitation.
 * - A PDF that genuinely requires a *user* password to open still loads
 *   structurally (page count and document-info are almost always stored
 *   unencrypted in the trailer/info dictionary even when page *content*
 *   streams are encrypted), so {@link PdfInspectionResult.isReadable} is
 *   `true` far more often here than the Dart/Syncfusion version, which
 *   reported `isReadable: false` whenever the correct password wasn't
 *   supplied. There is no password field on {@link PdfInspectInput} as a
 *   result — one would have no effect, since `pdf-lib` never asks for one.
 * - {@link PdfInspectionResult.isEncrypted} therefore means "this PDF has
 *   an encryption dictionary", not "this PDF required a password to open"
 *   the way it did in the Dart version.
 *
 * `isReadable` is kept in the result shape anyway (`false` only when the
 * bytes aren't parseable as a PDF at all, e.g. a non-PDF file or a
 * truncated/corrupt one) so the UI layer's shape matches the Dart original
 * and callers don't need to special-case "totally unreadable" separately.
 *
 * ## A real `pdf-lib` trap: `load()` mutates metadata by default
 * `PDFDocument.load()` (like `PDFDocument.create()`) defaults its
 * `updateMetadata` option to `true`, and immediately — inside the
 * constructor, before any caller code runs — overwrites the document's
 * `Producer` field with `pdf-lib`'s own string and its
 * `ModificationDate` field with the current time (see
 * `PDFDocument.prototype.updateInfoDict` in `pdf-lib`'s source). Loading a
 * document with the default options and then reading `getProducer()`/
 * `getModificationDate()` back would therefore report `pdf-lib` and "now"
 * for every single PDF ever inspected, never the original file's real
 * values — a real bug caught by this file's own tests during the port
 * (see `pdfInspector.test.ts`). `execute` below passes
 * `updateMetadata: false` to `PDFDocument.load` specifically to avoid
 * this, so inspection is actually read-only.
 */

/** Document metadata pulled from `PDFDocument`'s document-info dictionary.
 * Plain data only — no `pdf-lib` types — so the UI layer doesn't need to
 * import `pdf-lib` itself just to display an inspection result.
 *
 * Every field is `undefined` when `pdf-lib` reports it as unset or an
 * empty string, so the UI can cleanly distinguish "field present" from
 * "field absent". */
export interface PdfDocumentInfo {
  title?: string
  author?: string
  subject?: string
  keywords?: string
  creator?: string
  producer?: string
  creationDate?: Date
  modificationDate?: Date
}

/** True when none of the metadata fields carried a value. */
export function isPdfDocumentInfoEmpty(info: PdfDocumentInfo): boolean {
  return (
    info.title === undefined &&
    info.author === undefined &&
    info.subject === undefined &&
    info.keywords === undefined &&
    info.creator === undefined &&
    info.producer === undefined &&
    info.creationDate === undefined &&
    info.modificationDate === undefined
  )
}

/** Result of inspecting one PDF file. Plain data — see {@link PdfDocumentInfo}
 * for why `pdf-lib` types don't leak into this shape. */
export interface PdfInspectionResult {
  /** Number of pages, or `0` when the document couldn't be opened at all
   * (see {@link isReadable}). */
  pageCount: number
  /** Size of the original input bytes, in bytes. */
  fileSizeBytes: number
  /** Whether the document has an encryption dictionary (see the
   * library-level doc comment above for exactly what this does and does
   * not mean with `pdf-lib`). */
  isEncrypted: boolean
  /** Whether {@link PdfInspector} was able to parse the document's
   * structure at all. False only when the bytes aren't a parseable PDF —
   * in that case `pageCount` is `0` and `info` is empty. */
  isReadable: boolean
  info: PdfDocumentInfo
}

/** Input for {@link PdfInspector.execute}: the PDF's raw bytes. */
export interface PdfInspectInput {
  bytes: Uint8Array
}

function nullIfEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value
}

/**
 * Reads a PDF's page count, document-info metadata, encryption status, and
 * file size, returning a plain {@link PdfInspectionResult}.
 */
export class PdfInspector implements IToolUseCase<PdfInspectInput, Promise<PdfInspectionResult>> {
  async execute(input: PdfInspectInput): Promise<PdfInspectionResult> {
    const fileSizeBytes = input.bytes.length
    if (fileSizeBytes === 0) {
      throw new Error('Source PDF is empty')
    }

    let document: PDFDocument
    try {
      document = await PDFDocument.load(input.bytes, { ignoreEncryption: true, updateMetadata: false })
    } catch {
      return {
        pageCount: 0,
        fileSizeBytes,
        isEncrypted: false,
        isReadable: false,
        info: {},
      }
    }

    return {
      pageCount: document.getPageCount(),
      fileSizeBytes,
      isEncrypted: document.isEncrypted,
      isReadable: true,
      info: {
        title: nullIfEmpty(document.getTitle()),
        author: nullIfEmpty(document.getAuthor()),
        subject: nullIfEmpty(document.getSubject()),
        keywords: nullIfEmpty(document.getKeywords()),
        creator: nullIfEmpty(document.getCreator()),
        producer: nullIfEmpty(document.getProducer()),
        creationDate: document.getCreationDate(),
        modificationDate: document.getModificationDate(),
      },
    }
  }
}
