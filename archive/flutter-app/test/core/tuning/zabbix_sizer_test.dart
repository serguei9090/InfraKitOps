import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/tuning/zabbix_sizer.dart';

void main() {
  const sizer = ZabbixSizer();

  group('NVPS arithmetic', () {
    test('nvps = (hosts * items/host) / interval, for a known input set', () {
      final result = sizer.execute(
        const ZabbixSizerInput(
          hostCount: 100,
          itemsPerHost: 100,
          checkIntervalSeconds: 10,
          historyRetentionDays: 7,
          trendsRetentionDays: 365,
        ),
      );

      expect(result.totalItems, 10000);
      expect(result.nvps, 1000);
    });

    test('a non-integer-dividing interval still computes the exact ratio', () {
      final result = sizer.execute(
        const ZabbixSizerInput(
          hostCount: 100,
          itemsPerHost: 50,
          checkIntervalSeconds: 60,
          historyRetentionDays: 1,
          trendsRetentionDays: 1,
        ),
      );

      expect(result.totalItems, 5000);
      expect(result.nvps, closeTo(5000 / 60, 1e-9));
    });

    test('worker recommendations derive from nvps at documented ratios, '
        'floored at the documented stock defaults', () {
      final result = sizer.execute(
        const ZabbixSizerInput(
          hostCount: 100,
          itemsPerHost: 100,
          checkIntervalSeconds: 10, // nvps = 1000
          historyRetentionDays: 7,
          trendsRetentionDays: 365,
          cpuCores: 8,
        ),
      );

      // startPollers: ceil(1000/100) = 10 (above the floor of 5)
      expect(result.startPollers, 10);
      // unreachable pollers: startPollers ~/ 10, floored at 1
      expect(result.startPollersUnreachable, 1);
      // startPreprocessors: max(ceil(1000/250)=4, cpuCores=8) = 8, but the
      // documented stock floor of 16 wins since 8 < 16.
      expect(result.startPreprocessors, 16);
      // startTrappers: ceil(1000/500) = 2, floored at the stock default of 5
      expect(result.startTrappers, 5);
      // startDbSyncers: ceil(1000/1000) = 1, floored at the documented 4
      expect(result.startDbSyncers, 4);
    });

    test('a very high cpuCores raises StartPreprocessors above the nvps-only '
        'recommendation, per the "no less than CPU core count" rule', () {
      final result = sizer.execute(
        const ZabbixSizerInput(
          hostCount: 100,
          itemsPerHost: 100,
          checkIntervalSeconds: 10, // nvps = 1000 -> nvps-only would be 4
          historyRetentionDays: 1,
          trendsRetentionDays: 1,
          cpuCores: 32,
        ),
      );

      expect(result.startPreprocessors, 32);
    });

    test('heavy load pushes worker counts well above the stock floors', () {
      final result = sizer.execute(
        const ZabbixSizerInput(
          hostCount: 10000,
          itemsPerHost: 100,
          checkIntervalSeconds: 1, // nvps = 1,000,000
          historyRetentionDays: 1,
          trendsRetentionDays: 1,
        ),
      );

      expect(result.startPollers, lessThanOrEqualTo(ZabbixSizer.maxWorkers));
      expect(result.startDbSyncers, lessThanOrEqualTo(ZabbixSizer.maxDbSyncers));
      expect(result.startPollers, greaterThan(ZabbixSizer.defaultStartPollers));
      expect(result.startDbSyncers, greaterThan(4));
    });
  });

  group('growth / DB-size estimates scale sensibly with retention', () {
    test('historyBytesTotal and trendsBytesTotal scale linearly with their '
        'own retention window (raw bytes, no constant offset)', () {
      final short = sizer.execute(
        const ZabbixSizerInput(
          hostCount: 50,
          itemsPerHost: 40,
          checkIntervalSeconds: 30,
          historyRetentionDays: 7,
          trendsRetentionDays: 30,
        ),
      );
      final doubledHistory = sizer.execute(
        const ZabbixSizerInput(
          hostCount: 50,
          itemsPerHost: 40,
          checkIntervalSeconds: 30,
          historyRetentionDays: 14,
          trendsRetentionDays: 30,
        ),
      );

      expect(doubledHistory.historyBytesTotal, closeTo(short.historyBytesTotal * 2, 1e-6));
      // Trends retention unchanged, so trends growth is untouched.
      expect(doubledHistory.trendsBytesTotal, closeTo(short.trendsBytesTotal, 1e-6));
      // totalDbBytes still grows because history contributes to it, even
      // though there's a fixed +10MB configuration offset in the mix.
      expect(doubledHistory.totalDbBytes, greaterThan(short.totalDbBytes));
    });

    test('totalDbBytes increases monotonically with trends retention alone', () {
      final base = sizer.execute(
        const ZabbixSizerInput(
          hostCount: 50,
          itemsPerHost: 40,
          checkIntervalSeconds: 30,
          historyRetentionDays: 7,
          trendsRetentionDays: 30,
        ),
      );
      final moreTrends = sizer.execute(
        const ZabbixSizerInput(
          hostCount: 50,
          itemsPerHost: 40,
          checkIntervalSeconds: 30,
          historyRetentionDays: 7,
          trendsRetentionDays: 365,
        ),
      );

      expect(moreTrends.trendsBytesTotal, greaterThan(base.trendsBytesTotal));
      expect(moreTrends.totalDbBytes, greaterThan(base.totalDbBytes));
    });

    test('more hosts/items increases both nvps-driven history growth and '
        'item-count-driven trend growth', () {
      final smaller = sizer.execute(
        const ZabbixSizerInput(
          hostCount: 10,
          itemsPerHost: 20,
          checkIntervalSeconds: 60,
          historyRetentionDays: 30,
          trendsRetentionDays: 365,
        ),
      );
      final larger = sizer.execute(
        const ZabbixSizerInput(
          hostCount: 100,
          itemsPerHost: 20,
          checkIntervalSeconds: 60,
          historyRetentionDays: 30,
          trendsRetentionDays: 365,
        ),
      );

      expect(larger.totalItems, 10 * smaller.totalItems);
      expect(larger.nvps, closeTo(smaller.nvps * 10, 1e-9));
      expect(larger.historyBytesTotal, closeTo(smaller.historyBytesTotal * 10, 1e-3));
      expect(larger.trendsBytesTotal, closeTo(smaller.trendsBytesTotal * 10, 1e-3));
      expect(larger.totalDbBytes, greaterThan(smaller.totalDbBytes));
    });

    test('exact history/trends byte math for a known input set', () {
      final result = sizer.execute(
        const ZabbixSizerInput(
          hostCount: 100,
          itemsPerHost: 100,
          checkIntervalSeconds: 10, // nvps = 1000
          historyRetentionDays: 7,
          trendsRetentionDays: 365,
        ),
      );

      // historyValuesPerDay = nvps * 86400
      expect(result.historyValuesPerDay, 1000 * 86400);
      // historyBytesPerDay = historyValuesPerDay * 90 bytes/value
      expect(result.historyBytesPerDay, 1000 * 86400 * 90);
      expect(result.historyBytesTotal, 1000 * 86400 * 90 * 7);

      // trendRowsPerDay = totalItems * 24 (one row per item per hour)
      expect(result.trendRowsPerDay, 10000 * 24);
      expect(result.trendsBytesPerDay, 10000 * 24 * 90);
      expect(result.trendsBytesTotal, 10000 * 24 * 90 * 365);
    });

    test('PostgreSQL and MySQL overhead factors differ and both apply on '
        'top of the raw row bytes plus the fixed configuration size', () {
      const input = ZabbixSizerInput(
        hostCount: 100,
        itemsPerHost: 100,
        checkIntervalSeconds: 10,
        historyRetentionDays: 7,
        trendsRetentionDays: 365,
      );

      final postgres = sizer.execute(input);
      final mysql = sizer.execute(
        const ZabbixSizerInput(
          hostCount: 100,
          itemsPerHost: 100,
          checkIntervalSeconds: 10,
          historyRetentionDays: 7,
          trendsRetentionDays: 365,
          dbEngine: ZabbixDbEngine.mysql,
        ),
      );

      expect(postgres.engineOverheadFactor, 1.30);
      expect(mysql.engineOverheadFactor, 1.20);
      expect(postgres.totalDbBytes, greaterThan(mysql.totalDbBytes));

      final rawRowBytes = postgres.historyBytesTotal + postgres.trendsBytesTotal;
      expect(
        postgres.totalDbBytes,
        closeTo(rawRowBytes * 1.30 + ZabbixSizer.configurationBytes, 1e-3),
      );
      expect(
        mysql.totalDbBytes,
        closeTo(rawRowBytes * 1.20 + ZabbixSizer.configurationBytes, 1e-3),
      );
    });
  });

  group('invalid inputs are rejected', () {
    const valid = ZabbixSizerInput(
      hostCount: 10,
      itemsPerHost: 10,
      checkIntervalSeconds: 30,
      historyRetentionDays: 7,
      trendsRetentionDays: 30,
    );

    test('zero or negative hostCount', () {
      expect(() => sizer.execute(const ZabbixSizerInput(
            hostCount: 0,
            itemsPerHost: 10,
            checkIntervalSeconds: 30,
            historyRetentionDays: 7,
            trendsRetentionDays: 30,
          )), throwsArgumentError);
      expect(() => sizer.execute(const ZabbixSizerInput(
            hostCount: -5,
            itemsPerHost: 10,
            checkIntervalSeconds: 30,
            historyRetentionDays: 7,
            trendsRetentionDays: 30,
          )), throwsArgumentError);
    });

    test('zero or negative itemsPerHost', () {
      expect(() => sizer.execute(const ZabbixSizerInput(
            hostCount: 10,
            itemsPerHost: 0,
            checkIntervalSeconds: 30,
            historyRetentionDays: 7,
            trendsRetentionDays: 30,
          )), throwsArgumentError);
      expect(() => sizer.execute(const ZabbixSizerInput(
            hostCount: 10,
            itemsPerHost: -1,
            checkIntervalSeconds: 30,
            historyRetentionDays: 7,
            trendsRetentionDays: 30,
          )), throwsArgumentError);
    });

    test('zero, negative, infinite or NaN checkIntervalSeconds', () {
      expect(() => sizer.execute(const ZabbixSizerInput(
            hostCount: 10,
            itemsPerHost: 10,
            checkIntervalSeconds: 0,
            historyRetentionDays: 7,
            trendsRetentionDays: 30,
          )), throwsArgumentError);
      expect(() => sizer.execute(const ZabbixSizerInput(
            hostCount: 10,
            itemsPerHost: 10,
            checkIntervalSeconds: -30,
            historyRetentionDays: 7,
            trendsRetentionDays: 30,
          )), throwsArgumentError);
      expect(() => sizer.execute(ZabbixSizerInput(
            hostCount: 10,
            itemsPerHost: 10,
            checkIntervalSeconds: double.infinity,
            historyRetentionDays: 7,
            trendsRetentionDays: 30,
          )), throwsArgumentError);
      expect(() => sizer.execute(ZabbixSizerInput(
            hostCount: 10,
            itemsPerHost: 10,
            checkIntervalSeconds: double.nan,
            historyRetentionDays: 7,
            trendsRetentionDays: 30,
          )), throwsArgumentError);
    });

    test('zero or negative historyRetentionDays', () {
      expect(() => sizer.execute(const ZabbixSizerInput(
            hostCount: 10,
            itemsPerHost: 10,
            checkIntervalSeconds: 30,
            historyRetentionDays: 0,
            trendsRetentionDays: 30,
          )), throwsArgumentError);
    });

    test('zero or negative trendsRetentionDays', () {
      expect(() => sizer.execute(const ZabbixSizerInput(
            hostCount: 10,
            itemsPerHost: 10,
            checkIntervalSeconds: 30,
            historyRetentionDays: 7,
            trendsRetentionDays: 0,
          )), throwsArgumentError);
    });

    test('zero or negative cpuCores', () {
      expect(() => sizer.execute(const ZabbixSizerInput(
            hostCount: 10,
            itemsPerHost: 10,
            checkIntervalSeconds: 30,
            historyRetentionDays: 7,
            trendsRetentionDays: 30,
            cpuCores: 0,
          )), throwsArgumentError);
    });

    test('a valid baseline input does not throw', () {
      expect(() => sizer.execute(valid), returnsNormally);
    });
  });

  group('zabbix_server.conf snippet', () {
    test('contains every expected directive name', () {
      final result = sizer.execute(
        const ZabbixSizerInput(
          hostCount: 100,
          itemsPerHost: 100,
          checkIntervalSeconds: 10,
          historyRetentionDays: 7,
          trendsRetentionDays: 365,
        ),
      );

      final conf = result.configText;
      for (final directive in const [
        'StartPollers=',
        'StartPollersUnreachable=',
        'StartPreprocessors=',
        'StartTrappers=',
        'StartDBSyncers=',
        'CacheSize=',
        'HistoryCacheSize=',
        'HistoryIndexCacheSize=',
        'TrendCacheSize=',
        'ValueCacheSize=',
      ]) {
        expect(conf, contains(directive), reason: 'missing directive $directive');
      }
    });

    test('directive values match the computed recommendation fields', () {
      final result = sizer.execute(
        const ZabbixSizerInput(
          hostCount: 100,
          itemsPerHost: 100,
          checkIntervalSeconds: 10,
          historyRetentionDays: 7,
          trendsRetentionDays: 365,
        ),
      );

      final conf = result.configText;
      expect(conf, contains('StartPollers=${result.startPollers}'));
      expect(conf, contains('StartPollersUnreachable=${result.startPollersUnreachable}'));
      expect(conf, contains('StartPreprocessors=${result.startPreprocessors}'));
      expect(conf, contains('StartTrappers=${result.startTrappers}'));
      expect(conf, contains('StartDBSyncers=${result.startDbSyncers}'));
      expect(conf, contains('CacheSize=${result.cacheSizeMb}M'));
      expect(conf, contains('HistoryCacheSize=${result.historyCacheSizeMb}M'));
      expect(conf, contains('HistoryIndexCacheSize=${result.historyIndexCacheSizeMb}M'));
      expect(conf, contains('TrendCacheSize=${result.trendCacheSizeMb}M'));
      expect(conf, contains('ValueCacheSize=${result.valueCacheSizeMb}M'));
    });

    test('mentions the engine label and NVPS figure', () {
      final result = sizer.execute(
        const ZabbixSizerInput(
          hostCount: 100,
          itemsPerHost: 100,
          checkIntervalSeconds: 10,
          historyRetentionDays: 7,
          trendsRetentionDays: 365,
          dbEngine: ZabbixDbEngine.mysql,
        ),
      );

      expect(result.configText, contains('MySQL / MariaDB'));
      expect(result.configText, contains('1000.00 NVPS'));
    });
  });

  group('formatZabbixBytes', () {
    test('renders sub-1024 byte counts as bytes', () {
      expect(formatZabbixBytes(512), '512 B');
    });

    test('renders binary (1024-based) units up through the scale', () {
      expect(formatZabbixBytes(2048), '2.00 KB');
      expect(formatZabbixBytes(5 * 1024 * 1024), '5.00 MB');
      expect(formatZabbixBytes(3 * 1024 * 1024 * 1024), '3.00 GB');
    });
  });
}
