/**
 * Database configuration builder — pure TypeScript, no I/O, no React.
 *
 * Renders either a `postgresql.conf` or a `my.cnf` (`[mysqld]` section) from
 * two independent sources of truth, kept deliberately separate:
 *
 *  * **Calculated parameters** — derived purely from machine metrics (RAM,
 *    CPU count, workload type, storage, version). These are always emitted;
 *    there is nothing to "select", the same way `shared_buffers` isn't
 *    optional once you've told the tool how much RAM the box has.
 *  * **Policy options** — a small catalog of durability/replication/logging
 *    switches and dropdowns the operator decides deliberately (SSL,
 *    synchronous_commit, archive_mode, slow query logging, binary logging,
 *    …). Only options the caller actually selected are emitted, matching
 *    this app's "minimal reviewable diff" philosophy established by the
 *    sysctl config builder. Each catalog entry is typed with a
 *    `DbOptionValueKind` so the UI can pick a switch/dropdown/text-field
 *    generically instead of hard-coding widget choices per key.
 *
 * ## Sourcing of the calculated-parameter formulas
 *
 * **PostgreSQL** formulas are taken from pgtune
 * (github.com/le0pard/pgtune), specifically its `dbType`-driven
 * shared_buffers / effective_cache_size / maintenance_work_mem / work_mem /
 * wal_buffers / checkpoint / planner / parallel-worker logic. Every branch
 * (Windows caps, PG-version gates on wal_compression/jit/parallel workers,
 * the DB-fits-in-RAM work_mem multiplier) mirrors pgtune's own source.
 *
 * **MariaDB** formulas are taken from database.gkanev.com's InnoDB sizing
 * calculator plus general Percona/MariaDB tuning guidance — these are
 * looser industry heuristics rather than a single canonical tool.
 *
 * ## Deliberate extensions beyond the cited sources
 *
 *  * `PgStorageType` includes `nvme` in addition to the `hdd`/`ssd`/`san`
 *    trio pgtune's UI exposes, because pgtune's own `effective_io_concurrency`
 *    table defines a value for it (1000) that the other three don't cover.
 *  * `random_page_cost` for `san`/`nvme` storage falls through to the
 *    "fast storage" value (1.1) rather than the HDD value — SAN and NVMe
 *    are both lower-latency than spinning disk, so grouping them with SSD
 *    is the conservative reading, not a change to pgtune's HDD/SSD logic.
 */

import type { IToolUseCase } from '../ports/IToolUseCase'

// ===========================================================================
// Engine selector
// ===========================================================================

export type DatabaseEngine = 'postgresql' | 'mariadb'

const databaseEngineMeta: Record<DatabaseEngine, { label: string; suggestedFileName: string }> = {
  postgresql: { label: 'PostgreSQL', suggestedFileName: 'postgresql.conf' },
  mariadb: { label: 'MariaDB', suggestedFileName: 'my.cnf' },
}

export function databaseEngineLabel(engine: DatabaseEngine): string {
  return databaseEngineMeta[engine].label
}
/** Filename to suggest in a native "save as" dialog. */
export function databaseEngineSuggestedFileName(engine: DatabaseEngine): string {
  return databaseEngineMeta[engine].suggestedFileName
}

// ===========================================================================
// PostgreSQL metric inputs
// ===========================================================================

export type PgWorkloadType = 'web' | 'oltp' | 'dw' | 'desktop' | 'mixed'

const pgWorkloadTypeLabels: Record<PgWorkloadType, string> = {
  web: 'Web application',
  oltp: 'OLTP (high transaction rate)',
  dw: 'Data warehouse',
  desktop: 'Desktop / development',
  mixed: 'Mixed workload',
}
export function pgWorkloadTypeLabel(type: PgWorkloadType): string {
  return pgWorkloadTypeLabels[type]
}

export type PgStorageType = 'hdd' | 'ssd' | 'san' | 'nvme'

const pgStorageTypeLabels: Record<PgStorageType, string> = {
  hdd: 'Spinning disk (HDD)',
  ssd: 'SSD',
  san: 'SAN / network storage',
  nvme: 'NVMe',
}
export function pgStorageTypeLabel(type: PgStorageType): string {
  return pgStorageTypeLabels[type]
}

/** Drives the emitted `wal_level`: standalone -> minimal, primary/replica -> replica, logical replication -> logical. */
export type PgReplicationRole = 'standalone' | 'primary' | 'replica' | 'logical'

const pgReplicationRoleLabels: Record<PgReplicationRole, string> = {
  standalone: 'Standalone (no replication)',
  primary: 'Primary (physical replication)',
  replica: 'Replica (physical replication)',
  logical: 'Logical replication',
}
export function pgReplicationRoleLabel(role: PgReplicationRole): string {
  return pgReplicationRoleLabels[role]
}

/**
 * Machine/workload facts pgtune's formulas are computed from. Everything
 * here maps to a calculated parameter — nothing in this class is optional
 * the way a policy option is.
 */
export interface PostgresMetrics {
  totalMemoryMb: number
  cpuCount: number
  /** PostgreSQL major version, e.g. `18`, `16`, `9` (for pre-10 releases). */
  dbVersion: number
  dbType: PgWorkloadType
  /** User-supplied `max_connections`, or undefined for pgtune's per-`dbType` default. */
  maxConnections?: number
  storageType: PgStorageType
  /**
   * Windows only matters for two things: the PG<10 shared_buffers 512MB
   * cap, and the PG<=17 2GB-1MB cap on maintenance_work_mem/work_mem —
   * plus it disables `effective_io_concurrency` entirely (POSIX AIO-only).
   */
  osIsWindows?: boolean
  /** Whether the whole database is expected to fit in RAM. Feeds the work_mem multiplier and random_page_cost. */
  dbFitsInRam?: boolean
  replicationRole?: PgReplicationRole
}

