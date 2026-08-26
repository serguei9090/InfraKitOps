import { describe, expect, it } from 'vitest'
import { ZabbixSizer, formatZabbixBytes } from './zabbixSizer'

describe('ZabbixSizer', () => {
  const sizer = new ZabbixSizer()

  describe('NVPS arithmetic', () => {
    it('nvps = (hosts * items/host) / interval, for a known input set', () => {
      const result = sizer.execute({
        hostCount: 100,
        itemsPerHost: 100,
        checkIntervalSeconds: 10,
        historyRetentionDays: 7,
        trendsRetentionDays: 365,
      })

      expect(result.totalItems).toBe(10000)
      expect(result.nvps).toBe(1000)
    })

    it('a non-integer-dividing interval still computes the exact ratio', () => {
      const result = sizer.execute({
        hostCount: 100,
        itemsPerHost: 50,
        checkIntervalSeconds: 60,
        historyRetentionDays: 1,
        trendsRetentionDays: 1,
      })

      expect(result.totalItems).toBe(5000)
      expect(result.nvps).toBeCloseTo(5000 / 60, 9)
    })

    it('worker recommendations derive from nvps at documented ratios, floored at the documented stock defaults', () => {
      const result = sizer.execute({
        hostCount: 100,
        itemsPerHost: 100,
        checkIntervalSeconds: 10, // nvps = 1000
        historyRetentionDays: 7,
        trendsRetentionDays: 365,
        cpuCores: 8,
      })

      // startPollers: ceil(1000/100) = 10 (above the floor of 5)
      expect(result.startPollers).toBe(10)
      // unreachable pollers: startPollers ~/ 10, floored at 1
      expect(result.startPollersUnreachable).toBe(1)
      // startPreprocessors: max(ceil(1000/250)=4, cpuCores=8) = 8, but the
      // documented stock floor of 16 wins since 8 < 16.
      expect(result.startPreprocessors).toBe(16)
      // startTrappers: ceil(1000/500) = 2, floored at the stock default of 5
      expect(result.startTrappers).toBe(5)
      // startDbSyncers: ceil(1000/1000) = 1, floored at the documented 4
      expect(result.startDbSyncers).toBe(4)
    })

    it('a very high cpuCores raises StartPreprocessors above the nvps-only recommendation, per the "no less than CPU core count" rule', () => {
      const result = sizer.execute({
        hostCount: 100,
        itemsPerHost: 100,
        checkIntervalSeconds: 10, // nvps = 1000 -> nvps-only would be 4
        historyRetentionDays: 1,
        trendsRetentionDays: 1,
        cpuCores: 32,
      })

      expect(result.startPreprocessors).toBe(32)
    })

    it('heavy load pushes worker counts well above the stock floors', () => {
      const result = sizer.execute({
        hostCount: 10000,
        itemsPerHost: 100,
        checkIntervalSeconds: 1, // nvps = 1,000,000
        historyRetentionDays: 1,
        trendsRetentionDays: 1,
      })

      expect(result.startPollers).toBeLessThanOrEqual(ZabbixSizer.maxWorkers)
      expect(result.startDbSyncers).toBeLessThanOrEqual(ZabbixSizer.maxDbSyncers)
      expect(result.startPollers).toBeGreaterThan(ZabbixSizer.defaultStartPollers)
      expect(result.startDbSyncers).toBeGreaterThan(4)
    })
  })

  describe('growth / DB-size estimates scale sensibly with retention', () => {
    it("historyBytesTotal and trendsBytesTotal scale linearly with their own retention window (raw bytes, no constant offset)", () => {
      const short = sizer.execute({
        hostCount: 50,
        itemsPerHost: 40,
        checkIntervalSeconds: 30,
        historyRetentionDays: 7,
        trendsRetentionDays: 30,
      })
      const doubledHistory = sizer.execute({
        hostCount: 50,
        itemsPerHost: 40,
        checkIntervalSeconds: 30,
        historyRetentionDays: 14,
        trendsRetentionDays: 30,
      })

      expect(doubledHistory.historyBytesTotal).toBeCloseTo(short.historyBytesTotal * 2, 6)
      // Trends retention unchanged, so trends growth is untouched.
      expect(doubledHistory.trendsBytesTotal).toBeCloseTo(short.trendsBytesTotal, 6)
      // totalDbBytes still grows because history contributes to it, even
      // though there's a fixed +10MB configuration offset in the mix.
      expect(doubledHistory.totalDbBytes).toBeGreaterThan(short.totalDbBytes)
    })

    it('totalDbBytes increases monotonically with trends retention alone', () => {
      const base = sizer.execute({
        hostCount: 50,
        itemsPerHost: 40,
        checkIntervalSeconds: 30,
        historyRetentionDays: 7,
        trendsRetentionDays: 30,
      })
      const moreTrends = sizer.execute({
        hostCount: 50,
        itemsPerHost: 40,
        checkIntervalSeconds: 30,
        historyRetentionDays: 7,
        trendsRetentionDays: 365,
      })

      expect(moreTrends.trendsBytesTotal).toBeGreaterThan(base.trendsBytesTotal)
      expect(moreTrends.totalDbBytes).toBeGreaterThan(base.totalDbBytes)
    })

    it('more hosts/items increases both nvps-driven history growth and item-count-driven trend growth', () => {
      const smaller = sizer.execute({
        hostCount: 10,
        itemsPerHost: 20,
        checkIntervalSeconds: 60,
        historyRetentionDays: 30,
        trendsRetentionDays: 365,
      })
      const larger = sizer.execute({
        hostCount: 100,
        itemsPerHost: 20,
        checkIntervalSeconds: 60,
        historyRetentionDays: 30,
        trendsRetentionDays: 365,
      })

      expect(larger.totalItems).toBe(10 * smaller.totalItems)
      expect(larger.nvps).toBeCloseTo(smaller.nvps * 10, 9)
      expect(larger.historyBytesTotal).toBeCloseTo(smaller.historyBytesTotal * 10, 3)
      expect(larger.trendsBytesTotal).toBeCloseTo(smaller.trendsBytesTotal * 10, 3)
      expect(larger.totalDbBytes).toBeGreaterThan(smaller.totalDbBytes)
    })

    it('exact history/trends byte math for a known input set', () => {
      const result = sizer.execute({
        hostCount: 100,
        itemsPerHost: 100,
        checkIntervalSeconds: 10, // nvps = 1000
        historyRetentionDays: 7,
        trendsRetentionDays: 365,
      })

      // historyValuesPerDay = nvps * 86400
      expect(result.historyValuesPerDay).toBe(1000 * 86400)
      // historyBytesPerDay = historyValuesPerDay * 90 bytes/value
      expect(result.historyBytesPerDay).toBe(1000 * 86400 * 90)
      expect(result.historyBytesTotal).toBe(1000 * 86400 * 90 * 7)

      // trendRowsPerDay = totalItems * 24 (one row per item per hour)
      expect(result.trendRowsPerDay).toBe(10000 * 24)
      expect(result.trendsBytesPerDay).toBe(10000 * 24 * 90)
      expect(result.trendsBytesTotal).toBe(10000 * 24 * 90 * 365)
    })

    it('PostgreSQL and MySQL overhead factors differ and both apply on top of the raw row bytes plus the fixed configuration size', () => {
      const input = {
        hostCount: 100,
        itemsPerHost: 100,
        checkIntervalSeconds: 10,
        historyRetentionDays: 7,
        trendsRetentionDays: 365,
      }

      const postgres = sizer.execute(input)
      const mysql = sizer.execute({ ...input, dbEngine: 'mysql' as const })

      expect(postgres.engineOverheadFactor).toBe(1.3)
      expect(mysql.engineOverheadFactor).toBe(1.2)
      expect(postgres.totalDbBytes).toBeGreaterThan(mysql.totalDbBytes)

      const rawRowBytes = postgres.historyBytesTotal + postgres.trendsBytesTotal
      expect(postgres.totalDbBytes).toBeCloseTo(rawRowBytes * 1.3 + ZabbixSizer.configurationBytes, 3)
      expect(mysql.totalDbBytes).toBeCloseTo(rawRowBytes * 1.2 + ZabbixSizer.configurationBytes, 3)
    })
  })

  describe('invalid inputs are rejected', () => {
    const valid = {
      hostCount: 10,
      itemsPerHost: 10,
      checkIntervalSeconds: 30,
      historyRetentionDays: 7,
      trendsRetentionDays: 30,
    }

    it('zero or negative hostCount', () => {
      expect(() => sizer.execute({ ...valid, hostCount: 0 })).toThrow()
      expect(() => sizer.execute({ ...valid, hostCount: -5 })).toThrow()
    })

    it('zero or negative itemsPerHost', () => {
      expect(() => sizer.execute({ ...valid, itemsPerHost: 0 })).toThrow()
      expect(() => sizer.execute({ ...valid, itemsPerHost: -1 })).toThrow()
    })

    it('zero, negative, infinite or NaN checkIntervalSeconds', () => {
      expect(() => sizer.execute({ ...valid, checkIntervalSeconds: 0 })).toThrow()
      expect(() => sizer.execute({ ...valid, checkIntervalSeconds: -30 })).toThrow()
      expect(() => sizer.execute({ ...valid, checkIntervalSeconds: Infinity })).toThrow()
      expect(() => sizer.execute({ ...valid, checkIntervalSeconds: NaN })).toThrow()
    })

    it('zero or negative historyRetentionDays', () => {
      expect(() => sizer.execute({ ...valid, historyRetentionDays: 0 })).toThrow()
    })

    it('zero or negative trendsRetentionDays', () => {
      expect(() => sizer.execute({ ...valid, trendsRetentionDays: 0 })).toThrow()
    })

    it('zero or negative cpuCores', () => {
      expect(() => sizer.execute({ ...valid, cpuCores: 0 })).toThrow()
    })

    it('a valid baseline input does not throw', () => {
      expect(() => sizer.execute(valid)).not.toThrow()
    })
  })

  describe('zabbix_server.conf snippet', () => {
    it('contains every expected directive name', () => {
      const result = sizer.execute({
        hostCount: 100,
        itemsPerHost: 100,
        checkIntervalSeconds: 10,
        historyRetentionDays: 7,
        trendsRetentionDays: 365,
      })

      const conf = result.configText
      for (const directive of [
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
        expect(conf).toContain(directive)
      }
    })

    it('directive values match the computed recommendation fields', () => {
      const result = sizer.execute({
        hostCount: 100,
        itemsPerHost: 100,
        checkIntervalSeconds: 10,
        historyRetentionDays: 7,
        trendsRetentionDays: 365,
      })

      const conf = result.configText
      expect(conf).toContain(`StartPollers=${result.startPollers}`)
      expect(conf).toContain(`StartPollersUnreachable=${result.startPollersUnreachable}`)
      expect(conf).toContain(`StartPreprocessors=${result.startPreprocessors}`)
      expect(conf).toContain(`StartTrappers=${result.startTrappers}`)
      expect(conf).toContain(`StartDBSyncers=${result.startDbSyncers}`)
      expect(conf).toContain(`CacheSize=${result.cacheSizeMb}M`)
      expect(conf).toContain(`HistoryCacheSize=${result.historyCacheSizeMb}M`)
      expect(conf).toContain(`HistoryIndexCacheSize=${result.historyIndexCacheSizeMb}M`)
      expect(conf).toContain(`TrendCacheSize=${result.trendCacheSizeMb}M`)
      expect(conf).toContain(`ValueCacheSize=${result.valueCacheSizeMb}M`)
    })

    it('mentions the engine label and NVPS figure', () => {
      const result = sizer.execute({
        hostCount: 100,
        itemsPerHost: 100,
        checkIntervalSeconds: 10,
        historyRetentionDays: 7,
        trendsRetentionDays: 365,
        dbEngine: 'mysql',
      })

      expect(result.configText).toContain('MySQL / MariaDB')
      expect(result.configText).toContain('1000.00 NVPS')
    })
  })

  describe('formatZabbixBytes', () => {
    it('renders sub-1024 byte counts as bytes', () => {
      expect(formatZabbixBytes(512)).toBe('512 B')
    })

    it('renders binary (1024-based) units up through the scale', () => {
      expect(formatZabbixBytes(2048)).toBe('2.00 KB')
      expect(formatZabbixBytes(5 * 1024 * 1024)).toBe('5.00 MB')
      expect(formatZabbixBytes(3 * 1024 * 1024 * 1024)).toBe('3.00 GB')
    })
  })
})
