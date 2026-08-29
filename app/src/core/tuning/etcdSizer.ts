import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * etcd Sizer — pure math, no I/O, no React.
 *
 * etcd stores every key plus an MVCC history of past revisions until
 * compaction, and the on-disk file only shrinks when you defragment. The
 * numbers that bite:
 *
 *   live data      = objects · avgObjectSize
 *   history        = writes/s · compactionRetention · avgObjectSize
 *   DB size (peak) ≈ (live + history) · fragmentationFactor   — grows toward
 *                    this between defrags
 *   the hard wall  = 8 GiB (--quota-backend-bytes max; above it etcd goes
 *                    read-only and the whole control plane stalls)
 *
 * etcd wants the keyspace resident, so RAM should be a few × the DB size.
 * Every write is an fsync, so disk needs low p99 fsync latency (NVMe), and
 * write IOPS ≈ writes/s.
 *
 * Estimates — real DB size depends on key churn patterns and how many
 * clients hold old revisions open (watches, slow list-watch consumers).
 */

export interface EtcdSizerInput {
  /** Total keys in the keyspace. */
  objectCount: number
  /** Average object size, bytes. Kubernetes objects average ~5–15 KiB. Default 8192. */
  avgObjectSizeBytes?: number
  /** Write / update operations per second (the MVCC churn). */
  writesPerSec: number
  /** `--auto-compaction-retention` window, hours. Kubernetes default is a few minutes; larger keeps more history. Default 1. */
  compactionRetentionHours?: number
  /** Fragmentation multiplier between defrags (tombstones + free pages). Default 1.8. */
  fragmentationFactor?: number
  /** Configured `--quota-backend-bytes`, GiB. Default 8 (the recommended max). */
  quotaBackendGiB?: number
}

export interface EtcdSizerResult {
  liveDataBytes: number
  historyBytes: number
  /** (live + history) × fragmentation — the size the DB file grows toward between defrags. */
  peakDbSizeBytes: number
  quotaBackendBytes: number
  /** peakDbSize / quotaBackend, percent. */
  quotaUtilizationPercent: number
  /** peakDbSize / 8 GiB, percent — distance to the hard wall. */
  hardLimitUtilizationPercent: number
  recommendedRamBytes: number
  /** Write IOPS the disk must sustain (≈ writes/s, each an fsync). */
  writeIops: number
  /** Write bandwidth to WAL + DB, bytes/sec. */
  writeBandwidthBytesPerSec: number
  /** Suggested defrag interval, hours (when fragmentation would double the live size). */
  defragIntervalHours: number
  warnings: string[]
  configText: string
}

const HARD_LIMIT_BYTES = 8 * 1024 ** 3

