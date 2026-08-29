import { describe, expect, it } from 'vitest'
import { LoadBalancerSizer, type LoadBalancerSizerInput } from './loadBalancerSizer'

const sizer = new LoadBalancerSizer()

const base: LoadBalancerSizerInput = {
  peakRps: 500,
  avgResponseMs: 120,
  instanceRamGb: 8,
  instanceCpuCores: 4,
  perWorkerRamMb: 256,
  workerModel: 'process',
  targetUtilization: 0.7,
  headroom: 'n+1',
  outputFormat: 'nginx',
}

describe('LoadBalancerSizer', () => {
  it('peak concurrency follows Little’s Law (≈ λ · W, a bit more from queueing)', () => {
    const r = sizer.execute({ ...base })
    // λ·W_service = 500 · 0.12 = 60; total in-system is slightly higher.
    expect(r.peakConcurrency).toBeGreaterThanOrEqual(60)
    expect(r.peakConcurrency).toBeLessThan(75)
  })

  it('workers needed keeps utilisation at or under the target', () => {
    const r = sizer.execute({ ...base })
    expect(r.utilizationAtTarget).toBeLessThanOrEqual(0.7 + 1e-9)
    // one fewer worker would exceed it
    const offered = base.peakRps * (base.avgResponseMs / 1000)
    expect(offered / (r.workersNeeded - 1)).toBeGreaterThan(0.7)
  })

  it('process model → 2·cores + 1 CPU-bound workers', () => {
    const r = sizer.execute({ ...base, instanceCpuCores: 4, workerModel: 'process' })
    expect(r.cpuBoundWorkers).toBe(9)
  })

  it('thread model uses cores · (1 + wait/compute)', () => {
    const r = sizer.execute({ ...base, workerModel: 'thread', waitToComputeRatio: 3, instanceCpuCores: 4 })
    expect(r.cpuBoundWorkers).toBe(16) // 4 · (1 + 3)
  })

  it('async model → one worker per core', () => {
    const r = sizer.execute({ ...base, workerModel: 'async', instanceCpuCores: 6 })
    expect(r.cpuBoundWorkers).toBe(6)
  })

  it('RAM bound wins on a small box', () => {
    const r = sizer.execute({ ...base, instanceRamGb: 2, perWorkerRamMb: 512, instanceCpuCores: 8 })
    // (2048 - 512) / 512 = 3 RAM-bound vs 17 CPU-bound
    expect(r.ramBoundWorkers).toBe(3)
    expect(r.workersPerInstance).toBe(3)
    expect(r.bindingConstraint).toBe('ram')
  })

  it('CPU bound wins on a RAM-rich box', () => {
    const r = sizer.execute({ ...base, instanceRamGb: 64, perWorkerRamMb: 128, instanceCpuCores: 4, workerModel: 'process' })
    expect(r.bindingConstraint).toBe('cpu')
    expect(r.workersPerInstance).toBe(9)
  })

  it('N+1 / N+2 add the right number of spare instances', () => {
    const none = sizer.execute({ ...base, headroom: 'none' })
    const n1 = sizer.execute({ ...base, headroom: 'n+1' })
    const n2 = sizer.execute({ ...base, headroom: 'n+2' })
    expect(n1.instancesWithHeadroom).toBe(none.instancesNeeded + 1)
    expect(n2.instancesWithHeadroom).toBe(none.instancesNeeded + 2)
  })

  it('effective capacity exceeds the peak it was sized for', () => {
    const r = sizer.execute({ ...base })
    expect(r.effectiveCapacityRps).toBeGreaterThan(base.peakRps)
  })

  it('emits an nginx upstream with one server line per instance', () => {
    const r = sizer.execute({ ...base, outputFormat: 'nginx', upstreamName: 'web' })
    expect(r.configText).toContain('upstream web {')
    expect(r.configText).toContain('worker_processes auto;')
    expect((r.configText.match(/server 10\.0\.1\./g) ?? []).length).toBe(r.instancesWithHeadroom)
  })

  it('emits an haproxy backend when asked', () => {
    const r = sizer.execute({ ...base, outputFormat: 'haproxy', upstreamName: 'web' })
    expect(r.configText).toContain('backend web')
    expect(r.configText).toContain(`maxconn ${r.maxConnections}`)
  })

  it('rejects an instance too small for one worker', () => {
    expect(() => sizer.execute({ ...base, instanceRamGb: 1, perWorkerRamMb: 700, osReserveMb: 512 })).toThrow(/cannot hold even one/i)
  })

  it('rejects bad inputs', () => {
    expect(() => sizer.execute({ ...base, peakRps: 0 })).toThrow()
    expect(() => sizer.execute({ ...base, avgResponseMs: -1 })).toThrow()
    expect(() => sizer.execute({ ...base, instanceCpuCores: 0 })).toThrow()
    expect(() => sizer.execute({ ...base, targetUtilization: 1.2 })).toThrow()
  })
})
