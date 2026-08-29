import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * Storage IOPS & Capacity sizer — pure math, no I/O, no React.
 *
 * The number people forget is the **RAID write penalty**: a front-end write
 * turns into several back-end disk operations.
 *
 *   RAID 0        1   (no redundancy)
 *   RAID 1 / 10   2   (mirror both copies)
 *   RAID 5        4   (read old data + read old parity + write data + write parity)
 *   RAID 6        6   (two parity blocks)
 *   replication×N  N   (write lands on every replica)
 *
 *   back-end IOPS = readIOPS + writeIOPS × penalty
 *   disks for IOPS = ceil(back-end IOPS / per-disk IOPS)
 *
 * Capacity depends on the layout's usable fraction (RAID 5 loses one disk to
 * parity, RAID 6 two, mirrors/replication halve or divide by N). The disk
 * count is the larger of the IOPS and capacity requirements, bumped up to the
 * layout minimum.
 *
 * Growth runway assumes compound annual growth against the *usable* capacity
 * at that disk count.
 */

export type StorageLayout = 'raid0' | 'raid1' | 'raid5' | 'raid6' | 'raid10' | 'replication'

export const STORAGE_LAYOUT_LABELS: Record<StorageLayout, string> = {
  raid0: 'RAID 0 — stripe, no redundancy',
  raid1: 'RAID 1 — mirror',
  raid5: 'RAID 5 — single parity',
  raid6: 'RAID 6 — double parity',
  raid10: 'RAID 10 — striped mirrors',
  replication: 'Replication ×N (Ceph, distributed FS)',
}

export function writePenalty(layout: StorageLayout, replicationFactor: number): number {
  switch (layout) {
    case 'raid0':
      return 1
    case 'raid1':
    case 'raid10':
      return 2
    case 'raid5':
      return 4
    case 'raid6':
      return 6
    case 'replication':
      return Math.max(1, replicationFactor)
  }
}

export interface StorageIopsSizerInput {
  /** Total front-end IOPS the workload peaks at. */
  targetIops: number
  /** Share of `targetIops` that is reads, 0-100. The rest are writes. */
  readPercent: number
  /** Random IOPS one disk sustains. */
  perDiskIops: number
  /** Usable capacity of one disk, GiB. */
  perDiskCapacityGb: number
  /** Usable capacity the workload needs today, GiB. */
  requiredCapacityGb: number
  layout: StorageLayout
  /** For `replication`: number of copies. Default 3. */
  replicationFactor?: number
  /** Compound annual data growth, percent. Default 30. */
  growthPercentPerYear?: number
}

export interface StorageIopsSizerResult {
  penalty: number
  frontEndReadIops: number
  frontEndWriteIops: number
  /** readIOPS + writeIOPS × penalty. */
  backEndIops: number
  disksForIops: number
  disksForCapacity: number
  layoutMinimumDisks: number
  /** max of the three, the answer. */
  disksNeeded: number
  usableIops: number
  usableCapacityGb: number
  /** Usable fraction of raw capacity for this layout at `disksNeeded`. */
  usableCapacityFraction: number
  /** Years until compound growth exceeds `usableCapacityGb`. Infinity if it never does. */
  runwayYears: number
  summaryText: string
}

function capacityDiskCount(usableGb: number, perDiskGb: number, layout: StorageLayout, rf: number): number {
  const dataDisks = Math.ceil(usableGb / perDiskGb)
  switch (layout) {
    case 'raid0':
      return dataDisks
    case 'raid1':
    case 'raid10':
      return dataDisks * 2
    case 'raid5':
      return dataDisks + 1
    case 'raid6':
      return dataDisks + 2
    case 'replication':
      return Math.ceil((usableGb * Math.max(1, rf)) / perDiskGb)
  }
}

function usableFraction(disks: number, layout: StorageLayout, rf: number): number {
  switch (layout) {
    case 'raid0':
      return 1
    case 'raid1':
    case 'raid10':
      return 0.5
    case 'raid5':
      return (disks - 1) / disks
    case 'raid6':
      return (disks - 2) / disks
    case 'replication':
      return 1 / Math.max(1, rf)
  }
}

const LAYOUT_MIN: Record<StorageLayout, number> = {
  raid0: 1,
  raid1: 2,
  raid5: 3,
  raid6: 4,
  raid10: 4,
  replication: 1,
}

