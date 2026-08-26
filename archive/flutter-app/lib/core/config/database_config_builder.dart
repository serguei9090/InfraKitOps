/// Database configuration builder — pure Dart, no I/O, no Flutter.
///
/// Renders either a `postgresql.conf` or a `my.cnf` (`[mysqld]` section) from
/// two independent sources of truth, kept deliberately separate:
///
///  * **Calculated parameters** — derived purely from machine metrics (RAM,
///    CPU count, workload type, storage, version). These are always emitted;
///    there is nothing to "select", the same way `shared_buffers` isn't
///    optional once you've told the tool how much RAM the box has.
///  * **Policy options** — a small catalog of durability/replication/logging
///    switches and dropdowns the operator decides deliberately (SSL,
///    synchronous_commit, archive_mode, slow query logging, binary logging,
///    …). Only options the caller actually selected are emitted, matching
///    this app's "minimal reviewable diff" philosophy established by
///    `ssh_config_builder.dart` and `sysctl_config_builder.dart`. Each
///    catalog entry is typed with a [DbOptionValueKind] so the UI can pick a
///    switch/dropdown/text-field generically instead of hard-coding widget
///    choices per key — same pattern as `SysctlValueKind`.
///
/// ## Sourcing of the calculated-parameter formulas
///
/// **PostgreSQL** formulas are taken from pgtune
/// (github.com/le0pard/pgtune), specifically its `dbType`-driven
/// shared_buffers / effective_cache_size / maintenance_work_mem / work_mem /
/// wal_buffers / checkpoint / planner / parallel-worker logic. Every branch
/// (Windows caps, PG-version gates on wal_compression/jit/parallel workers,
/// the DB-fits-in-RAM work_mem multiplier) mirrors pgtune's own source.
///
/// **MariaDB** formulas are taken from database.gkanev.com's InnoDB sizing
/// calculator plus general Percona/MariaDB tuning guidance (documented at
/// each formula site below) — these are looser industry heuristics rather
/// than a single canonical tool, and are flagged as such in the doc comments
/// where the source itself calls them approximate (e.g. `table_open_cache`,
/// `thread_cache_size`).
///
/// ## Deliberate extensions beyond the cited sources
///
///  * `PgStorageType` includes `nvme` in addition to the `hdd`/`ssd`/`san`
///    trio pgtune's UI exposes, because pgtune's own `effective_io_concurrency`
///    table defines a value for it (1000) that the other three don't cover.
///  * `random_page_cost` for `san`/`nvme` storage (which pgtune's own
///    two-branch formula doesn't explicitly name) falls through to the
///    "fast storage" value (1.1) rather than the HDD value — SAN and NVMe
///    are both lower-latency than spinning disk, so grouping them with SSD
///    is the conservative reading, not a change to pgtune's HDD/SSD logic.
library;

import '../ports/i_tool_use_case.dart';

// ===========================================================================
// Engine selector
// ===========================================================================

enum DatabaseEngine {
  postgresql('PostgreSQL', 'postgresql.conf'),
  mariadb('MariaDB', 'my.cnf');

  const DatabaseEngine(this.label, this.suggestedFileName);

  final String label;

  /// Filename to suggest in a native "save as" dialog.
  final String suggestedFileName;
}

// ===========================================================================
// PostgreSQL metric inputs
// ===========================================================================

enum PgWorkloadType {
  web('Web application'),
  oltp('OLTP (high transaction rate)'),
  dw('Data warehouse'),
  desktop('Desktop / development'),
  mixed('Mixed workload');

  const PgWorkloadType(this.label);

  final String label;
}

enum PgStorageType {
  hdd('Spinning disk (HDD)'),
  ssd('SSD'),
  san('SAN / network storage'),
  nvme('NVMe');

  const PgStorageType(this.label);

  final String label;
}

/// Drives the emitted `wal_level`: standalone -> minimal, primary/replica ->
/// replica, logical replication -> logical.
enum PgReplicationRole {
  standalone('Standalone (no replication)'),
  primary('Primary (physical replication)'),
  replica('Replica (physical replication)'),
  logical('Logical replication');

  const PgReplicationRole(this.label);

  final String label;
}

/// Machine/workload facts pgtune's formulas are computed from. Everything
/// here maps to a calculated parameter — nothing in this class is optional
/// the way a policy option is.
class PostgresMetrics {
  const PostgresMetrics({
    required this.totalMemoryMb,
    required this.cpuCount,
    required this.dbVersion,
    required this.dbType,
    this.maxConnections,
    required this.storageType,
    this.osIsWindows = false,
    this.dbFitsInRam = false,
    this.replicationRole = PgReplicationRole.standalone,
  });

  final int totalMemoryMb;
  final int cpuCount;

  /// PostgreSQL major version, e.g. `18`, `16`, `9` (for pre-10 releases).
  final int dbVersion;

  final PgWorkloadType dbType;

  /// User-supplied `max_connections`, or null for pgtune's per-`dbType`
  /// default (web=200, oltp=300, dw=40, desktop=20, mixed=100).
  final int? maxConnections;

  final PgStorageType storageType;

  /// Windows only matters for two things: the PG<10 shared_buffers 512MB
  /// cap, and the PG<=17 2GB-1MB cap on maintenance_work_mem/work_mem —
  /// plus it disables `effective_io_concurrency` entirely (POSIX AIO-only).
  final bool osIsWindows;

  /// Whether the whole database is expected to fit in RAM. Feeds the
  /// work_mem multiplier (x1.3 vs x0.9) and random_page_cost.
  final bool dbFitsInRam;

  final PgReplicationRole replicationRole;
}

// ===========================================================================
// MariaDB metric inputs
// ===========================================================================

enum MariaDbStorageType {
  hdd('Spinning disk (HDD)'),
  ssd('SSD'),
  nvme('NVMe');

  const MariaDbStorageType(this.label);

  final String label;
}

