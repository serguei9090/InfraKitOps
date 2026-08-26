import type { IToolUseCase } from '../ports/IToolUseCase'

/** Inputs shared by both engines' memory-sizing calculations. */
export interface DbMemorySizerInput {
  /** Total system RAM, in gibibytes (GiB). */
  totalRamGb: number
  /**
   * Expected `max_connections` (Postgres) / concurrent connections
   * (MariaDB) the sizing should assume — this drives the per-connection
   * `work_mem` split.
   */
  maxConnections: number
  /**
   * Percentage (0, 100] of total RAM this database instance may claim.
   * Use less than 100 when the box is shared with other services; 100
   * assumes a dedicated database server, which is the baseline the
   * classic tuning guides (PGTune, MySQL/InnoDB docs) use.
   */
  percentForDatabase?: number
}

/** Recommended `postgresql.conf` values. */
export interface PostgresConfigResult {
  sharedBuffersMb: number
  effectiveCacheSizeMb: number
  workMemMb: number
  /** Ready-to-paste `postgresql.conf` lines. */
  configText: string
}

/** Recommended MariaDB/MySQL `my.cnf` values. */
export interface MariaDbConfigResult {
  innodbBufferPoolSizeMb: number
  /** Ready-to-paste `my.cnf` line. */
  configText: string
}

export interface DbMemorySizerResult {
  postgres: PostgresConfigResult
  mariadb: MariaDbConfigResult
}

/**
 * Formats a megabyte quantity as a clean "NGB" when it divides evenly,
 * otherwise "NMB". Exposed for reuse by the UI layer.
 */
export function formatMb(mb: number): string {
  if (mb >= 1024 && mb % 1024 === 0) return `${mb / 1024}GB`
  return `${mb}MB`
}

/**
 * Database memory sizer: heuristic RAM-sizing calculator for PostgreSQL
 * and MariaDB/MySQL, given total system RAM and expected connection
 * count. Pure math, zero I/O, zero UI — the formulas below are
 * widely-used *rules of thumb* (PGTune-style for Postgres, standard
 * InnoDB guidance for MariaDB), not a substitute for real workload
 * profiling and load testing.
 */
export class DbMemorySizer implements IToolUseCase<DbMemorySizerInput, DbMemorySizerResult> {
  execute(input: DbMemorySizerInput): DbMemorySizerResult {
    const percentForDatabase = input.percentForDatabase ?? 100

    if (input.totalRamGb <= 0) {
      throw new Error('totalRamGb must be positive')
    }
    if (input.maxConnections <= 0) {
      throw new Error('maxConnections must be positive')
    }
    if (percentForDatabase <= 0 || percentForDatabase > 100) {
      throw new Error('percentForDatabase must be in (0, 100]')
    }

    const effectiveRamMb = input.totalRamGb * 1024 * (percentForDatabase / 100)

    // ---- PostgreSQL ----
    // shared_buffers: ~25% of RAM is the long-standing PGTune/community
    // baseline for a dedicated server. Postgres also leans on the OS page
    // cache, so pushing this much higher tends to cause double-buffering
    // rather than real gains.
    const sharedBuffersMb = Math.round(effectiveRamMb * 0.25)

    // effective_cache_size: a *query-planner hint*, not a real
    // allocation — it tells the planner roughly how much caching (OS page
    // cache + shared_buffers combined) to expect. ~75% of RAM is the
    // commonly recommended value for a dedicated database server (the
    // general guidance range is 50-75%).
    const effectiveCacheSizeMb = Math.round(effectiveRamMb * 0.75)

    // work_mem: per-sort/-hash operation memory, granted PER CONNECTION,
    // and potentially several times over within a single complex query
    // (each sort/hash node gets its own allocation). Heuristic used here:
    // take the RAM left over after shared_buffers, split it evenly across
    // max_connections, then divide by a fixed safety factor of 4 to leave
    // headroom for multiple concurrent operations per connection. This is
    // a conservative starting point for tuning, not a guarantee against
    // memory pressure under real concurrent load.
    const workMemSafetyDivisor = 4
    const remainingMb = effectiveRamMb - sharedBuffersMb
    const workMemMb = Math.max(
      1,
      Math.floor(remainingMb / input.maxConnections / workMemSafetyDivisor),
    )

    // ---- MariaDB / MySQL ----
    // innodb_buffer_pool_size: standard InnoDB guidance for a dedicated
    // database server is 70-80% of total RAM; 75% is the commonly cited
    // midpoint used here.
    const innodbBufferPoolSizeMb = Math.round(effectiveRamMb * 0.75)

    const postgres: PostgresConfigResult = {
      sharedBuffersMb,
      effectiveCacheSizeMb,
      workMemMb,
      configText:
        `shared_buffers = ${formatMb(sharedBuffersMb)}\n` +
        `effective_cache_size = ${formatMb(effectiveCacheSizeMb)}\n` +
        `work_mem = ${workMemMb}MB`,
    }

    const mariadb: MariaDbConfigResult = {
      innodbBufferPoolSizeMb,
      configText: `innodb_buffer_pool_size = ${formatMb(innodbBufferPoolSizeMb)}`,
    }

    return { postgres, mariadb }
  }
}
