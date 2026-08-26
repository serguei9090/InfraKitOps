import { describe, expect, it } from 'vitest'
import { DbMemorySizer, formatMb } from './dbMemorySizer'

describe('DbMemorySizer', () => {
  const sizer = new DbMemorySizer()

  it('16GB dedicated server lands in a sane PostgreSQL range', () => {
    const result = sizer.execute({ totalRamGb: 16, maxConnections: 100 })

    // shared_buffers ~= 25% of 16GB = 4GB
    expect(result.postgres.sharedBuffersMb).toBe(4096)
    // effective_cache_size ~= 75% of 16GB = 12GB
    expect(result.postgres.effectiveCacheSizeMb).toBe(12288)
    // work_mem = (16384 - 4096) / 100 / 4 = 30.72 -> floor 30MB, a sane
    // per-connection value (neither near-zero nor unbounded).
    expect(result.postgres.workMemMb).toBe(30)
    expect(result.postgres.workMemMb).toBeGreaterThan(0)
    expect(result.postgres.workMemMb).toBeLessThan(1024)

    expect(result.postgres.configText).toContain('shared_buffers = 4GB')
    expect(result.postgres.configText).toContain('effective_cache_size = 12GB')
    expect(result.postgres.configText).toContain('work_mem = 30MB')
  })

  it('16GB dedicated server lands in a sane MariaDB range', () => {
    const result = sizer.execute({ totalRamGb: 16, maxConnections: 100 })

    // innodb_buffer_pool_size ~= 75% of 16GB = 12GB, within the standard
    // 70-80% guidance band.
    expect(result.mariadb.innodbBufferPoolSizeMb).toBe(12288)
    expect(result.mariadb.configText).toBe('innodb_buffer_pool_size = 12GB')
  })

  it('percentForDatabase scales down the RAM considered available', () => {
    const full = sizer.execute({ totalRamGb: 32, maxConnections: 50 })
    const half = sizer.execute({ totalRamGb: 32, maxConnections: 50, percentForDatabase: 50 })

    expect(half.postgres.sharedBuffersMb).toBe(Math.trunc(full.postgres.sharedBuffersMb / 2))
    expect(half.mariadb.innodbBufferPoolSizeMb).toBe(
      Math.trunc(full.mariadb.innodbBufferPoolSizeMb / 2),
    )
  })

  it('work_mem never drops to zero even with a huge connection count', () => {
    const result = sizer.execute({ totalRamGb: 2, maxConnections: 5000 })
    expect(result.postgres.workMemMb).toBeGreaterThanOrEqual(1)
  })

  it('rejects non-positive totalRamGb', () => {
    expect(() => sizer.execute({ totalRamGb: 0, maxConnections: 100 })).toThrow()
    expect(() => sizer.execute({ totalRamGb: -4, maxConnections: 100 })).toThrow()
  })

  it('rejects non-positive maxConnections', () => {
    expect(() => sizer.execute({ totalRamGb: 16, maxConnections: 0 })).toThrow()
  })

  it('rejects out-of-range percentForDatabase', () => {
    expect(() =>
      sizer.execute({ totalRamGb: 16, maxConnections: 100, percentForDatabase: 0 }),
    ).toThrow()
    expect(() =>
      sizer.execute({ totalRamGb: 16, maxConnections: 100, percentForDatabase: 150 }),
    ).toThrow()
  })

  it('formatMb renders even-GB values as GB and the rest as MB', () => {
    expect(formatMb(4096)).toBe('4GB')
    expect(formatMb(30)).toBe('30MB')
    expect(formatMb(1536)).toBe('1536MB')
  })
})
