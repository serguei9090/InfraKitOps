import { beforeEach, describe, expect, it } from 'vitest'
import { useErrorStore } from './errorStore'

const S = useErrorStore.getState

beforeEach(() => {
  useErrorStore.setState({ errors: [], history: [] })
})

describe('errorStore', () => {
  it('classifies, enqueues, and records in history', () => {
    S().report(new Error('boom'), 'Test')
    expect(S().errors).toHaveLength(1)
    expect(S().history).toHaveLength(1)
    expect(S().errors[0].source).toBe('Test')
  })

  it('drops aborted operations', () => {
    const e = new Error('cancelled')
    e.name = 'AbortError'
    expect(S().report(e, 'Test')).toBeNull()
    expect(S().errors).toHaveLength(0)
  })

  it('dedups the same code+detail inside the window', () => {
    S().report(new Error('same'), 'Test')
    S().report(new Error('same'), 'Test')
    expect(S().errors).toHaveLength(1)
  })

  it('E3e — collapses a burst from one source into a single toast', () => {
    for (let i = 0; i < 6; i++) S().report(new Error(`distinct error ${i}`), 'Spammy')
    const toasts = S().errors
    const burst = toasts.filter((t) => t.id === 'burst:Spammy')
    expect(burst).toHaveLength(1)
    expect(burst[0].title).toMatch(/Multiple errors from Spammy/)
    // every one still in history
    expect(S().history.length).toBe(6)
  })

  it('E3b — clear() leaves history, clearHistory() empties it', () => {
    S().report(new Error('x'), 'Test')
    S().clear()
    expect(S().errors).toHaveLength(0)
    expect(S().history).toHaveLength(1)
    S().clearHistory()
    expect(S().history).toHaveLength(0)
  })
})
