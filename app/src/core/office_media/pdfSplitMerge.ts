import { PDFDocument } from 'pdf-lib'
import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * PDF merge/split/extract logic built on `pdf-lib` (browser-safe, pure
 * JS/WASM-free — see `package.json`). The Flutter reference
 * (`lib/core/office_media/pdf_split_merge.dart`) was built on
 * `syncfusion_flutter_pdf`'s `PdfDocument`, a completely different library
 * with a template/draw-based page-copy API and its own set of quirks (see
 * that file's extensive doc comments on `PdfPageSettings.size`'s setter
 * lock). None of that applies here: `pdf-lib`'s `PDFDocument.copyPages`
 * copies pages (content, size, orientation, annotations) directly between
 * documents in one call, so this port is considerably simpler than the
 * Dart original — it matches its *operations* (merge N PDFs in order,
 * extract a page subset) and *input/output shapes*, not any of its
 * library-specific workarounds.
 */

/**
 * Merges any number of source PDFs (as raw bytes, in the given order) into
 * a single output PDF. Every page from `input[0]` comes first, then every
 * page from `input[1]`, and so on — pages are never reordered within a
 * source document.
 */
export class PdfMerger implements IToolUseCase<Uint8Array[], Promise<Uint8Array>> {
  async execute(input: Uint8Array[]): Promise<Uint8Array> {
    if (input.length === 0) {
      throw new Error('At least one PDF is required to merge')
    }

    const output = await PDFDocument.create()
    for (const bytes of input) {
      if (bytes.length === 0) {
        throw new Error('One of the source PDFs is empty')
      }
      const source = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
      const copiedPages = await output.copyPages(source, source.getPageIndices())
      for (const page of copiedPages) {
        output.addPage(page)
      }
    }

    return output.save()
  }
}

/** Input for {@link PdfPageExtractor}: the source PDF's bytes plus the
 * 1-based page numbers to keep. */
export interface PdfExtractInput {
  bytes: Uint8Array
  /** 1-based page numbers to keep in the output, e.g. `[1, 2, 5]`. Order
   * and duplicates in this list don't matter — the output always preserves
   * the source document's own page order. Typically produced by parsing a
   * user-facing range string (e.g. `"1-3,5"`) via {@link PdfPageRangeParser}. */
  pageNumbers: number[]
}

/**
 * Extracts a subset of pages from one source PDF into a new output PDF,
 * preserving the source document's page order.
 */
export class PdfPageExtractor implements IToolUseCase<PdfExtractInput, Promise<Uint8Array>> {
  async execute(input: PdfExtractInput): Promise<Uint8Array> {
    if (input.pageNumbers.length === 0) {
      throw new Error('At least one page number is required')
    }
    if (input.bytes.length === 0) {
      throw new Error('Source PDF is empty')
    }

    const source = await PDFDocument.load(input.bytes, { ignoreEncryption: true, updateMetadata: false })
    const pageCount = source.getPageCount()
    const keep = [...new Set(input.pageNumbers)]
    for (const pageNumber of keep) {
      if (pageNumber < 1 || pageNumber > pageCount) {
        throw new Error(`Page ${pageNumber} is out of range — the document has ${pageCount} page(s)`)
      }
    }
    // Always keep the source document's own page order, regardless of the
    // order pageNumbers was given in.
    keep.sort((a, b) => a - b)

    const output = await PDFDocument.create()
    const copiedPages = await output.copyPages(
      source,
      keep.map((n) => n - 1),
    )
    for (const page of copiedPages) {
      output.addPage(page)
    }

    return output.save()
  }
}

/** Parses a token like `"5"` or `"3"` as a strict base-10 integer, `null`
 * if it isn't one (unlike `Number.parseInt`, this rejects trailing
 * garbage such as `"5abc"`, matching Dart's `int.tryParse`). */
function parseStrictInt(token: string): number | null {
  if (!/^-?\d+$/.test(token)) return null
  return Number.parseInt(token, 10)
}

/**
 * Parses a user-facing page-range string like `"1-3,5,8-9"` into an
 * ascending, deduplicated list of 1-based page numbers, validated against
 * the document's actual page count.
 *
 * This is plain string/int logic with no PDF dependency at all, kept in
 * this file only because it exists to feed {@link PdfExtractInput.pageNumbers}.
 */
export class PdfPageRangeParser {
  /** Throws for empty input, malformed tokens (not an integer or
   * `start-end` pair), a range where `start > end`, or a parsed page
   * number falling outside `1..pageCount`. */
  parse(input: string, pageCount: number): number[] {
    const trimmed = input.trim()
    if (trimmed.length === 0) {
      throw new Error('Page range cannot be empty')
    }

    const pages = new Set<number>()
    for (const rawToken of trimmed.split(',')) {
      const token = rawToken.trim()
      if (token.length === 0) continue

      if (token.includes('-')) {
        const bounds = token.split('-')
        if (bounds.length !== 2) {
          throw new Error(`Invalid range "${token}" — expected "start-end"`)
        }
        const start = parseStrictInt(bounds[0].trim())
        const end = parseStrictInt(bounds[1].trim())
        if (start === null || end === null) {
          throw new Error(`Invalid range "${token}" — expected two numbers separated by "-"`)
        }
        if (start > end) {
          throw new Error(`Invalid range "${token}" — start must be <= end`)
        }
        for (let page = start; page <= end; page++) {
          pages.add(page)
        }
      } else {
        const page = parseStrictInt(token)
        if (page === null) {
          throw new Error(`Invalid page number "${token}"`)
        }
        pages.add(page)
      }
    }

    if (pages.size === 0) {
      throw new Error('No page numbers found')
    }

    const sorted = [...pages].sort((a, b) => a - b)
    if (sorted[0] < 1 || sorted[sorted.length - 1] > pageCount) {
      throw new Error(
        `Page numbers must be between 1 and ${pageCount} (got ${sorted[0]}..${sorted[sorted.length - 1]})`,
      )
    }
    return sorted
  }
}