// ===========================================================================
// MariaDB metric inputs
// ===========================================================================

export type MariaDbStorageType = 'hdd' | 'ssd' | 'nvme'

const mariaDbStorageTypeLabels: Record<MariaDbStorageType, string> = {
  hdd: 'Spinning disk (HDD)',
  ssd: 'SSD',
  nvme: 'NVMe',
}
export function mariaDbStorageTypeLabel(type: MariaDbStorageType): string {
  return mariaDbStorageTypeLabels[type]
}

export type MariaDbWorkloadType = 'oltp' | 'olap' | 'mixed' | 'web' | 'smallVps'

const mariaDbWorkloadTypeLabels: Record<MariaDbWorkloadType, string> = {
  oltp: 'OLTP (high transaction rate)',
  olap: 'OLAP / analytics',
  mixed: 'Mixed workload',
  web: 'Web application',
  smallVps: 'Small VPS / shared host',
}
export function mariaDbWorkloadTypeLabel(type: MariaDbWorkloadType): string {
  return mariaDbWorkloadTypeLabels[type]
}

export interface MariaDbMetrics {
  totalMemoryMb: number
  /** Memory reserved for the OS and everything that isn't MariaDB. */
  reservedForOsMb: number
  storageType: MariaDbStorageType
  dbType: MariaDbWorkloadType
  /** Only affects `innodb_flush_method` (O_DIRECT vs unbuffered). */
  osIsWindows?: boolean
  /**
   * MariaDB major/minor version, used to decide between the legacy
   * `innodb_log_file_size` and the `innodb_redo_log_capacity` that replaced
   * it in MariaDB 10.8.
   */
  majorVersion?: number
  minorVersion?: number
}

function mariaDbMajorVersion(m: MariaDbMetrics): number {
  return m.majorVersion ?? 10
}
function mariaDbMinorVersion(m: MariaDbMetrics): number {
  return m.minorVersion ?? 6
}

/** Whether this version is >= 10.8, i.e. uses `innodb_redo_log_capacity`. */
export function mariaDbUsesRedoLogCapacity(m: MariaDbMetrics): boolean {
  const major = mariaDbMajorVersion(m)
  const minor = mariaDbMinorVersion(m)
  return major > 10 || (major === 10 && minor >= 8)
}

// ===========================================================================
// Policy option catalog
// ===========================================================================

export type DbOptionValueKind = 'boolean' | 'choice' | 'freeText'

export interface DbOptionChoice {
  value: string
  label: string
}

/**
 * One selectable policy directive. The UI enumerates
 * `dbPolicyOptionsForEngine` and builds its widgets generically off `kind`.
 */
export interface DbPolicyOption {
  /** The literal config key, e.g. `synchronous_commit` or `log_bin`. */
  key: string
  engine: DatabaseEngine
  /** Output section heading this option's line is grouped under, e.g. `Durability & Replication`. */
  section: string
  label: string
  description: string
  kind: DbOptionValueKind
  /** Legal values for `choice`. Empty otherwise. */
  choices: DbOptionChoice[]
  /** Value pre-filled in the UI before the user changes anything. */
  defaultValue: string
  /** Placeholder text for free-text fields. */
  hint?: string
  /**
   * When set, this option is only ever emitted if the option keyed
   * `dependsOnKey` is itself selected (and, when `dependsOnValue` is also
   * set, its selected value matches).
   */
  dependsOnKey?: string
  /** Required value of `dependsOnKey` for this option to be emitted. Undefined means "governing key just needs to be selected with any value". */
  dependsOnValue?: string
  /** Whether the emitted value is wrapped in single quotes (PostgreSQL string GUCs). */
  quoted?: boolean
  /** Whether a `boolean` value is emitted as `ON`/`OFF` (MariaDB convention) rather than `on`/`off` (PostgreSQL convention). */
  uppercaseBoolean?: boolean
}

// ---------------------------------------------------------------------------
// PostgreSQL policy catalog
// ---------------------------------------------------------------------------

