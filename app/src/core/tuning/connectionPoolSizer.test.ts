import { describe, expect, it } from 'vitest'
import { ConnectionPoolSizer, type ConnectionPoolSizerInput } from './connectionPoolSizer'

const sizer = new ConnectionPoolSizer()

const base: ConnectionPoolSizerInput = {
  dbMaxConnections: 200,
  reservedConnections: 10,
  appInstances: 8,
  poolSizePerInstance: 20,
  peakConcurrentQueriesPerInstance: 10,
  poolMode: 'direct',
}

describe('ConnectionPoolSizer — direct', () => {
  it('computes available = max − reserved', () => {
    expect(sizer.execute(base).availableConnections).toBe(190)
  })

  it('over-budget: 8 × 20 = 160 fits in 190, but 8 × 30 does not', () => {
    expect(sizer.execute({ ...base, poolSizePerInstance: 20 }).fits).toBe(true)
    const over = sizer.execute({ ...base, poolSizePerInstance: 30 })
    expect(over.fits).toBe(false)
    expect(over.headroom).toBeLessThan(0)
    expect(over.warnings.join(' ')).toMatch(/over budget/i)
  })

  it('recommends ~1.2× peak concurrency, capped by the fair share', () => {
    const r = sizer.execute({ ...base, peakConcurrentQueriesPerInstance: 10 })
    expect(r.recommendedPoolSize).toBe(12) // ceil(10 × 1.2)
    expect(r.fairShareCeiling).toBe(Math.floor(190 / 8)) // 23
  })

  it('fair-share ceiling caps the recommendation when peak concurrency is huge', () => {
    const r = sizer.execute({ ...base, peakConcurrentQueriesPerInstance: 100, appInstances: 8 })
    expect(r.recommendedPoolSize).toBe(r.fairShareCeiling)
  })

  it('classic (cores·2 + spindles) ceiling applies when cores given', () => {
    const r = sizer.execute({ ...base, dbCpuCores: 4, effectiveSpindles: 1, peakConcurrentQueriesPerInstance: 50 })
    expect(r.classicCeiling).toBe(9)
    expect(r.recommendedPoolSize).toBe(9)
  })

  it('warns when the pool dwarfs real concurrency', () => {
    const r = sizer.execute({ ...base, poolSizePerInstance: 25, peakConcurrentQueriesPerInstance: 5 })
    expect(r.warnings.join(' ')).toMatch(/twice the instance/i)
  })

  it('warns when the pool starves concurrency', () => {
    const r = sizer.execute({ ...base, poolSizePerInstance: 4, peakConcurrentQueriesPerInstance: 10 })
    expect(r.warnings.join(' ')).toMatch(/smaller than/i)
  })

  it('emits driver pool-tuning notes', () => {
    const r = sizer.execute(base)
    expect(r.configText).toMatch(/HikariCP/)
    expect(r.configText).toMatch(/SQLAlchemy/)
  })
})

describe('ConnectionPoolSizer — pgbouncer', () => {
  it('transaction pooling: server demand = default_pool_size × pools, not instances × pool', () => {
    const r = sizer.execute({
      ...base,
      poolMode: 'pgbouncer-transaction',
      appInstances: 40,
      poolSizePerInstance: 10,
      peakConcurrentQueriesPerInstance: 15,
      pgbouncerPoolCount: 1,
    })
    // default_pool_size ≈ ceil(15 × 1.2) = 18; × 1 pool = 18 server conns for 40 instances
    expect(r.recommendedPoolSize).toBe(18)
    expect(r.currentServerDemand).toBe(18)
    expect(r.fits).toBe(true)
  })

  it('recommends max_client_conn = instances × client pool', () => {
    const r = sizer.execute({
      ...base,
      poolMode: 'pgbouncer-transaction',
      appInstances: 40,
      poolSizePerInstance: 10,
    })
    expect(r.recommendedMaxClientConn).toBe(400)
    expect(r.configText).toContain('pool_mode = transaction')
    expect(r.configText).toContain('max_client_conn = 400')
  })

  it('warns about transaction-mode session-feature breakage', () => {
    const r = sizer.execute({ ...base, poolMode: 'pgbouncer-transaction' })
    expect(r.warnings.join(' ')).toMatch(/LISTEN\/NOTIFY|prepared statements/i)
  })

  it('warns that session pooling barely helps', () => {
    const r = sizer.execute({ ...base, poolMode: 'pgbouncer-session' })
    expect(r.warnings.join(' ')).toMatch(/barely reduces/i)
  })
})

describe('ConnectionPoolSizer — validation', () => {
  it('rejects bad inputs', () => {
    expect(() => sizer.execute({ ...base, dbMaxConnections: 0 })).toThrow()
    expect(() => sizer.execute({ ...base, reservedConnections: 200 })).toThrow()
    expect(() => sizer.execute({ ...base, appInstances: 0 })).toThrow()
    expect(() => sizer.execute({ ...base, poolSizePerInstance: 0 })).toThrow()
    expect(() => sizer.execute({ ...base, peakConcurrentQueriesPerInstance: -1 })).toThrow()
  })
})
