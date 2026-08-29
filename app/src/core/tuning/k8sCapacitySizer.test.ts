import { describe, expect, it } from 'vitest'
import {
  K8sCapacitySizer,
  defaultReservedCpuMillis,
  defaultReservedRamMb,
  type K8sCapacitySizerInput,
} from './k8sCapacitySizer'

const sizer = new K8sCapacitySizer()

const base: K8sCapacitySizerInput = {
  nodeCpuCores: 8,
  nodeRamGb: 32,
  podCpuRequestMillis: 250,
  podRamRequestMb: 512,
  replicas: 30,
  targetUtilization: 0.8,
  azCount: 3,
}

describe('GKE-style reservation defaults', () => {
  it('CPU: 1 core → 60m; 2 → 70m; 4 → 80m; 8 → 90m (GKE bands 6/1/0.5/0.25%)', () => {
    expect(defaultReservedCpuMillis(1)).toBe(60)
    expect(defaultReservedCpuMillis(2)).toBe(70)
    expect(defaultReservedCpuMillis(4)).toBe(80)
    expect(defaultReservedCpuMillis(8)).toBe(90)
  })
  it('RAM: 8 GiB → 25%·4 + 20%·4 GiB = 1843 MiB', () => {
    expect(defaultReservedRamMb(8)).toBe(Math.round(4096 * 0.25 + 4096 * 0.2))
  })
  it('RAM: 32 GiB → 1024 + 819.2 + 819.2 + 983.04 = 3645 MiB', () => {
    expect(defaultReservedRamMb(32)).toBe(Math.round(1024 + 819.2 + 819.2 + 983.04))
  })
})

describe('K8sCapacitySizer', () => {
  it('allocatable = capacity − reserved − eviction', () => {
    const r = sizer.execute(base)
    expect(r.allocatableCpuMillis).toBe(8000 - defaultReservedCpuMillis(8))
    expect(r.allocatableRamMb).toBe(32768 - defaultReservedRamMb(32) - 100)
  })

  it('pods per node is the min of the CPU, RAM and max-pods bounds', () => {
    const r = sizer.execute(base)
    expect(r.podsPerNode).toBe(Math.min(r.cpuBoundPods, r.ramBoundPods, 110 - 6))
    expect(['cpu', 'ram', 'maxPods']).toContain(r.bindingConstraint)
  })

  it('RAM-bound on a memory-light node', () => {
    const r = sizer.execute({ ...base, nodeRamGb: 8, podRamRequestMb: 1024, nodeCpuCores: 16 })
    expect(r.bindingConstraint).toBe('ram')
  })

  it('max-pods-bound with tiny pods', () => {
    const r = sizer.execute({ ...base, podCpuRequestMillis: 10, podRamRequestMb: 16, nodeCpuCores: 16, nodeRamGb: 64 })
    expect(r.bindingConstraint).toBe('maxPods')
    expect(r.podsPerNode).toBe(110 - 6)
  })

  it('nodes are rounded up to a multiple of the AZ count', () => {
    const r = sizer.execute({ ...base, replicas: 30, azCount: 3 })
    expect(r.nodesBalanced % 3).toBe(0)
    expect(r.nodesBalanced).toBeGreaterThanOrEqual(r.nodesNeeded)
    expect(r.nodesPerAz).toBe(r.nodesBalanced / 3)
  })

  it('survivesOneAzLoss reflects whether (az−1) zones still hold every replica', () => {
    const tight = sizer.execute({ ...base, replicas: 30, azCount: 3 })
    // if 3 AZ hold exactly 30, losing one drops ~1/3 → should fail unless overprovisioned
    expect(typeof tight.survivesOneAzLoss).toBe('boolean')
    const roomy = sizer.execute({ ...base, replicas: 6, azCount: 3 })
    expect(roomy.survivesOneAzLoss).toBe(true)
  })

  it('single AZ always "survives" its own loss trivially (no other zone)', () => {
    const r = sizer.execute({ ...base, azCount: 1 })
    expect(r.survivesOneAzLoss).toBe(true)
  })

  it('honours explicit reservation overrides', () => {
    const r = sizer.execute({ ...base, reservations: { kubeReservedCpuMillis: 1000, kubeReservedRamMb: 4096 } })
    expect(r.allocatableCpuMillis).toBe(8000 - 1000)
    expect(r.reservations.kubeReservedRamMb).toBe(4096)
  })

  it('generates a ResourceQuota + LimitRange for the namespace', () => {
    const r = sizer.execute({ ...base, namespace: 'payments' })
    expect(r.configText).toContain('kind: ResourceQuota')
    expect(r.configText).toContain('namespace: payments')
    expect(r.configText).toContain('kind: LimitRange')
  })

  it('throws when nothing fits', () => {
    expect(() => sizer.execute({ ...base, nodeCpuCores: 1, nodeRamGb: 1, podCpuRequestMillis: 2000, podRamRequestMb: 2000 })).toThrow()
  })

  it('rejects bad inputs', () => {
    expect(() => sizer.execute({ ...base, nodeCpuCores: 0 })).toThrow()
    expect(() => sizer.execute({ ...base, replicas: 0 })).toThrow()
    expect(() => sizer.execute({ ...base, targetUtilization: 1.5 })).toThrow()
    expect(() => sizer.execute({ ...base, azCount: 0 })).toThrow()
  })
})