export const kPostgresPolicyCatalog: DbPolicyOption[] = [
  {
    key: 'synchronous_commit',
    engine: 'postgresql',
    section: 'Durability & Replication',
    label: 'Synchronous commit',
    description:
      'Durability vs. throughput tradeoff: "on" waits for the WAL to be flushed (and, with synchronous ' +
      'replicas, confirmed) before returning success to the client; "off" returns immediately and can lose ' +
      'the last few transactions on a crash.',
    kind: 'choice',
    choices: [
      { value: 'on', label: 'on — full durability (default)' },
      { value: 'off', label: 'off — fastest, can lose recent commits on crash' },
      { value: 'local', label: 'local — flush locally, do not wait on replicas' },
      { value: 'remote_write', label: 'remote_write — wait for replica OS write, not fsync' },
      { value: 'remote_apply', label: 'remote_apply — wait for replica to apply and be visible' },
    ],
    defaultValue: 'on',
  },
  {
    key: 'ssl',
    engine: 'postgresql',
    section: 'Durability & Replication',
    label: 'SSL',
    description: 'Require TLS-capable connections. The server also needs valid ssl_cert_file/ssl_key_file.',
    kind: 'boolean',
    choices: [],
    defaultValue: 'off',
  },
  {
    key: 'archive_mode',
    engine: 'postgresql',
    section: 'Durability & Replication',
    label: 'Archive mode',
    description: 'Continuously archive completed WAL segments via archive_command — the basis for PITR and warm standbys.',
    kind: 'boolean',
    choices: [],
    defaultValue: 'off',
  },
  {
    key: 'archive_command',
    engine: 'postgresql',
    section: 'Durability & Replication',
    label: 'Archive command',
    description: 'Shell command PostgreSQL runs to archive one WAL file. %p is the source path, %f the filename.',
    kind: 'freeText',
    choices: [],
    defaultValue: 'cp %p /var/lib/postgresql/wal_archive/%f',
    hint: 'cp %p /var/lib/postgresql/wal_archive/%f',
    dependsOnKey: 'archive_mode',
    dependsOnValue: 'on',
    quoted: true,
  },
  {
    key: 'logging_collector',
    engine: 'postgresql',
    section: 'Logging',
    label: 'Logging collector',
    description: 'Capture stderr output into rotated log files instead of relying on the launching process.',
    kind: 'boolean',
    choices: [],
    defaultValue: 'off',
  },
  {
    key: 'log_min_duration_statement',
    engine: 'postgresql',
    section: 'Logging',
    label: 'Slow query threshold (ms)',
    description: 'Log any statement taking at least this many milliseconds. -1 disables, 0 logs every statement.',
    kind: 'freeText',
    choices: [],
    defaultValue: '1000',
    hint: '1000',
  },
  {
    key: 'log_line_prefix',
    engine: 'postgresql',
    section: 'Logging',
    label: 'Log line prefix',
    description:
      'printf-style prefix for each log line. Emitted alongside the slow-query threshold with a sensible ' +
      'default (timestamp, PID, query id, user@database) so slow-query logs are actually attributable.',
    kind: 'freeText',
    choices: [],
    defaultValue: '%m [%p] %q%u@%d/%a ',
    dependsOnKey: 'log_min_duration_statement',
    quoted: true,
  },
]

// ---------------------------------------------------------------------------
// MariaDB policy catalog
// ---------------------------------------------------------------------------

export const kMariaDbPolicyCatalog: DbPolicyOption[] = [
  {
    key: 'innodb_flush_log_at_trx_commit',
    engine: 'mariadb',
    section: 'Durability',
    label: 'InnoDB flush at commit',
    description:
      '1 = full ACID, fsync on every commit (slowest, safest). 2 = flush the log to the OS on every commit ' +
      'but only fsync once per second (can lose ~1s of commits on an OS crash, safe against a mysqld crash). ' +
      '0 = write and fsync only once per second (fastest, can lose ~1s of commits on either kind of crash).',
    kind: 'choice',
    choices: [
      { value: '1', label: '1 — full ACID / slowest' },
      { value: '2', label: '2 — flush on commit, fsync ~1/sec' },
      { value: '0', label: '0 — fastest, least durable' },
    ],
    defaultValue: '1',
  },
  {
    key: 'query_cache_type',
    engine: 'mariadb',
    section: 'Query Cache',
    label: 'Query cache',
    description:
      'MariaDB still supports the legacy query cache, unlike modern MySQL, but it serializes writes to a ' +
      'single cache and is widely recommended OFF under any real concurrency.',
    kind: 'boolean',
    choices: [],
    defaultValue: 'off',
    uppercaseBoolean: true,
  },
  {
    key: 'query_cache_size',
    engine: 'mariadb',
    section: 'Query Cache',
    label: 'Query cache size',
    description: 'Keep this small if the cache is enabled at all — a large query cache increases lock contention, not hit rate.',
    kind: 'freeText',
    choices: [],
    defaultValue: '64M',
    hint: '64M',
    dependsOnKey: 'query_cache_type',
    dependsOnValue: 'on',
  },
  {
    key: 'log_bin',
    engine: 'mariadb',
    section: 'Replication',
    label: 'Binary logging',
    description: 'Enables the binary log — required for replication and point-in-time recovery.',
    kind: 'boolean',
    choices: [],
    defaultValue: 'off',
    uppercaseBoolean: true,
  },
  {
    key: 'server_id',
    engine: 'mariadb',
    section: 'Replication',
    label: 'Server ID',
    description: 'Unique numeric ID for this instance. Required once binary logging is on, and must be distinct across a replication topology.',
    kind: 'freeText',
    choices: [],
    defaultValue: '1',
    hint: '1',
    dependsOnKey: 'log_bin',
    dependsOnValue: 'on',
  },
  {
    key: 'slow_query_log',
    engine: 'mariadb',
    section: 'Logging',
    label: 'Slow query log',
    description: 'Log queries slower than long_query_time to the slow query log.',
    kind: 'boolean',
    choices: [],
    defaultValue: 'off',
    uppercaseBoolean: true,
  },
  {
    key: 'long_query_time',
    engine: 'mariadb',
    section: 'Logging',
    label: 'Slow query threshold (seconds)',
    description: 'Queries taking at least this many seconds are written to the slow query log.',
    kind: 'freeText',
    choices: [],
    defaultValue: '2',
    hint: '2',
    dependsOnKey: 'slow_query_log',
    dependsOnValue: 'on',
  },
]

/** Catalog options for `engine`, in emission/UI order. */
export function dbPolicyOptionsForEngine(engine: DatabaseEngine): DbPolicyOption[] {
  return engine === 'postgresql' ? kPostgresPolicyCatalog : kMariaDbPolicyCatalog
}