enum MariaDbWorkloadType {
  oltp('OLTP (high transaction rate)'),
  olap('OLAP / analytics'),
  mixed('Mixed workload'),
  web('Web application'),
  smallVps('Small VPS / shared host');

  const MariaDbWorkloadType(this.label);

  final String label;
}

class MariaDbMetrics {
  const MariaDbMetrics({
    required this.totalMemoryMb,
    required this.reservedForOsMb,
    required this.storageType,
    required this.dbType,
    this.osIsWindows = false,
    this.majorVersion = 10,
    this.minorVersion = 6,
  });

  final int totalMemoryMb;

  /// Memory reserved for the OS and everything that isn't MariaDB. A common
  /// starting suggestion is 10-20% of [totalMemoryMb]; the UI should offer
  /// that as a default, not enforce it — this is just an input here.
  final int reservedForOsMb;

  final MariaDbStorageType storageType;
  final MariaDbWorkloadType dbType;

  /// Only affects `innodb_flush_method` (O_DIRECT vs unbuffered).
  final bool osIsWindows;

  /// MariaDB major/minor version, used to decide between the legacy
  /// `innodb_log_file_size` and the `innodb_redo_log_capacity` that replaced
  /// it in MariaDB 10.8.
  final int majorVersion;
  final int minorVersion;

  /// Whether this version is >= 10.8, i.e. uses `innodb_redo_log_capacity`.
  bool get usesRedoLogCapacity => majorVersion > 10 || (majorVersion == 10 && minorVersion >= 8);
}

// ===========================================================================
// Policy option catalog (switches/dropdowns, value-kind driven like
// SysctlValueKind so the UI stays generic)
// ===========================================================================

enum DbOptionValueKind {
  /// Exactly two legal values. Rendered as a switch by the UI.
  boolean,

  /// A fixed, closed set of values ([DbPolicyOption.choices]). Rendered as a
  /// dropdown; any other value is rejected.
  choice,

  /// Genuinely free-form (commands, paths, numeric-but-unbounded thresholds).
  freeText,
}

class DbOptionChoice {
  const DbOptionChoice(this.value, this.label);

  final String value;
  final String label;
}

/// One selectable policy directive. The UI enumerates
/// [dbPolicyOptionsForEngine] and builds its widgets generically off [kind],
/// exactly like `sysctl_config_builder_screen.dart` does for
/// [DbOptionValueKind.choice]/[DbOptionValueKind.boolean] vs free entry.
class DbPolicyOption {
  const DbPolicyOption({
    required this.key,
    required this.engine,
    required this.section,
    required this.label,
    required this.description,
    required this.kind,
    this.choices = const [],
    required this.defaultValue,
    this.hint,
    this.dependsOnKey,
    this.dependsOnValue,
    this.quoted = false,
    this.uppercaseBoolean = false,
  });

  /// The literal config key, e.g. `synchronous_commit` or `log_bin`.
  final String key;

  final DatabaseEngine engine;

  /// Output section heading this option's line is grouped under, e.g.
  /// `Durability & Replication`.
  final String section;

  final String label;
  final String description;
  final DbOptionValueKind kind;

  /// Legal values for [DbOptionValueKind.choice]. Empty otherwise.
  final List<DbOptionChoice> choices;

  /// Value pre-filled in the UI before the user changes anything.
  final String defaultValue;

  /// Placeholder text for free-text fields.
  final String? hint;

  /// When set, this option is only ever emitted if the option keyed
  /// [dependsOnKey] is itself selected (and, when [dependsOnValue] is also
  /// set, its selected value matches). Models pairs like
  /// `archive_mode` -> `archive_command` and `log_bin` -> `server_id`: the
  /// dependent field only appears once its governing switch is on.
  final String? dependsOnKey;

  /// Required value of [dependsOnKey] for this option to be emitted. Null
  /// means "governing key just needs to be selected with any value" — used
  /// for freeText -> freeText pairs like `log_min_duration_statement` ->
  /// `log_line_prefix`.
  final String? dependsOnValue;

  /// Whether the emitted value is wrapped in single quotes (PostgreSQL
  /// string GUCs such as `archive_command`/`log_line_prefix`).
  final bool quoted;

  /// Whether a [DbOptionValueKind.boolean] value is emitted as `ON`/`OFF`
  /// (MariaDB convention) rather than `on`/`off` (PostgreSQL convention).
  final bool uppercaseBoolean;
}

// ---------------------------------------------------------------------------
// PostgreSQL policy catalog
// ---------------------------------------------------------------------------

