import 'dart:math' as math;

import '../ports/i_tool_use_case.dart';

/// Inputs shared by both engines' memory-sizing calculations.
class DbMemorySizerInput {
  const DbMemorySizerInput({
    required this.totalRamGb,
    required this.maxConnections,
    this.percentForDatabase = 100,
  });

  /// Total system RAM, in gibibytes (GiB).
  final double totalRamGb;

  /// Expected `max_connections` (Postgres) / concurrent connections
  /// (MariaDB) the sizing should assume — this drives the per-connection
  /// `work_mem` split.
  final int maxConnections;

  /// Percentage (0, 100] of total RAM this database instance may claim.
  /// Use less than 100 when the box is shared with other services; 100
  /// assumes a dedicated database server, which is the baseline the
  /// classic tuning guides (PGTune, MySQL/InnoDB docs) use.
  final double percentForDatabase;
}

/// Recommended `postgresql.conf` values.
class PostgresConfigResult {
  const PostgresConfigResult({
    required this.sharedBuffersMb,
    required this.effectiveCacheSizeMb,
    required this.workMemMb,
  });

  final int sharedBuffersMb;
  final int effectiveCacheSizeMb;
  final int workMemMb;

  /// Ready-to-paste `postgresql.conf` lines.
  String get configText => 'shared_buffers = ${formatMb(sharedBuffersMb)}\n'
      'effective_cache_size = ${formatMb(effectiveCacheSizeMb)}\n'
      'work_mem = ${workMemMb}MB';
}

/// Recommended MariaDB/MySQL `my.cnf` values.
class MariaDbConfigResult {
  const MariaDbConfigResult({required this.innodbBufferPoolSizeMb});

  final int innodbBufferPoolSizeMb;

  /// Ready-to-paste `my.cnf` line.
  String get configText => 'innodb_buffer_pool_size = ${formatMb(innodbBufferPoolSizeMb)}';
}

class DbMemorySizerResult {
  const DbMemorySizerResult({required this.postgres, required this.mariadb});

  final PostgresConfigResult postgres;
  final MariaDbConfigResult mariadb;
}

/// Formats a megabyte quantity as a clean "NGB" when it divides evenly,
/// otherwise "NMB". Exposed for reuse by the UI layer.
String formatMb(int mb) {
  if (mb >= 1024 && mb % 1024 == 0) return '${mb ~/ 1024}GB';
  return '${mb}MB';
}

/// Database memory sizer: heuristic RAM-sizing calculator for PostgreSQL
/// and MariaDB/MySQL, given total system RAM and expected connection
/// count. Pure math, zero I/O, zero Flutter — the formulas below are
/// widely-used *rules of thumb* (PGTune-style for Postgres, standard
/// InnoDB guidance for MariaDB), not a substitute for real workload
/// profiling and load testing.
class DbMemorySizer implements IToolUseCase<DbMemorySizerInput, DbMemorySizerResult> {
  const DbMemorySizer();

  @override
  DbMemorySizerResult execute(DbMemorySizerInput input) {
    if (input.totalRamGb <= 0) {
      throw ArgumentError('totalRamGb must be positive');
    }
    if (input.maxConnections <= 0) {
      throw ArgumentError('maxConnections must be positive');
    }
    if (input.percentForDatabase <= 0 || input.percentForDatabase > 100) {
      throw ArgumentError('percentForDatabase must be in (0, 100]');
    }

    final effectiveRamMb = (input.totalRamGb * 1024) * (input.percentForDatabase / 100);

    // ---- PostgreSQL ----
    // shared_buffers: ~25% of RAM is the long-standing PGTune/community
    // baseline for a dedicated server. Postgres also leans on the OS page
    // cache, so pushing this much higher tends to cause double-buffering
    // rather than real gains.
    final sharedBuffersMb = (effectiveRamMb * 0.25).round();

    // effective_cache_size: a *query-planner hint*, not a real
    // allocation — it tells the planner roughly how much caching (OS page
    // cache + shared_buffers combined) to expect. ~75% of RAM is the
    // commonly recommended value for a dedicated database server (the
    // general guidance range is 50-75%).
    final effectiveCacheSizeMb = (effectiveRamMb * 0.75).round();

    // work_mem: per-sort/-hash operation memory, granted PER CONNECTION,
    // and potentially several times over within a single complex query
    // (each sort/hash node gets its own allocation). Heuristic used here:
    // take the RAM left over after shared_buffers, split it evenly across
    // max_connections, then divide by a fixed safety factor of 4 to leave
    // headroom for multiple concurrent operations per connection. This is
    // a conservative starting point for tuning, not a guarantee against
    // memory pressure under real concurrent load.
    const workMemSafetyDivisor = 4;
    final remainingMb = effectiveRamMb - sharedBuffersMb;
    final workMemMb = math.max(1, (remainingMb / input.maxConnections / workMemSafetyDivisor).floor());

    // ---- MariaDB / MySQL ----
    // innodb_buffer_pool_size: standard InnoDB guidance for a dedicated
    // database server is 70-80% of total RAM; 75% is the commonly cited
    // midpoint used here.
    final innodbBufferPoolSizeMb = (effectiveRamMb * 0.75).round();

    return DbMemorySizerResult(
      postgres: PostgresConfigResult(
        sharedBuffersMb: sharedBuffersMb,
        effectiveCacheSizeMb: effectiveCacheSizeMb,
        workMemMb: workMemMb,
      ),
      mariadb: MariaDbConfigResult(innodbBufferPoolSizeMb: innodbBufferPoolSizeMb),
    );
  }
}
