import { describe, expect, it } from 'vitest'
import { classify, isAborted } from './appError'

describe('classify', () => {
  it('passes an AppError through and stamps the source', () => {
    const e = classify({ code: 'auth_failed', title: 'x', detail: 'y', retryable: false }, 'AI Hub')
    expect(e.code).toBe('auth_failed')
    expect(e.source).toBe('AI Hub')
  })

  it('maps a backend envelope by code', () => {
    const e = classify({ error: 'bad key', code: 'auth_failed' }, 'AI Hub')
    expect(e.code).toBe('auth_failed')
    expect(e.title).toBe('Authentication failed')
    expect(e.detail).toBe('bad key')
    expect(e.hint).toMatch(/API key/)
  })

  it('honours an envelope hint over the preset', () => {
    const e = classify({ error: 'nope', code: 'validation', hint: 'name is taken' })
    expect(e.hint).toBe('name is taken')
  })

  it('falls back to unknown for an unrecognised code', () => {
    expect(classify({ error: 'huh', code: 'wat' }).code).toBe('unknown')
  })

  it('classifies a fetch TypeError as unreachable', () => {
    expect(classify(new TypeError('Failed to fetch')).code).toBe('unreachable')
  })

  it('classifies BackendUnavailableError as backend_down', () => {
    const err = new Error('no backend')
    err.name = 'BackendUnavailableError'
    expect(classify(err).code).toBe('backend_down')
  })

  it('classifies an AbortError as aborted', () => {
    const err = new Error('The operation was aborted.')
    err.name = 'AbortError'
    expect(classify(err).code).toBe('aborted')
    expect(isAborted(err)).toBe(true)
  })

  it('handles a plain Error and a string', () => {
    expect(classify(new Error('boom')).detail).toBe('boom')
    expect(classify('boom').code).toBe('unknown')
  })
})
