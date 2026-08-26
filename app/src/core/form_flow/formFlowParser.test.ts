import { describe, expect, it } from 'vitest'
import { FormFlowParser } from './formFlowParser'
import { SCALAR_ARRAY_ITEM_KEY, defaultValuesFromFields, type SchemaField } from './schemaModel'

/**
 * Builds a values map (matching the contract documented on
 * `FormFlowParser.render`) from a schema's own detected defaults — i.e.
 * "the user submitted the form without changing anything". Each array gets
 * exactly one item, built from its child template's defaults.
 */
function valuesFromDefaults(fields: SchemaField[]): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const field of fields) {
    switch (field.type) {
      case 'object':
        values[field.key] = valuesFromDefaults(field.children)
        break
      case 'array':
        values[field.key] = [valuesFromDefaults(field.children)]
        break
      case 'text':
      case 'number':
      case 'boolean':
        values[field.key] = field.defaultValue
        break
    }
  }
  return values
}

/** Canonical, comparable snapshot of a field tree's shape + data. */
function snapshot(fields: SchemaField[]): SchemaField[] {
  return JSON.parse(JSON.stringify(fields))
}

const parser = new FormFlowParser()

describe('XML', () => {
  const xml = `
<config>
  <enabled>true</enabled>
  <name>prod-cluster</name>
  <server>
    <host>10.0.0.1</host>
    <port>8080</port>
  </server>
  <server>
    <host>10.0.0.2</host>
    <port>8081</port>
  </server>
  <admin>alice</admin>
  <admin>bob</admin>
</config>
`

  it('detects format and root name', () => {
    const schema = parser.parse(xml)
    expect(schema.format).toBe('xml')
    expect(schema.rootName).toBe('config')
  })

  it('detects a boolean leaf, a text leaf, and a repeated object group', () => {
    const schema = parser.parse(xml)
    const byKey = Object.fromEntries(schema.fields.map((f) => [f.key, f]))

    expect(byKey.enabled.type).toBe('boolean')
    expect(byKey.enabled.defaultValue).toBe('true')

    expect(byKey.name.type).toBe('text')
    expect(byKey.name.defaultValue).toBe('prod-cluster')

    const server = byKey.server
    expect(server.type).toBe('array')
    expect(server.children.map((c) => c.key)).toEqual(['host', 'port'])
    expect(server.children.find((c) => c.key === 'host')?.type).toBe('text')
    expect(server.children.find((c) => c.key === 'host')?.defaultValue).toBe('10.0.0.1')
    expect(server.children.find((c) => c.key === 'port')?.type).toBe('number')
    expect(server.children.find((c) => c.key === 'port')?.defaultValue).toBe('8080')
  })

  it('detects a repeated scalar sibling as an array with a synthetic value child', () => {
    const schema = parser.parse(xml)
    const admin = schema.fields.find((f) => f.key === 'admin')!

    expect(admin.type).toBe('array')
    expect(admin.children).toHaveLength(1)
    expect(admin.children[0].key).toBe(SCALAR_ARRAY_ITEM_KEY)
    expect(admin.children[0].type).toBe('text')
    expect(admin.children[0].defaultValue).toBe('alice')
  })

  it('rejects malformed XML', () => {
    expect(() => parser.parse('<unclosed>', 'xml')).toThrow()
  })
})

describe('YAML', () => {
  const yaml = `
enabled: true
name: prod-cluster
server:
  - host: 10.0.0.1
    port: 8080
  - host: 10.0.0.2
    port: 8081
admin:
  - alice
  - bob
`

  it('detects format and the equivalent field shape as XML', () => {
    const schema = parser.parse(yaml)
    expect(schema.format).toBe('yaml')

    const byKey = Object.fromEntries(schema.fields.map((f) => [f.key, f]))
    expect(byKey.enabled.type).toBe('boolean')
    expect(byKey.name.type).toBe('text')

    const server = byKey.server
    expect(server.type).toBe('array')
    expect(server.children.map((c) => c.key)).toEqual(['host', 'port'])
    expect(server.children.find((c) => c.key === 'port')?.type).toBe('number')

    const admin = byKey.admin
    expect(admin.type).toBe('array')
    expect(admin.children[0].key).toBe(SCALAR_ARRAY_ITEM_KEY)
    expect(admin.children[0].defaultValue).toBe('alice')
  })
})