/** The choices a picker should offer for `option`. */
export function dbEffectiveChoices(option: DbPolicyOption): DbOptionChoice[] {
  switch (option.kind) {
    case 'choice':
      return option.choices
    case 'boolean':
      return option.uppercaseBoolean
        ? [
            { value: 'ON', label: 'ON' },
            { value: 'OFF', label: 'OFF' },
          ]
        : [
            { value: 'on', label: 'on' },
            { value: 'off', label: 'off' },
          ]
    case 'freeText':
      return []
  }
}

// ===========================================================================
// Calculated parameters — PostgreSQL (pgtune formulas)
// ===========================================================================

/**
 * Everything pgtune's own metric-driven logic computes for one
 * `PostgresMetrics` input. Exposed as its own pure function/result pair so
 * each formula can be unit-tested against a hand-computed value
 * independently of string output.
 */
export interface PgCalculatedParams {
  maxConnections: number
  sharedBuffersKb: number
  effectiveCacheSizeKb: number
  maintenanceWorkMemKb: number
  autovacuumWorkMemKb: number
  workMemKb: number
  walBuffersKb: number
  minWalSizeMb: number
  maxWalSizeMb: number
  checkpointCompletionTarget: number
  defaultStatisticsTarget: number
  randomPageCost: number
  /** Null on Windows — `effective_io_concurrency` is a POSIX AIO knob. */
  effectiveIoConcurrency: number | null
  /** Null unless `cpuCount >= 4`. */
  maxWorkerProcesses: number | null
  maxParallelWorkersPerGather: number | null
  /** Null unless `cpuCount >= 4` AND `dbVersion >= 10`. */
  maxParallelWorkers: number | null
  /** Null unless `cpuCount >= 4` AND `dbVersion >= 11`. */
  maxParallelMaintenanceWorkers: number | null
  /** `lz4` (PG>=15), `on` (PG 10-14), or null (PG<10). */
  walCompression: string | null
  /** `off` for web/oltp/mixed on PG>=12, else null. */
  jit: string | null
  walLevel: string
}

function pgDefaultMaxConnections(t: PgWorkloadType): number {
  switch (t) {
    case 'web':
      return 200
    case 'oltp':
      return 300
    case 'dw':
      return 40
    case 'desktop':
      return 20
    case 'mixed':
      return 100
  }
}

/**
 * 2GB - 1MB in kB, the Windows + PG<=17 cap on maintenance_work_mem,
 * autovacuum_work_mem and work_mem (32-bit Windows int overflow guard kept
 * by pgtune for older releases).
 */
const kWindowsLegacyCapKb = 2 * 1024 * 1024 - 1024

