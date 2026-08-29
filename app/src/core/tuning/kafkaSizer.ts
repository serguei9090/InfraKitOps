import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * Kafka Sizer — pure math, no I/O, no React.
 *
 *   storage   = ingress · retention · replicationFactor
 *   egress    = replication egress (ingress · (RF−1))  +  consumer egress
 *               (ingress · consumerGroups)
 *   partitions ≥ ceil(ingress / per-partition throughput ceiling), and at
 *               least the largest consumer group you want to run
 *   brokers   = max of the storage bound, the network bound and the
 *               partitions-per-broker bound, and never below RF
 *
 * Per-partition throughput is deliberately conservative (10 MB/s) — real
 * ceilings depend on message size, batching, `acks`, and disk. Treat the
 * output as a floor and load-test.
 */

export interface KafkaSizerInput {
  /** Producer write throughput into the topic(s), MB/s (as stored — post-compression if you compress). */
  ingressMbPerSec: number
  /** Average message size, bytes. Informational; drives the small-message partition warning. */
  avgMessageSizeBytes: number
  /** Replicas per partition. Default 3. */
  replicationFactor?: number
  /** Log retention, hours. Default 168 (7 days). */
  retentionHours?: number
  /** Independent consumer groups; each reads the whole stream once. Default 1. */
  consumerGroups?: number
  /** Largest number of consumers you want to run in one group (= min partitions for that parallelism). Default 1. */
  maxConsumersPerGroup?: number
  /** Sustained per-partition write throughput ceiling, MB/s. Default 10. */
  partitionThroughputMbPerSec?: number
  /** Soft cap on replica partitions per broker. Default 4000. */
  maxPartitionsPerBroker?: number
  /** Usable disk per broker, TiB. Default 4. */
  diskPerBrokerTiB?: number
  /** Fraction of broker disk to actually fill. Default 0.7. */
  diskTargetFraction?: number
  /** Broker NIC, Gbit/s. Default 10. */
  networkPerBrokerGbps?: number
  /** Fraction of NIC usable for Kafka. Default 0.8. */
  networkTargetFraction?: number
}

export interface KafkaSizerResult {
  replicationFactor: number
  totalStorageTiB: number
  replicationEgressMbPerSec: number
  consumerEgressMbPerSec: number
  /** Write + replication egress + consumer egress that the cluster's NICs must carry. */
  totalClusterThroughputMbPerSec: number

  partitionsByIngress: number
  partitionsByConsumers: number
  recommendedPartitions: number

  brokersByStorage: number
  brokersByNetwork: number
  brokersByPartitionCap: number
  recommendedBrokers: number

  perBrokerStorageTiB: number
  perBrokerThroughputMbPerSec: number
  perBrokerReplicaPartitions: number

  retentionMs: number
  warnings: string[]
  configText: string
}