const List<DbPolicyOption> kPostgresPolicyCatalog = [
  DbPolicyOption(
    key: 'synchronous_commit',
    engine: DatabaseEngine.postgresql,
    section: 'Durability & Replication',
    label: 'Synchronous commit',
    description:
        'Durability vs. throughput tradeoff: "on" waits for the WAL to be flushed (and, with synchronous '
        'replicas, confirmed) before returning success to the client; "off" returns immediately and can lose '
        'the last few transactions on a crash.',
    kind: DbOptionValueKind.choice,
    choices: [
      DbOptionChoice('on', 'on — full durability (default)'),
      DbOptionChoice('off', 'off — fastest, can lose recent commits on crash'),
      DbOptionChoice('local', 'local — flush locally, do not wait on replicas'),
      DbOptionChoice('remote_write', 'remote_write — wait for replica OS write, not fsync'),
      DbOptionChoice('remote_apply', 'remote_apply — wait for replica to apply and be visible'),
    ],
    defaultValue: 'on',
  ),
  DbPolicyOption(
    key: 'ssl',
    engine: DatabaseEngine.postgresql,
    section: 'Durability & Replication',
    label: 'SSL',
    description: 'Require TLS-capable connections. The server also needs valid ssl_cert_file/ssl_key_file.',
    kind: DbOptionValueKind.boolean,
    defaultValue: 'off',
  ),
  DbPolicyOption(
    key: 'archive_mode',
    engine: DatabaseEngine.postgresql,
    section: 'Durability & Replication',
    label: 'Archive mode',
    description: 'Continuously archive completed WAL segments via archive_command — the basis for PITR and warm standbys.',
    kind: DbOptionValueKind.boolean,
    defaultValue: 'off',
  ),
  DbPolicyOption(
    key: 'archive_command',
    engine: DatabaseEngine.postgresql,
    section: 'Durability & Replication',
    label: 'Archive command',
    description: 'Shell command PostgreSQL runs to archive one WAL file. %p is the source path, %f the filename.',
    kind: DbOptionValueKind.freeText,
    defaultValue: 'cp %p /var/lib/postgresql/wal_archive/%f',
    hint: 'cp %p /var/lib/postgresql/wal_archive/%f',
    dependsOnKey: 'archive_mode',
    dependsOnValue: 'on',
    quoted: true,
  ),
  DbPolicyOption(
    key: 'logging_collector',
    engine: DatabaseEngine.postgresql,
    section: 'Logging',
    label: 'Logging collector',
    description: 'Capture stderr output into rotated log files instead of relying on the launching process.',
    kind: DbOptionValueKind.boolean,
    defaultValue: 'off',
  ),
  DbPolicyOption(
    key: 'log_min_duration_statement',
    engine: DatabaseEngine.postgresql,
    section: 'Logging',
    label: 'Slow query threshold (ms)',
    description: 'Log any statement taking at least this many milliseconds. -1 disables, 0 logs every statement.',
    kind: DbOptionValueKind.freeText,
    defaultValue: '1000',
    hint: '1000',
  ),
  DbPolicyOption(
    key: 'log_line_prefix',
    engine: DatabaseEngine.postgresql,
    section: 'Logging',
    label: 'Log line prefix',
    description:
        'printf-style prefix for each log line. Emitted alongside the slow-query threshold with a sensible '
        'default (timestamp, PID, query id, user@database) so slow-query logs are actually attributable.',
    kind: DbOptionValueKind.freeText,
    defaultValue: '%m [%p] %q%u@%d/%a ',
    dependsOnKey: 'log_min_duration_statement',
    quoted: true,
  ),
];

// ---------------------------------------------------------------------------
// MariaDB policy catalog
// ---------------------------------------------------------------------------

const List<DbPolicyOption> kMariaDbPolicyCatalog = [
  DbPolicyOption(
    key: 'innodb_flush_log_at_trx_commit',
    engine: DatabaseEngine.mariadb,
    section: 'Durability',
    label: 'InnoDB flush at commit',
    description:
        '1 = full ACID, fsync on every commit (slowest, safest). 2 = flush the log to the OS on every commit '
        'but only fsync once per second (can lose ~1s of commits on an OS crash, safe against a mysqld crash). '
        '0 = write and fsync only once per second (fastest, can lose ~1s of commits on either kind of crash).',
    kind: DbOptionValueKind.choice,
    choices: [
      DbOptionChoice('1', '1 — full ACID / slowest'),
      DbOptionChoice('2', '2 — flush on commit, fsync ~1/sec'),
      DbOptionChoice('0', '0 — fastest, least durable'),
    ],
    defaultValue: '1',
  ),
  DbPolicyOption(
    key: 'query_cache_type',
    engine: DatabaseEngine.mariadb,
    section: 'Query Cache',
    label: 'Query cache',
    description:
        'MariaDB still supports the legacy query cache, unlike modern MySQL, but it serializes writes to a '
        'single cache and is widely recommended OFF under any real concurrency.',
    kind: DbOptionValueKind.boolean,
    defaultValue: 'off',
    uppercaseBoolean: true,
  ),
  DbPolicyOption(
    key: 'query_cache_size',
    engine: DatabaseEngine.mariadb,
    section: 'Query Cache',
    label: 'Query cache size',
    description: 'Keep this small if the cache is enabled at all — a large query cache increases lock contention, not hit rate.',
    kind: DbOptionValueKind.freeText,
    defaultValue: '64M',
    hint: '64M',
    dependsOnKey: 'query_cache_type',
    dependsOnValue: 'on',
  ),
  DbPolicyOption(
    key: 'log_bin',
    engine: DatabaseEngine.mariadb,
    section: 'Replication',
    label: 'Binary logging',
    description: 'Enables the binary log — required for replication and point-in-time recovery.',
    kind: DbOptionValueKind.boolean,
    defaultValue: 'off',
    uppercaseBoolean: true,
  ),
  DbPolicyOption(
    key: 'server_id',
    engine: DatabaseEngine.mariadb,
    section: 'Replication',
    label: 'Server ID',
    description: 'Unique numeric ID for this instance. Required once binary logging is on, and must be distinct across a replication topology.',
    kind: DbOptionValueKind.freeText,
    defaultValue: '1',
    hint: '1',
    dependsOnKey: 'log_bin',
    dependsOnValue: 'on',
  ),
  DbPolicyOption(
    key: 'slow_query_log',
    engine: DatabaseEngine.mariadb,
    section: 'Logging',
    label: 'Slow query log',
    description: 'Log queries slower than long_query_time to the slow query log.',
    kind: DbOptionValueKind.boolean,
    defaultValue: 'off',
    uppercaseBoolean: true,
  ),
  DbPolicyOption(
    key: 'long_query_time',
    engine: DatabaseEngine.mariadb,
    section: 'Logging',
    label: 'Slow query threshold (seconds)',
    description: 'Queries taking at least this many seconds are written to the slow query log.',
    kind: DbOptionValueKind.freeText,
    defaultValue: '2',
    hint: '2',
    dependsOnKey: 'slow_query_log',
    dependsOnValue: 'on',
  ),
];

/// Catalog options for [engine], in emission/UI order.
List<DbPolicyOption> dbPolicyOptionsForEngine(DatabaseEngine engine) => engine == DatabaseEngine.postgresql
    ? kPostgresPolicyCatalog
    : kMariaDbPolicyCatalog;

