import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/tuning/db_memory_sizer.dart';

void main() {
  const sizer = DbMemorySizer();

  test('16GB dedicated server lands in a sane PostgreSQL range', () {
    final result = sizer.execute(
      const DbMemorySizerInput(totalRamGb: 16, maxConnections: 100),
    );

    // shared_buffers ~= 25% of 16GB = 4GB
    expect(result.postgres.sharedBuffersMb, 4096);
    // effective_cache_size ~= 75% of 16GB = 12GB
    expect(result.postgres.effectiveCacheSizeMb, 12288);
    // work_mem = (16384 - 4096) / 100 / 4 = 30.72 -> floor 30MB, a sane
    // per-connection value (neither near-zero nor unbounded).
    expect(result.postgres.workMemMb, 30);
    expect(result.postgres.workMemMb, greaterThan(0));
    expect(result.postgres.workMemMb, lessThan(1024));

    expect(result.postgres.configText, contains('shared_buffers = 4GB'));
    expect(result.postgres.configText, contains('effective_cache_size = 12GB'));
    expect(result.postgres.configText, contains('work_mem = 30MB'));
  });

  test('16GB dedicated server lands in a sane MariaDB range', () {
    final result = sizer.execute(
      const DbMemorySizerInput(totalRamGb: 16, maxConnections: 100),
    );

    // innodb_buffer_pool_size ~= 75% of 16GB = 12GB, within the standard
    // 70-80% guidance band.
    expect(result.mariadb.innodbBufferPoolSizeMb, 12288);
    expect(result.mariadb.configText, 'innodb_buffer_pool_size = 12GB');
  });

  test('percentForDatabase scales down the RAM considered available', () {
    final full = sizer.execute(const DbMemorySizerInput(totalRamGb: 32, maxConnections: 50));
    final half = sizer.execute(
      const DbMemorySizerInput(totalRamGb: 32, maxConnections: 50, percentForDatabase: 50),
    );

    expect(half.postgres.sharedBuffersMb, full.postgres.sharedBuffersMb ~/ 2);
    expect(half.mariadb.innodbBufferPoolSizeMb, full.mariadb.innodbBufferPoolSizeMb ~/ 2);
  });

  test('work_mem never drops to zero even with a huge connection count', () {
    final result = sizer.execute(
      const DbMemorySizerInput(totalRamGb: 2, maxConnections: 5000),
    );

    expect(result.postgres.workMemMb, greaterThanOrEqualTo(1));
  });

  test('rejects non-positive totalRamGb', () {
    expect(
      () => sizer.execute(const DbMemorySizerInput(totalRamGb: 0, maxConnections: 100)),
      throwsArgumentError,
    );
    expect(
      () => sizer.execute(const DbMemorySizerInput(totalRamGb: -4, maxConnections: 100)),
      throwsArgumentError,
    );
  });

  test('rejects non-positive maxConnections', () {
    expect(
      () => sizer.execute(const DbMemorySizerInput(totalRamGb: 16, maxConnections: 0)),
      throwsArgumentError,
    );
  });

  test('rejects out-of-range percentForDatabase', () {
    expect(
      () => sizer.execute(
        const DbMemorySizerInput(totalRamGb: 16, maxConnections: 100, percentForDatabase: 0),
      ),
      throwsArgumentError,
    );
    expect(
      () => sizer.execute(
        const DbMemorySizerInput(totalRamGb: 16, maxConnections: 100, percentForDatabase: 150),
      ),
      throwsArgumentError,
    );
  });

  test('formatMb renders even-GB values as GB and the rest as MB', () {
    expect(formatMb(4096), '4GB');
    expect(formatMb(30), '30MB');
    expect(formatMb(1536), '1536MB');
  });
}
