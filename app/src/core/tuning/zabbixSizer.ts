import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * Backing database engine. Only affects the on-disk overhead multiplier
 * applied to the raw history/trends estimate — see `ZabbixSizer`.
 */
export type ZabbixDbEngine = 'postgresql' | 'mysql'

export function zabbixDbEngineLabel(engine: ZabbixDbEngine): string {
  return engine === 'postgresql' ? 'PostgreSQL' : 'MySQL / MariaDB'
}

/** Inputs for the Zabbix capacity/sizing estimate. */
export interface ZabbixSizerInput {
  /** Number of monitored hosts. */
  hostCount: number
  /** Average number of enabled items per host. */
  itemsPerHost: number
  /**
   * Average item check interval, in seconds. This is the "refresh rate"
   * term in Zabbix's own disk-space formula.
   */
  checkIntervalSeconds: number
  /** `Housekeeping -> History storage period`, in days. */
  historyRetentionDays: number
  /** `Housekeeping -> Trend storage period`, in days. */
  trendsRetentionDays: number
  dbEngine?: ZabbixDbEngine
  /**
   * CPU cores on the Zabbix server host. Zabbix documents that
   * `StartPreprocessors` "should be set to no less than the available CPU
   * core count", so the recommendation is floored at this value.
   */
  cpuCores?: number
}

/**
 * Recommended `zabbix_server.conf` worker/cache values plus the storage
 * estimate they were derived from.
 */
export interface ZabbixSizerResult {
  /** `hostCount * itemsPerHost`. */
  totalItems: number
  /** **New Values Per Second** — Zabbix's central capacity metric. `totalItems / checkIntervalSeconds`. */
  nvps: number

  startPollers: number
  startPollersUnreachable: number
  startPreprocessors: number
  startTrappers: number
  startDbSyncers: number

  cacheSizeMb: number
  historyCacheSizeMb: number
  historyIndexCacheSizeMb: number
  trendCacheSizeMb: number
  valueCacheSizeMb: number

  /** `nvps * 86400`. */
  historyValuesPerDay: number
  historyBytesPerDay: number
  /** History growth across the whole retention window. */
  historyBytesTotal: number

  /** One trend row per item per hour: `totalItems * 24`. */
  trendRowsPerDay: number
  trendsBytesPerDay: number
  trendsBytesTotal: number

  /** Index/page overhead multiplier applied on top of the raw row bytes. */
  engineOverheadFactor: number

  /** `(history + trends) * engineOverheadFactor + configuration`. */
  totalDbBytes: number

  dbEngine: ZabbixDbEngine

  /** Ready-to-paste `zabbix_server.conf` snippet. */
  configText: string
}

/**
 * Formats a byte count as B / KB / MB / GB / TB with two decimals.
 * Uses binary (1024) steps, matching how `df`/`free` report disk usage.
 */
