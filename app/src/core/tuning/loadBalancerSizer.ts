import type { IToolUseCase } from '../ports/IToolUseCase'
import { analyzeQueue, littlesLaw, serversForUtilization } from './queueing'

/**
 * Load Balancer & App Tier Sizer — pure math, no I/O, no React.
 *
 * Given the peak request rate, the average response time, and the shape of
 * one app instance (RAM, cores, worker model), works out:
 *  - the concurrency the tier has to sustain (Little's Law: `L = λ · W`),
 *  - how many worker processes/threads that needs at a target utilisation
 *    (M/M/c — see `queueing.ts`),
 *  - how many workers one instance can hold (the smaller of a RAM bound and
 *    a CPU/worker-model bound),
 *  - the instance count, plus N+1 / N+2 spares,
 *  - starting nginx / HAProxy connection-tuning values.
 *
 * Worker-per-core heuristics:
 *  - **process** (gunicorn sync, uWSGI, php-fpm static): `2·cores + 1` — the
 *    long-standing gunicorn recommendation; a spare worker covers a blocked
 *    one.
 *  - **thread** (gunicorn gthread, Tomcat, Puma): Brian Goetz's pool formula
 *    `cores · (1 + wait/compute)` where `wait/compute` is the ratio of time a
 *    request spends blocked on I/O to time on CPU.
 *  - **async** (asyncio, Node, Go, gunicorn+uvicorn): one worker per core;
 *    each worker multiplexes many in-flight requests on one event loop, so
 *    the RAM bound and the queue math, not a worker count, are the limit.
 *
 * These are starting points for capacity planning, not a substitute for a
 * load test against the real workload.
 */

export type WorkerModel = 'process' | 'thread' | 'async'
export type LbOutputFormat = 'nginx' | 'haproxy'

export const WORKER_MODEL_LABELS: Record<WorkerModel, string> = {
  process: 'Process (gunicorn sync, uWSGI, php-fpm)',
  thread: 'Thread (gunicorn gthread, Tomcat, Puma)',
  async: 'Async (asyncio, Node.js, Go)',
}

export type Headroom = 'none' | 'n+1' | 'n+2'

export interface LoadBalancerSizerInput {
  /** Peak sustained request rate the tier must serve, requests per second. */
  peakRps: number
  /** Average server-side response time, milliseconds (the service time W). */
  avgResponseMs: number
  /** RAM on one app instance, gibibytes. */
  instanceRamGb: number
  /** vCPU / cores on one app instance. */
  instanceCpuCores: number
  /** RAM one worker process/thread needs resident, mebibytes. */
  perWorkerRamMb: number
  /** RAM to leave for the OS + agents on each instance, mebibytes. Default 512. */
  osReserveMb?: number
  /** Concurrency model of the app server. */
  workerModel: WorkerModel
  /**
   * For `thread` model only: ratio of time a request spends waiting on I/O
   * to time it spends on CPU. 0 = pure CPU, 4 = spends 80% of its time
   * blocked. Default 1. Ignored for the other models.
   */
  waitToComputeRatio?: number
  /** Target worker-pool utilisation, 0 < ρ ≤ 0.95. Default 0.7. */
  targetUtilization?: number
  /** Spare instances for availability. */
  headroom?: Headroom
  /** Which reverse proxy the generated snippet targets. */
  outputFormat?: LbOutputFormat
  /** Upstream/backend name in the generated config. Default `app`. */
  upstreamName?: string
}

