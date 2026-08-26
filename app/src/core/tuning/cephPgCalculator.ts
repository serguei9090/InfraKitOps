import type { IToolUseCase } from '../ports/IToolUseCase'

export interface CephPgInput {
  osdCount: number
  poolCount: number
  targetPgsPerOsd: number
  replicationFactor: number
}

export interface CephPgResult {
  /** (OSD count * target PGs per OSD) / replication factor / pool count. */
  rawPgCount: number
  /** Rounded up to the nearest power of 2, per Ceph best practice. */
  roundedPgCount: number
}

/**
 * Ceph Placement Group calculator: power-of-2 rounding per Ceph's official
 * PG-count formula. Pure math, zero I/O, zero React — lives in the core so
 * it is unit-testable in milliseconds and reusable by any UI adapter.
 */
export class CephPgCalculator implements IToolUseCase<CephPgInput, CephPgResult> {
  execute(input: CephPgInput): CephPgResult {
    if (input.osdCount <= 0 || input.poolCount <= 0 || input.replicationFactor <= 0) {
      throw new Error('osdCount, poolCount and replicationFactor must be positive')
    }

    const raw =
      (input.osdCount * input.targetPgsPerOsd) / input.replicationFactor / input.poolCount

    const rounded = nextPowerOfTwo(raw)

    return { rawPgCount: raw, roundedPgCount: rounded }
  }
}

function nextPowerOfTwo(value: number): number {
  if (value <= 1) return 1
  return 2 ** Math.ceil(Math.log2(value))
}
