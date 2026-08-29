import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * Kubernetes Node & Pod Capacity — pure math, no I/O, no React.
 *
 * Turns "these pods, this node type" into a node count, and "this node type"
 * into pods-per-node, accounting for the slices of a node that never run
 * your workload:
 *
 *   allocatable = capacity − kube-reserved − system-reserved − eviction-threshold
 *   usable      = allocatable − DaemonSet requests (per node)
 *   schedulable = usable × targetUtilization        (leave bin-packing slack)
 *
 * pods/node is the smallest of the CPU bound, the RAM bound, and the
 * kubelet `--max-pods` cap. nodes = ceil(replicas / pods-per-node), then
 * rounded up to a multiple of the AZ count so zones stay balanced.
 *
 * `defaultReservations` reproduces GKE's published reserve formula, which
 * most managed platforms follow closely:
 *   CPU  — 6% of core 1, 1% of core 2, 0.5% of cores 3-4, 0.25% of the rest
 *   RAM  — 25% of the first 4 GiB, 20% of the next 4, 10% of the next 8,
 *          6% of the next 112, 2% of anything above 128 GiB
 *   plus a 100 MiB hard eviction threshold.
 *
 * Everything here is a planning estimate — real schedulability depends on
 * affinity rules, topology spread, PodDisruptionBudgets and actual usage
 * vs requests.
 */

export interface NodeReservations {
  kubeReservedCpuMillis: number
  systemReservedCpuMillis: number
  kubeReservedRamMb: number
  systemReservedRamMb: number
  evictionThresholdRamMb: number
}

/** GKE-style reserved CPU (millicores) for a node with `cores` vCPU. */
export function defaultReservedCpuMillis(cores: number): number {
  let m = 0
  const bands: [number, number][] = [
    [1, 0.06],
    [1, 0.01],
    [2, 0.005],
  ]
  let remaining = cores
  for (const [width, rate] of bands) {
    const take = Math.min(width, remaining)
    if (take <= 0) break
    m += take * 1000 * rate
    remaining -= take
  }
  if (remaining > 0) m += remaining * 1000 * 0.0025
  return Math.round(m)
}

/** GKE-style reserved memory (MiB) for a node with `ramGb` GiB. */
export function defaultReservedRamMb(ramGb: number): number {
  const ramMb = ramGb * 1024
  const bands: [number, number][] = [
    [4 * 1024, 0.25],
    [4 * 1024, 0.2],
    [8 * 1024, 0.1],
    [112 * 1024, 0.06],
  ]
  let m = 0
  let remaining = ramMb
  for (const [width, rate] of bands) {
    const take = Math.min(width, remaining)
    if (take <= 0) break
    m += take * rate
    remaining -= take
  }
  if (remaining > 0) m += remaining * 0.02
  return Math.round(m)
}

export function defaultReservations(cores: number, ramGb: number): NodeReservations {
  return {
    // GKE lumps everything into kube-reserved; split is cosmetic here.
    kubeReservedCpuMillis: defaultReservedCpuMillis(cores),
    systemReservedCpuMillis: 0,
    kubeReservedRamMb: defaultReservedRamMb(ramGb),
    systemReservedRamMb: 0,
    evictionThresholdRamMb: 100,
  }
}

export interface K8sCapacitySizerInput {
  /** Node vCPU. */
  nodeCpuCores: number
  /** Node RAM, GiB. */
  nodeRamGb: number
  /** Per-node reserved slices. Omit any field to take the GKE-style default for the node size. */
  reservations?: Partial<NodeReservations>
  /** kubelet --max-pods. Default 110. */
  maxPodsPerNode?: number
  /** CPU (millicores) DaemonSets request on every node (CNI, logging, node-exporter, …). Default 400. */
  daemonSetCpuMillis?: number
  /** Memory (MiB) DaemonSets request on every node. Default 512. */
  daemonSetRamMb?: number
  /** Number of DaemonSet pods per node (count against --max-pods). Default 6. */
  daemonSetPods?: number
  /** Workload: one deployment. */
  podCpuRequestMillis: number
  podRamRequestMb: number
  replicas: number
  /** Fraction of usable capacity to actually fill, leaving bin-packing slack. Default 0.8. */
  targetUtilization?: number
  /** Availability zones to spread across. Default 3. */
  azCount?: number
  /** Namespace for the generated ResourceQuota. Default `team-a`. */
  namespace?: string
}