export interface LoadBalancerSizerResult {
  /** L = λ · W — average number of requests in flight across the whole tier. */
  peakConcurrency: number
  /** Worker count for the tier at the target utilisation (M/M/c). */
  workersNeeded: number
  /** ρ at `workersNeeded`. */
  utilizationAtTarget: number
  /** Erlang-C probability a request has to queue at `workersNeeded`. */
  probabilityQueued: number
  /** Workers one instance can run — the binding constraint. */
  workersPerInstance: number
  /** 'ram' or 'cpu' — which bound set `workersPerInstance`. */
  bindingConstraint: 'ram' | 'cpu'
  ramBoundWorkers: number
  cpuBoundWorkers: number
  /** Instances to hold `workersNeeded` workers, before spares. */
  instancesNeeded: number
  /** Instances including the N+1 / N+2 spares. */
  instancesWithHeadroom: number
  /** Requests/sec the tier can serve at `instancesWithHeadroom` before ρ hits 1. */
  effectiveCapacityRps: number
  /** Per-instance nginx `worker_connections` starting value. */
  nginxWorkerConnections: number
  /** Global connection ceiling for the generated config. */
  maxConnections: number
  /** Ready-to-paste reverse-proxy snippet. */
  configText: string
}

function workersPerCore(input: LoadBalancerSizerInput): number {
  switch (input.workerModel) {
    case 'process':
      return 2 + 1 / Math.max(1, input.instanceCpuCores) // → 2·cores + 1 when multiplied out
    case 'thread':
      return 1 + Math.max(0, input.waitToComputeRatio ?? 1)
    case 'async':
      return 1
  }
}

export class LoadBalancerSizer implements IToolUseCase<LoadBalancerSizerInput, LoadBalancerSizerResult> {
  execute(input: LoadBalancerSizerInput): LoadBalancerSizerResult {
    const osReserveMb = input.osReserveMb ?? 512
    const targetUtilization = input.targetUtilization ?? 0.7
    const headroom = input.headroom ?? 'n+1'
    const outputFormat = input.outputFormat ?? 'nginx'
    const upstreamName = (input.upstreamName ?? 'app').trim() || 'app'

    if (input.peakRps <= 0) throw new Error('peakRps must be positive')
    if (input.avgResponseMs <= 0) throw new Error('avgResponseMs must be positive')
    if (input.instanceRamGb <= 0) throw new Error('instanceRamGb must be positive')
    if (!Number.isInteger(input.instanceCpuCores) || input.instanceCpuCores < 1)
      throw new Error('instanceCpuCores must be an integer ≥ 1')
    if (input.perWorkerRamMb <= 0) throw new Error('perWorkerRamMb must be positive')
    if (targetUtilization <= 0 || targetUtilization > 0.95)
      throw new Error('targetUtilization must be in (0, 0.95]')

    const serviceTimeSec = input.avgResponseMs / 1000

    // --- concurrency + worker count for the whole tier -------------------
    const workersNeeded = serversForUtilization(input.peakRps, serviceTimeSec, targetUtilization)
    const atTarget = analyzeQueue({
      arrivalRate: input.peakRps,
      serviceTimeSec,
      servers: workersNeeded,
    })
    const peakConcurrency = littlesLaw(input.peakRps, atTarget.avgResponseSec)

    // --- how many workers fit on one instance --------------------------
    const usableRamMb = input.instanceRamGb * 1024 - osReserveMb
    const ramBoundWorkers = Math.max(0, Math.floor(usableRamMb / input.perWorkerRamMb))
    const cpuBoundWorkers = Math.max(1, Math.round(input.instanceCpuCores * workersPerCore(input)))
    if (ramBoundWorkers < 1) {
      throw new Error(
        `An instance with ${input.instanceRamGb} GiB RAM cannot hold even one ${input.perWorkerRamMb} MiB worker after the ${osReserveMb} MiB OS reserve.`,
      )
    }
    const workersPerInstance = Math.min(ramBoundWorkers, cpuBoundWorkers)
    const bindingConstraint: 'ram' | 'cpu' = ramBoundWorkers <= cpuBoundWorkers ? 'ram' : 'cpu'

    // --- instance count + spares --------------------------------------
    const instancesNeeded = Math.max(1, Math.ceil(workersNeeded / workersPerInstance))
    const spare = headroom === 'n+1' ? 1 : headroom === 'n+2' ? 2 : 0
    const instancesWithHeadroom = instancesNeeded + spare

    // Capacity at the final instance count: ρ = 1 when λ = c / serviceTime.
    const totalWorkersDeployed = instancesWithHeadroom * workersPerInstance
    const effectiveCapacityRps = totalWorkersDeployed / serviceTimeSec

    // --- connection tuning -------------------------------------------
    // Peak concurrent connections per instance ≈ in-flight requests it holds
    // + a keepalive allowance. Round up to a comfortable power-of-two-ish value.
    const perInstanceConcurrency = Math.ceil(peakConcurrency / instancesWithHeadroom)
    const nginxWorkerConnections = clampUp((perInstanceConcurrency + 1) * 4, 1024)
    const maxConnections = nginxWorkerConnections * input.instanceCpuCores

    const configText =
      outputFormat === 'nginx'
        ? renderNginx(input, {
            upstreamName,
            instancesWithHeadroom,
            nginxWorkerConnections,
          })
        : renderHaproxy(input, { upstreamName, instancesWithHeadroom, maxConnections })

    return {
      peakConcurrency,
      workersNeeded,
      utilizationAtTarget: atTarget.utilization,
      probabilityQueued: atTarget.probabilityWait,
      workersPerInstance,
      bindingConstraint,
      ramBoundWorkers,
      cpuBoundWorkers,
      instancesNeeded,
      instancesWithHeadroom,
      effectiveCapacityRps,
      nginxWorkerConnections,
      maxConnections,
      configText,
    }
  }
}