/// The choices a picker should offer for [option]: [DbPolicyOption.choices]
/// for [DbOptionValueKind.choice], on/off for boolean, empty for free entry.
List<DbOptionChoice> dbEffectiveChoices(DbPolicyOption option) {
  switch (option.kind) {
    case DbOptionValueKind.choice:
      return option.choices;
    case DbOptionValueKind.boolean:
      return option.uppercaseBoolean
          ? const [DbOptionChoice('ON', 'ON'), DbOptionChoice('OFF', 'OFF')]
          : const [DbOptionChoice('on', 'on'), DbOptionChoice('off', 'off')];
    case DbOptionValueKind.freeText:
      return const [];
  }
}

// ===========================================================================
// Calculated parameters — PostgreSQL (pgtune formulas)
// ===========================================================================

/// Everything pgtune's own metric-driven logic computes for one
/// [PostgresMetrics] input. Exposed as its own pure function/result pair
/// (rather than folded straight into text rendering) so each formula can be
/// unit-tested against a hand-computed value independently of string output.
class PgCalculatedParams {
  const PgCalculatedParams({
    required this.maxConnections,
    required this.sharedBuffersKb,
    required this.effectiveCacheSizeKb,
    required this.maintenanceWorkMemKb,
    required this.autovacuumWorkMemKb,
    required this.workMemKb,
    required this.walBuffersKb,
    required this.minWalSizeMb,
    required this.maxWalSizeMb,
    required this.checkpointCompletionTarget,
    required this.defaultStatisticsTarget,
    required this.randomPageCost,
    required this.effectiveIoConcurrency,
    required this.maxWorkerProcesses,
    required this.maxParallelWorkersPerGather,
    required this.maxParallelWorkers,
    required this.maxParallelMaintenanceWorkers,
    required this.walCompression,
    required this.jit,
    required this.walLevel,
  });

  final int maxConnections;
  final int sharedBuffersKb;
  final int effectiveCacheSizeKb;
  final int maintenanceWorkMemKb;
  final int autovacuumWorkMemKb;
  final int workMemKb;
  final int walBuffersKb;
  final int minWalSizeMb;
  final int maxWalSizeMb;
  final double checkpointCompletionTarget;
  final int defaultStatisticsTarget;
  final double randomPageCost;

  /// Null on Windows — `effective_io_concurrency` is a POSIX AIO knob.
  final int? effectiveIoConcurrency;

  /// Null unless `cpuCount >= 4`.
  final int? maxWorkerProcesses;
  final int? maxParallelWorkersPerGather;

  /// Null unless `cpuCount >= 4` AND `dbVersion >= 10`.
  final int? maxParallelWorkers;

  /// Null unless `cpuCount >= 4` AND `dbVersion >= 11`.
  final int? maxParallelMaintenanceWorkers;

  /// `lz4` (PG>=15), `on` (PG 10-14), or null (PG<10).
  final String? walCompression;

  /// `off` for web/oltp/mixed on PG>=12, else null.
  final String? jit;

  final String walLevel;
}

int _pgDefaultMaxConnections(PgWorkloadType t) => switch (t) {
  PgWorkloadType.web => 200,
  PgWorkloadType.oltp => 300,
  PgWorkloadType.dw => 40,
  PgWorkloadType.desktop => 20,
  PgWorkloadType.mixed => 100,
};

/// 2GB - 1MB in kB, the Windows + PG<=17 cap on maintenance_work_mem,
/// autovacuum_work_mem and work_mem (32-bit Windows int overflow guard kept
/// by pgtune for older releases).
const int _kWindowsLegacyCapKb = 2 * 1024 * 1024 - 1024;