/** Computes every pgtune-derived parameter for `m`. Throws on non-positive RAM/CPU/connections. */
export function computePostgresParams(m: PostgresMetrics): PgCalculatedParams {
  if (m.totalMemoryMb <= 0) {
    throw new Error(`Total memory must be greater than zero (got ${m.totalMemoryMb}MB).`)
  }
  if (m.cpuCount <= 0) {
    throw new Error(`CPU count must be greater than zero (got ${m.cpuCount}).`)
  }
  if (m.maxConnections != null && m.maxConnections <= 0) {
    throw new Error(`Max connections must be greater than zero, or left unset for auto (got ${m.maxConnections}).`)
  }

  const totalKb = m.totalMemoryMb * 1024
  const osIsWindows = m.osIsWindows ?? false
  const dbFitsInRam = m.dbFitsInRam ?? false
  const replicationRole = m.replicationRole ?? 'standalone'

  // --- shared_buffers ---
  let sharedBuffersKb = m.dbType === 'desktop' ? Math.round(totalKb / 16) : Math.round(totalKb / 4)
  if (osIsWindows && m.dbVersion < 10) {
    const capKb = 512 * 1024
    if (sharedBuffersKb > capKb) sharedBuffersKb = capKb
  }

  // --- effective_cache_size ---
  const effectiveCacheSizeKb = m.dbType === 'desktop' ? Math.round(totalKb / 4) : Math.round((totalKb * 3) / 4)

  // --- maintenance_work_mem ---
  let maintenanceWorkMemKb = m.dbType === 'dw' ? Math.round(totalKb / 8) : Math.round(totalKb / 16)
  const windowsLegacyCap = osIsWindows && m.dbVersion <= 17
  const maintenanceCapKb = windowsLegacyCap ? kWindowsLegacyCapKb : 8 * 1024 * 1024
  if (maintenanceWorkMemKb > maintenanceCapKb) maintenanceWorkMemKb = maintenanceCapKb

  // --- autovacuum_work_mem: capped at 2GB (or the Windows legacy cap) ---
  const autovacuumCapKb = windowsLegacyCap ? kWindowsLegacyCapKb : 2 * 1024 * 1024
  const autovacuumWorkMemKb = maintenanceWorkMemKb > autovacuumCapKb ? autovacuumCapKb : maintenanceWorkMemKb

  // --- max_connections ---
  const maxConnections = m.maxConnections ?? pgDefaultMaxConnections(m.dbType)

  // Effective max_worker_processes used in the work_mem formula regardless
  // of whether the GUC itself gets emitted (it's only emitted at cpu>=4;
  // below that PostgreSQL's own built-in default of 8 applies).
  const effectiveMaxWorkerProcesses = m.cpuCount >= 4 ? m.cpuCount : 8

  // --- work_mem ---
  let workMemBase = (totalKb - sharedBuffersKb) / ((maxConnections + effectiveMaxWorkerProcesses) * 3)
  switch (m.dbType) {
    case 'dw':
    case 'mixed':
      workMemBase = workMemBase / 2
      break
    case 'desktop':
      workMemBase = workMemBase / 6
      break
    case 'web':
    case 'oltp':
      break
  }
  const workMemScaled = dbFitsInRam ? workMemBase * 1.3 : workMemBase * 0.9
  let workMemKb = Math.round(workMemScaled)
  if (workMemKb < 4096) workMemKb = 4096
  if (windowsLegacyCap && workMemKb > kWindowsLegacyCapKb) workMemKb = kWindowsLegacyCapKb

  // --- wal_buffers: 3% of shared_buffers, snapped/capped at 16MB, floor 32kB ---
  let walBuffersKb = Math.round(sharedBuffersKb * 0.03)
  if (walBuffersKb >= 14336) {
    walBuffersKb = 16384
  }
  if (walBuffersKb < 32) walBuffersKb = 32

  // --- min/max_wal_size ---
  let minWalSizeMb: number
  let maxWalSizeMb: number
  switch (m.dbType) {
    case 'web':
      minWalSizeMb = 1024
      maxWalSizeMb = 4096
      break
    case 'oltp':
      minWalSizeMb = 2048
      maxWalSizeMb = 8192
      break
    case 'dw':
      minWalSizeMb = 4096
      maxWalSizeMb = 16384
      break
    case 'desktop':
      minWalSizeMb = 100
      maxWalSizeMb = 2048
      break
    case 'mixed':
      minWalSizeMb = 1024
      maxWalSizeMb = 4096
      break
  }

  const checkpointCompletionTarget = 0.9
  const defaultStatisticsTarget = m.dbType === 'dw' ? 500 : 100

  // --- random_page_cost ---
  let randomPageCost: number
  if (dbFitsInRam || m.storageType === 'ssd') {
    randomPageCost = 1.1
  } else if (m.storageType === 'hdd' || (m.dbType === 'dw' && !dbFitsInRam)) {
    randomPageCost = 4.0
  } else {
    // san/nvme, not a data warehouse missing RAM: treat as fast storage.
    randomPageCost = 1.1
  }

  // --- effective_io_concurrency (Linux only) ---
  let effectiveIoConcurrency: number | null = null
  if (!osIsWindows) {
    switch (m.storageType) {
      case 'hdd':
        effectiveIoConcurrency = 2
        break
      case 'ssd':
        effectiveIoConcurrency = 200
        break
      case 'san':
        effectiveIoConcurrency = 300
        break
      case 'nvme':
        effectiveIoConcurrency = 1000
        break
    }
  }

  // --- parallel workers (cpuCount >= 4 only) ---
  let maxWorkerProcesses: number | null = null
  let maxParallelWorkersPerGather: number | null = null
  let maxParallelWorkers: number | null = null
  let maxParallelMaintenanceWorkers: number | null = null
  if (m.cpuCount >= 4) {
    maxWorkerProcesses = m.cpuCount
    const halfCeil = Math.ceil(m.cpuCount / 2)
    maxParallelWorkersPerGather = m.dbType === 'dw' ? halfCeil : Math.min(halfCeil, 4)
    if (m.dbVersion >= 10) maxParallelWorkers = m.cpuCount
    if (m.dbVersion >= 11) maxParallelMaintenanceWorkers = Math.min(halfCeil, 4)
  }

  // --- wal_compression ---
  let walCompression: string | null = null
  if (m.dbVersion >= 15) {
    walCompression = 'lz4'
  } else if (m.dbVersion >= 10) {
    walCompression = 'on'
  }

  // --- jit ---
  let jit: string | null = null
  if (m.dbVersion >= 12 && (m.dbType === 'web' || m.dbType === 'oltp' || m.dbType === 'mixed')) {
    jit = 'off'
  }

  // --- wal_level, driven by replicationRole ---
  let walLevel: string
  switch (replicationRole) {
    case 'standalone':
      walLevel = 'minimal'
      break
    case 'primary':
    case 'replica':
      walLevel = 'replica'
      break
    case 'logical':
      walLevel = 'logical'
      break
  }

  return {
    maxConnections,
    sharedBuffersKb,
    effectiveCacheSizeKb,
    maintenanceWorkMemKb,
    autovacuumWorkMemKb,
    workMemKb,
    walBuffersKb,
    minWalSizeMb,
    maxWalSizeMb,
    checkpointCompletionTarget,
    defaultStatisticsTarget,
    randomPageCost,
    effectiveIoConcurrency,
    maxWorkerProcesses,
    maxParallelWorkersPerGather,
    maxParallelWorkers,
    maxParallelMaintenanceWorkers,
    walCompression,
    jit,
    walLevel,
  }
}

// ===========================================================================
// Calculated parameters — MariaDB
// ===========================================================================

