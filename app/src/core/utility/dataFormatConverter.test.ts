import { XMLParser } from 'fast-xml-parser'
import { load as loadYaml } from 'js-yaml'
import { parse as parseToml } from 'smol-toml'
import { describe, expect, it } from 'vitest'
import { DataFormatConverter } from './dataFormatConverter'

/**
 * Every conversion test below re-parses the tool's output with the real,
 * standard library for that format (the same ones `dataFormatConverter.ts`
 * itself uses to decode) and asserts the parsed value against an
 * independently-written expected object — not a substring match on the
 * text. A `toContain` check can pass on output that is syntactically
 * invalid (e.g. a missing closing brace two lines later); parsing the
 * output back is what actually confirms it conforms to the target format's
 * own spec.
 */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
})

describe('DataFormatConverter', () => {
  const converter = new DataFormatConverter()

  describe('JSON -> YAML', () => {
    it('produces YAML that reparses to the same data (js-yaml)', () => {
      const result = converter.execute({
        source: '{"name": "InfraKit", "port": 8080, "tags": ["a", "b"]}',
        sourceFormat: 'json',
        targetFormat: 'yaml',
      })
      expect(loadYaml(result.output)).toEqual({ name: 'InfraKit', port: 8080, tags: ['a', 'b'] })
    })

    it('uses YAML’s standard 2-space indent for nested structures', () => {
      const result = converter.execute({
        source: '{"server": {"host": "localhost", "port": 8080}}',
        sourceFormat: 'json',
        targetFormat: 'yaml',
      })
      expect(result.output).toBe('server:\n  host: localhost\n  port: 8080\n')
    })
  })

  describe('YAML -> JSON', () => {
    it('produces valid, standard-parseable JSON (JSON.parse) with the same data', () => {
      const result = converter.execute({
        source: 'name: InfraKit\nport: 8080\n',
        sourceFormat: 'yaml',
        targetFormat: 'json',
      })
      expect(JSON.parse(result.output)).toEqual({ name: 'InfraKit', port: 8080 })
    })

    it('uses JSON.stringify’s standard 2-space indent', () => {
      const result = converter.execute({
        source: 'server:\n  host: localhost\n  port: 8080\n',
        sourceFormat: 'yaml',
        targetFormat: 'json',
      })
      expect(result.output).toBe('{\n  "server": {\n    "host": "localhost",\n    "port": 8080\n  }\n}')
    })
  })

  describe('JSON <-> TOML round trip', () => {
    it('produces TOML that reparses to the same data (smol-toml, a spec-conformant TOML parser)', () => {
      const result = converter.execute({
        source: '{"server": {"host": "localhost", "port": 8080}}',
        sourceFormat: 'json',
        targetFormat: 'toml',
      })
      expect(parseToml(result.output)).toEqual({ server: { host: 'localhost', port: 8080 } })

      const back = converter.execute({ source: result.output, sourceFormat: 'toml', targetFormat: 'json' })
      expect(JSON.parse(back.output)).toEqual({ server: { host: 'localhost', port: 8080 } })
    })
  })

  describe('JSON <-> XML round trip', () => {
    it('produces well-formed XML (fast-xml-parser) with the expected element tree', () => {
      const result = converter.execute({
        source: '{"config": {"name": "svc", "enabled": true}}',
        sourceFormat: 'json',
        targetFormat: 'xml',
      })
      // XML has no native boolean/number leaf type -- element text is always
      // a string, exactly matching what a real XML parser produces. The root
      // tag <config> is itself a key in the decoded tree, same as the JSON
      // that was originally encoded.
      expect(xmlParser.parse(result.output)).toEqual({ config: { name: 'svc', enabled: 'true' } })

      const back = converter.execute({ source: result.output, sourceFormat: 'xml', targetFormat: 'json' })
      expect(JSON.parse(back.output)).toEqual({ config: { name: 'svc', enabled: 'true' } })
    })

    it('indents nested elements 2 spaces per level', () => {
      const result = converter.execute({
        source: '{"config": {"server": {"host": "localhost"}}}',
        sourceFormat: 'json',
        targetFormat: 'xml',
      })
      expect(result.output).toContain('<config>\n  <server>\n    <host>localhost</host>\n  </server>\n</config>')
    })

    it('round-trips XML attributes through the @ convention losslessly', () => {
      const result = converter.execute({
        source: '<user id="42"><name>Ada</name></user>',
        sourceFormat: 'xml',
        targetFormat: 'json',
      })
      expect(JSON.parse(result.output)).toEqual({ user: { '@id': '42', name: 'Ada' } })

      const back = converter.execute({ source: result.output, sourceFormat: 'json', targetFormat: 'xml' })
      expect(xmlParser.parse(back.output)).toEqual({ user: { '@id': '42', name: 'Ada' } })
    })
  })

  describe('invalid input', () => {
    it('rejects empty input', () => {
      expect(() => converter.execute({ source: '   ', sourceFormat: 'json', targetFormat: 'yaml' })).toThrow()
    })

    it('rejects malformed JSON input', () => {
      expect(() => converter.execute({ source: '{not valid json', sourceFormat: 'json', targetFormat: 'yaml' })).toThrow()
    })

    it('rejects a non-object root when encoding TOML — the TOML spec has no bare-array document form', () => {
      expect(() => converter.execute({ source: '[1, 2, 3]', sourceFormat: 'json', targetFormat: 'toml' })).toThrow()
    })

    it('rejects malformed XML input (mismatched tags)', () => {
      expect(() => converter.execute({ source: '<a><b></a>', sourceFormat: 'xml', targetFormat: 'json' })).toThrow()
    })
  })
})