/// Computes every pgtune-derived parameter for [m]. Throws [ArgumentError]
/// on non-positive RAM/CPU/connections — there is no sensible config to
/// generate from those.
PgCalculatedParams computePostgresParams(PostgresMetrics m) {
  if (m.totalMemoryMb <= 0) {
    throw ArgumentError('Total memory must be greater than zero (got ${m.totalMemoryMb}MB).');
  }
  if (m.cpuCount <= 0) {
    throw ArgumentError('CPU count must be greater than zero (got ${m.cpuCount}).');
  }
  if (m.maxConnections != null && m.maxConnections! <= 0) {
    throw ArgumentError('Max connections must be greater than zero, or left unset for auto (got ${m.maxConnections}).');
  }

  final totalKb = m.totalMemoryMb * 1024;

  // --- shared_buffers ---
  int sharedBuffersKb = m.dbType == PgWorkloadType.desktop ? (totalKb / 16).round() : (totalKb / 4).round();
  if (m.osIsWindows && m.dbVersion < 10) {
    const capKb = 512 * 1024;
    if (sharedBuffersKb > capKb) sharedBuffersKb = capKb;
  }

  // --- effective_cache_size ---
  final effectiveCacheSizeKb = m.dbType == PgWorkloadType.desktop ? (totalKb / 4).round() : (totalKb * 3 / 4).round();

  // --- maintenance_work_mem ---
  int maintenanceWorkMemKb = m.dbType == PgWorkloadType.dw ? (totalKb / 8).round() : (totalKb / 16).round();
  final windowsLegacyCap = m.osIsWindows && m.dbVersion <= 17;
  final maintenanceCapKb = windowsLegacyCap ? _kWindowsLegacyCapKb : 8 * 1024 * 1024;
  if (maintenanceWorkMemKb > maintenanceCapKb) maintenanceWorkMemKb = maintenanceCapKb;

  // --- autovacuum_work_mem: capped at 2GB (or the Windows legacy cap) ---
  final autovacuumCapKb = windowsLegacyCap ? _kWindowsLegacyCapKb : 2 * 1024 * 1024;
  final autovacuumWorkMemKb = maintenanceWorkMemKb > autovacuumCapKb ? autovacuumCapKb : maintenanceWorkMemKb;

  // --- max_connections ---
  final maxConnections = m.maxConnections ?? _pgDefaultMaxConnections(m.dbType);

  // Effective max_worker_processes used in the work_mem formula regardless
  // of whether the GUC itself gets emitted (it's only emitted at cpu>=4;
  // below that PostgreSQL's own built-in default of 8 applies).
  final effectiveMaxWorkerProcesses = m.cpuCount >= 4 ? m.cpuCount : 8;

  // --- work_mem ---
  double workMemBase = (totalKb - sharedBuffersKb) / ((maxConnections + effectiveMaxWorkerProcesses) * 3);
  workMemBase = switch (m.dbType) {
    PgWorkloadType.dw || PgWorkloadType.mixed => workMemBase / 2,
    PgWorkloadType.desktop => workMemBase / 6,
    PgWorkloadType.web || PgWorkloadType.oltp => workMemBase,
  };
  final workMemScaled = m.dbFitsInRam ? workMemBase * 1.3 : workMemBase * 0.9;
  int workMemKb = workMemScaled.round();
  if (workMemKb < 4096) workMemKb = 4096;
  if (windowsLegacyCap && workMemKb > _kWindowsLegacyCapKb) workMemKb = _kWindowsLegacyCapKb;

  // --- wal_buffers: 3% of shared_buffers, snapped/capped at 16MB, floor 32kB ---
  int walBuffersKb = (sharedBuffersKb * 0.03).round();
  if (walBuffersKb >= 14336) {
    walBuffersKb = 16384;
  }
  if (walBuffersKb < 32) walBuffersKb = 32;

  // --- min/max_wal_size ---
  final (minWalSizeMb, maxWalSizeMb) = switch (m.dbType) {
    PgWorkloadType.web => (1024, 4096),
    PgWorkloadType.oltp => (2048, 8192),
    PgWorkloadType.dw => (4096, 16384),
    PgWorkloadType.desktop => (100, 2048),
    PgWorkloadType.mixed => (1024, 4096),
  };

  const checkpointCompletionTarget = 0.9;
  final defaultStatisticsTarget = m.dbType == PgWorkloadType.dw ? 500 : 100;

  // --- random_page_cost ---
  double randomPageCost;
  if (m.dbFitsInRam || m.storageType == PgStorageType.ssd) {
    randomPageCost = 1.1;
  } else if (m.storageType == PgStorageType.hdd || (m.dbType == PgWorkloadType.dw && !m.dbFitsInRam)) {
    randomPageCost = 4.0;
  } else {
    // san/nvme, not a data warehouse missing RAM: treat as fast storage.
    randomPageCost = 1.1;
  }

  // --- effective_io_concurrency (Linux only) ---
  int? effectiveIoConcurrency;
  if (!m.osIsWindows) {
    effectiveIoConcurrency = switch (m.storageType) {
      PgStorageType.hdd => 2,
      PgStorageType.ssd => 200,
      PgStorageType.san => 300,
      PgStorageType.nvme => 1000,
    };
  }

  // --- parallel workers (cpuCount >= 4 only) ---
  int? maxWorkerProcesses;
  int? maxParallelWorkersPerGather;
  int? maxParallelWorkers;
  int? maxParallelMaintenanceWorkers;
  if (m.cpuCount >= 4) {
    maxWorkerProcesses = m.cpuCount;
    final halfCeil = (m.cpuCount / 2).ceil();
    maxParallelWorkersPerGather = m.dbType == PgWorkloadType.dw ? halfCeil : (halfCeil > 4 ? 4 : halfCeil);
    if (m.dbVersion >= 10) maxParallelWorkers = m.cpuCount;
    if (m.dbVersion >= 11) maxParallelMaintenanceWorkers = halfCeil > 4 ? 4 : halfCeil;
  }

  // --- wal_compression ---
  String? walCompression;
  if (m.dbVersion >= 15) {
    walCompression = 'lz4';
  } else if (m.dbVersion >= 10) {
    walCompression = 'on';
  }

  // --- jit ---
  String? jit;
  if (m.dbVersion >= 12 &&
      (m.dbType == PgWorkloadType.web || m.dbType == PgWorkloadType.oltp || m.dbType == PgWorkloadType.mixed)) {
    jit = 'off';
  }

  // --- wal_level, driven by replicationRole ---
  final walLevel = switch (m.replicationRole) {
    PgReplicationRole.standalone => 'minimal',
    PgReplicationRole.primary || PgReplicationRole.replica => 'replica',
    PgReplicationRole.logical => 'logical',
  };

  return PgCalculatedParams(
    maxConnections: maxConnections,
    sharedBuffersKb: sharedBuffersKb,
    effectiveCacheSizeKb: effectiveCacheSizeKb,
    maintenanceWorkMemKb: maintenanceWorkMemKb,
    autovacuumWorkMemKb: autovacuumWorkMemKb,
    workMemKb: workMemKb,
    walBuffersKb: walBuffersKb,
    minWalSizeMb: minWalSizeMb,
    maxWalSizeMb: maxWalSizeMb,
    checkpointCompletionTarget: checkpointCompletionTarget,
    defaultStatisticsTarget: defaultStatisticsTarget,
    randomPageCost: randomPageCost,
    effectiveIoConcurrency: effectiveIoConcurrency,
    maxWorkerProcesses: maxWorkerProcesses,
    maxParallelWorkersPerGather: maxParallelWorkersPerGather,
    maxParallelWorkers: maxParallelWorkers,
    maxParallelMaintenanceWorkers: maxParallelMaintenanceWorkers,
    walCompression: walCompression,
    jit: jit,
    walLevel: walLevel,
  );
}

// ===========================================================================
// Calculated parameters — MariaDB
// ===========================================================================

class MariaDbCalculatedParams {
  const MariaDbCalculatedParams({
    required this.innodbBufferPoolSizeMb,
    required this.innodbLogFileSizeMb,
    required this.innodbFlushMethod,
    required this.innodbIoCapacity,
    required this.innodbFlushNeighbors,
    required this.maxConnections,
    required this.tableOpenCache,
    required this.tmpTableSizeMb,
    required this.threadCacheSize,
  });