export interface MariaDbCalculatedParams {
  /** 75% of (totalMemory - reservedForOs), rounded to the nearest 128MB. */
  innodbBufferPoolSizeMb: number
  /**
   * ~25% of the buffer pool, capped at 2048MB. Emitted as
   * `innodb_redo_log_capacity` on MariaDB >= 10.8, `innodb_log_file_size`
   * before that — see `mariaDbUsesRedoLogCapacity`.
   */
  innodbLogFileSizeMb: number
  /** `O_DIRECT` (Linux) or `unbuffered` (Windows). */
  innodbFlushMethod: string
  innodbIoCapacity: number
  /**
   * 1 on HDD (spinning disks benefit from flushing neighboring pages
   * together), 0 on SSD/NVMe.
   */
  innodbFlushNeighbors: number
  maxConnections: number
  /** `max_connections * 4`, floor 400. */
  tableOpenCache: number
  /** Shared by `tmp_table_size` and `max_heap_table_size`. `min(totalMemory / 32, 256)` MB, floored at 16MB. */
  tmpTableSizeMb: number
  /** `min(max_connections / 2, 100)`. */
  threadCacheSize: number
}

export function computeMariaDbParams(m: MariaDbMetrics): MariaDbCalculatedParams {
  if (m.totalMemoryMb <= 0) {
    throw new Error(`Total memory must be greater than zero (got ${m.totalMemoryMb}MB).`)
  }
  if (m.reservedForOsMb < 0) {
    throw new Error(`Reserved OS memory cannot be negative (got ${m.reservedForOsMb}MB).`)
  }
  const availableMb = m.totalMemoryMb - m.reservedForOsMb
  if (availableMb <= 0) {
    throw new Error(
      `Reserved OS memory (${m.reservedForOsMb}MB) leaves no memory for MariaDB out of ${m.totalMemoryMb}MB total.`,
    )
  }

  // --- innodb_buffer_pool_size: 75% of available, nearest 128MB ---
  const rawPoolMb = availableMb * 0.75
  let poolMb = Math.round(rawPoolMb / 128) * 128
  if (poolMb < 128) poolMb = 128

  // --- innodb_log_file_size / innodb_redo_log_capacity ---
  const rawLogMb = poolMb * 0.25
  const logMb = Math.round(rawLogMb < 2048 ? rawLogMb : 2048)

  const osIsWindows = m.osIsWindows ?? false
  const flushMethod = osIsWindows ? 'unbuffered' : 'O_DIRECT'

  let ioCapacity: number
  switch (m.storageType) {
    case 'hdd':
      ioCapacity = 200
      break
    case 'ssd':
      ioCapacity = 2000
      break
    case 'nvme':
      ioCapacity = 10000
      break
  }
  const flushNeighbors = m.storageType === 'hdd' ? 1 : 0

  let maxConnections: number
  switch (m.dbType) {
    case 'oltp':
      maxConnections = 200
      break
    case 'olap':
      maxConnections = 50
      break
    case 'mixed':
      maxConnections = 150
      break
    case 'web':
      maxConnections = 150
      break
    case 'smallVps':
      maxConnections = 50
      break
  }

  let tableOpenCache = maxConnections * 4
  if (tableOpenCache < 400) tableOpenCache = 400

  let tmpTableSizeMb = Math.floor(m.totalMemoryMb / 32)
  if (tmpTableSizeMb > 256) tmpTableSizeMb = 256
  if (tmpTableSizeMb < 16) tmpTableSizeMb = 16

  let threadCacheSize = Math.round(maxConnections / 2)
  if (threadCacheSize > 100) threadCacheSize = 100

  return {
    innodbBufferPoolSizeMb: poolMb,
    innodbLogFileSizeMb: logMb,
    innodbFlushMethod: flushMethod,
    innodbIoCapacity: ioCapacity,
    innodbFlushNeighbors: flushNeighbors,
    maxConnections,
    tableOpenCache,
    tmpTableSizeMb,
    threadCacheSize,
  }
}

// ===========================================================================
// Text formatting helpers
// ===========================================================================

/** Formats a kB quantity as PostgreSQL's own unit suffix style: `kB`, `MB` or `GB`, no space, picking the largest unit that divides evenly. */
function formatPgKb(kb: number): string {
  if (kb <= 0) return '0kB'
  if (kb % (1024 * 1024) === 0) return `${kb / (1024 * 1024)}GB`
  if (kb % 1024 === 0) return `${kb / 1024}MB`
  return `${kb}kB`
}

/** Formats an MB quantity as PostgreSQL's own unit suffix style. */
function formatPgMb(mb: number): string {
  if (mb <= 0) return '0MB'
  if (mb % 1024 === 0) return `${mb / 1024}GB`
  return `${mb}MB`
}

/** Formats an MB quantity as MariaDB's `my.cnf` unit suffix style (`M`/`G`, no trailing `B`). */
function formatMariaDbMb(mb: number): string {
  if (mb <= 0) return '0M'
  if (mb % 1024 === 0) return `${mb / 1024}G`
  return `${mb}M`
}

// ===========================================================================
// Policy value validation + rendering
// ===========================================================================

function validatePolicyValue(option: DbPolicyOption, raw: string): string {
  const value = raw.trim()
  if (value.length === 0) {
    throw new Error(`${option.key} needs a value.`)
  }
  if (value.includes('\n')) {
    throw new Error(`${option.key} must be a single line.`)
  }

  switch (option.kind) {
    case 'boolean': {
      const lower = value.toLowerCase()
      if (lower !== 'on' && lower !== 'off') {
        throw new Error(`${option.key} must be "on" or "off" (got "${value}").`)
      }
      return option.uppercaseBoolean ? lower.toUpperCase() : lower
    }

    case 'choice': {
      for (const choice of option.choices) {
        if (choice.value.toLowerCase() === value.toLowerCase()) return choice.value
      }
      throw new Error(`${option.key} must be one of ${option.choices.map((c) => c.value).join(', ')} (got "${value}").`)
    }

    case 'freeText':
      return value
  }
}

