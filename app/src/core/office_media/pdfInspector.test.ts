import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { isPdfDocumentInfoEmpty, PdfInspector } from './pdfInspector'

describe('PdfInspector', () => {
  const inspector = new PdfInspector()

  it('reports page count, file size and readability for a plain PDF', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([200, 300])
    doc.addPage([200, 300])
    const bytes = await doc.save()

    const result = await inspector.execute({ bytes })

    expect(result.isReadable).toBe(true)
    expect(result.pageCount).toBe(2)
    expect(result.fileSizeBytes).toBe(bytes.length)
    expect(result.isEncrypted).toBe(false)
  })

  it('reads document-info metadata when set', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([200, 300])
    doc.setTitle('My Title')
    doc.setAuthor('Jane Doe')
    doc.setSubject('A subject')
    doc.setKeywords(['infra', 'pdf'])
    doc.setCreator('InfraKit Studio')
    doc.setProducer('pdf-lib')
    const bytes = await doc.save()

    const result = await inspector.execute({ bytes })

    expect(result.info.title).toBe('My Title')
    expect(result.info.author).toBe('Jane Doe')
    expect(result.info.subject).toBe('A subject')
    expect(result.info.creator).toBe('InfraKit Studio')
    expect(result.info.producer).toBe('pdf-lib')
    expect(result.info.keywords).toContain('infra')
    expect(isPdfDocumentInfoEmpty(result.info)).toBe(false)
  })

  it('reports metadata fields as undefined, not empty strings, when unset', async () => {
    // `PDFDocument.create()`'s own defaults auto-populate Producer,
    // Creator, CreationDate and ModificationDate the instant the document
    // is constructed (see the "real pdf-lib trap" test below) — so a
    // genuinely metadata-free document, as a real PDF from a scanner or a
    // hand-written one might be, has to be built with
    // `updateMetadata: false` to actually get one in a test.
    const doc = await PDFDocument.create({ updateMetadata: false })
    doc.addPage([200, 300])
    const bytes = await doc.save()

    const result = await inspector.execute({ bytes })

    expect(result.info.title).toBeUndefined()
    expect(result.info.author).toBeUndefined()
    expect(result.info.producer).toBeUndefined()
    expect(isPdfDocumentInfoEmpty(result.info)).toBe(true)
  })

  it('reads creation and modification dates when set', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([200, 300])
    const created = new Date('2024-01-01T00:00:00Z')
    const modified = new Date('2024-06-15T00:00:00Z')
    doc.setCreationDate(created)
    doc.setModificationDate(modified)
    const bytes = await doc.save()

    const result = await inspector.execute({ bytes })

    expect(result.info.creationDate).toEqual(created)
    expect(result.info.modificationDate).toEqual(modified)
  })

  it('works around a real pdf-lib trap: default load() silently mutates Producer/ModificationDate', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([200, 300])
    doc.setProducer('my custom producer')
    const bytes = await doc.save()

    // `PDFDocument.load` with pdf-lib's own default options
    // (`updateMetadata: true`) overwrites Producer/ModificationDate the
    // instant the document is constructed — before any caller code runs.
    // This is a genuine footgun for a metadata-inspection tool: without
    // guarding against it, every inspected PDF would report pdf-lib's own
    // producer string and the current time, never the file's real values.
    const reloadedWithLibraryDefaults = await PDFDocument.load(bytes)
    expect(reloadedWithLibraryDefaults.getProducer()).toBe('pdf-lib (https://github.com/Hopding/pdf-lib)')

    // PdfInspector passes `updateMetadata: false` to `PDFDocument.load`
    // specifically to avoid this, so it reports the file's actual,
    // un-mutated value instead.
    const result = await inspector.execute({ bytes })
    expect(result.info.producer).toBe('my custom producer')
  })

  it('throws when the input bytes are empty', async () => {
    await expect(inspector.execute({ bytes: new Uint8Array(0) })).rejects.toThrow('Source PDF is empty')
  })

  it('reports isReadable false for bytes that are not a parseable PDF at all', async () => {
    const garbage = new TextEncoder().encode('this is definitely not a pdf file')

    const result = await inspector.execute({ bytes: garbage })

    expect(result.isReadable).toBe(false)
    expect(result.pageCount).toBe(0)
    expect(isPdfDocumentInfoEmpty(result.info)).toBe(true)
    expect(result.fileSizeBytes).toBe(garbage.length)
  })
})