  /// 75% of (totalMemory - reservedForOs), rounded to the nearest 128MB.
  /// Sits inside the commonly cited 70-80% range for a dedicated DB server;
  /// see [computeMariaDbParams] for why 75% specifically was picked as the
  /// single calculated default.
  final int innodbBufferPoolSizeMb;

  /// ~25% of the buffer pool, capped at 2048MB. Emitted as
  /// `innodb_redo_log_capacity` on MariaDB >= 10.8, `innodb_log_file_size`
  /// (per-file, historically paired with innodb_log_files_in_group) before
  /// that — see [MariaDbMetrics.usesRedoLogCapacity].
  final int innodbLogFileSizeMb;

  /// `O_DIRECT` (Linux) or `unbuffered` (Windows).
  final String innodbFlushMethod;

  final int innodbIoCapacity;

  /// 1 on HDD (spinning disks benefit from flushing neighboring pages
  /// together), 0 on SSD/NVMe (neighbor flushing only adds seek-free I/O
  /// that random-access flash gets no benefit from).
  final int innodbFlushNeighbors;

  final int maxConnections;

  /// `max_connections * 4`, floor 400 — a rough connection-scaled heuristic,
  /// not a formula from a specific cited source.
  final int tableOpenCache;

  /// Shared by `tmp_table_size` and `max_heap_table_size`, which MariaDB
  /// docs recommend keeping equal. `min(totalMemory / 32, 256)` MB, floored
  /// at 16MB so very small inputs don't collapse to zero.
  final int tmpTableSizeMb;

  /// `min(max_connections / 2, 100)` — small RAM/connection-scaled default.
  final int threadCacheSize;
}

MariaDbCalculatedParams computeMariaDbParams(MariaDbMetrics m) {
  if (m.totalMemoryMb <= 0) {
    throw ArgumentError('Total memory must be greater than zero (got ${m.totalMemoryMb}MB).');
  }
  if (m.reservedForOsMb < 0) {
    throw ArgumentError('Reserved OS memory cannot be negative (got ${m.reservedForOsMb}MB).');
  }
  final availableMb = m.totalMemoryMb - m.reservedForOsMb;
  if (availableMb <= 0) {
    throw ArgumentError(
      'Reserved OS memory (${m.reservedForOsMb}MB) leaves no memory for MariaDB out of ${m.totalMemoryMb}MB total.',
    );
  }

  // --- innodb_buffer_pool_size: 75% of available, nearest 128MB ---
  final rawPoolMb = availableMb * 0.75;
  int poolMb = ((rawPoolMb / 128).round()) * 128;
  if (poolMb < 128) poolMb = 128;

  // --- innodb_log_file_size / innodb_redo_log_capacity ---
  final rawLogMb = poolMb * 0.25;
  final logMb = (rawLogMb < 2048 ? rawLogMb : 2048).round();

  final flushMethod = m.osIsWindows ? 'unbuffered' : 'O_DIRECT';

  final ioCapacity = switch (m.storageType) {
    MariaDbStorageType.hdd => 200,
    MariaDbStorageType.ssd => 2000,
    MariaDbStorageType.nvme => 10000,
  };
  final flushNeighbors = m.storageType == MariaDbStorageType.hdd ? 1 : 0;

  final maxConnections = switch (m.dbType) {
    MariaDbWorkloadType.oltp => 200,
    MariaDbWorkloadType.olap => 50,
    MariaDbWorkloadType.mixed => 150,
    MariaDbWorkloadType.web => 150,
    MariaDbWorkloadType.smallVps => 50,
  };

  int tableOpenCache = maxConnections * 4;
  if (tableOpenCache < 400) tableOpenCache = 400;

  int tmpTableSizeMb = (m.totalMemoryMb / 32).floor();
  if (tmpTableSizeMb > 256) tmpTableSizeMb = 256;
  if (tmpTableSizeMb < 16) tmpTableSizeMb = 16;

  int threadCacheSize = (maxConnections / 2).round();
  if (threadCacheSize > 100) threadCacheSize = 100;

  return MariaDbCalculatedParams(
    innodbBufferPoolSizeMb: poolMb,
    innodbLogFileSizeMb: logMb,
    innodbFlushMethod: flushMethod,
    innodbIoCapacity: ioCapacity,
    innodbFlushNeighbors: flushNeighbors,
    maxConnections: maxConnections,
    tableOpenCache: tableOpenCache,
    tmpTableSizeMb: tmpTableSizeMb,
    threadCacheSize: threadCacheSize,
  );
}

// ===========================================================================
// Text formatting helpers
// ===========================================================================

/// Formats a kB quantity as PostgreSQL's own unit suffix style: `kB`, `MB`
/// or `GB`, no space, picking the largest unit that divides evenly.
String _formatPgKb(int kb) {
  if (kb <= 0) return '0kB';
  if (kb % (1024 * 1024) == 0) return '${kb ~/ (1024 * 1024)}GB';
  if (kb % 1024 == 0) return '${kb ~/ 1024}MB';
  return '${kb}kB';
}

/// Formats an MB quantity as PostgreSQL's own unit suffix style.
String _formatPgMb(int mb) {
  if (mb <= 0) return '0MB';
  if (mb % 1024 == 0) return '${mb ~/ 1024}GB';
  return '${mb}MB';
}

/// Formats an MB quantity as MariaDB's `my.cnf` unit suffix style (`M`/`G`,
/// no trailing `B`).
String _formatMariaDbMb(int mb) {
  if (mb <= 0) return '0M';
  if (mb % 1024 == 0) return '${mb ~/ 1024}G';
  return '${mb}M';
}

// ===========================================================================
// Policy value validation + rendering
// ===========================================================================

