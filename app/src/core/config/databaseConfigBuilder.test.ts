import { describe, expect, it } from 'vitest'
import {
  DatabaseConfigBuilder,
  computePostgresParams,
  computeMariaDbParams,
  mariaDbUsesRedoLogCapacity,
  databaseEngineSuggestedFileName,
  type PostgresMetrics,
  type MariaDbMetrics,
  type PgCalculatedParams,
  type MariaDbCalculatedParams,
  type PgReplicationRole,
  type PgStorageType,
  type PgWorkloadType,
  type MariaDbStorageType,
  type MariaDbWorkloadType,
} from './databaseConfigBuilder'

describe('DatabaseConfigBuilder', () => {
  const builder = new DatabaseConfigBuilder()

  describe('PostgreSQL — computePostgresParams', () => {
    it('web workload, 16GB RAM, 4 CPUs, 200 connections, SSD, does not fit in RAM', () => {
      const p = computePostgresParams({
        totalMemoryMb: 16384,
        cpuCount: 4,
        dbVersion: 18,
        dbType: 'web',
        maxConnections: 200,
        storageType: 'ssd',
      })

      // shared_buffers = 16384MB / 4 = 4096MB = 4194304kB
      expect(p.sharedBuffersKb).toBe(4194304)
      // effective_cache_size = 16384MB * 3/4 = 12288MB = 12582912kB
      expect(p.effectiveCacheSizeKb).toBe(12582912)
      // maintenance_work_mem = 16384MB / 16 = 1024MB = 1048576kB
      expect(p.maintenanceWorkMemKb).toBe(1048576)
      expect(p.autovacuumWorkMemKb).toBe(1048576) // below the 2GB cap, so unchanged
      // work_mem base = (totalKb - sharedBuffersKb) / ((200+4)*3), web -> as-is, x0.9 (doesn't fit RAM)
      expect(p.workMemKb).toBe(18504)
      // wal_buffers = 3% of shared_buffers = 125829.12kB -> over 14MB -> snapped to 16MB cap
      expect(p.walBuffersKb).toBe(16384)
      expect(p.maxConnections).toBe(200)
      expect(p.minWalSizeMb).toBe(1024)
      expect(p.maxWalSizeMb).toBe(4096)
      expect(p.checkpointCompletionTarget).toBe(0.9)
      expect(p.defaultStatisticsTarget).toBe(100)
      expect(p.randomPageCost).toBe(1.1) // ssd
      expect(p.effectiveIoConcurrency).toBe(200) // ssd, linux
    })

    it('data warehouse workload: /8 maintenance_work_mem, /2 work_mem base, dw stats target, uncapped parallel gather', () => {
      const p = computePostgresParams({
        totalMemoryMb: 16384,
        cpuCount: 10,
        dbVersion: 18,
        dbType: 'dw',
        storageType: 'hdd',
      })

      expect(p.maxConnections).toBe(40) // dw default
      expect(p.sharedBuffersKb).toBe(4194304) // dw uses /4 like web/oltp/mixed
      // maintenance_work_mem = 16384MB / 8 = 2048MB = 2097152kB
      expect(p.maintenanceWorkMemKb).toBe(2097152)
      // exactly at the 2GB autovacuum cap -> unchanged
      expect(p.autovacuumWorkMemKb).toBe(2097152)
      // base = (16777216 - 4194304) / ((40+10)*3) = 83886.08; dw -> /2 = 41943.04; x0.9 (dw+hdd doesn't fit RAM)
      expect(p.workMemKb).toBe(37749)
      expect(p.defaultStatisticsTarget).toBe(500)
      expect(p.randomPageCost).toBe(4.0) // hdd
      expect(p.effectiveIoConcurrency).toBe(2) // hdd
      // cpu=10 -> half-ceil = 5; dw is NOT capped at 4, unlike other workloads.
      expect(p.maxParallelWorkersPerGather).toBe(5)
      expect(p.maxWorkerProcesses).toBe(10)
    })

    it('work_mem DB-fits-in-RAM multiplier: x1.3 instead of x0.9', () => {
      const fits = computePostgresParams({
        totalMemoryMb: 4096,
        cpuCount: 4,
        dbVersion: 18,
        dbType: 'oltp',
        maxConnections: 50,
        storageType: 'ssd',
        dbFitsInRam: true,
      })
      const doesNotFit = computePostgresParams({
        totalMemoryMb: 4096,
        cpuCount: 4,
        dbVersion: 18,
        dbType: 'oltp',
        maxConnections: 50,
        storageType: 'ssd',
        dbFitsInRam: false,
      })

      // Same base, only the multiplier differs -> fits should be exactly (1.3/0.9) times larger.
      expect(fits.workMemKb).toBeGreaterThan(doesNotFit.workMemKb)
      const ratio = fits.workMemKb / doesNotFit.workMemKb
      expect(ratio).toBeCloseTo(1.3 / 0.9, 2)
    })

    it('random_page_cost and effective_io_concurrency vary by storage type', () => {
      const paramsFor = (storage: PgStorageType, fits = false): PgCalculatedParams =>
        computePostgresParams({
          totalMemoryMb: 8192,
          cpuCount: 2,
          dbVersion: 18,
          dbType: 'oltp',
          storageType: storage,
          dbFitsInRam: fits,
        })

      expect(paramsFor('hdd').randomPageCost).toBe(4.0)
      expect(paramsFor('ssd').randomPageCost).toBe(1.1)
      expect(paramsFor('san').randomPageCost).toBe(1.1)
      expect(paramsFor('nvme').randomPageCost).toBe(1.1)
      expect(paramsFor('hdd', true).randomPageCost).toBe(1.1) // fits-in-RAM wins over hdd

      expect(paramsFor('hdd').effectiveIoConcurrency).toBe(2)
      expect(paramsFor('ssd').effectiveIoConcurrency).toBe(200)
      expect(paramsFor('san').effectiveIoConcurrency).toBe(300)
      expect(paramsFor('nvme').effectiveIoConcurrency).toBe(1000)
    })

    it('effective_io_concurrency is omitted on Windows', () => {
      const p = computePostgresParams({
        totalMemoryMb: 8192,
        cpuCount: 2,
        dbVersion: 18,
        dbType: 'oltp',
        storageType: 'ssd',
        osIsWindows: true,
      })
      expect(p.effectiveIoConcurrency).toBeNull()
    })

    it('parallel worker settings only appear when cpuCount >= 4', () => {
      const below = computePostgresParams({
        totalMemoryMb: 8192,
        cpuCount: 3,
        dbVersion: 18,
        dbType: 'oltp',
        storageType: 'ssd',
      })
      const atThreshold = computePostgresParams({
        totalMemoryMb: 8192,
        cpuCount: 4,
        dbVersion: 18,
        dbType: 'oltp',
        storageType: 'ssd',
      })

      expect(below.maxWorkerProcesses).toBeNull()
      expect(below.maxParallelWorkersPerGather).toBeNull()
      expect(below.maxParallelWorkers).toBeNull()
      expect(below.maxParallelMaintenanceWorkers).toBeNull()

      expect(atThreshold.maxWorkerProcesses).toBe(4)
      expect(atThreshold.maxParallelWorkersPerGather).toBe(2)
      expect(atThreshold.maxParallelWorkers).toBe(4)
      expect(atThreshold.maxParallelMaintenanceWorkers).toBe(2)
    })

    it('max_parallel_workers_per_gather is capped at 4 for non-dw workloads', () => {
      const p = computePostgresParams({
        totalMemoryMb: 8192,
        cpuCount: 16,
        dbVersion: 18,
        dbType: 'oltp',
        storageType: 'ssd',
      })
      expect(p.maxParallelWorkersPerGather).toBe(4) // half-ceil(16/2)=8, capped at 4
    })

    it('wal_compression is version-gated: lz4 on PG15+, on for PG10-14, absent below PG10', () => {
      const metricsFor = (version: number): PostgresMetrics => ({
        totalMemoryMb: 8192,
        cpuCount: 2,
        dbVersion: version,
        dbType: 'oltp',
        storageType: 'ssd',
      })

      expect(computePostgresParams(metricsFor(15)).walCompression).toBe('lz4')
      expect(computePostgresParams(metricsFor(18)).walCompression).toBe('lz4')
      expect(computePostgresParams(metricsFor(14)).walCompression).toBe('on')
      expect(computePostgresParams(metricsFor(10)).walCompression).toBe('on')
      expect(computePostgresParams(metricsFor(9)).walCompression).toBeNull()
    })

    it('jit is off for web/oltp/mixed on PG12+, absent for dw/desktop and below PG12', () => {
      const paramsFor = (type: PgWorkloadType, version: number): PgCalculatedParams =>
        computePostgresParams({
          totalMemoryMb: 8192,
          cpuCount: 2,
          dbVersion: version,
          dbType: type,
          storageType: 'ssd',
        })

      expect(paramsFor('web', 12).jit).toBe('off')
      expect(paramsFor('oltp', 12).jit).toBe('off')
      expect(paramsFor('mixed', 12).jit).toBe('off')
      expect(paramsFor('dw', 12).jit).toBeNull()
      expect(paramsFor('desktop', 12).jit).toBeNull()
      expect(paramsFor('oltp', 11).jit).toBeNull()
    })

    it('shared_buffers capped at 512MB on Windows + PG < 10', () => {
      const p = computePostgresParams({
        totalMemoryMb: 8192, // /4 = 2048MB, would exceed the cap
        cpuCount: 2,
        dbVersion: 9,
        dbType: 'web',
        storageType: 'ssd',
        osIsWindows: true,
      })
      expect(p.sharedBuffersKb).toBe(512 * 1024)
    })

    it('work_mem and maintenance_work_mem capped at 2GB-1MB on Windows + PG <= 17', () => {
      const p = computePostgresParams({
        totalMemoryMb: 131072, // 128GB
        cpuCount: 2,
        dbVersion: 17,
        dbType: 'web',
        maxConnections: 5,
        storageType: 'ssd',
        dbFitsInRam: true,
        osIsWindows: true,
      })
      const capKb = 2 * 1024 * 1024 - 1024
      expect(p.workMemKb).toBe(capKb)
    })

    it('wal_level is driven by replicationRole', () => {
      const paramsFor = (role: PgReplicationRole): PgCalculatedParams =>
        computePostgresParams({
          totalMemoryMb: 8192,
          cpuCount: 2,
          dbVersion: 18,
          dbType: 'oltp',
          storageType: 'ssd',
          replicationRole: role,
        })

      expect(paramsFor('standalone').walLevel).toBe('minimal')
      expect(paramsFor('primary').walLevel).toBe('replica')
      expect(paramsFor('replica').walLevel).toBe('replica')
      expect(paramsFor('logical').walLevel).toBe('logical')
    })

    it('rejects zero/negative RAM, CPU count, and max_connections', () => {
      expect(() =>
        computePostgresParams({ totalMemoryMb: 0, cpuCount: 2, dbVersion: 18, dbType: 'oltp', storageType: 'ssd' }),
      ).toThrow()
      expect(() =>
        computePostgresParams({ totalMemoryMb: 8192, cpuCount: 0, dbVersion: 18, dbType: 'oltp', storageType: 'ssd' }),
      ).toThrow()
      expect(() =>
        computePostgresParams({
          totalMemoryMb: 8192,
          cpuCount: 2,
          dbVersion: 18,
          dbType: 'oltp',
          maxConnections: 0,
          storageType: 'ssd',
        }),
      ).toThrow()
    })
  })

  describe('PostgreSQL — DatabaseConfigBuilder.execute', () => {
    const metrics: PostgresMetrics = {
      totalMemoryMb: 8192,
      cpuCount: 4,
      dbVersion: 18,
      dbType: 'oltp',
      storageType: 'ssd',
    }

    it('renders calculated parameters unconditionally', () => {
      const text = builder.execute({ engine: 'postgresql', postgres: metrics })
      expect(text).toContain('shared_buffers')
      expect(text).toContain('wal_level = minimal')
      expect(text).toContain('# --- Memory')
    })

    it('archive_command only appears when archive_mode is selected and on', () => {
      const withoutArchiveMode = builder.execute({
        engine: 'postgresql',
        postgres: metrics,
        policyValues: { archive_command: 'cp %p /archive/%f' },
      })
      expect(withoutArchiveMode).not.toContain('archive_command')

      const archiveOff = builder.execute({
        engine: 'postgresql',
        postgres: metrics,
        policyValues: { archive_mode: 'off', archive_command: 'cp %p /archive/%f' },
      })
      expect(archiveOff).toContain('archive_mode = off')
      expect(archiveOff).not.toContain('archive_command')

      const archiveOn = builder.execute({
        engine: 'postgresql',
        postgres: metrics,
        policyValues: { archive_mode: 'on', archive_command: 'cp %p /archive/%f' },
      })
      expect(archiveOn).toContain('archive_mode = on')
      expect(archiveOn).toContain("archive_command = 'cp %p /archive/%f'")
    })

    it('log_line_prefix only appears when log_min_duration_statement is set', () => {
      const without = builder.execute({ engine: 'postgresql', postgres: metrics })
      expect(without).not.toContain('log_line_prefix')

      const withThreshold = builder.execute({
        engine: 'postgresql',
        postgres: metrics,
        policyValues: { log_min_duration_statement: '500' },
      })
      expect(withThreshold).toContain('log_min_duration_statement = 500')
      expect(withThreshold).toContain('log_line_prefix =')
    })

    it('unselected policy options never appear (minimal reviewable diff)', () => {
      const text = builder.execute({
        engine: 'postgresql',
        postgres: metrics,
        policyValues: { ssl: 'on' },
      })
      expect(text).toContain('ssl = on')
      expect(text).not.toContain('synchronous_commit')
      expect(text).not.toContain('logging_collector')
    })

    it('rejects an unknown policy key', () => {
      expect(() =>
        builder.execute({ engine: 'postgresql', postgres: metrics, policyValues: { not_a_real_key: 'x' } }),
      ).toThrow()
    })

    it('rejects a boolean policy value that is not on/off', () => {
      expect(() =>
        builder.execute({ engine: 'postgresql', postgres: metrics, policyValues: { ssl: 'maybe' } }),
      ).toThrow()
    })

    it('throws when postgres metrics are missing for the postgresql engine', () => {
      expect(() => builder.execute({ engine: 'postgresql' })).toThrow()
    })
  })

  describe('MariaDB — computeMariaDbParams', () => {
    it('innodb_buffer_pool_size is 75% of available RAM, rounded to nearest 128MB', () => {
      const p = computeMariaDbParams({
        totalMemoryMb: 8192,
        reservedForOsMb: 1024,
        storageType: 'ssd',
        dbType: 'oltp',
      })
      // available = 7168MB; 75% = 5376MB, already a multiple of 128.
      expect(p.innodbBufferPoolSizeMb).toBe(5376)
    })

    it('innodb_buffer_pool_size rounding handles a non-exact 128MB boundary', () => {
      const p = computeMariaDbParams({
        totalMemoryMb: 10000,
        reservedForOsMb: 1000,
        storageType: 'ssd',
        dbType: 'oltp',
      })
      // available = 9000MB; 75% = 6750MB; /128 = 52.734 -> rounds to 53 -> 6784MB.
      expect(p.innodbBufferPoolSizeMb).toBe(6784)
    })

    it('innodb_log_file_size is 25% of the buffer pool, capped at 2048MB', () => {
      const small = computeMariaDbParams({
        totalMemoryMb: 8192,
        reservedForOsMb: 1024,
        storageType: 'ssd',
        dbType: 'oltp',
      })
      // pool = 5376MB; 25% = 1344MB, under the cap.
      expect(small.innodbLogFileSizeMb).toBe(1344)

      const large = computeMariaDbParams({
        totalMemoryMb: 65536,
        reservedForOsMb: 8192,
        storageType: 'nvme',
        dbType: 'olap',
      })
      // pool = 43008MB; 25% = 10752MB, well over 2048MB -> capped.
      expect(large.innodbLogFileSizeMb).toBe(2048)
    })

    it('innodb_flush_method varies by OS', () => {
      const linux = computeMariaDbParams({ totalMemoryMb: 8192, reservedForOsMb: 1024, storageType: 'ssd', dbType: 'oltp' })
      const windows = computeMariaDbParams({
        totalMemoryMb: 8192,
        reservedForOsMb: 1024,
        storageType: 'ssd',
        dbType: 'oltp',
        osIsWindows: true,
      })
      expect(linux.innodbFlushMethod).toBe('O_DIRECT')
      expect(windows.innodbFlushMethod).toBe('unbuffered')
    })

    it('innodb_io_capacity and innodb_flush_neighbors vary by storage type', () => {
      const paramsFor = (storage: MariaDbStorageType): MariaDbCalculatedParams =>
        computeMariaDbParams({ totalMemoryMb: 8192, reservedForOsMb: 1024, storageType: storage, dbType: 'oltp' })

      const hdd = paramsFor('hdd')
      const ssd = paramsFor('ssd')
      const nvme = paramsFor('nvme')

      expect(hdd.innodbIoCapacity).toBe(200)
      expect(ssd.innodbIoCapacity).toBe(2000)
      expect(nvme.innodbIoCapacity).toBe(10000)

      expect(hdd.innodbFlushNeighbors).toBe(1)
      expect(ssd.innodbFlushNeighbors).toBe(0)
      expect(nvme.innodbFlushNeighbors).toBe(0)
    })

    it('max_connections varies by workload type', () => {
      const maxConnFor = (type: MariaDbWorkloadType): number =>
        computeMariaDbParams({ totalMemoryMb: 8192, reservedForOsMb: 1024, storageType: 'ssd', dbType: type }).maxConnections

      expect(maxConnFor('oltp')).toBe(200)
      expect(maxConnFor('olap')).toBe(50)
      expect(maxConnFor('mixed')).toBe(150)
      expect(maxConnFor('web')).toBe(150)
      expect(maxConnFor('smallVps')).toBe(50)
    })

    it('rejects zero/negative RAM and reserved-OS memory that consumes all RAM', () => {
      expect(() =>
        computeMariaDbParams({ totalMemoryMb: 0, reservedForOsMb: 0, storageType: 'ssd', dbType: 'oltp' }),
      ).toThrow()
      expect(() =>
        computeMariaDbParams({ totalMemoryMb: 1024, reservedForOsMb: 1024, storageType: 'ssd', dbType: 'oltp' }),
      ).toThrow()
    })
  })

  describe('MariaDB — version-gated redo log naming', () => {
    it('usesRedoLogCapacity is true from 10.8 onward and false before it', () => {
      const base: MariaDbMetrics = { totalMemoryMb: 1, reservedForOsMb: 0, storageType: 'ssd', dbType: 'oltp' }
      expect(mariaDbUsesRedoLogCapacity({ ...base, majorVersion: 10, minorVersion: 7 })).toBe(false)
      expect(mariaDbUsesRedoLogCapacity({ ...base, majorVersion: 10, minorVersion: 8 })).toBe(true)
      expect(mariaDbUsesRedoLogCapacity({ ...base, majorVersion: 11, minorVersion: 0 })).toBe(true)
    })

    it('renders innodb_redo_log_capacity on 10.8+ and innodb_log_file_size before it', () => {
      const oldMetrics: MariaDbMetrics = {
        totalMemoryMb: 8192,
        reservedForOsMb: 1024,
        storageType: 'ssd',
        dbType: 'oltp',
        majorVersion: 10,
        minorVersion: 6,
      }
      const newMetrics: MariaDbMetrics = {
        totalMemoryMb: 8192,
        reservedForOsMb: 1024,
        storageType: 'ssd',
        dbType: 'oltp',
        majorVersion: 10,
        minorVersion: 8,
      }

      const oldText = builder.execute({ engine: 'mariadb', mariadb: oldMetrics })
      const newText = builder.execute({ engine: 'mariadb', mariadb: newMetrics })

      expect(oldText).toContain('innodb_log_file_size')
      expect(oldText).not.toContain('innodb_redo_log_capacity')
      expect(newText).toContain('innodb_redo_log_capacity')
      expect(newText).not.toContain('innodb_log_file_size =')
    })
  })

  describe('MariaDB — DatabaseConfigBuilder.execute conditional field pairs', () => {
    const metrics: MariaDbMetrics = {
      totalMemoryMb: 8192,
      reservedForOsMb: 1024,
      storageType: 'ssd',
      dbType: 'oltp',
    }

    it('server_id only appears when log_bin is on', () => {
      const off = builder.execute({
        engine: 'mariadb',
        mariadb: metrics,
        policyValues: { log_bin: 'off', server_id: '7' },
      })
      expect(off).toContain('log_bin = OFF')
      expect(off).not.toContain('server_id')

      const on = builder.execute({
        engine: 'mariadb',
        mariadb: metrics,
        policyValues: { log_bin: 'on', server_id: '7' },
      })
      expect(on).toContain('log_bin = ON')
      expect(on).toContain('server_id = 7')
    })

    it('long_query_time only appears when slow_query_log is on', () => {
      const withoutSwitch = builder.execute({
        engine: 'mariadb',
        mariadb: metrics,
        policyValues: { long_query_time: '5' },
      })
      expect(withoutSwitch).not.toContain('long_query_time')

      const withSwitchOn = builder.execute({
        engine: 'mariadb',
        mariadb: metrics,
        policyValues: { slow_query_log: 'on', long_query_time: '5' },
      })
      expect(withSwitchOn).toContain('slow_query_log = ON')
      expect(withSwitchOn).toContain('long_query_time = 5')
    })

    it('query_cache_size only appears when query_cache_type is on', () => {
      const off = builder.execute({
        engine: 'mariadb',
        mariadb: metrics,
        policyValues: { query_cache_type: 'off', query_cache_size: '64M' },
      })
      expect(off).toContain('query_cache_type = OFF')
      expect(off).not.toContain('query_cache_size')

      const on = builder.execute({
        engine: 'mariadb',
        mariadb: metrics,
        policyValues: { query_cache_type: 'on', query_cache_size: '64M' },
      })
      expect(on).toContain('query_cache_type = ON')
      expect(on).toContain('query_cache_size = 64M')
    })

    it('character set defaults are always emitted', () => {
      const text = builder.execute({ engine: 'mariadb', mariadb: metrics })
      expect(text).toContain('character-set-server = utf8mb4')
      expect(text).toContain('collation-server = utf8mb4_unicode_ci')
    })

    it('unknown policy key is rejected', () => {
      expect(() =>
        builder.execute({ engine: 'mariadb', mariadb: metrics, policyValues: { bogus_key: '1' } }),
      ).toThrow()
    })

    it('throws when mariadb metrics are missing for the mariadb engine', () => {
      expect(() => builder.execute({ engine: 'mariadb' })).toThrow()
    })
  })

  describe('Suggested file names', () => {
    it('match each engine', () => {
      expect(databaseEngineSuggestedFileName('postgresql')).toBe('postgresql.conf')
      expect(databaseEngineSuggestedFileName('mariadb')).toBe('my.cnf')
    })
  })
})