export class StorageIopsSizer implements IToolUseCase<StorageIopsSizerInput, StorageIopsSizerResult> {
  execute(input: StorageIopsSizerInput): StorageIopsSizerResult {
    const rf = input.replicationFactor ?? 3
    const growth = (input.growthPercentPerYear ?? 30) / 100

    if (input.targetIops <= 0) throw new Error('targetIops must be positive')
    if (input.readPercent < 0 || input.readPercent > 100) throw new Error('readPercent must be in [0, 100]')
    if (input.perDiskIops <= 0) throw new Error('perDiskIops must be positive')
    if (input.perDiskCapacityGb <= 0) throw new Error('perDiskCapacityGb must be positive')
    if (input.requiredCapacityGb <= 0) throw new Error('requiredCapacityGb must be positive')
    if (input.layout === 'replication' && (!Number.isInteger(rf) || rf < 1))
      throw new Error('replicationFactor must be an integer ≥ 1')

    const penalty = writePenalty(input.layout, rf)
    const frontEndReadIops = input.targetIops * (input.readPercent / 100)
    const frontEndWriteIops = input.targetIops - frontEndReadIops
    const backEndIops = frontEndReadIops + frontEndWriteIops * penalty

    const disksForIops = Math.ceil(backEndIops / input.perDiskIops)
    const disksForCapacity = capacityDiskCount(input.requiredCapacityGb, input.perDiskCapacityGb, input.layout, rf)
    const layoutMinimumDisks = input.layout === 'raid10' ? 4 : LAYOUT_MIN[input.layout]

    let disksNeeded = Math.max(disksForIops, disksForCapacity, layoutMinimumDisks)
    // RAID 10 needs an even disk count.
    if (input.layout === 'raid10' && disksNeeded % 2 === 1) disksNeeded += 1

    const usableCapacityFraction = usableFraction(disksNeeded, input.layout, rf)
    const usableCapacityGb = disksNeeded * input.perDiskCapacityGb * usableCapacityFraction

    // Usable random-write IOPS the array can sustain (the pessimistic view —
    // an all-write workload). Reads see closer to raw n × per-disk.
    const usableIops = (disksNeeded * input.perDiskIops) / penalty

    let runwayYears = Infinity
    if (growth > 0) {
      runwayYears = Math.log(usableCapacityGb / input.requiredCapacityGb) / Math.log(1 + growth)
      if (!Number.isFinite(runwayYears) || runwayYears < 0) runwayYears = 0
    }

    return {
      penalty,
      frontEndReadIops,
      frontEndWriteIops,
      backEndIops,
      disksForIops,
      disksForCapacity,
      layoutMinimumDisks,
      disksNeeded,
      usableIops,
      usableCapacityGb,
      usableCapacityFraction,
      runwayYears,
      summaryText: renderSummary(input, {
        penalty,
        backEndIops,
        disksForIops,
        disksForCapacity,
        disksNeeded,
        usableCapacityGb,
        usableIops,
        runwayYears,
      }),
    }
  }
}

function fmtGb(gb: number): string {
  return gb >= 1024 ? `${(gb / 1024).toFixed(1)} TiB` : `${Math.round(gb)} GiB`
}

function renderSummary(
  input: StorageIopsSizerInput,
  r: {
    penalty: number
    backEndIops: number
    disksForIops: number
    disksForCapacity: number
    disksNeeded: number
    usableCapacityGb: number
    usableIops: number
    runwayYears: number
  },
): string {
  return [
    `Layout: ${STORAGE_LAYOUT_LABELS[input.layout]} — write penalty ×${r.penalty}`,
    `Front-end ${Math.round(input.targetIops)} IOPS (${input.readPercent}% read) → back-end ${Math.round(r.backEndIops)} IOPS`,
    '',
    `Disks for IOPS:     ${r.disksForIops}`,
    `Disks for capacity: ${r.disksForCapacity}`,
    `Disks needed:       ${r.disksNeeded}`,
    '',
    `Usable capacity: ${fmtGb(r.usableCapacityGb)} (need ${fmtGb(input.requiredCapacityGb)})`,
    `Usable write IOPS: ${Math.round(r.usableIops)}`,
    Number.isFinite(r.runwayYears)
      ? `Growth runway at ${input.growthPercentPerYear ?? 30}%/yr: ${r.runwayYears.toFixed(1)} years`
      : 'Growth runway: no growth entered',
  ].join('\n')
}
