import { describe, expect, it } from 'vitest'
import { exportTemplates, materializeTemplateImport, parseTemplateExport } from './templateIo'
import type { SeedTemplate } from './templates/index'

const tmpl = (name: string): SeedTemplate => ({
  id: 'tmpl_x',
  name,
  tags: ['linux'],
  variables: {
    ENV: { kind: 'select', options: [{ value: 'prod', label: 'Production' }, { value: 'dev' }], defaultValue: 'prod' },
    NOTE: { kind: 'textarea', required: true },
  },
  messages: [{ id: 'm1', role: 'system', content: 'Env is {{ENV}}' }],
  userDefined: true,
})

describe('exportTemplates / parseTemplateExport', () => {
  it('round-trips including variable kind + options', () => {
    const parsed = parseTemplateExport(exportTemplates([tmpl('T')]))
    expect(parsed.templates).toHaveLength(1)
    expect(parsed.templates[0].variables.ENV).toMatchObject({ kind: 'select' })
  })

  it('rejects a non-template file and bad JSON', () => {
    expect(() => parseTemplateExport('{"format":"x"}')).toThrow(/not a prompt template export/i)
    expect(() => parseTemplateExport('nope')).toThrow(/valid json/i)
  })

  it('rejects a malformed message', () => {
    const bad = JSON.stringify({
      format: 'infrakit-prompt-templates',
      v: 1,
      exportedAt: 0,
      templates: [{ name: 'x', tags: [], variables: {}, messages: [{ role: 'nope', content: '' }] }],
    })
    expect(() => parseTemplateExport(bad)).toThrow(/malformed message/i)
  })
})

describe('materializeTemplateImport', () => {
  it('regenerates ids, sanitises variables, de-collides names', () => {
    const exp = parseTemplateExport(exportTemplates([tmpl('Dup')]))
    const out = materializeTemplateImport(exp, ['Dup'])
    expect(out[0].name).toBe('Dup (imported)')
    expect(out[0].id).not.toBe('tmpl_x')
    expect(out[0].messages[0].id).not.toBe('m1')
    expect(out[0].variables.ENV).toMatchObject({
      kind: 'select',
      options: [{ value: 'prod', label: 'Production' }, { value: 'dev' }],
      defaultValue: 'prod',
    })
    expect(out[0].variables.NOTE).toEqual({ kind: 'textarea', required: true })
  })
})