export interface K8sCapacitySizerResult {
  allocatableCpuMillis: number
  allocatableRamMb: number
  usableCpuMillis: number
  usableRamMb: number
  /** Pods of the given shape that fit on one node. */
  podsPerNode: number
  /** 'cpu' | 'ram' | 'maxPods' — what capped `podsPerNode`. */
  bindingConstraint: 'cpu' | 'ram' | 'maxPods'
  cpuBoundPods: number
  ramBoundPods: number
  /** Nodes for `replicas`, before AZ rounding. */
  nodesNeeded: number
  /** Nodes after rounding up to a multiple of azCount. */
  nodesBalanced: number
  nodesPerAz: number
  /** Can the workload still be scheduled if one AZ is lost? */
  survivesOneAzLoss: boolean
  /** Effective request utilisation of allocatable capacity at `nodesBalanced`. */
  cpuPackingEfficiency: number
  ramPackingEfficiency: number
  reservations: NodeReservations
  configText: string
}

export class K8sCapacitySizer implements IToolUseCase<K8sCapacitySizerInput, K8sCapacitySizerResult> {
  execute(input: K8sCapacitySizerInput): K8sCapacitySizerResult {
    const maxPods = input.maxPodsPerNode ?? 110
    const dsCpu = input.daemonSetCpuMillis ?? 400
    const dsRam = input.daemonSetRamMb ?? 512
    const dsPods = input.daemonSetPods ?? 6
    const targetUtilization = input.targetUtilization ?? 0.8
    const azCount = input.azCount ?? 3
    const namespace = (input.namespace ?? 'team-a').trim() || 'team-a'

    if (input.nodeCpuCores <= 0) throw new Error('nodeCpuCores must be positive')
    if (input.nodeRamGb <= 0) throw new Error('nodeRamGb must be positive')
    if (input.podCpuRequestMillis <= 0) throw new Error('podCpuRequestMillis must be positive')
    if (input.podRamRequestMb <= 0) throw new Error('podRamRequestMb must be positive')
    if (!Number.isInteger(input.replicas) || input.replicas < 1)
      throw new Error('replicas must be an integer ≥ 1')
    if (targetUtilization <= 0 || targetUtilization > 1) throw new Error('targetUtilization must be in (0, 1]')
    if (!Number.isInteger(azCount) || azCount < 1) throw new Error('azCount must be an integer ≥ 1')

    const d = defaultReservations(input.nodeCpuCores, input.nodeRamGb)
    const reservations: NodeReservations = {
      kubeReservedCpuMillis: input.reservations?.kubeReservedCpuMillis ?? d.kubeReservedCpuMillis,
      systemReservedCpuMillis: input.reservations?.systemReservedCpuMillis ?? d.systemReservedCpuMillis,
      kubeReservedRamMb: input.reservations?.kubeReservedRamMb ?? d.kubeReservedRamMb,
      systemReservedRamMb: input.reservations?.systemReservedRamMb ?? d.systemReservedRamMb,
      evictionThresholdRamMb: input.reservations?.evictionThresholdRamMb ?? d.evictionThresholdRamMb,
    }

    const capacityCpu = input.nodeCpuCores * 1000
    const capacityRam = input.nodeRamGb * 1024

    const allocatableCpuMillis =
      capacityCpu - reservations.kubeReservedCpuMillis - reservations.systemReservedCpuMillis
    const allocatableRamMb =
      capacityRam -
      reservations.kubeReservedRamMb -
      reservations.systemReservedRamMb -
      reservations.evictionThresholdRamMb

    const usableCpuMillis = allocatableCpuMillis - dsCpu
    const usableRamMb = allocatableRamMb - dsRam
    if (usableCpuMillis <= 0 || usableRamMb <= 0) {
      throw new Error('After reservations and DaemonSets this node has no capacity left for workload pods.')
    }

    const schedulableCpu = usableCpuMillis * targetUtilization
    const schedulableRam = usableRamMb * targetUtilization

    const cpuBoundPods = Math.floor(schedulableCpu / input.podCpuRequestMillis)
    const ramBoundPods = Math.floor(schedulableRam / input.podRamRequestMb)
    const maxPodsBound = Math.max(0, maxPods - dsPods)
    const podsPerNode = Math.min(cpuBoundPods, ramBoundPods, maxPodsBound)
    if (podsPerNode < 1) {
      throw new Error(
        'Not even one workload pod fits on this node after reservations, DaemonSets and the utilisation target.',
      )
    }
    const bindingConstraint: 'cpu' | 'ram' | 'maxPods' =
      podsPerNode === cpuBoundPods ? 'cpu' : podsPerNode === ramBoundPods ? 'ram' : 'maxPods'

    const nodesNeeded = Math.ceil(input.replicas / podsPerNode)
    const nodesBalanced = Math.ceil(nodesNeeded / azCount) * azCount
    const nodesPerAz = nodesBalanced / azCount

    // Losing one AZ leaves (azCount − 1) × nodesPerAz nodes.
    const survivorPods = azCount > 1 ? (azCount - 1) * nodesPerAz * podsPerNode : nodesBalanced * podsPerNode
    const survivesOneAzLoss = survivorPods >= input.replicas

    const totalAllocCpu = nodesBalanced * allocatableCpuMillis
    const totalAllocRam = nodesBalanced * allocatableRamMb
    const requestedCpu = input.replicas * input.podCpuRequestMillis + nodesBalanced * dsCpu
    const requestedRam = input.replicas * input.podRamRequestMb + nodesBalanced * dsRam

    return {
      allocatableCpuMillis,
      allocatableRamMb,
      usableCpuMillis,
      usableRamMb,
      podsPerNode,
      bindingConstraint,
      cpuBoundPods,
      ramBoundPods,
      nodesNeeded,
      nodesBalanced,
      nodesPerAz,
      survivesOneAzLoss,
      cpuPackingEfficiency: (requestedCpu / totalAllocCpu) * 100,
      ramPackingEfficiency: (requestedRam / totalAllocRam) * 100,
      reservations,
      configText: renderQuota(input, namespace, nodesBalanced, podsPerNode),
    }
  }
}