/**
 * Whether `option` should be emitted, given every selection in `raw`:
 * unconditional options always are; options with `dependsOnKey` only are
 * if that governing key is itself selected (and matches `dependsOnValue`
 * when one is specified).
 */
function dependencySatisfied(raw: Record<string, string>, option: DbPolicyOption): boolean {
  const governingKey = option.dependsOnKey
  if (governingKey == null) return true
  const governingRaw = raw[governingKey]
  if (governingRaw == null || governingRaw.trim().length === 0) return false
  const requiredValue = option.dependsOnValue
  if (requiredValue == null) return true
  return governingRaw.trim().toLowerCase() === requiredValue.toLowerCase()
}

/**
 * Renders the selected+dependency-satisfied lines from `catalog` belonging
 * to `section`, validating each value against its option descriptor.
 *
 * A dependent option (one with `dependsOnKey` set) whose governing
 * condition is satisfied but which was never itself given an explicit
 * value falls back to `defaultValue` — this is what makes `log_line_prefix`
 * a "fixed sensible default that rides along with"
 * `log_min_duration_statement` rather than a second thing the caller has
 * to separately select, while an independent (non-dependent) option still
 * requires an explicit selection to appear at all.
 */
function catalogLines(catalog: DbPolicyOption[], raw: Record<string, string>, section: string): string[] {
  const lines: string[] = []
  for (const option of catalog.filter((o) => o.section === section)) {
    if (!dependencySatisfied(raw, option)) continue
    let rawValue: string | undefined = raw[option.key]
    if ((rawValue == null || rawValue.trim().length === 0) && option.dependsOnKey != null) {
      rawValue = option.defaultValue
    }
    if (rawValue == null || rawValue.trim().length === 0) continue
    const value = validatePolicyValue(option, rawValue)
    const formatted = option.quoted ? `'${value}'` : value
    lines.push(`${option.key} = ${formatted}`)
  }
  return lines
}

function writeSection(lines: string[], header: string, sectionLines: string[]): void {
  if (sectionLines.length === 0) return
  lines.push(`# --- ${header} ---`)
  for (const line of sectionLines) {
    lines.push(line)
  }
  lines.push('')
}

function rejectUnknownKeys(engine: DatabaseEngine, raw: Record<string, string>): void {
  const known = new Set(dbPolicyOptionsForEngine(engine).map((o) => o.key))
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      throw new Error(`"${key}" is not a known ${databaseEngineLabel(engine)} policy option in this catalog.`)
    }
  }
}

// ===========================================================================
// Input / builder
// ===========================================================================

/** Input for `DatabaseConfigBuilder`. Exactly one of `postgres`/`mariadb` must be supplied, matching `engine`. */
export interface DatabaseConfigBuilderInput {
  engine: DatabaseEngine
  postgres?: PostgresMetrics
  mariadb?: MariaDbMetrics
  /**
   * Policy option key -> user-selected value. Presence in this map *is*
   * selection — an unselected boolean is simply absent, not "false" and
   * present. Keys not found in the catalog for `engine` are rejected.
   */
  policyValues?: Record<string, string>
}

/**
 * Renders a `postgresql.conf` or `my.cnf` `[mysqld]` block from a metrics
 * input (calculated parameters, always emitted) plus a set of selected
 * policy options (only emitted if selected). See the module doc comment
 * for the formula sourcing.
 */
export class DatabaseConfigBuilder implements IToolUseCase<DatabaseConfigBuilderInput, string> {
  execute(input: DatabaseConfigBuilderInput): string {
    const policyValues = input.policyValues ?? {}
    switch (input.engine) {
      case 'postgresql': {
        const metrics = input.postgres
        if (metrics == null) {
          throw new Error('PostgreSQL metrics are required when engine is "postgresql".')
        }
        rejectUnknownKeys(input.engine, policyValues)
        return this.renderPostgres(metrics, policyValues)
      }

      case 'mariadb': {
        const metrics = input.mariadb
        if (metrics == null) {
          throw new Error('MariaDB metrics are required when engine is "mariadb".')
        }
        rejectUnknownKeys(input.engine, policyValues)
        return this.renderMariaDb(metrics, policyValues)
      }
    }
  }

