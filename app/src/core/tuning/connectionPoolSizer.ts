import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * Connection Pool Sizer — pure math, no I/O, no React.
 *
 * Checks whether the app tier's total pooled connections fit inside the
 * database's `max_connections` (minus what's reserved for superusers,
 * replication and monitoring), and recommends a per-instance pool size.
 *
 * Direct pooling (no PgBouncer):
 *   demand   = appInstances × poolSizePerInstance
 *   available = dbMaxConnections − reservedConnections
 *   the demand must fit, with headroom for connection spikes.
 *
 * Recommended per-instance pool:
 *   ~1.2 × the instance's peak concurrent queries (the classic HikariCP
 *   advice: a small pool, a little above real concurrency, beats a big one),
 *   but never more than an equal share of `available`, and — when CPU cores
 *   are given — never more than the old `(cores × 2) + effective_spindles`
 *   ceiling that a spinning-disk database could actually keep busy.
 *
 * PgBouncer in transaction mode changes the arithmetic entirely: the
 * database only ever sees `default_pool_size` connections per
 * (user, database) pair, and thousands of app clients share them. The
 * recommendation switches to sizing `default_pool_size` and
 * `max_client_conn`.
 */

export type PoolMode = 'direct' | 'pgbouncer-transaction' | 'pgbouncer-session'

export const POOL_MODE_LABELS: Record<PoolMode, string> = {
  direct: 'Direct — each app instance pools straight to the database',
  'pgbouncer-transaction': 'PgBouncer — transaction pooling',
  'pgbouncer-session': 'PgBouncer — session pooling',
}

export interface ConnectionPoolSizerInput {
  /** The database's configured `max_connections`. */
  dbMaxConnections: number
  /** Connections held back for superusers, replication slots, monitoring, admin. Default 10. */
  reservedConnections?: number
  /** Number of app instances that each open their own pool (direct) or client connections (pgbouncer). */
  appInstances: number
  /** Currently-configured pool size on one instance. */
  poolSizePerInstance: number
  /** Peak number of queries one instance runs concurrently. Drives the recommended pool size. */
  peakConcurrentQueriesPerInstance: number
  /** Database server CPU cores — enables the `(cores·2)+spindles` upper bound. Optional. */
  dbCpuCores?: number
  /** Effective spindle count for the classic formula (1 for a single SSD/NVMe). Default 1. */
  effectiveSpindles?: number
  poolMode?: PoolMode
  /**
   * PgBouncer only: how many (user, database) pairs will have their own
   * pool. Each pair gets up to `default_pool_size` server connections.
   * Default 1.
   */
  pgbouncerPoolCount?: number
}

export interface ConnectionPoolSizerResult {
  mode: PoolMode
  /** max_connections − reserved. */
  availableConnections: number
  /** Server-side connections the current settings would open. */
  currentServerDemand: number
  /** Does `currentServerDemand` fit inside `availableConnections`? */
  fits: boolean
  /** Free connections left after `currentServerDemand`. Negative = over budget. */
  headroom: number
  headroomPercent: number
  /** Recommended per-instance pool size (direct) or `default_pool_size` (pgbouncer). */
  recommendedPoolSize: number
  /** The equal-share ceiling: floor(available / instances-or-pools). */
  fairShareCeiling: number
  /** The `(cores·2)+spindles` ceiling, or null when cores weren't given. */
  classicCeiling: number | null
  /** PgBouncer only: suggested `max_client_conn`. */
  recommendedMaxClientConn: number | null
  warnings: string[]
  /** Generated config snippet (pgbouncer.ini, or pool-tuning notes). */
  configText: string
}

