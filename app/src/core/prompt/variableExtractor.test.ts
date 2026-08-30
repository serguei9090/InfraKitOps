import { describe, expect, it } from 'vitest'
import { extractVariables, extractVariablesFromText, isValidVariableName } from './variableExtractor'
import type { Message } from './promptModel'

function msg(role: Message['role'], content: string): Message {
  return { id: `${role}-${content.length}`, role, content }
}

describe('extractVariablesFromText', () => {
  it('returns names in first-appearance order, de-duplicated', () => {
    expect(extractVariablesFromText('{{B}} then {{A}} then {{B}} again')).toEqual(['B', 'A'])
  })

  it('accepts surrounding whitespace inside the braces', () => {
    expect(extractVariablesFromText('{{  HOST  }}')).toEqual(['HOST'])
  })

  it('ignores malformed / non-variable braces', () => {
    expect(extractVariablesFromText('{{ bad-name }} { single } {{}} {{ a b }}')).toEqual([])
  })

  it('is empty for text with no variables', () => {
    expect(extractVariablesFromText('plain text')).toEqual([])
  })
})

describe('extractVariables', () => {
  it('merges across messages, first-appearance order, de-duplicated', () => {
    const messages = [
      msg('system', 'You are helping with {{UNIT}} on {{HOST}}.'),
      msg('user', 'Error on {{HOST}}: {{ERROR}}'),
    ]
    expect(extractVariables(messages)).toEqual(['UNIT', 'HOST', 'ERROR'])
  })

  it('handles multiple occurrences in one body', () => {
    expect(extractVariables([msg('user', '{{X}}{{X}}{{Y}}')])).toEqual(['X', 'Y'])
  })
})

describe('isValidVariableName', () => {
  it('accepts alphanumerics and underscore', () => {
    expect(isValidVariableName('ERROR_OUTPUT_2')).toBe(true)
  })
  it('rejects dashes, spaces and empties', () => {
    expect(isValidVariableName('bad-name')).toBe(false)
    expect(isValidVariableName('bad name')).toBe(false)
    expect(isValidVariableName('')).toBe(false)
  })
})
