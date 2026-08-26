import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/config/database_config_builder.dart';

void main() {
  const builder = DatabaseConfigBuilder();

  group('PostgreSQL — computePostgresParams', () {
    test('web workload, 16GB RAM, 4 CPUs, 200 connections, SSD, does not fit in RAM', () {
      final p = computePostgresParams(
        const PostgresMetrics(
          totalMemoryMb: 16384,
          cpuCount: 4,
          dbVersion: 18,
          dbType: PgWorkloadType.web,
          maxConnections: 200,
          storageType: PgStorageType.ssd,
        ),
      );

      // shared_buffers = 16384MB / 4 = 4096MB = 4194304kB
      expect(p.sharedBuffersKb, 4194304);
      // effective_cache_size = 16384MB * 3/4 = 12288MB = 12582912kB
      expect(p.effectiveCacheSizeKb, 12582912);
      // maintenance_work_mem = 16384MB / 16 = 1024MB = 1048576kB
      expect(p.maintenanceWorkMemKb, 1048576);
      expect(p.autovacuumWorkMemKb, 1048576); // below the 2GB cap, so unchanged
      // work_mem base = (totalKb - sharedBuffersKb) / ((200+4)*3), web -> as-is, x0.9 (doesn't fit RAM)
      expect(p.workMemKb, 18504);
      // wal_buffers = 3% of shared_buffers = 125829.12kB -> over 14MB -> snapped to 16MB cap
      expect(p.walBuffersKb, 16384);
      expect(p.maxConnections, 200);
      expect(p.minWalSizeMb, 1024);
      expect(p.maxWalSizeMb, 4096);
      expect(p.checkpointCompletionTarget, 0.9);
      expect(p.defaultStatisticsTarget, 100);
      expect(p.randomPageCost, 1.1); // ssd
      expect(p.effectiveIoConcurrency, 200); // ssd, linux
    });

    test('data warehouse workload: /8 maintenance_work_mem, /2 work_mem base, dw stats target, uncapped parallel gather', () {
      final p = computePostgresParams(
        const PostgresMetrics(
          totalMemoryMb: 16384,
          cpuCount: 10,
          dbVersion: 18,
          dbType: PgWorkloadType.dw,
          storageType: PgStorageType.hdd,
        ),
      );

      expect(p.maxConnections, 40); // dw default
      expect(p.sharedBuffersKb, 4194304); // dw uses /4 like web/oltp/mixed
      // maintenance_work_mem = 16384MB / 8 = 2048MB = 2097152kB
      expect(p.maintenanceWorkMemKb, 2097152);
      // exactly at the 2GB autovacuum cap -> unchanged
      expect(p.autovacuumWorkMemKb, 2097152);
      // effective_max_worker_processes = cpuCount (10, since cpu>=4)
      // base = (16777216 - 4194304) / ((40+10)*3) = 83886.08; dw -> /2 = 41943.04; x0.9 (dw+hdd doesn't fit RAM)
      expect(p.workMemKb, 37749);
      expect(p.defaultStatisticsTarget, 500);
      expect(p.randomPageCost, 4.0); // hdd
      expect(p.effectiveIoConcurrency, 2); // hdd
      // cpu=10 -> half-ceil = 5; dw is NOT capped at 4, unlike other workloads.
      expect(p.maxParallelWorkersPerGather, 5);
      expect(p.maxWorkerProcesses, 10);
    });

    test('work_mem DB-fits-in-RAM multiplier: x1.3 instead of x0.9', () {
      final fits = computePostgresParams(
        const PostgresMetrics(
          totalMemoryMb: 4096,
          cpuCount: 4,
          dbVersion: 18,
          dbType: PgWorkloadType.oltp,
          maxConnections: 50,
          storageType: PgStorageType.ssd,
          dbFitsInRam: true,
        ),
      );
      final doesNotFit = computePostgresParams(
        const PostgresMetrics(
          totalMemoryMb: 4096,
          cpuCount: 4,
          dbVersion: 18,
          dbType: PgWorkloadType.oltp,
          maxConnections: 50,
          storageType: PgStorageType.ssd,
          dbFitsInRam: false,
        ),
      );

      // Same base, only the multiplier differs -> fits should be exactly (1.3/0.9) times larger.
      expect(fits.workMemKb, greaterThan(doesNotFit.workMemKb));
      final ratio = fits.workMemKb / doesNotFit.workMemKb;
      expect(ratio, closeTo(1.3 / 0.9, 0.01));
    });

    test('random_page_cost and effective_io_concurrency vary by storage type', () {
      PgCalculatedParams paramsFor(PgStorageType storage, {bool fits = false}) => computePostgresParams(
        PostgresMetrics(
          totalMemoryMb: 8192,
          cpuCount: 2,
          dbVersion: 18,
          dbType: PgWorkloadType.oltp,
          storageType: storage,
          dbFitsInRam: fits,
        ),
      );

      expect(paramsFor(PgStorageType.hdd).randomPageCost, 4.0);
      expect(paramsFor(PgStorageType.ssd).randomPageCost, 1.1);
      expect(paramsFor(PgStorageType.san).randomPageCost, 1.1);
      expect(paramsFor(PgStorageType.nvme).randomPageCost, 1.1);
      expect(paramsFor(PgStorageType.hdd, fits: true).randomPageCost, 1.1); // fits-in-RAM wins over hdd

      expect(paramsFor(PgStorageType.hdd).effectiveIoConcurrency, 2);
      expect(paramsFor(PgStorageType.ssd).effectiveIoConcurrency, 200);
      expect(paramsFor(PgStorageType.san).effectiveIoConcurrency, 300);
      expect(paramsFor(PgStorageType.nvme).effectiveIoConcurrency, 1000);
    });

    test('effective_io_concurrency is omitted on Windows', () {
      final p = computePostgresParams(
        const PostgresMetrics(
          totalMemoryMb: 8192,
          cpuCount: 2,
          dbVersion: 18,
          dbType: PgWorkloadType.oltp,
          storageType: PgStorageType.ssd,
          osIsWindows: true,
        ),
      );
      expect(p.effectiveIoConcurrency, isNull);
    });

    test('parallel worker settings only appear when cpuCount >= 4', () {
      final below = computePostgresParams(
        const PostgresMetrics(
          totalMemoryMb: 8192,
          cpuCount: 3,
          dbVersion: 18,
          dbType: PgWorkloadType.oltp,
          storageType: PgStorageType.ssd,
        ),
      );
      final atThreshold = computePostgresParams(
        const PostgresMetrics(
          totalMemoryMb: 8192,
          cpuCount: 4,
          dbVersion: 18,
          dbType: PgWorkloadType.oltp,
          storageType: PgStorageType.ssd,
        ),
      );

      expect(below.maxWorkerProcesses, isNull);
      expect(below.maxParallelWorkersPerGather, isNull);
      expect(below.maxParallelWorkers, isNull);
      expect(below.maxParallelMaintenanceWorkers, isNull);

      expect(atThreshold.maxWorkerProcesses, 4);
      expect(atThreshold.maxParallelWorkersPerGather, 2);
      expect(atThreshold.maxParallelWorkers, 4);
      expect(atThreshold.maxParallelMaintenanceWorkers, 2);
    });

    test('max_parallel_workers_per_gather is capped at 4 for non-dw workloads', () {
      final p = computePostgresParams(
        const PostgresMetrics(
          totalMemoryMb: 8192,
          cpuCount: 16,
          dbVersion: 18,
          dbType: PgWorkloadType.oltp,
          storageType: PgStorageType.ssd,
        ),
      );
      expect(p.maxParallelWorkersPerGather, 4); // half-ceil(16/2)=8, capped at 4
    });

    test('wal_compression is version-gated: lz4 on PG15+, on for PG10-14, absent below PG10', () {
      PostgresMetrics metricsFor(int version) => PostgresMetrics(
        totalMemoryMb: 8192,
        cpuCount: 2,
        dbVersion: version,
        dbType: PgWorkloadType.oltp,
        storageType: PgStorageType.ssd,
      );

      expect(computePostgresParams(metricsFor(15)).walCompression, 'lz4');
      expect(computePostgresParams(metricsFor(18)).walCompression, 'lz4');
      expect(computePostgresParams(metricsFor(14)).walCompression, 'on');
      expect(computePostgresParams(metricsFor(10)).walCompression, 'on');
      expect(computePostgresParams(metricsFor(9)).walCompression, isNull);
    });

    test('jit is off for web/oltp/mixed on PG12+, absent for dw/desktop and below PG12', () {
      PgCalculatedParams paramsFor(PgWorkloadType type, int version) => computePostgresParams(
        PostgresMetrics(
          totalMemoryMb: 8192,
          cpuCount: 2,
          dbVersion: version,
          dbType: type,
          storageType: PgStorageType.ssd,
        ),
      );

      expect(paramsFor(PgWorkloadType.web, 12).jit, 'off');
      expect(paramsFor(PgWorkloadType.oltp, 12).jit, 'off');
      expect(paramsFor(PgWorkloadType.mixed, 12).jit, 'off');
      expect(paramsFor(PgWorkloadType.dw, 12).jit, isNull);
      expect(paramsFor(PgWorkloadType.desktop, 12).jit, isNull);
      expect(paramsFor(PgWorkloadType.oltp, 11).jit, isNull);
    });

    test('shared_buffers capped at 512MB on Windows + PG < 10', () {
      final p = computePostgresParams(
        const PostgresMetrics(
          totalMemoryMb: 8192, // /4 = 2048MB, would exceed the cap
          cpuCount: 2,
          dbVersion: 9,
          dbType: PgWorkloadType.web,
          storageType: PgStorageType.ssd,
          osIsWindows: true,
        ),
      );
      expect(p.sharedBuffersKb, 512 * 1024);
    });

    test('work_mem and maintenance_work_mem capped at 2GB-1MB on Windows + PG <= 17', () {
      final p = computePostgresParams(
        const PostgresMetrics(
          totalMemoryMb: 131072, // 128GB
          cpuCount: 2,
          dbVersion: 17,
          dbType: PgWorkloadType.web,
          maxConnections: 5,
          storageType: PgStorageType.ssd,
          dbFitsInRam: true,
          osIsWindows: true,
        ),
      );
      const capKb = 2 * 1024 * 1024 - 1024;
      expect(p.workMemKb, capKb);
    });

    test('wal_level is driven by replicationRole', () {
      PgCalculatedParams paramsFor(PgReplicationRole role) => computePostgresParams(
        PostgresMetrics(
          totalMemoryMb: 8192,
          cpuCount: 2,
          dbVersion: 18,
          dbType: PgWorkloadType.oltp,
          storageType: PgStorageType.ssd,
          replicationRole: role,
        ),
      );

      expect(paramsFor(PgReplicationRole.standalone).walLevel, 'minimal');
      expect(paramsFor(PgReplicationRole.primary).walLevel, 'replica');
      expect(paramsFor(PgReplicationRole.replica).walLevel, 'replica');
      expect(paramsFor(PgReplicationRole.logical).walLevel, 'logical');
    });

    test('rejects zero/negative RAM, CPU count, and max_connections', () {
      expect(
        () => computePostgresParams(
          const PostgresMetrics(totalMemoryMb: 0, cpuCount: 2, dbVersion: 18, dbType: PgWorkloadType.oltp, storageType: PgStorageType.ssd),
        ),
        throwsArgumentError,
      );
      expect(
        () => computePostgresParams(
          const PostgresMetrics(totalMemoryMb: 8192, cpuCount: 0, dbVersion: 18, dbType: PgWorkloadType.oltp, storageType: PgStorageType.ssd),
        ),
        throwsArgumentError,
      );
      expect(
        () => computePostgresParams(
          const PostgresMetrics(
            totalMemoryMb: 8192,
            cpuCount: 2,
            dbVersion: 18,
            dbType: PgWorkloadType.oltp,
            maxConnections: 0,
            storageType: PgStorageType.ssd,
          ),
        ),
        throwsArgumentError,
      );
    });
  });

  group('PostgreSQL — DatabaseConfigBuilder.execute', () {
    const metrics = PostgresMetrics(
      totalMemoryMb: 8192,
      cpuCount: 4,
      dbVersion: 18,
      dbType: PgWorkloadType.oltp,
      storageType: PgStorageType.ssd,
    );

    test('renders calculated parameters unconditionally', () {
      final text = builder.execute(const DatabaseConfigBuilderInput(engine: DatabaseEngine.postgresql, postgres: metrics));
      expect(text, contains('shared_buffers'));
      expect(text, contains('wal_level = minimal'));
      expect(text, contains('# --- Memory'));
    });

    test('archive_command only appears when archive_mode is selected and on', () {
      final withoutArchiveMode = builder.execute(
        const DatabaseConfigBuilderInput(
          engine: DatabaseEngine.postgresql,
          postgres: metrics,
          policyValues: {'archive_command': 'cp %p /archive/%f'},
        ),
      );
      expect(withoutArchiveMode, isNot(contains('archive_command')));

      final archiveOff = builder.execute(
        const DatabaseConfigBuilderInput(
          engine: DatabaseEngine.postgresql,
          postgres: metrics,
          policyValues: {'archive_mode': 'off', 'archive_command': 'cp %p /archive/%f'},
        ),
      );
      expect(archiveOff, contains('archive_mode = off'));
      expect(archiveOff, isNot(contains('archive_command')));

      final archiveOn = builder.execute(
        const DatabaseConfigBuilderInput(
          engine: DatabaseEngine.postgresql,
          postgres: metrics,
          policyValues: {'archive_mode': 'on', 'archive_command': 'cp %p /archive/%f'},
        ),
      );
      expect(archiveOn, contains('archive_mode = on'));
      expect(archiveOn, contains("archive_command = 'cp %p /archive/%f'"));
    });

    test('log_line_prefix only appears when log_min_duration_statement is set', () {
      final without = builder.execute(
        const DatabaseConfigBuilderInput(engine: DatabaseEngine.postgresql, postgres: metrics),
      );
      expect(without, isNot(contains('log_line_prefix')));

      final withThreshold = builder.execute(
        const DatabaseConfigBuilderInput(
          engine: DatabaseEngine.postgresql,
          postgres: metrics,
          policyValues: {'log_min_duration_statement': '500'},
        ),
      );
      expect(withThreshold, contains('log_min_duration_statement = 500'));
      expect(withThreshold, contains('log_line_prefix ='));
    });

    test('unselected policy options never appear (minimal reviewable diff)', () {
      final text = builder.execute(
        const DatabaseConfigBuilderInput(
          engine: DatabaseEngine.postgresql,
          postgres: metrics,
          policyValues: {'ssl': 'on'},
        ),
      );
      expect(text, contains('ssl = on'));
      expect(text, isNot(contains('synchronous_commit')));
      expect(text, isNot(contains('logging_collector')));
    });

    test('rejects an unknown policy key', () {
      expect(
        () => builder.execute(
          const DatabaseConfigBuilderInput(
            engine: DatabaseEngine.postgresql,
            postgres: metrics,
            policyValues: {'not_a_real_key': 'x'},
          ),
        ),
        throwsArgumentError,
      );
    });

    test('rejects a boolean policy value that is not on/off', () {
      expect(
        () => builder.execute(
          const DatabaseConfigBuilderInput(
            engine: DatabaseEngine.postgresql,
            postgres: metrics,
            policyValues: {'ssl': 'maybe'},
          ),
        ),
        throwsArgumentError,
      );
    });

    test('throws when postgres metrics are missing for the postgresql engine', () {
      expect(
        () => builder.execute(const DatabaseConfigBuilderInput(engine: DatabaseEngine.postgresql)),
        throwsArgumentError,
      );
    });
  });

  group('MariaDB — computeMariaDbParams', () {
    test('innodb_buffer_pool_size is 75% of available RAM, rounded to nearest 128MB', () {
      final p = computeMariaDbParams(
        const MariaDbMetrics(
          totalMemoryMb: 8192,
          reservedForOsMb: 1024,
          storageType: MariaDbStorageType.ssd,
          dbType: MariaDbWorkloadType.oltp,
        ),
      );
      // available = 7168MB; 75% = 5376MB, already a multiple of 128.
      expect(p.innodbBufferPoolSizeMb, 5376);
    });

    test('innodb_buffer_pool_size rounding handles a non-exact 128MB boundary', () {
      final p = computeMariaDbParams(
        const MariaDbMetrics(
          totalMemoryMb: 10000,
          reservedForOsMb: 1000,
          storageType: MariaDbStorageType.ssd,
          dbType: MariaDbWorkloadType.oltp,
        ),
      );
      // available = 9000MB; 75% = 6750MB; /128 = 52.734 -> rounds to 53 -> 6784MB.
      expect(p.innodbBufferPoolSizeMb, 6784);
    });

    test('innodb_log_file_size is 25% of the buffer pool, capped at 2048MB', () {
      final small = computeMariaDbParams(
        const MariaDbMetrics(
          totalMemoryMb: 8192,
          reservedForOsMb: 1024,
          storageType: MariaDbStorageType.ssd,
          dbType: MariaDbWorkloadType.oltp,
        ),
      );
      // pool = 5376MB; 25% = 1344MB, under the cap.
      expect(small.innodbLogFileSizeMb, 1344);

      final large = computeMariaDbParams(
        const MariaDbMetrics(
          totalMemoryMb: 65536,
          reservedForOsMb: 8192,
          storageType: MariaDbStorageType.nvme,
          dbType: MariaDbWorkloadType.olap,
        ),
      );
      // pool = 43008MB; 25% = 10752MB, well over 2048MB -> capped.
      expect(large.innodbLogFileSizeMb, 2048);
    });

    test('innodb_flush_method varies by OS', () {
      final linux = computeMariaDbParams(
        const MariaDbMetrics(totalMemoryMb: 8192, reservedForOsMb: 1024, storageType: MariaDbStorageType.ssd, dbType: MariaDbWorkloadType.oltp),
      );
      final windows = computeMariaDbParams(
        const MariaDbMetrics(
          totalMemoryMb: 8192,
          reservedForOsMb: 1024,
          storageType: MariaDbStorageType.ssd,
          dbType: MariaDbWorkloadType.oltp,
          osIsWindows: true,
        ),
      );
      expect(linux.innodbFlushMethod, 'O_DIRECT');
      expect(windows.innodbFlushMethod, 'unbuffered');
    });

    test('innodb_io_capacity and innodb_flush_neighbors vary by storage type', () {
      MariaDbCalculatedParams paramsFor(MariaDbStorageType storage) => computeMariaDbParams(
        MariaDbMetrics(totalMemoryMb: 8192, reservedForOsMb: 1024, storageType: storage, dbType: MariaDbWorkloadType.oltp),
      );

      final hdd = paramsFor(MariaDbStorageType.hdd);
      final ssd = paramsFor(MariaDbStorageType.ssd);
      final nvme = paramsFor(MariaDbStorageType.nvme);

      expect(hdd.innodbIoCapacity, 200);
      expect(ssd.innodbIoCapacity, 2000);
      expect(nvme.innodbIoCapacity, 10000);

      expect(hdd.innodbFlushNeighbors, 1);
      expect(ssd.innodbFlushNeighbors, 0);
      expect(nvme.innodbFlushNeighbors, 0);
    });

    test('max_connections varies by workload type', () {
      int maxConnFor(MariaDbWorkloadType type) => computeMariaDbParams(
        MariaDbMetrics(totalMemoryMb: 8192, reservedForOsMb: 1024, storageType: MariaDbStorageType.ssd, dbType: type),
      ).maxConnections;

      expect(maxConnFor(MariaDbWorkloadType.oltp), 200);
      expect(maxConnFor(MariaDbWorkloadType.olap), 50);
      expect(maxConnFor(MariaDbWorkloadType.mixed), 150);
      expect(maxConnFor(MariaDbWorkloadType.web), 150);
      expect(maxConnFor(MariaDbWorkloadType.smallVps), 50);
    });

    test('rejects zero/negative RAM and reserved-OS memory that consumes all RAM', () {
      expect(
        () => computeMariaDbParams(
          const MariaDbMetrics(totalMemoryMb: 0, reservedForOsMb: 0, storageType: MariaDbStorageType.ssd, dbType: MariaDbWorkloadType.oltp),
        ),
        throwsArgumentError,
      );
      expect(
        () => computeMariaDbParams(
          const MariaDbMetrics(totalMemoryMb: 1024, reservedForOsMb: 1024, storageType: MariaDbStorageType.ssd, dbType: MariaDbWorkloadType.oltp),
        ),
        throwsArgumentError,
      );
    });
  });

  group('MariaDB — version-gated redo log naming', () {
    test('usesRedoLogCapacity is true from 10.8 onward and false before it', () {
      expect(const MariaDbMetrics(totalMemoryMb: 1, reservedForOsMb: 0, storageType: MariaDbStorageType.ssd, dbType: MariaDbWorkloadType.oltp, majorVersion: 10, minorVersion: 7).usesRedoLogCapacity, isFalse);
      expect(const MariaDbMetrics(totalMemoryMb: 1, reservedForOsMb: 0, storageType: MariaDbStorageType.ssd, dbType: MariaDbWorkloadType.oltp, majorVersion: 10, minorVersion: 8).usesRedoLogCapacity, isTrue);
      expect(const MariaDbMetrics(totalMemoryMb: 1, reservedForOsMb: 0, storageType: MariaDbStorageType.ssd, dbType: MariaDbWorkloadType.oltp, majorVersion: 11, minorVersion: 0).usesRedoLogCapacity, isTrue);
    });

    test('renders innodb_redo_log_capacity on 10.8+ and innodb_log_file_size before it', () {
      const oldMetrics = MariaDbMetrics(
        totalMemoryMb: 8192,
        reservedForOsMb: 1024,
        storageType: MariaDbStorageType.ssd,
        dbType: MariaDbWorkloadType.oltp,
        majorVersion: 10,
        minorVersion: 6,
      );
      const newMetrics = MariaDbMetrics(
        totalMemoryMb: 8192,
        reservedForOsMb: 1024,
        storageType: MariaDbStorageType.ssd,
        dbType: MariaDbWorkloadType.oltp,
        majorVersion: 10,
        minorVersion: 8,
      );

      final oldText = builder.execute(const DatabaseConfigBuilderInput(engine: DatabaseEngine.mariadb, mariadb: oldMetrics));
      final newText = builder.execute(const DatabaseConfigBuilderInput(engine: DatabaseEngine.mariadb, mariadb: newMetrics));

      expect(oldText, contains('innodb_log_file_size'));
      expect(oldText, isNot(contains('innodb_redo_log_capacity')));
      expect(newText, contains('innodb_redo_log_capacity'));
      expect(newText, isNot(contains('innodb_log_file_size =')));
    });
  });

  group('MariaDB — DatabaseConfigBuilder.execute conditional field pairs', () {
    const metrics = MariaDbMetrics(
      totalMemoryMb: 8192,
      reservedForOsMb: 1024,
      storageType: MariaDbStorageType.ssd,
      dbType: MariaDbWorkloadType.oltp,
    );

    test('server_id only appears when log_bin is on', () {
      final off = builder.execute(
        const DatabaseConfigBuilderInput(
          engine: DatabaseEngine.mariadb,
          mariadb: metrics,
          policyValues: {'log_bin': 'off', 'server_id': '7'},
        ),
      );
      expect(off, contains('log_bin = OFF'));
      expect(off, isNot(contains('server_id')));

      final on = builder.execute(
        const DatabaseConfigBuilderInput(
          engine: DatabaseEngine.mariadb,
          mariadb: metrics,
          policyValues: {'log_bin': 'on', 'server_id': '7'},
        ),
      );
      expect(on, contains('log_bin = ON'));
      expect(on, contains('server_id = 7'));
    });

    test('long_query_time only appears when slow_query_log is on', () {
      final withoutSwitch = builder.execute(
        const DatabaseConfigBuilderInput(
          engine: DatabaseEngine.mariadb,
          mariadb: metrics,
          policyValues: {'long_query_time': '5'},
        ),
      );
      expect(withoutSwitch, isNot(contains('long_query_time')));

      final withSwitchOn = builder.execute(
        const DatabaseConfigBuilderInput(
          engine: DatabaseEngine.mariadb,
          mariadb: metrics,
          policyValues: {'slow_query_log': 'on', 'long_query_time': '5'},
        ),
      );
      expect(withSwitchOn, contains('slow_query_log = ON'));
      expect(withSwitchOn, contains('long_query_time = 5'));
    });

    test('query_cache_size only appears when query_cache_type is on', () {
      final off = builder.execute(
        const DatabaseConfigBuilderInput(
          engine: DatabaseEngine.mariadb,
          mariadb: metrics,
          policyValues: {'query_cache_type': 'off', 'query_cache_size': '64M'},
        ),
      );
      expect(off, contains('query_cache_type = OFF'));
      expect(off, isNot(contains('query_cache_size')));

      final on = builder.execute(
        const DatabaseConfigBuilderInput(
          engine: DatabaseEngine.mariadb,
          mariadb: metrics,
          policyValues: {'query_cache_type': 'on', 'query_cache_size': '64M'},
        ),
      );
      expect(on, contains('query_cache_type = ON'));
      expect(on, contains('query_cache_size = 64M'));
    });

    test('character set defaults are always emitted', () {
      final text = builder.execute(const DatabaseConfigBuilderInput(engine: DatabaseEngine.mariadb, mariadb: metrics));
      expect(text, contains('character-set-server = utf8mb4'));
      expect(text, contains('collation-server = utf8mb4_unicode_ci'));
    });

    test('unknown policy key is rejected', () {
      expect(
        () => builder.execute(
          const DatabaseConfigBuilderInput(
            engine: DatabaseEngine.mariadb,
            mariadb: metrics,
            policyValues: {'bogus_key': '1'},
          ),
        ),
        throwsArgumentError,
      );
    });

    test('throws when mariadb metrics are missing for the mariadb engine', () {
      expect(
        () => builder.execute(const DatabaseConfigBuilderInput(engine: DatabaseEngine.mariadb)),
        throwsArgumentError,
      );
    });
  });

  group('Suggested file names', () {
    test('match each engine', () {
      expect(DatabaseEngine.postgresql.suggestedFileName, 'postgresql.conf');
      expect(DatabaseEngine.mariadb.suggestedFileName, 'my.cnf');
    });
  });
}
