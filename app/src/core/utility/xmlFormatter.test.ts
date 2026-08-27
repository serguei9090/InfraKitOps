import { XMLParser } from 'fast-xml-parser'
import { describe, expect, it } from 'vitest'
import { XmlFormatter } from './xmlFormatter'

/** Plain-object re-parse used to confirm formatting didn't change the data, independent of the formatter's own `preserveOrder` parser. */
const plainParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', trimValues: true })

describe('XmlFormatter', () => {
  const formatter = new XmlFormatter()

  it('pretty-prints nested elements with exact 2-space indentation by default', () => {
    const result = formatter.execute({ source: '<root><a>1</a><b>2</b></root>', mode: 'pretty' })

    expect(result.isValid).toBe(true)
    expect(result.output).toBe('<root>\n  <a>1</a>\n  <b>2</b>\n</root>')
  })

  it('honors a custom indent string', () => {
    const result = formatter.execute({ source: '<root><a><b>1</b></a></root>', mode: 'pretty', indent: '\t' })

    expect(result.isValid).toBe(true)
    expect(result.output).toBe('<root>\n\t<a>\n\t\t<b>1</b>\n\t</a>\n</root>')
  })

  it('pretty-printing preserves the same data a real XML parser reads back, attributes included', () => {
    const source = '<root a="1"><child x="y">text</child><child x="z">more</child></root>'
    const result = formatter.execute({ source, mode: 'pretty' })

    expect(plainParser.parse(result.output!)).toEqual(plainParser.parse(source))
  })

  it('minifies away insignificant whitespace between tags', () => {
    const result = formatter.execute({ source: '<root>\n  <a>1</a>\n  <b>2</b>\n</root>', mode: 'minify' })

    expect(result.isValid).toBe(true)
    expect(result.output).toBe('<root><a>1</a><b>2</b></root>')
  })

  it('minifying preserves the same data a real XML parser reads back', () => {
    const source = '<root a="1">\n  <child x="y">text</child>\n</root>'
    const result = formatter.execute({ source, mode: 'minify' })

    expect(plainParser.parse(result.output!)).toEqual(plainParser.parse(source))
  })

  it('validate reports valid XML', () => {
    const result = formatter.execute({ source: '<root/>', mode: 'validate' })

    expect(result.isValid).toBe(true)
  })

  it('rejects malformed XML with mismatched tags, via the real XML validator', () => {
    const result = formatter.execute({ source: '<root><a></root>', mode: 'validate' })

    expect(result.isValid).toBe(false)
    expect(result.errorMessage).not.toBeNull()
  })

  it('rejects an unclosed tag', () => {
    const result = formatter.execute({ source: '<root><a>1</a>', mode: 'validate' })

    expect(result.isValid).toBe(false)
  })

  it('KNOWN LIMITATION: fast-xml-parser\'s validator does not enforce the single-root-element rule from XML 1.0 §2.1, so multiple top-level elements pass', () => {
    // Documented here rather than silently dropped: this is a real gap
    // versus strict XML well-formedness, inherited from the underlying
    // library, not a choice this formatter makes. Pinned so a future
    // fast-xml-parser upgrade that starts enforcing it is noticed (this
    // test would then fail and should be relaxed, not "fixed" back).
    const result = formatter.execute({ source: '<a/><b/>', mode: 'validate' })
    expect(result.isValid).toBe(true)
  })
})