export class KafkaSizer implements IToolUseCase<KafkaSizerInput, KafkaSizerResult> {
  execute(input: KafkaSizerInput): KafkaSizerResult {
    const rf = input.replicationFactor ?? 3
    const retentionHours = input.retentionHours ?? 168
    const consumerGroups = input.consumerGroups ?? 1
    const maxConsumers = input.maxConsumersPerGroup ?? 1
    const partThroughput = input.partitionThroughputMbPerSec ?? 10
    const maxPartsPerBroker = input.maxPartitionsPerBroker ?? 4000
    const diskPerBrokerTiB = input.diskPerBrokerTiB ?? 4
    const diskTarget = input.diskTargetFraction ?? 0.7
    const nicGbps = input.networkPerBrokerGbps ?? 10
    const nicTarget = input.networkTargetFraction ?? 0.8

    if (input.ingressMbPerSec <= 0) throw new Error('ingressMbPerSec must be positive')
    if (input.avgMessageSizeBytes <= 0) throw new Error('avgMessageSizeBytes must be positive')
    if (!Number.isInteger(rf) || rf < 1) throw new Error('replicationFactor must be an integer ≥ 1')
    if (retentionHours <= 0) throw new Error('retentionHours must be positive')
    if (!Number.isInteger(consumerGroups) || consumerGroups < 0) throw new Error('consumerGroups must be an integer ≥ 0')
    if (partThroughput <= 0) throw new Error('partitionThroughputMbPerSec must be positive')
    if (diskPerBrokerTiB <= 0) throw new Error('diskPerBrokerTiB must be positive')

    const warnings: string[] = []

    // --- storage -----------------------------------------------------
    const bytesPerSecStored = input.ingressMbPerSec * 1024 * 1024
    const totalStorageBytes = bytesPerSecStored * 3600 * retentionHours * rf
    const totalStorageTiB = totalStorageBytes / 1024 ** 4

    // --- egress ----------------------------------------------------
    const replicationEgressMbPerSec = input.ingressMbPerSec * (rf - 1)
    const consumerEgressMbPerSec = input.ingressMbPerSec * consumerGroups
    // The cluster carries: writes in, replication both ways, consumer reads out.
    const totalClusterThroughputMbPerSec =
      input.ingressMbPerSec + replicationEgressMbPerSec + consumerEgressMbPerSec

    // --- partitions ------------------------------------------------
    const partitionsByIngress = Math.ceil(input.ingressMbPerSec / partThroughput)
    const partitionsByConsumers = Math.max(1, maxConsumers)
    const recommendedPartitions = Math.max(partitionsByIngress, partitionsByConsumers, 6)

    if (input.avgMessageSizeBytes < 100) {
      warnings.push(
        `Tiny messages (${input.avgMessageSizeBytes} B) — throughput is usually record-rate-bound, not MB/s-bound. Batch on the producer (linger.ms, batch.size) or the partition/broker counts here will be optimistic.`,
      )
    }

    // --- brokers -------------------------------------------------
    const usableDiskPerBrokerTiB = diskPerBrokerTiB * diskTarget
    const brokersByStorage = Math.ceil(totalStorageTiB / usableDiskPerBrokerTiB)

    const perBrokerNetMbPerSec = ((nicGbps * 1000) / 8) * nicTarget
    const brokersByNetwork = Math.ceil(totalClusterThroughputMbPerSec / perBrokerNetMbPerSec)

    const totalReplicaPartitions = recommendedPartitions * rf
    const brokersByPartitionCap = Math.ceil(totalReplicaPartitions / maxPartsPerBroker)

    const recommendedBrokers = Math.max(
      rf,
      brokersByStorage,
      brokersByNetwork,
      brokersByPartitionCap,
      3,
    )

    const perBrokerStorageTiB = totalStorageTiB / recommendedBrokers
    const perBrokerThroughputMbPerSec = totalClusterThroughputMbPerSec / recommendedBrokers
    const perBrokerReplicaPartitions = Math.ceil(totalReplicaPartitions / recommendedBrokers)

    if (rf < 3) warnings.push('replicationFactor < 3 — a single broker failure risks data loss and blocks producers with acks=all.')
    if (recommendedPartitions >= recommendedBrokers && recommendedPartitions % recommendedBrokers !== 0) {
      warnings.push(
        `Partition count ${recommendedPartitions} is not a multiple of broker count ${recommendedBrokers} — leaders will be unevenly spread. Round up to ${Math.ceil(recommendedPartitions / recommendedBrokers) * recommendedBrokers}.`,
      )
    }
    if (recommendedPartitions < recommendedBrokers) {
      warnings.push(
        `Only ${recommendedPartitions} partitions across ${recommendedBrokers} brokers — ${recommendedBrokers - recommendedPartitions} brokers hold no leader for this topic. Storage or network is the binding constraint; consider fewer, larger brokers or more topics.`,
      )
    }

    return {
      replicationFactor: rf,
      totalStorageTiB,
      replicationEgressMbPerSec,
      consumerEgressMbPerSec,
      totalClusterThroughputMbPerSec,
      partitionsByIngress,
      partitionsByConsumers,
      recommendedPartitions,
      brokersByStorage,
      brokersByNetwork,
      brokersByPartitionCap,
      recommendedBrokers,
      perBrokerStorageTiB,
      perBrokerThroughputMbPerSec,
      perBrokerReplicaPartitions,
      retentionMs: retentionHours * 3600 * 1000,
      warnings,
      configText: renderConfig({
        rf,
        recommendedPartitions,
        retentionMs: retentionHours * 3600 * 1000,
        recommendedBrokers,
      }),
    }
  }
}

function renderConfig(ctx: {
  rf: number
  recommendedPartitions: number
  retentionMs: number
  recommendedBrokers: number
}): string {
  return [
    '# Topic — generated by InfraKit Studio. Floor values; load-test.',
    `kafka-topics.sh --create --topic my-topic \\`,
    `  --partitions ${ctx.recommendedPartitions} \\`,
    `  --replication-factor ${ctx.rf} \\`,
    `  --config retention.ms=${ctx.retentionMs} \\`,
    `  --config min.insync.replicas=${Math.max(1, ctx.rf - 1)} \\`,
    `  --config compression.type=producer`,
    '',
    `# Cluster: ${ctx.recommendedBrokers} brokers, RF ${ctx.rf}.`,
    `# Producer: acks=all, enable.idempotence=true, linger.ms=10, batch.size=131072`,
  ].join('\n')
}
