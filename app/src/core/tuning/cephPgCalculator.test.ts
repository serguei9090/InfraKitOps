import { describe, expect, it } from 'vitest'
import { CephPgCalculator } from './cephPgCalculator'

describe('CephPgCalculator', () => {
  const calculator = new CephPgCalculator()

  it('rounds up to the nearest power of 2', () => {
    const result = calculator.execute({
      osdCount: 20,
      poolCount: 1,
      targetPgsPerOsd: 100,
      replicationFactor: 3,
    })

    expect(result.rawPgCount).toBeCloseTo(666.67, 2)
    expect(result.roundedPgCount).toBe(1024)
  })

  it('rejects non-positive inputs', () => {
    expect(() =>
      calculator.execute({
        osdCount: 0,
        poolCount: 1,
        targetPgsPerOsd: 100,
        replicationFactor: 3,
      }),
    ).toThrow()
  })
})
