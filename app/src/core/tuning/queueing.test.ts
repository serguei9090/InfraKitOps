import { describe, expect, it } from 'vitest'
import {
  analyzeQueue,
  erlangB,
  erlangC,
  littlesLaw,
  serversForUtilization,
  serversForWaitProbability,
} from './queueing'

describe('littlesLaw', () => {
  it('L = λ · W', () => {
    expect(littlesLaw(100, 0.2)).toBeCloseTo(20)
  })
})

describe('erlangB', () => {
  it('B(1, a) = a / (1 + a)  (single-server loss)', () => {
    expect(erlangB(1, 0.5)).toBeCloseTo(0.5 / 1.5, 10)
  })
  it('is decreasing in server count for fixed load', () => {
    const a = 5
    expect(erlangB(5, a)).toBeGreaterThan(erlangB(10, a))
  })
  it('classic textbook value: a=2 erlang, 3 lines ≈ 0.2105', () => {
    expect(erlangB(3, 2)).toBeCloseTo(0.21053, 4)
  })
})

describe('erlangC', () => {
  it('returns 1 when offered load ≥ servers (unstable)', () => {
    expect(erlangC(2, 2)).toBe(1)
    expect(erlangC(2, 3)).toBe(1)
  })
  it('single server M/M/1: C = ρ', () => {
    // For c=1, Erlang C reduces to the utilisation ρ = a.
    expect(erlangC(1, 0.7)).toBeCloseTo(0.7, 10)
  })
  it('is between 0 and 1 for a stable multi-server queue', () => {
    const c = erlangC(5, 3.5)
    expect(c).toBeGreaterThan(0)
    expect(c).toBeLessThan(1)
  })
  it('stays finite and well-behaved for large c (no factorial overflow)', () => {
    const c = erlangC(500, 480)
    expect(Number.isFinite(c)).toBe(true)
    expect(c).toBeGreaterThan(0)
    expect(c).toBeLessThanOrEqual(1)
  })
})

describe('analyzeQueue', () => {
  it('M/M/1 matches closed form: λ=8, μ=10 (serviceTime .1)', () => {
    const r = analyzeQueue({ arrivalRate: 8, serviceTimeSec: 0.1, servers: 1 })
    // ρ = 0.8; Wq = ρ / (μ - λ) = 0.8 / 2 = 0.4 s; W = 0.5 s; L = λW = 4; Lq = 3.2
    expect(r.utilization).toBeCloseTo(0.8, 10)
    expect(r.avgWaitSec).toBeCloseTo(0.4, 10)
    expect(r.avgResponseSec).toBeCloseTo(0.5, 10)
    expect(r.avgConcurrency).toBeCloseTo(4, 10)
    expect(r.avgQueueLength).toBeCloseTo(3.2, 10)
    expect(r.stable).toBe(true)
  })

  it('Little’s Law holds: L = λ · W and Lq = λ · Wq', () => {
    const r = analyzeQueue({ arrivalRate: 50, serviceTimeSec: 0.08, servers: 5 })
    expect(r.avgConcurrency).toBeCloseTo(50 * r.avgResponseSec, 9)
    expect(r.avgQueueLength).toBeCloseTo(50 * r.avgWaitSec, 9)
  })

  it('adding servers lowers the wait', () => {
    const base = analyzeQueue({ arrivalRate: 90, serviceTimeSec: 0.05, servers: 5 })
    const more = analyzeQueue({ arrivalRate: 90, serviceTimeSec: 0.05, servers: 8 })
    expect(more.avgWaitSec).toBeLessThan(base.avgWaitSec)
  })

  it('flags an unstable queue instead of returning garbage', () => {
    const r = analyzeQueue({ arrivalRate: 100, serviceTimeSec: 0.05, servers: 4 })
    expect(r.stable).toBe(false)
    expect(r.utilization).toBeGreaterThan(1)
    expect(r.avgWaitSec).toBe(Infinity)
  })

  it('rejects bad inputs', () => {
    expect(() => analyzeQueue({ arrivalRate: 0, serviceTimeSec: 1, servers: 1 })).toThrow()
    expect(() => analyzeQueue({ arrivalRate: 1, serviceTimeSec: -1, servers: 1 })).toThrow()
    expect(() => analyzeQueue({ arrivalRate: 1, serviceTimeSec: 1, servers: 0 })).toThrow()
    expect(() => analyzeQueue({ arrivalRate: 1, serviceTimeSec: 1, servers: 1.5 })).toThrow()
  })
})

describe('serversForUtilization', () => {
  it('offered load 8, target 80% → 10 servers', () => {
    expect(serversForUtilization(80, 0.1, 0.8)).toBe(10)
  })
  it('always at least 1', () => {
    expect(serversForUtilization(1, 0.001, 0.9)).toBe(1)
  })
  it('rejects a target outside (0,1)', () => {
    expect(() => serversForUtilization(10, 1, 0)).toThrow()
    expect(() => serversForUtilization(10, 1, 1)).toThrow()
  })
})

describe('serversForWaitProbability', () => {
  it('gives a stable server count where the wait probability meets the target', () => {
    const c = serversForWaitProbability(90, 0.05, 0.2) // offered load 4.5
    expect(c).toBeGreaterThanOrEqual(5)
    expect(erlangC(c, 4.5)).toBeLessThanOrEqual(0.2)
    expect(erlangC(c - 1, 4.5)).toBeGreaterThan(0.2)
  })
  it('tighter target needs at least as many servers', () => {
    const loose = serversForWaitProbability(90, 0.05, 0.5)
    const tight = serversForWaitProbability(90, 0.05, 0.01)
    expect(tight).toBeGreaterThanOrEqual(loose)
  })
})
