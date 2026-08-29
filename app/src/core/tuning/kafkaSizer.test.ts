import { describe, expect, it } from 'vitest'
import { KafkaSizer, type KafkaSizerInput } from './kafkaSizer'

const sizer = new KafkaSizer()

const base: KafkaSizerInput = {
  ingressMbPerSec: 100,
  avgMessageSizeBytes: 1024,
  replicationFactor: 3,
  retentionHours: 168,
  consumerGroups: 3,
  maxConsumersPerGroup: 12,
  partitionThroughputMbPerSec: 10,
  diskPerBrokerTiB: 4,
  networkPerBrokerGbps: 10,
}

describe('KafkaSizer', () => {
  it('storage = ingress · retention · RF', () => {
    const r = sizer.execute(base)
    // 100 MB/s · 3600 · 168 h · 3 = 181,440,000 MB ≈ 173 TiB
    const expectedTiB = (100 * 1024 * 1024 * 3600 * 168 * 3) / 1024 ** 4
    expect(r.totalStorageTiB).toBeCloseTo(expectedTiB, 3)
  })

  it('replication + consumer egress', () => {
    const r = sizer.execute(base)
    expect(r.replicationEgressMbPerSec).toBe(100 * 2) // RF-1
    expect(r.consumerEgressMbPerSec).toBe(100 * 3) // groups
    expect(r.totalClusterThroughputMbPerSec).toBe(100 + 200 + 300)
  })

  it('partitions: max of ingress/throughput, consumer parallelism, and a floor of 6', () => {
    const r = sizer.execute(base)
    expect(r.partitionsByIngress).toBe(10) // 100 / 10
    expect(r.partitionsByConsumers).toBe(12)
    expect(r.recommendedPartitions).toBe(12)
  })

  it('a very high ingress makes ingress the binding partition constraint', () => {
    const r = sizer.execute({ ...base, ingressMbPerSec: 500, maxConsumersPerGroup: 4 })
    expect(r.recommendedPartitions).toBe(50)
  })

  it('brokers = max of storage / network / partition-cap bounds, never below RF or 3', () => {
    const r = sizer.execute(base)
    expect(r.recommendedBrokers).toBe(
      Math.max(3, r.replicationFactor, r.brokersByStorage, r.brokersByNetwork, r.brokersByPartitionCap),
    )
  })

  it('big storage forces more brokers', () => {
    const small = sizer.execute({ ...base, retentionHours: 24 })
    const big = sizer.execute({ ...base, retentionHours: 720 })
    expect(big.recommendedBrokers).toBeGreaterThan(small.recommendedBrokers)
  })

  it('per-broker figures divide the totals', () => {
    const r = sizer.execute(base)
    expect(r.perBrokerStorageTiB).toBeCloseTo(r.totalStorageTiB / r.recommendedBrokers, 6)
    expect(r.perBrokerThroughputMbPerSec).toBeCloseTo(r.totalClusterThroughputMbPerSec / r.recommendedBrokers, 6)
  })

  it('warns about tiny messages', () => {
    const r = sizer.execute({ ...base, avgMessageSizeBytes: 50 })
    expect(r.warnings.join(' ')).toMatch(/tiny messages/i)
  })

  it('warns about RF < 3', () => {
    const r = sizer.execute({ ...base, replicationFactor: 2 })
    expect(r.warnings.join(' ')).toMatch(/replicationFactor < 3/i)
  })

  it('generates a create-topic command with the partition/RF/retention', () => {
    const r = sizer.execute(base)
    expect(r.configText).toContain(`--partitions ${r.recommendedPartitions}`)
    expect(r.configText).toContain('--replication-factor 3')
    expect(r.configText).toContain(`retention.ms=${168 * 3600 * 1000}`)
  })

  it('rejects bad inputs', () => {
    expect(() => sizer.execute({ ...base, ingressMbPerSec: 0 })).toThrow()
    expect(() => sizer.execute({ ...base, replicationFactor: 0 })).toThrow()
    expect(() => sizer.execute({ ...base, retentionHours: -1 })).toThrow()
    expect(() => sizer.execute({ ...base, diskPerBrokerTiB: 0 })).toThrow()
  })
})
