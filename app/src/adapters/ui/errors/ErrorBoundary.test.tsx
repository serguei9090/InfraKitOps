// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const reportError = vi.fn()
vi.mock('@/stores/errorStore', () => ({ reportError: (...a: unknown[]) => reportError(...a) }))

import { ErrorBoundary } from './ErrorBoundary'

function Boom({ throwNow }: { throwNow: boolean }) {
  if (throwNow) throw new Error('kaboom')
  return <div>all good</div>
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    cleanup()
    reportError.mockClear()
  })

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <Boom throwNow={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('all good')).toBeTruthy()
  })

  it('shows the fallback and reports when a child throws', () => {
    // React logs the caught error to console.error — silence it for the test.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Boom throwNow={true} />
      </ErrorBoundary>,
    )
    expect(screen.getByText(/something broke/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /reload/i })).toBeTruthy()
    expect(reportError).toHaveBeenCalledOnce()
    spy.mockRestore()
  })

  it('recovers when resetKeys change', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rerender } = render(
      <ErrorBoundary resetKeys={['a']}>
        <Boom throwNow={true} />
      </ErrorBoundary>,
    )
    expect(screen.getByText(/something broke/i)).toBeTruthy()

    rerender(
      <ErrorBoundary resetKeys={['b']}>
        <Boom throwNow={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('all good')).toBeTruthy()
    spy.mockRestore()
  })
})