export function formatZabbixBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(2)} ${units[unit]}`
}

function trimZeros(value: number): string {
  const text = value.toFixed(2)
  return text.endsWith('.00') ? text.slice(0, -3) : text
}

function pluralValues(values: number): string {
  return `${Math.round(values)} values`
}

/**
 * Zabbix monitoring capacity and database-growth sizer.
 *
 * Pure math, zero I/O, zero UI.
 *
 * ## Documented constants (Zabbix official documentation)
 *
 * Sources — Zabbix manual, *Installation -> Requirements -> Database size*
 * and *Appendix -> Configuration -> Zabbix server*:
 *
 * * History disk space: `days * (items / refresh rate) * 24 * 3600 * bytes`.
 * * Trends disk space: `days * (items / 3600) * 24 * 3600 * bytes` — the
 *   `3600` is the one-hour trend averaging period, i.e. one trend row per
 *   item per hour.
 * * `historyBytesPerValue` = 90 — "around 90 bytes per value" for numeric
 *   items.
 * * `trendsBytesPerRow` = 90 — the docs quote ~90 bytes for each hourly
 *   min/max/avg/count set.
 * * `historyIndexBytesPerItem` = 100 — "the index cache size needs roughly
 *   100 bytes to cache one item" (HistoryIndexCacheSize).
 * * `configurationBytes` = 10 MB — "Fixed size. Normally 10MB or less."
 * * `StartDBSyncers` default is 4 and "the default value should be enough
 *   to handle up to 4000 NVPS", which is where `nvpsPerDbSyncer` = 1000
 *   comes from (4000 NVPS / 4 syncers).
 * * Documented defaults used as *floors* so a recommendation never comes
 *   out below stock Zabbix: CacheSize 32M, HistoryCacheSize 16M,
 *   HistoryIndexCacheSize 4M, ValueCacheSize 8M, TrendCacheSize 4M,
 *   StartPollers 5, StartPreprocessors 16, StartTrappers 5,
 *   StartPollersUnreachable 1.
 * * Documented maxima used as caps: HistoryCacheSize / HistoryIndexCacheSize
 *   / TrendCacheSize 2G; CacheSize / ValueCacheSize 64G; poller-style
 *   parameters 1000; StartDBSyncers 100. `StartPreprocessors` "should be
 *   set to no less than the available CPU core count".
 *
 * ## Rule-of-thumb figures (NOT from Zabbix documentation)
 *
 * Zabbix publishes defaults and maxima but does not publish a formula that
 * maps NVPS to cache sizes or poller counts — real numbers depend on check
 * type, preprocessing, trigger complexity and DB latency. The following are
 * therefore **heuristic starting points**, expressed as "scale the stock
 * default linearly with load":
 *
 * * `nvpsPerPoller` = 100 — one extra poller per 100 NVPS.
 * * `nvpsPerTrapper` = 500.
 * * `nvpsPerPreprocessor` = 250.
 * * `itemsPerCacheSizeUnit` = 10000 — one stock 32M CacheSize unit per
 *   10k items of configuration.
 * * `nvpsPerHistoryCacheUnit` = 1000 — one stock 16M HistoryCacheSize unit
 *   per 1000 NVPS.
 * * `itemsPerValueCacheUnit` = 1000 — one stock 8M ValueCacheSize unit per
 *   1000 items.
 * * `itemsPerTrendCacheUnit` = 1000 — one stock 4M TrendCacheSize unit per
 *   1000 items.
 * * Unreachable pollers = 1 per 10 regular pollers.
 * * Engine overhead: PostgreSQL 1.30x, MySQL/InnoDB 1.20x on top of the raw
 *   row bytes, covering primary-key and secondary-index storage plus page
 *   fill factor.
 */
export class ZabbixSizer implements IToolUseCase<ZabbixSizerInput, ZabbixSizerResult> {
  // ---- documented constants ----
  static readonly historyBytesPerValue = 90
  static readonly trendsBytesPerRow = 90
  static readonly historyIndexBytesPerItem = 100
  static readonly configurationBytes = 10 * 1024 * 1024
  static readonly secondsPerDay = 86400
  static readonly trendRowsPerItemPerDay = 24
  static readonly nvpsPerDbSyncer = 1000

  // Documented stock defaults, used as floors.
  static readonly defaultCacheSizeMb = 32
  static readonly defaultHistoryCacheSizeMb = 16
  static readonly defaultHistoryIndexCacheSizeMb = 4
  static readonly defaultTrendCacheSizeMb = 4
  static readonly defaultValueCacheSizeMb = 8
  static readonly defaultStartPollers = 5
  static readonly defaultStartPreprocessors = 16
  static readonly defaultStartTrappers = 5

  // Documented maxima, used as caps.
  static readonly maxSmallCacheMb = 2 * 1024 // 2G
  static readonly maxLargeCacheMb = 64 * 1024 // 64G
  static readonly maxWorkers = 1000
  static readonly maxDbSyncers = 100

  // ---- rule-of-thumb scaling factors (see class doc) ----
  static readonly nvpsPerPoller = 100
  static readonly nvpsPerTrapper = 500
  static readonly nvpsPerPreprocessor = 250
  static readonly itemsPerCacheSizeUnit = 10000
  static readonly nvpsPerHistoryCacheUnit = 1000
  static readonly itemsPerValueCacheUnit = 1000
  static readonly itemsPerTrendCacheUnit = 1000

  execute(input: ZabbixSizerInput): ZabbixSizerResult {
    const dbEngine = input.dbEngine ?? 'postgresql'
    const cpuCores = input.cpuCores ?? 8

    if (input.hostCount <= 0) {
      throw new Error('hostCount must be positive')
    }
    if (input.itemsPerHost <= 0) {
      throw new Error('itemsPerHost must be positive')
    }
    if (!(input.checkIntervalSeconds > 0) || !Number.isFinite(input.checkIntervalSeconds)) {
      throw new Error('checkIntervalSeconds must be greater than zero')
    }
    if (input.historyRetentionDays <= 0) {
      throw new Error('historyRetentionDays must be positive')
    }
    if (input.trendsRetentionDays <= 0) {
      throw new Error('trendsRetentionDays must be positive')
    }
    if (cpuCores <= 0) {
      throw new Error('cpuCores must be positive')
    }

    const totalItems = input.hostCount * input.itemsPerHost
    const nvps = totalItems / input.checkIntervalSeconds

    // ---- storage (documented Zabbix formulas) ----
    const historyValuesPerDay = nvps * ZabbixSizer.secondsPerDay
    const historyBytesPerDay = historyValuesPerDay * ZabbixSizer.historyBytesPerValue
    const historyBytesTotal = historyBytesPerDay * input.historyRetentionDays

    const trendRowsPerDay = totalItems * ZabbixSizer.trendRowsPerItemPerDay
    const trendsBytesPerDay = trendRowsPerDay * ZabbixSizer.trendsBytesPerRow
    const trendsBytesTotal = trendsBytesPerDay * input.trendsRetentionDays

    const overhead = dbEngine === 'postgresql' ? 1.3 : 1.2
    const totalDbBytes = (historyBytesTotal + trendsBytesTotal) * overhead + ZabbixSizer.configurationBytes

    // ---- workers ----
    const startPollers = clampInt(
      Math.ceil(nvps / ZabbixSizer.nvpsPerPoller),
      ZabbixSizer.defaultStartPollers,
      ZabbixSizer.maxWorkers,
    )
    const startPollersUnreachable = clampInt(Math.trunc(startPollers / 10), 1, ZabbixSizer.maxWorkers)
    const startPreprocessors = clampInt(
      Math.max(Math.ceil(nvps / ZabbixSizer.nvpsPerPreprocessor), cpuCores),
      ZabbixSizer.defaultStartPreprocessors,
      ZabbixSizer.maxWorkers,
    )
    const startTrappers = clampInt(
      Math.ceil(nvps / ZabbixSizer.nvpsPerTrapper),
      ZabbixSizer.defaultStartTrappers,
      ZabbixSizer.maxWorkers,
    )
    // Zabbix documents that the stock 4 syncers cover up to 4000 NVPS.
    const startDbSyncers = clampInt(Math.ceil(nvps / ZabbixSizer.nvpsPerDbSyncer), 4, ZabbixSizer.maxDbSyncers)

    // ---- caches ----
    const cacheSizeMb = clampInt(
      Math.ceil(totalItems / ZabbixSizer.itemsPerCacheSizeUnit) * ZabbixSizer.defaultCacheSizeMb,
      ZabbixSizer.defaultCacheSizeMb,
      ZabbixSizer.maxLargeCacheMb,
    )
    const historyCacheSizeMb = clampInt(
      Math.ceil(nvps / ZabbixSizer.nvpsPerHistoryCacheUnit) * ZabbixSizer.defaultHistoryCacheSizeMb,
      ZabbixSizer.defaultHistoryCacheSizeMb,
      ZabbixSizer.maxSmallCacheMb,
    )
    // The only cache with a documented per-item cost: ~100 bytes per item.
    const historyIndexCacheSizeMb = clampInt(
      Math.ceil((totalItems * ZabbixSizer.historyIndexBytesPerItem) / (1024 * 1024)),
      ZabbixSizer.defaultHistoryIndexCacheSizeMb,
      ZabbixSizer.maxSmallCacheMb,
    )
    const trendCacheSizeMb = clampInt(
      Math.ceil(totalItems / ZabbixSizer.itemsPerTrendCacheUnit) * ZabbixSizer.defaultTrendCacheSizeMb,
      ZabbixSizer.defaultTrendCacheSizeMb,
      ZabbixSizer.maxSmallCacheMb,
    )
    const valueCacheSizeMb = clampInt(
      Math.ceil(totalItems / ZabbixSizer.itemsPerValueCacheUnit) * ZabbixSizer.defaultValueCacheSizeMb,
      ZabbixSizer.defaultValueCacheSizeMb,
      ZabbixSizer.maxLargeCacheMb,
    )

    const nvpsText = nvps.toFixed(2)
    const intervalSeconds = totalItems / nvps
    const configText = [
      '### Generated by InfraKit Studio - Zabbix Monitoring Sizing',
      `### Estimated load: ${nvpsText} NVPS (${totalItems} items / ${trimZeros(intervalSeconds)}s interval)`,
      `### Engine: ${zabbixDbEngineLabel(dbEngine)} | history ${pluralValues(historyValuesPerDay)}/day`,
      '',
      `StartPollers=${startPollers}`,
      `StartPollersUnreachable=${startPollersUnreachable}`,
      `StartPreprocessors=${startPreprocessors}`,
      `StartTrappers=${startTrappers}`,
      `StartDBSyncers=${startDbSyncers}`,
      '',
      `CacheSize=${cacheSizeMb}M`,
      `HistoryCacheSize=${historyCacheSizeMb}M`,
      `HistoryIndexCacheSize=${historyIndexCacheSizeMb}M`,
      `TrendCacheSize=${trendCacheSizeMb}M`,
      `ValueCacheSize=${valueCacheSizeMb}M`,
    ].join('\n')

    return {
      totalItems,
      nvps,
      startPollers,
      startPollersUnreachable,
      startPreprocessors,
      startTrappers,
      startDbSyncers,
      cacheSizeMb,
      historyCacheSizeMb,
      historyIndexCacheSizeMb,
      trendCacheSizeMb,
      valueCacheSizeMb,
      historyValuesPerDay,
      historyBytesPerDay,
      historyBytesTotal,
      trendRowsPerDay,
      trendsBytesPerDay,
      trendsBytesTotal,
      engineOverheadFactor: overhead,
      totalDbBytes,
      dbEngine,
      configText,
    }
  }
}

function clampInt(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}