function clampUp(value: number, min: number): number {
  return Math.max(min, Math.ceil(value / 256) * 256)
}

function renderNginx(
  input: LoadBalancerSizerInput,
  ctx: { upstreamName: string; instancesWithHeadroom: number; nginxWorkerConnections: number },
): string {
  const servers = Array.from({ length: ctx.instancesWithHeadroom }, (_, i) => `    server 10.0.1.${i + 10}:8080 max_fails=3 fail_timeout=15s;`)
  return [
    '# nginx — generated by InfraKit Studio. Starting values; load-test before trusting them.',
    'worker_processes auto;',
    `events { worker_connections ${ctx.nginxWorkerConnections}; }   # per worker process`,
    '',
    'http {',
    `  upstream ${ctx.upstreamName} {`,
    '    least_conn;',
    `    keepalive 32;`,
    ...servers,
    '  }',
    '',
    '  server {',
    '    listen 80 backlog=4096;   # also raise net.core.somaxconn to match',
    '    location / {',
    `      proxy_pass http://${ctx.upstreamName};`,
    '      proxy_http_version 1.1;',
    '      proxy_set_header Connection "";',
    '      proxy_set_header Host $host;',
    '      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    `      proxy_read_timeout ${Math.max(5, Math.ceil((input.avgResponseMs / 1000) * 10))}s;`,
    '    }',
    '  }',
    '}',
  ].join('\n')
}

function renderHaproxy(
  input: LoadBalancerSizerInput,
  ctx: { upstreamName: string; instancesWithHeadroom: number; maxConnections: number },
): string {
  const servers = Array.from(
    { length: ctx.instancesWithHeadroom },
    (_, i) => `    server app${i + 1} 10.0.1.${i + 10}:8080 check maxconn ${Math.ceil(ctx.maxConnections / ctx.instancesWithHeadroom)}`,
  )
  return [
    '# haproxy.cfg — generated by InfraKit Studio. Starting values; load-test first.',
    'global',
    `    maxconn ${ctx.maxConnections}`,
    '',
    'defaults',
    '    mode http',
    '    option http-keep-alive',
    `    timeout connect 5s`,
    `    timeout client  ${Math.max(10, Math.ceil((input.avgResponseMs / 1000) * 10))}s`,
    `    timeout server  ${Math.max(10, Math.ceil((input.avgResponseMs / 1000) * 10))}s`,
    '',
    `backend ${ctx.upstreamName}`,
    '    balance leastconn',
    ...servers,
  ].join('\n')
}
