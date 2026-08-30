import { describe, expect, it } from 'vitest'
import { countUnfilled, renderAll, renderMessage, renderText } from './promptRenderer'
import type { Message } from './promptModel'

function msg(role: Message['role'], content: string): Message {
  return { id: `${role}-${Math.random()}`, role, content }
}

describe('renderText', () => {
  it('substitutes known values and leaves unknown ones literal', () => {
    expect(renderText('{{A}} and {{B}}', { A: 'x' })).toBe('x and {{B}}')
  })
  it('treats an empty-string value as unfilled', () => {
    expect(renderText('{{A}}', { A: '' })).toBe('{{A}}')
  })
})

describe('renderMessage', () => {
  it('renders one message body', () => {
    expect(renderMessage(msg('user', 'hi {{NAME}}'), { NAME: 'Sam' })).toBe('hi Sam')
  })
})

describe('countUnfilled', () => {
  it('counts distinct variables with no non-empty value', () => {
    const messages = [msg('system', '{{A}} {{B}}'), msg('user', '{{B}} {{C}}')]
    expect(countUnfilled(messages, { A: 'set' })).toBe(2) // B and C
  })
})

describe('renderAll', () => {
  const system = msg('system', 'You are terse.')
  const user = msg('user', 'Fix {{UNIT}}.')

  it('text: single message copies bare', () => {
    expect(renderAll([user], { UNIT: 'nginx' }, 'text')).toBe('Fix nginx.')
  })

  it('text: 2+ messages get role labels', () => {
    expect(renderAll([system, user], { UNIT: 'nginx' }, 'text')).toBe(
      'System:\nYou are terse.\n\nUser:\nFix nginx.',
    )
  })

  it('markdown: 2+ messages get ### headers', () => {
    expect(renderAll([system, user], { UNIT: 'nginx' }, 'markdown')).toBe(
      '### System\n\nYou are terse.\n\n### User\n\nFix nginx.',
    )
  })

  it('messages-json: role/content array', () => {
    expect(JSON.parse(renderAll([system, user], { UNIT: 'nginx' }, 'messages-json'))).toEqual([
      { role: 'system', content: 'You are terse.' },
      { role: 'user', content: 'Fix nginx.' },
    ])
  })

  it('system-user: joins systems then users, drops assistant, no labels', () => {
    const assistant = msg('assistant', 'example answer')
    expect(renderAll([system, assistant, user], { UNIT: 'nginx' }, 'system-user')).toBe(
      'You are terse.\n\nFix nginx.',
    )
  })
})
