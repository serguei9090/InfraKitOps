/**
 * Queueing-theory primitives shared by the capacity sizers (Load Balancer &
 * App Tier Sizer, Connection Pool Sizer, …). Pure math, no I/O, no React.
 *
 * Models an M/M/c queue: Poisson arrivals at rate `λ`, exponential service
 * at rate `μ = 1/serviceTime` per server, `c` identical servers, one shared
 * FIFO queue of unbounded length.
 *
 * Formulas
 * --------
 * - **Little's Law**  `L = λ · W`  — the average number in the system equals
 *   the arrival rate times the average time spent in it. Distribution-free;
 *   holds for any stable system.
 * - **Offered load**  `a = λ / μ = λ · serviceTime`  (unit: erlangs).
 * - **Utilisation**  `ρ = a / c`. The queue is stable only while `ρ < 1`.
 * - **Erlang B** (loss probability, used here only as a stable stepping
 *   stone): `B(0,a) = 1`, `B(n,a) = a·B(n-1,a) / (n + a·B(n-1,a))`.
 * - **Erlang C** (probability an arrival has to wait):
 *   `C = c·B / (c − a·(1 − B))`  with `B = B(c, a)`.
 *   The recursive B form avoids the `a^c / c!` overflow the textbook
 *   Erlang-C formula suffers for large `c`.
 * - **Average wait in queue**  `Wq = C / (c·μ − λ)`.
 * - **Average time in system**  `W = Wq + 1/μ`.
 * - **Average queue length**  `Lq = λ · Wq`  (Little's Law applied to the queue).
 *
 * References: Kleinrock, *Queueing Systems Vol. 1*; Erlang's 1917 loss/delay
 * formulae; the recursive Erlang-B recurrence is the standard numerically
 * stable evaluation (see e.g. Zeng, "Three Interpretations of the Erlang B
 * Formula", 2003).
 */

export interface QueueInput {
  /** λ — mean job arrival rate, jobs per second. Must be > 0. */
  arrivalRate: number
  /** Mean service time for one job on one server, in seconds (= 1/μ). Must be > 0. */
  serviceTimeSec: number
  /** c — number of identical servers/workers. Integer ≥ 1. */
  servers: number
}

export interface QueueResult {
  /** a = λ · serviceTime, in erlangs. */
  offeredLoad: number
  /** ρ = a / c. */
  utilization: number
  /** ρ < 1 — an unstable queue grows without bound and the wait metrics are meaningless. */
  stable: boolean
  /** Erlang C: probability an arriving job finds all servers busy and must queue. */
  probabilityWait: number
  /** Wq — mean time a job spends waiting in the queue, seconds. 0 when unstable. */
  avgWaitSec: number
  /** W = Wq + serviceTime — mean total time in the system, seconds. */
  avgResponseSec: number
  /** Lq — mean number of jobs waiting (not yet in service). */
  avgQueueLength: number
  /** L = λ · W — mean number of jobs in the system (waiting + in service). */
  avgConcurrency: number
}

/** Little's Law: mean number in system = arrival rate × mean time in system. */
export function littlesLaw(arrivalRate: number, avgTimeInSystemSec: number): number {
  return arrivalRate * avgTimeInSystemSec
}

/**
 * Erlang B — blocking probability for an M/M/c/c loss system with offered
 * load `a` and `c` servers. Evaluated with the stable recurrence.
 */
export function erlangB(servers: number, offeredLoad: number): number {
  let b = 1
  for (let n = 1; n <= servers; n++) {
    b = (offeredLoad * b) / (n + offeredLoad * b)
  }
  return b
}

/**
 * Erlang C — probability an arriving job must wait in an M/M/c queue with
 * offered load `a` and `c` servers. Returns 1 when the system is unstable
 * (`a ≥ c`): every arrival queues and the queue grows forever.
 */
export function erlangC(servers: number, offeredLoad: number): number {
  if (offeredLoad >= servers) return 1
  const b = erlangB(servers, offeredLoad)
  return (servers * b) / (servers - offeredLoad * (1 - b))
}

/** Full M/M/c analysis. Throws on non-positive inputs. */
export function analyzeQueue(input: QueueInput): QueueResult {
  const { arrivalRate: lambda, serviceTimeSec, servers } = input
  if (lambda <= 0) throw new Error('arrivalRate must be positive')
  if (serviceTimeSec <= 0) throw new Error('serviceTimeSec must be positive')
  if (!Number.isInteger(servers) || servers < 1) throw new Error('servers must be an integer ≥ 1')

  const mu = 1 / serviceTimeSec
  const offeredLoad = lambda / mu
  const utilization = offeredLoad / servers
  const stable = utilization < 1

  if (!stable) {
    return {
      offeredLoad,
      utilization,
      stable: false,
      probabilityWait: 1,
      avgWaitSec: Infinity,
      avgResponseSec: Infinity,
      avgQueueLength: Infinity,
      avgConcurrency: Infinity,
    }
  }

  const pWait = erlangC(servers, offeredLoad)
  const avgWaitSec = pWait / (servers * mu - lambda)
  const avgResponseSec = avgWaitSec + serviceTimeSec
  const avgQueueLength = lambda * avgWaitSec
  const avgConcurrency = lambda * avgResponseSec

  return {
    offeredLoad,
    utilization,
    stable: true,
    probabilityWait: pWait,
    avgWaitSec,
    avgResponseSec,
    avgQueueLength,
    avgConcurrency,
  }
}

/**
 * Smallest server count that keeps utilisation at or below `targetUtilization`
 * (which must be in (0, 1)). This is the capacity-planning floor — it says
 * nothing about latency; pair it with `serversForWaitProbability` when a
 * queue-time target matters.
 */
export function serversForUtilization(
  arrivalRate: number,
  serviceTimeSec: number,
  targetUtilization: number,
): number {
  if (arrivalRate <= 0 || serviceTimeSec <= 0) throw new Error('arrivalRate and serviceTimeSec must be positive')
  if (targetUtilization <= 0 || targetUtilization >= 1) throw new Error('targetUtilization must be in (0, 1)')
  const offeredLoad = arrivalRate * serviceTimeSec
  return Math.max(1, Math.ceil(offeredLoad / targetUtilization))
}

/**
 * Smallest server count for which the Erlang-C wait probability is at or
 * below `maxWaitProbability` (in (0, 1)). Always returns at least enough
 * servers for stability. Capped at a sane upper bound so a pathological
 * input can't spin forever.
 */
export function serversForWaitProbability(
  arrivalRate: number,
  serviceTimeSec: number,
  maxWaitProbability: number,
): number {
  if (arrivalRate <= 0 || serviceTimeSec <= 0) throw new Error('arrivalRate and serviceTimeSec must be positive')
  if (maxWaitProbability <= 0 || maxWaitProbability >= 1) throw new Error('maxWaitProbability must be in (0, 1)')
  const offeredLoad = arrivalRate * serviceTimeSec
  let c = Math.max(1, Math.floor(offeredLoad) + 1)
  const ceiling = c + 100_000
  while (c < ceiling && erlangC(c, offeredLoad) > maxWaitProbability) c++
  return c
}