describe('JSON', () => {
  const json = `
{
  "enabled": true,
  "name": "prod-cluster",
  "server": [
    {"host": "10.0.0.1", "port": 8080},
    {"host": "10.0.0.2", "port": 8081}
  ],
  "admin": ["alice", "bob"]
}
`

  it('detects format and the equivalent field shape as XML/YAML', () => {
    const schema = parser.parse(json)
    expect(schema.format).toBe('json')

    const byKey = Object.fromEntries(schema.fields.map((f) => [f.key, f]))
    expect(byKey.enabled.type).toBe('boolean')
    expect(byKey.name.type).toBe('text')

    const server = byKey.server
    expect(server.type).toBe('array')
    expect(server.children.map((c) => c.key)).toEqual(['host', 'port'])
    expect(server.children.find((c) => c.key === 'port')?.type).toBe('number')

    const admin = byKey.admin
    expect(admin.type).toBe('array')
    expect(admin.children[0].key).toBe(SCALAR_ARRAY_ITEM_KEY)
  })
})

describe('round trip (render re-parses to the same data)', () => {
  it('XML: parse -> render -> re-parse yields the same field shape and data', () => {
    const xml = `
<config>
  <enabled>true</enabled>
  <name>prod-cluster</name>
  <server>
    <host>10.0.0.1</host>
    <port>8080</port>
  </server>
  <admin>alice</admin>
</config>
`
    const schema1 = parser.parse(xml)
    const values = valuesFromDefaults(schema1.fields)
    const rendered = parser.render(schema1, values)

    expect(rendered).toContain('<config')

    const schema2 = parser.parse(rendered, 'xml')
    expect(snapshot(schema2.fields)).toEqual(snapshot(schema1.fields))
  })

  it('YAML: parse -> render -> re-parse yields the same field shape and data', () => {
    const yaml = `
enabled: true
name: prod-cluster
server:
  - host: 10.0.0.1
    port: 8080
admin:
  - alice
`
    const schema1 = parser.parse(yaml)
    const values = valuesFromDefaults(schema1.fields)
    const rendered = parser.render(schema1, values)

    const schema2 = parser.parse(rendered, 'yaml')
    expect(snapshot(schema2.fields)).toEqual(snapshot(schema1.fields))
  })

  it('JSON: parse -> render -> re-parse yields the same field shape and data', () => {
    const json = `
{
  "enabled": true,
  "name": "prod-cluster",
  "server": [{"host": "10.0.0.1", "port": 8080}],
  "admin": ["alice"]
}
`
    const schema1 = parser.parse(json)
    const values = valuesFromDefaults(schema1.fields)
    const rendered = parser.render(schema1, values)

    const schema2 = parser.parse(rendered, 'json')
    expect(snapshot(schema2.fields)).toEqual(snapshot(schema1.fields))
  })
})

describe('format auto-detection', () => {
  it('picks JSON over XML/YAML for a JSON object', () => {
    const schema = parser.parse('{"a": 1}')
    expect(schema.format).toBe('json')
  })

  it('picks XML for an XML document', () => {
    const schema = parser.parse('<root><a>1</a></root>')
    expect(schema.format).toBe('xml')
  })

  it('picks YAML for a plain mapping', () => {
    const schema = parser.parse('a: 1\nb: two\n')
    expect(schema.format).toBe('yaml')
  })

  it('throws a clear error when nothing matches', () => {
    expect(() => parser.parse('***not a config file***')).toThrow()
  })
})

describe('defaultValuesFromFields', () => {
  it('is exported from the schema model and usable standalone', () => {
    const schema = parser.parse('{"a": 1, "list": ["x"]}')
    const values = defaultValuesFromFields(schema.fields)
    expect(values.a).toBe('1')
    expect(Array.isArray(values.list)).toBe(true)
  })
})