export class EtcdSizer implements IToolUseCase<EtcdSizerInput, EtcdSizerResult> {
  execute(input: EtcdSizerInput): EtcdSizerResult {
    const avgObj = input.avgObjectSizeBytes ?? 8192
    const compactionHours = input.compactionRetentionHours ?? 1
    const frag = input.fragmentationFactor ?? 1.8
    const quotaBackendBytes = (input.quotaBackendGiB ?? 8) * 1024 ** 3

    if (!Number.isInteger(input.objectCount) || input.objectCount < 1)
      throw new Error('objectCount must be an integer ≥ 1')
    if (avgObj <= 0) throw new Error('avgObjectSizeBytes must be positive')
    if (input.writesPerSec < 0) throw new Error('writesPerSec must be ≥ 0')
    if (compactionHours <= 0) throw new Error('compactionRetentionHours must be positive')
    if (frag < 1) throw new Error('fragmentationFactor must be ≥ 1')
    if (quotaBackendBytes <= 0) throw new Error('quotaBackendGiB must be positive')

    const warnings: string[] = []

    const liveDataBytes = input.objectCount * avgObj
    const historyBytes = input.writesPerSec * compactionHours * 3600 * avgObj
    const peakDbSizeBytes = (liveDataBytes + historyBytes) * frag

    const quotaUtilizationPercent = (peakDbSizeBytes / quotaBackendBytes) * 100
    const hardLimitUtilizationPercent = (peakDbSizeBytes / HARD_LIMIT_BYTES) * 100

    // etcd keeps the b-tree + index resident; 2.5× the DB is a safe floor,
    // never below 8 GiB for a control-plane node.
    const recommendedRamBytes = Math.max(8 * 1024 ** 3, peakDbSizeBytes * 2.5)

    const writeIops = input.writesPerSec // one fsync per write, roughly
    const writeBandwidthBytesPerSec = input.writesPerSec * avgObj * 2 // WAL + DB

    // Defrag when history alone would have grown the DB past ~2× the live
    // size — i.e. how long for history to reach liveData.
    const defragIntervalHours =
      input.writesPerSec > 0
        ? Math.max(1, liveDataBytes / (input.writesPerSec * 3600 * avgObj))
        : Infinity

    if (peakDbSizeBytes > HARD_LIMIT_BYTES) {
      warnings.push(
        `Estimated peak DB size ${gib(peakDbSizeBytes)} exceeds the 8 GiB hard limit — etcd will go read-only. Shorten --auto-compaction-retention, shed objects (events → shorter TTL, prune stale CRDs), or split the cluster.`,
      )
    } else if (hardLimitUtilizationPercent > 60) {
      warnings.push(`Peak DB size is ${hardLimitUtilizationPercent.toFixed(0)}% of the 8 GiB wall — little margin for a churn spike.`)
    }
    if (quotaUtilizationPercent > 80) {
      warnings.push(`Peak DB size is ${quotaUtilizationPercent.toFixed(0)}% of the configured ${gib(quotaBackendBytes)} quota — raise it (up to 8 GiB) or reduce history.`)
    }
    if (historyBytes > liveDataBytes * 2) {
      warnings.push(
        `MVCC history (${gib(historyBytes)}) is more than 2× the live data — --auto-compaction-retention is too long for this write rate, or something is churning keys (a hot-loop controller, frequent lease renewals).`,
      )
    }
    if (input.writesPerSec > 0 && Number.isFinite(defragIntervalHours) && defragIntervalHours < 24) {
      warnings.push(`Fragmentation reaches the defrag threshold about every ${defragIntervalHours.toFixed(1)} h — schedule automated, rolling defrag (one member at a time).`)
    }

    return {
      liveDataBytes,
      historyBytes,
      peakDbSizeBytes,
      quotaBackendBytes,
      quotaUtilizationPercent,
      hardLimitUtilizationPercent,
      recommendedRamBytes,
      writeIops,
      writeBandwidthBytesPerSec,
      defragIntervalHours,
      warnings,
      configText: renderFlags(input, quotaBackendBytes, compactionHours),
    }
  }
}

function gib(b: number): string {
  return `${(b / 1024 ** 3).toFixed(2)} GiB`
}

function renderFlags(input: EtcdSizerInput, quotaBytes: number, compactionHours: number): string {
  const retention = compactionHours >= 1 ? `${compactionHours}h` : `${Math.round(compactionHours * 60)}m`
  return [
    '# etcd — generated by InfraKit Studio. Estimates; watch etcd_mvcc_db_total_size_in_bytes.',
    `--quota-backend-bytes=${Math.round(quotaBytes)}`,
    `--auto-compaction-mode=periodic`,
    `--auto-compaction-retention=${retention}`,
    `--snapshot-count=10000`,
    `--max-request-bytes=1572864`,
    '# Disk: dedicated NVMe, p99 fsync < 10ms (check with etcd_disk_wal_fsync_duration_seconds).',
    `# Expect ~${Math.round(input.writesPerSec)} write IOPS. Run periodic rolling defrag.`,
  ].join('\n')
}