function renderQuota(
  input: K8sCapacitySizerInput,
  namespace: string,
  nodes: number,
  podsPerNode: number,
): string {
  const totalCpu = input.replicas * input.podCpuRequestMillis
  const totalRam = input.replicas * input.podRamRequestMb
  return [
    '# Generated by InfraKit Studio — planning estimate.',
    `# ${input.replicas} pods @ ${input.podCpuRequestMillis}m / ${input.podRamRequestMb}Mi`,
    `# → ${podsPerNode} pods/node → ${nodes} nodes across ${input.azCount ?? 3} AZ(s)`,
    '---',
    'apiVersion: v1',
    'kind: ResourceQuota',
    'metadata:',
    `  name: ${namespace}-quota`,
    `  namespace: ${namespace}`,
    'spec:',
    '  hard:',
    `    requests.cpu: "${Math.ceil((totalCpu * 1.3) / 1000)}"`,
    `    requests.memory: ${Math.ceil((totalRam * 1.3) / 1024)}Gi`,
    `    limits.cpu: "${Math.ceil((totalCpu * 2) / 1000)}"`,
    `    limits.memory: ${Math.ceil((totalRam * 2) / 1024)}Gi`,
    `    pods: "${Math.ceil(input.replicas * 1.5)}"`,
    '---',
    'apiVersion: v1',
    'kind: LimitRange',
    'metadata:',
    `  name: ${namespace}-defaults`,
    `  namespace: ${namespace}`,
    'spec:',
    '  limits:',
    '    - type: Container',
    `      default:        { cpu: ${input.podCpuRequestMillis * 2}m, memory: ${input.podRamRequestMb * 2}Mi }`,
    `      defaultRequest: { cpu: ${input.podCpuRequestMillis}m, memory: ${input.podRamRequestMb}Mi }`,
  ].join('\n')
}
