import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { PdfMerger, PdfPageExtractor, PdfPageRangeParser } from './pdfSplitMerge'

/** Builds a tiny in-memory PDF with `pageCount` pages, each sized
 * `[width, height]` and (optionally) tagged with a `title`, so tests never
 * need on-disk fixture files. */
async function buildPdf(
  pageCount: number,
  options?: { width?: number; height?: number; title?: string },
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  if (options?.title) doc.setTitle(options.title)
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([options?.width ?? 200, options?.height ?? 300])
  }
  return doc.save()
}

describe('PdfMerger', () => {
  const merger = new PdfMerger()

  it('merges pages from multiple PDFs in source order', async () => {
    const a = await buildPdf(1)
    const b = await buildPdf(2)

    const mergedBytes = await merger.execute([a, b])
    const merged = await PDFDocument.load(mergedBytes)

    expect(merged.getPageCount()).toBe(3)
  })

  it('never reorders pages within a source document', async () => {
    const a = await buildPdf(2, { width: 100, height: 100 })
    const b = await buildPdf(1, { width: 400, height: 400 })

    const mergedBytes = await merger.execute([a, b])
    const merged = await PDFDocument.load(mergedBytes)

    expect(merged.getPageCount()).toBe(3)
    expect(merged.getPage(0).getWidth()).toBe(100)
    expect(merged.getPage(1).getWidth()).toBe(100)
    expect(merged.getPage(2).getWidth()).toBe(400)
  })

  it('preserves mixed page sizes and orientations across the merged set', async () => {
    const portrait = await buildPdf(1, { width: 200, height: 400 })
    const landscape = await buildPdf(1, { width: 400, height: 200 })

    const mergedBytes = await merger.execute([portrait, landscape])
    const merged = await PDFDocument.load(mergedBytes)

    expect(merged.getPage(0).getSize()).toEqual({ width: 200, height: 400 })
    expect(merged.getPage(1).getSize()).toEqual({ width: 400, height: 200 })
  })

  it('throws when given an empty list', async () => {
    await expect(merger.execute([])).rejects.toThrow('At least one PDF is required to merge')
  })

  it('throws when one of the source PDFs is empty', async () => {
    const a = await buildPdf(1)
    await expect(merger.execute([a, new Uint8Array(0)])).rejects.toThrow('One of the source PDFs is empty')
  })
})

describe('PdfPageExtractor', () => {
  const extractor = new PdfPageExtractor()

  it('extracts the requested 1-based pages', async () => {
    const source = await buildPdf(5, { width: 111, height: 222 })

    const outBytes = await extractor.execute({ bytes: source, pageNumbers: [2, 4] })
    const out = await PDFDocument.load(outBytes)

    expect(out.getPageCount()).toBe(2)
  })

  it('preserves source page order regardless of requested order', async () => {
    const doc = await PDFDocument.create()
    // Distinct sizes per page act as an identity fingerprint.
    doc.addPage([100, 100])
    doc.addPage([200, 200])
    doc.addPage([300, 300])
    const source = await doc.save()

    const outBytes = await extractor.execute({ bytes: source, pageNumbers: [3, 1] })
    const out = await PDFDocument.load(outBytes)

    expect(out.getPageCount()).toBe(2)
    expect(out.getPage(0).getWidth()).toBe(100)
    expect(out.getPage(1).getWidth()).toBe(300)
  })

  it('deduplicates repeated page numbers', async () => {
    const source = await buildPdf(3)
    const outBytes = await extractor.execute({ bytes: source, pageNumbers: [1, 1, 2] })
    const out = await PDFDocument.load(outBytes)
    expect(out.getPageCount()).toBe(2)
  })

  it('throws on a page number below 1', async () => {
    const source = await buildPdf(3)
    await expect(extractor.execute({ bytes: source, pageNumbers: [0] })).rejects.toThrow('out of range')
  })

  it('throws on a page number beyond the page count', async () => {
    const source = await buildPdf(3)
    await expect(extractor.execute({ bytes: source, pageNumbers: [4] })).rejects.toThrow(
      'the document has 3 page(s)',
    )
  })

  it('throws when given no page numbers', async () => {
    const source = await buildPdf(3)
    await expect(extractor.execute({ bytes: source, pageNumbers: [] })).rejects.toThrow(
      'At least one page number is required',
    )
  })

  it('throws when the source PDF is empty', async () => {
    await expect(extractor.execute({ bytes: new Uint8Array(0), pageNumbers: [1] })).rejects.toThrow(
      'Source PDF is empty',
    )
  })
})

describe('PdfPageRangeParser', () => {
  const parser = new PdfPageRangeParser()

  it('parses a mix of single pages and ranges into an ascending, deduplicated list', () => {
    expect(parser.parse('1-3,5,8-9', 10)).toEqual([1, 2, 3, 5, 8, 9])
  })

  it('deduplicates overlapping ranges and singles', () => {
    expect(parser.parse('1-3,2,3-4', 10)).toEqual([1, 2, 3, 4])
  })

  it('tolerates whitespace around tokens', () => {
    expect(parser.parse(' 1 - 3 , 5 ', 10)).toEqual([1, 2, 3, 5])
  })

  it('throws on empty input', () => {
    expect(() => parser.parse('', 10)).toThrow('Page range cannot be empty')
    expect(() => parser.parse('   ', 10)).toThrow('Page range cannot be empty')
  })

  it('throws on a non-numeric token', () => {
    expect(() => parser.parse('abc', 10)).toThrow('Invalid page number "abc"')
  })

  it('throws on a non-numeric token inside a range', () => {
    expect(() => parser.parse('1-abc', 10)).toThrow('Invalid range "1-abc"')
  })

  it('throws on a malformed range with too many hyphens', () => {
    expect(() => parser.parse('1-2-3', 10)).toThrow('Invalid range "1-2-3"')
  })

  it('throws when a range start is greater than its end', () => {
    expect(() => parser.parse('5-2', 10)).toThrow('start must be <= end')
  })

  it('throws when a page number is out of range for the document', () => {
    expect(() => parser.parse('1,15', 10)).toThrow('Page numbers must be between 1 and 10')
  })

  it('rejects trailing garbage on a numeric token (unlike parseInt)', () => {
    expect(() => parser.parse('5abc', 10)).toThrow('Invalid page number "5abc"')
  })
})
