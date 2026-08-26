import { describe, expect, it } from 'vitest'
import { DataFormatConverter } from './dataFormatConverter'

describe('DataFormatConverter', () => {
  const converter = new DataFormatConverter()

  it('converts JSON to YAML', () => {
    const result = converter.execute({
      source: '{"name": "InfraKit", "port": 8080, "tags": ["a", "b"]}',
      sourceFormat: 'json',
      targetFormat: 'yaml',
    })

    expect(result.output).toContain('name: InfraKit')
    expect(result.output).toContain('port: 8080')
    expect(result.output).toContain('- a')
    expect(result.output).toContain('- b')
  })

  it('converts YAML to JSON', () => {
    const result = converter.execute({
      source: 'name: InfraKit\nport: 8080\n',
      sourceFormat: 'yaml',
      targetFormat: 'json',
    })

    expect(result.output).toContain('"name": "InfraKit"')
    expect(result.output).toContain('"port": 8080')
  })

  it('round-trips JSON through TOML', () => {
    const result = converter.execute({
      source: '{"server": {"host": "localhost", "port": 8080}}',
      sourceFormat: 'json',
      targetFormat: 'toml',
    })

    expect(result.output).toContain('[server]')
    expect(result.output).toContain('host =')
    expect(result.output).toContain('localhost')

    const back = converter.execute({
      source: result.output,
      sourceFormat: 'toml',
      targetFormat: 'json',
    })
    expect(back.output).toContain('"host": "localhost"')
    expect(back.output).toContain('"port": 8080')
  })

  it('round-trips JSON through XML', () => {
    const result = converter.execute({
      source: '{"config": {"name": "svc", "enabled": true}}',
      sourceFormat: 'json',
      targetFormat: 'xml',
    })

    expect(result.output).toContain('<config>')
    expect(result.output).toContain('<name>svc</name>')

    const back = converter.execute({
      source: result.output,
      sourceFormat: 'xml',
      targetFormat: 'json',
    })
    expect(back.output).toContain('"name": "svc"')
    expect(back.output).toContain('"enabled": "true"')
  })

  it('encodes XML attributes with the @ convention', () => {
    const result = converter.execute({
      source: '<user id="42"><name>Ada</name></user>',
      sourceFormat: 'xml',
      targetFormat: 'json',
    })

    expect(result.output).toContain('"@id": "42"')
    expect(result.output).toContain('"name": "Ada"')
  })

  it('rejects empty input', () => {
    expect(() =>
      converter.execute({ source: '   ', sourceFormat: 'json', targetFormat: 'yaml' }),
    ).toThrow()
  })

  it('rejects malformed JSON input', () => {
    expect(() =>
      converter.execute({ source: '{not valid json', sourceFormat: 'json', targetFormat: 'yaml' }),
    ).toThrow()
  })

  it('rejects a non-object root when encoding TOML', () => {
    expect(() =>
      converter.execute({ source: '[1, 2, 3]', sourceFormat: 'json', targetFormat: 'toml' }),
    ).toThrow()
  })
})