export class ConnectionPoolSizer
  implements IToolUseCase<ConnectionPoolSizerInput, ConnectionPoolSizerResult>
{
  execute(input: ConnectionPoolSizerInput): ConnectionPoolSizerResult {
    const reserved = input.reservedConnections ?? 10
    const mode = input.poolMode ?? 'direct'
    const spindles = input.effectiveSpindles ?? 1
    const pgbouncerPoolCount = Math.max(1, input.pgbouncerPoolCount ?? 1)

    if (input.dbMaxConnections <= 0) throw new Error('dbMaxConnections must be positive')
    if (reserved < 0 || reserved >= input.dbMaxConnections)
      throw new Error('reservedConnections must be in [0, dbMaxConnections)')
    if (!Number.isInteger(input.appInstances) || input.appInstances < 1)
      throw new Error('appInstances must be an integer ≥ 1')
    if (input.poolSizePerInstance <= 0) throw new Error('poolSizePerInstance must be positive')
    if (input.peakConcurrentQueriesPerInstance <= 0)
      throw new Error('peakConcurrentQueriesPerInstance must be positive')

    const availableConnections = input.dbMaxConnections - reserved
    const warnings: string[] = []

    const classicCeiling =
      input.dbCpuCores != null && input.dbCpuCores > 0 ? input.dbCpuCores * 2 + spindles : null

    if (mode === 'direct') {
      const currentServerDemand = input.appInstances * input.poolSizePerInstance
      const fairShareCeiling = Math.max(1, Math.floor(availableConnections / input.appInstances))

      let recommended = Math.ceil(input.peakConcurrentQueriesPerInstance * 1.2)
      recommended = Math.min(recommended, fairShareCeiling)
      if (classicCeiling != null) recommended = Math.min(recommended, classicCeiling)
      recommended = Math.max(1, recommended)

      const fits = currentServerDemand <= availableConnections
      const headroom = availableConnections - currentServerDemand

      if (!fits) {
        warnings.push(
          `Over budget: ${input.appInstances} instances × pool ${input.poolSizePerInstance} = ${currentServerDemand} connections, but only ${availableConnections} are available. Cut the pool to ${fairShareCeiling} or fewer, or add a connection pooler.`,
        )
      }
      if (input.poolSizePerInstance > input.peakConcurrentQueriesPerInstance * 2) {
        warnings.push(
          'The pool is more than twice the instance\'s peak concurrency — extra idle connections cost the database memory and add context-switching. A pool a little above real concurrency performs better.',
        )
      }
      if (input.poolSizePerInstance < input.peakConcurrentQueriesPerInstance) {
        warnings.push(
          `The pool (${input.poolSizePerInstance}) is smaller than the instance's peak concurrent queries (${input.peakConcurrentQueriesPerInstance}) — requests will wait for a free connection under load.`,
        )
      }
      if (headroom >= 0 && headroom < availableConnections * 0.1) {
        warnings.push('Less than 10% connection headroom — a deploy that briefly doubles instances, or a connection leak, will hit the ceiling.')
      }

      return {
        mode,
        availableConnections,
        currentServerDemand,
        fits,
        headroom,
        headroomPercent: (headroom / availableConnections) * 100,
        recommendedPoolSize: recommended,
        fairShareCeiling,
        classicCeiling,
        recommendedMaxClientConn: null,
        warnings,
        configText: renderDirectNotes(input, recommended),
      }
    }

    // --- PgBouncer -----------------------------------------------------
    const defaultPoolSize = Math.max(1, Math.ceil(input.peakConcurrentQueriesPerInstance * 1.2))
    const currentServerDemand = defaultPoolSize * pgbouncerPoolCount
    const fairShareCeiling = Math.max(1, Math.floor(availableConnections / pgbouncerPoolCount))
    let recommended = Math.min(defaultPoolSize, fairShareCeiling)
    if (classicCeiling != null) recommended = Math.min(recommended, classicCeiling)
    recommended = Math.max(1, recommended)

    const serverDemand = recommended * pgbouncerPoolCount
    const fits = serverDemand <= availableConnections
    const headroom = availableConnections - serverDemand
    const recommendedMaxClientConn = input.appInstances * input.poolSizePerInstance

    if (!fits) {
      warnings.push(
        `default_pool_size ${defaultPoolSize} × ${pgbouncerPoolCount} pool(s) = ${currentServerDemand} server connections, over the ${availableConnections} available. Lower default_pool_size to ${fairShareCeiling}.`,
      )
    }
    if (mode === 'pgbouncer-session') {
      warnings.push(
        'Session pooling holds a server connection for the whole client session, so it barely reduces server-side connections vs direct pooling. Use transaction pooling unless the app needs session-level features (prepared statements, LISTEN/NOTIFY, advisory locks, SET).',
      )
    }
    if (mode === 'pgbouncer-transaction') {
      warnings.push(
        'Transaction pooling breaks session-scoped features: server-side prepared statements (pre-PgBouncer 1.21), LISTEN/NOTIFY, session advisory locks, and plain SET. Verify the app and its driver are compatible.',
      )
    }

    return {
      mode,
      availableConnections,
      currentServerDemand: serverDemand,
      fits,
      headroom,
      headroomPercent: (headroom / availableConnections) * 100,
      recommendedPoolSize: recommended,
      fairShareCeiling,
      classicCeiling,
      recommendedMaxClientConn,
      warnings,
      configText: renderPgbouncer(mode, recommended, recommendedMaxClientConn, pgbouncerPoolCount),
    }
  }
}

function renderDirectNotes(input: ConnectionPoolSizerInput, recommended: number): string {
  return [
    '# Direct pooling — set this on every app instance.',
    `# ${input.appInstances} instances × ${recommended} = ${input.appInstances * recommended} server connections`,
    `# (db max_connections ${input.dbMaxConnections}, ${input.reservedConnections ?? 10} reserved)`,
    '',
    '# HikariCP (Java):        maximumPoolSize=' + recommended + '   minimumIdle=' + Math.max(1, Math.ceil(recommended / 2)),
    '# SQLAlchemy (Python):    pool_size=' + recommended + ', max_overflow=0, pool_pre_ping=True',
    '# pgx / database/sql (Go): SetMaxOpenConns(' + recommended + '); SetMaxIdleConns(' + recommended + ')',
    '# node-postgres (pg.Pool): max: ' + recommended,
  ].join('\n')
}

function renderPgbouncer(
  mode: PoolMode,
  defaultPoolSize: number,
  maxClientConn: number | null,
  pools: number,
): string {
  const poolMode = mode === 'pgbouncer-session' ? 'session' : 'transaction'
  return [
    '# pgbouncer.ini — generated by InfraKit Studio',
    '[databases]',
    'app = host=127.0.0.1 port=5432 dbname=app',
    '',
    '[pgbouncer]',
    'listen_addr = 127.0.0.1',
    'listen_port = 6432',
    `pool_mode = ${poolMode}`,
    `default_pool_size = ${defaultPoolSize}          ; server conns per (user, db); ${defaultPoolSize} × ${pools} pool(s) hit the database`,
    `min_pool_size = ${Math.max(1, Math.ceil(defaultPoolSize / 4))}`,
    'reserve_pool_size = 2',
    'reserve_pool_timeout = 3',
    `max_client_conn = ${maxClientConn ?? defaultPoolSize * 20}       ; app-side client connections PgBouncer accepts`,
    'server_idle_timeout = 600',
  ].join('\n')
}