String _validatePolicyValue(DbPolicyOption option, String raw) {
  final value = raw.trim();
  if (value.isEmpty) {
    throw ArgumentError('${option.key} needs a value.');
  }
  if (value.contains('\n')) {
    throw ArgumentError('${option.key} must be a single line.');
  }

  switch (option.kind) {
    case DbOptionValueKind.boolean:
      final lower = value.toLowerCase();
      if (lower != 'on' && lower != 'off') {
        throw ArgumentError('${option.key} must be "on" or "off" (got "$value").');
      }
      return option.uppercaseBoolean ? lower.toUpperCase() : lower;

    case DbOptionValueKind.choice:
      for (final choice in option.choices) {
        if (choice.value.toLowerCase() == value.toLowerCase()) return choice.value;
      }
      throw ArgumentError(
        '${option.key} must be one of ${option.choices.map((c) => c.value).join(', ')} (got "$value").',
      );

    case DbOptionValueKind.freeText:
      return value;
  }
}

/// Whether [option] should be emitted, given every selection in [raw]:
/// unconditional options always are; options with [DbPolicyOption.dependsOnKey]
/// only are if that governing key is itself selected (and matches
/// [DbPolicyOption.dependsOnValue] when one is specified).
bool _dependencySatisfied(Map<String, String> raw, DbPolicyOption option) {
  final governingKey = option.dependsOnKey;
  if (governingKey == null) return true;
  final governingRaw = raw[governingKey];
  if (governingRaw == null || governingRaw.trim().isEmpty) return false;
  final requiredValue = option.dependsOnValue;
  if (requiredValue == null) return true;
  return governingRaw.trim().toLowerCase() == requiredValue.toLowerCase();
}

/// Renders the selected+dependency-satisfied lines from [catalog] belonging
/// to [section], validating each value against its option descriptor.
///
/// A dependent option (one with [DbPolicyOption.dependsOnKey] set) whose
/// governing condition is satisfied but which was never itself given an
/// explicit value falls back to [DbPolicyOption.defaultValue] — this is what
/// makes `log_line_prefix` a "fixed sensible default that rides along with"
/// `log_min_duration_statement` rather than a second thing the caller has to
/// separately select, while an independent (non-dependent) option still
/// requires an explicit selection to appear at all.
List<String> _catalogLines(List<DbPolicyOption> catalog, Map<String, String> raw, String section) {
  final lines = <String>[];
  for (final option in catalog.where((o) => o.section == section)) {
    if (!_dependencySatisfied(raw, option)) continue;
    var rawValue = raw[option.key];
    if ((rawValue == null || rawValue.trim().isEmpty) && option.dependsOnKey != null) {
      rawValue = option.defaultValue;
    }
    if (rawValue == null || rawValue.trim().isEmpty) continue;
    final value = _validatePolicyValue(option, rawValue);
    final formatted = option.quoted ? "'$value'" : value;
    lines.add('${option.key} = $formatted');
  }
  return lines;
}

void _writeSection(StringBuffer buffer, String header, List<String> lines) {
  if (lines.isEmpty) return;
  buffer.writeln('# --- $header ---');
  for (final line in lines) {
    buffer.writeln(line);
  }
  buffer.writeln();
}

void _rejectUnknownKeys(DatabaseEngine engine, Map<String, String> raw) {
  final known = {for (final o in dbPolicyOptionsForEngine(engine)) o.key};
  for (final key in raw.keys) {
    if (!known.contains(key)) {
      throw ArgumentError('"$key" is not a known ${engine.label} policy option in this catalog.');
    }
  }
}

// ===========================================================================
// Input / builder
// ===========================================================================

/// Input for [DatabaseConfigBuilder]. Exactly one of [postgres]/[mariadb]
/// must be supplied, matching [engine].
class DatabaseConfigBuilderInput {
  const DatabaseConfigBuilderInput({
    required this.engine,
    this.postgres,
    this.mariadb,
    this.policyValues = const {},
  });

  final DatabaseEngine engine;
  final PostgresMetrics? postgres;
  final MariaDbMetrics? mariadb;

  /// Policy option key -> user-selected value. Presence in this map *is*
  /// selection — an unselected boolean is simply absent, not "false" and
  /// present. Keys not found in the catalog for [engine] are rejected.
  final Map<String, String> policyValues;
}

/// Renders a `postgresql.conf` or `my.cnf` `[mysqld]` block from a metrics
/// input (calculated parameters, always emitted) plus a set of selected
/// policy options (only emitted if selected). See the library doc comment
/// for the formula sourcing.
class DatabaseConfigBuilder implements IToolUseCase<DatabaseConfigBuilderInput, String> {
  const DatabaseConfigBuilder();

  @override
  String execute(DatabaseConfigBuilderInput input) {
    switch (input.engine) {
      case DatabaseEngine.postgresql:
        final metrics = input.postgres;
        if (metrics == null) {
          throw ArgumentError('PostgreSQL metrics are required when engine is DatabaseEngine.postgresql.');
        }
        _rejectUnknownKeys(input.engine, input.policyValues);
        return _renderPostgres(metrics, input.policyValues);

      case DatabaseEngine.mariadb:
        final metrics = input.mariadb;
        if (metrics == null) {
          throw ArgumentError('MariaDB metrics are required when engine is DatabaseEngine.mariadb.');
        }
        _rejectUnknownKeys(input.engine, input.policyValues);
        return _renderMariaDb(metrics, input.policyValues);
    }
  }