  private renderPostgres(m: PostgresMetrics, policyValues: Record<string, string>): string {
    const p = computePostgresParams(m)
    const lines: string[] = []

    lines.push('# postgresql.conf — generated by InfraKit Studio')
    lines.push(
      `# Workload: ${pgWorkloadTypeLabel(m.dbType)} | RAM: ${m.totalMemoryMb}MB | CPUs: ${m.cpuCount} | PostgreSQL ${m.dbVersion}`,
    )
    lines.push('#')
    lines.push('# Formulas adapted from pgtune (github.com/le0pard/pgtune). Review every')
    lines.push('# line before applying to production — these are starting points.')
    lines.push('')

    lines.push(`# --- Memory (calculated from ${m.totalMemoryMb}MB RAM, ${pgWorkloadTypeLabel(m.dbType)} workload) ---`)
    lines.push(`max_connections = ${p.maxConnections}`)
    lines.push(`shared_buffers = ${formatPgKb(p.sharedBuffersKb)}`)
    lines.push(`effective_cache_size = ${formatPgKb(p.effectiveCacheSizeKb)}`)
    lines.push(`maintenance_work_mem = ${formatPgKb(p.maintenanceWorkMemKb)}`)
    lines.push(`autovacuum_work_mem = ${formatPgKb(p.autovacuumWorkMemKb)}`)
    lines.push(`work_mem = ${formatPgKb(p.workMemKb)}`)
    lines.push('')

    lines.push('# --- Checkpoints & WAL ---')
    lines.push(`wal_buffers = ${formatPgKb(p.walBuffersKb)}`)
    lines.push(`min_wal_size = ${formatPgMb(p.minWalSizeMb)}`)
    lines.push(`max_wal_size = ${formatPgMb(p.maxWalSizeMb)}`)
    lines.push(`checkpoint_completion_target = ${p.checkpointCompletionTarget}`)
    if (p.walCompression != null) lines.push(`wal_compression = ${p.walCompression}`)
    lines.push('')

    lines.push('# --- Query Planner ---')
    lines.push(`default_statistics_target = ${p.defaultStatisticsTarget}`)
    lines.push(`random_page_cost = ${p.randomPageCost}`)
    if (p.effectiveIoConcurrency != null) {
      lines.push(`effective_io_concurrency = ${p.effectiveIoConcurrency}`)
    }
    lines.push('')

    if (p.maxWorkerProcesses != null || p.jit != null) {
      lines.push(`# --- Parallelism (${m.cpuCount} CPUs) ---`)
      if (p.maxWorkerProcesses != null) {
        lines.push(`max_worker_processes = ${p.maxWorkerProcesses}`)
        lines.push(`max_parallel_workers_per_gather = ${p.maxParallelWorkersPerGather}`)
        if (p.maxParallelWorkers != null) lines.push(`max_parallel_workers = ${p.maxParallelWorkers}`)
        if (p.maxParallelMaintenanceWorkers != null) {
          lines.push(`max_parallel_maintenance_workers = ${p.maxParallelMaintenanceWorkers}`)
        }
      }
      if (p.jit != null) lines.push(`jit = ${p.jit}`)
      lines.push('')
    }

    lines.push('# --- Durability & Replication ---')
    lines.push(`wal_level = ${p.walLevel}`)
    for (const line of catalogLines(kPostgresPolicyCatalog, policyValues, 'Durability & Replication')) {
      lines.push(line)
    }
    lines.push('')

    writeSection(lines, 'Logging', catalogLines(kPostgresPolicyCatalog, policyValues, 'Logging'))

    return lines.join('\n').replace(/\s+$/, '') + '\n'
  }

  private renderMariaDb(m: MariaDbMetrics, policyValues: Record<string, string>): string {
    const p = computeMariaDbParams(m)
    const availableMb = m.totalMemoryMb - m.reservedForOsMb
    const lines: string[] = []

    lines.push('# my.cnf — generated by InfraKit Studio')
    lines.push(
      `# Workload: ${mariaDbWorkloadTypeLabel(m.dbType)} | RAM: ${m.totalMemoryMb}MB (reserving ${m.reservedForOsMb}MB for the OS) ` +
        `| MariaDB ${mariaDbMajorVersion(m)}.${mariaDbMinorVersion(m)}`,
    )
    lines.push('#')
    lines.push('# Formulas adapted from database.gkanev.com and general Percona/MariaDB tuning')
    lines.push('# guidance. Review every line before applying to production.')
    lines.push('')
    lines.push('[mysqld]')
    lines.push('')

    lines.push(`# --- Memory & InnoDB (calculated from ${availableMb}MB available, 75% target) ---`)
    lines.push(`innodb_buffer_pool_size = ${formatMariaDbMb(p.innodbBufferPoolSizeMb)}`)
    if (mariaDbUsesRedoLogCapacity(m)) {
      lines.push('# MariaDB >= 10.8 replaced innodb_log_file_size with innodb_redo_log_capacity')
      lines.push(`innodb_redo_log_capacity = ${formatMariaDbMb(p.innodbLogFileSizeMb)}`)
    } else {
      lines.push(`innodb_log_file_size = ${formatMariaDbMb(p.innodbLogFileSizeMb)}`)
    }
    lines.push(`innodb_flush_method = ${p.innodbFlushMethod}`)
    lines.push(`innodb_io_capacity = ${p.innodbIoCapacity}`)
    lines.push(`innodb_flush_neighbors = ${p.innodbFlushNeighbors}`)
    lines.push('')

    writeSection(lines, 'Durability', catalogLines(kMariaDbPolicyCatalog, policyValues, 'Durability'))

    lines.push('# --- Connections & Caches ---')
    lines.push(`max_connections = ${p.maxConnections}`)
    lines.push(`table_open_cache = ${p.tableOpenCache}`)
    lines.push(`tmp_table_size = ${p.tmpTableSizeMb}M`)
    lines.push(`max_heap_table_size = ${p.tmpTableSizeMb}M`)
    lines.push(`thread_cache_size = ${p.threadCacheSize}`)
    lines.push('')

    lines.push('# --- Character Set ---')
    lines.push('character-set-server = utf8mb4')
    lines.push('collation-server = utf8mb4_unicode_ci')
    lines.push('')

    writeSection(lines, 'Query Cache', catalogLines(kMariaDbPolicyCatalog, policyValues, 'Query Cache'))
    writeSection(lines, 'Replication', catalogLines(kMariaDbPolicyCatalog, policyValues, 'Replication'))
    writeSection(lines, 'Logging', catalogLines(kMariaDbPolicyCatalog, policyValues, 'Logging'))

    return lines.join('\n').replace(/\s+$/, '') + '\n'
  }
}