  String _renderPostgres(PostgresMetrics m, Map<String, String> policyValues) {
    final p = computePostgresParams(m);
    final buffer = StringBuffer();

    buffer.writeln('# postgresql.conf — generated by InfraKit Studio');
    buffer.writeln(
      '# Workload: ${m.dbType.label} | RAM: ${m.totalMemoryMb}MB | CPUs: ${m.cpuCount} | PostgreSQL ${m.dbVersion}',
    );
    buffer.writeln('#');
    buffer.writeln('# Formulas adapted from pgtune (github.com/le0pard/pgtune). Review every');
    buffer.writeln('# line before applying to production — these are starting points.');
    buffer.writeln();

    buffer.writeln('# --- Memory (calculated from ${m.totalMemoryMb}MB RAM, ${m.dbType.label} workload) ---');
    buffer.writeln('max_connections = ${p.maxConnections}');
    buffer.writeln('shared_buffers = ${_formatPgKb(p.sharedBuffersKb)}');
    buffer.writeln('effective_cache_size = ${_formatPgKb(p.effectiveCacheSizeKb)}');
    buffer.writeln('maintenance_work_mem = ${_formatPgKb(p.maintenanceWorkMemKb)}');
    buffer.writeln('autovacuum_work_mem = ${_formatPgKb(p.autovacuumWorkMemKb)}');
    buffer.writeln('work_mem = ${_formatPgKb(p.workMemKb)}');
    buffer.writeln();

    buffer.writeln('# --- Checkpoints & WAL ---');
    buffer.writeln('wal_buffers = ${_formatPgKb(p.walBuffersKb)}');
    buffer.writeln('min_wal_size = ${_formatPgMb(p.minWalSizeMb)}');
    buffer.writeln('max_wal_size = ${_formatPgMb(p.maxWalSizeMb)}');
    buffer.writeln('checkpoint_completion_target = ${p.checkpointCompletionTarget}');
    if (p.walCompression != null) buffer.writeln('wal_compression = ${p.walCompression}');
    buffer.writeln();

    buffer.writeln('# --- Query Planner ---');
    buffer.writeln('default_statistics_target = ${p.defaultStatisticsTarget}');
    buffer.writeln('random_page_cost = ${p.randomPageCost}');
    if (p.effectiveIoConcurrency != null) {
      buffer.writeln('effective_io_concurrency = ${p.effectiveIoConcurrency}');
    }
    buffer.writeln();

    if (p.maxWorkerProcesses != null || p.jit != null) {
      buffer.writeln('# --- Parallelism (${m.cpuCount} CPUs) ---');
      if (p.maxWorkerProcesses != null) {
        buffer.writeln('max_worker_processes = ${p.maxWorkerProcesses}');
        buffer.writeln('max_parallel_workers_per_gather = ${p.maxParallelWorkersPerGather}');
        if (p.maxParallelWorkers != null) buffer.writeln('max_parallel_workers = ${p.maxParallelWorkers}');
        if (p.maxParallelMaintenanceWorkers != null) {
          buffer.writeln('max_parallel_maintenance_workers = ${p.maxParallelMaintenanceWorkers}');
        }
      }
      if (p.jit != null) buffer.writeln('jit = ${p.jit}');
      buffer.writeln();
    }

    buffer.writeln('# --- Durability & Replication ---');
    buffer.writeln('wal_level = ${p.walLevel}');
    for (final line in _catalogLines(kPostgresPolicyCatalog, policyValues, 'Durability & Replication')) {
      buffer.writeln(line);
    }
    buffer.writeln();

    _writeSection(buffer, 'Logging', _catalogLines(kPostgresPolicyCatalog, policyValues, 'Logging'));

    return '${buffer.toString().trimRight()}\n';
  }

  String _renderMariaDb(MariaDbMetrics m, Map<String, String> policyValues) {
    final p = computeMariaDbParams(m);
    final availableMb = m.totalMemoryMb - m.reservedForOsMb;
    final buffer = StringBuffer();

    buffer.writeln('# my.cnf — generated by InfraKit Studio');
    buffer.writeln(
      '# Workload: ${m.dbType.label} | RAM: ${m.totalMemoryMb}MB (reserving ${m.reservedForOsMb}MB for the OS) '
      '| MariaDB ${m.majorVersion}.${m.minorVersion}',
    );
    buffer.writeln('#');
    buffer.writeln('# Formulas adapted from database.gkanev.com and general Percona/MariaDB tuning');
    buffer.writeln('# guidance. Review every line before applying to production.');
    buffer.writeln();
    buffer.writeln('[mysqld]');
    buffer.writeln();

    buffer.writeln('# --- Memory & InnoDB (calculated from ${availableMb}MB available, 75% target) ---');
    buffer.writeln('innodb_buffer_pool_size = ${_formatMariaDbMb(p.innodbBufferPoolSizeMb)}');
    if (m.usesRedoLogCapacity) {
      buffer.writeln('# MariaDB >= 10.8 replaced innodb_log_file_size with innodb_redo_log_capacity');
      buffer.writeln('innodb_redo_log_capacity = ${_formatMariaDbMb(p.innodbLogFileSizeMb)}');
    } else {
      buffer.writeln('innodb_log_file_size = ${_formatMariaDbMb(p.innodbLogFileSizeMb)}');
    }
    buffer.writeln('innodb_flush_method = ${p.innodbFlushMethod}');
    buffer.writeln('innodb_io_capacity = ${p.innodbIoCapacity}');
    buffer.writeln('innodb_flush_neighbors = ${p.innodbFlushNeighbors}');
    buffer.writeln();

    _writeSection(buffer, 'Durability', _catalogLines(kMariaDbPolicyCatalog, policyValues, 'Durability'));

    buffer.writeln('# --- Connections & Caches ---');
    buffer.writeln('max_connections = ${p.maxConnections}');
    buffer.writeln('table_open_cache = ${p.tableOpenCache}');
    buffer.writeln('tmp_table_size = ${p.tmpTableSizeMb}M');
    buffer.writeln('max_heap_table_size = ${p.tmpTableSizeMb}M');
    buffer.writeln('thread_cache_size = ${p.threadCacheSize}');
    buffer.writeln();

    buffer.writeln('# --- Character Set ---');
    buffer.writeln('character-set-server = utf8mb4');
    buffer.writeln('collation-server = utf8mb4_unicode_ci');
    buffer.writeln();

    _writeSection(buffer, 'Query Cache', _catalogLines(kMariaDbPolicyCatalog, policyValues, 'Query Cache'));
    _writeSection(buffer, 'Replication', _catalogLines(kMariaDbPolicyCatalog, policyValues, 'Replication'));
    _writeSection(buffer, 'Logging', _catalogLines(kMariaDbPolicyCatalog, policyValues, 'Logging'));

    return '${buffer.toString().trimRight()}\n';
  }
}
