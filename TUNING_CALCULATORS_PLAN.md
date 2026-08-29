# Tuning & Performance — SRE / platform calculators (wave 1)

Status: **wave 1 done** (2026-08-29). Branch `tuning-calculators`.

All 7 built and verified — `queueing.ts` primitive + 6 screens (Load
Balancer Sizer, Connection Pool Sizer, K8s Node & Pod Capacity, SLO &
Error Budget, Availability & Redundancy, Storage IOPS & Capacity). New
`Reliability` group in the Tuning & Performance module for the SLO and
Availability tools. `bun run build` clean, 1175 tests, `src/core` React-free.
Shared `adapters/ui/tuning/SizerPanels.tsx` (StatCard / StatGrid /
BreakdownTable / SizerCaveat).

Extends the **Tuning & Performance** module (today: DB RAM Sizer, Zabbix
Monitoring Sizer, Ceph PG, Linux Sysctl, Firewall Command) with the
capacity / reliability math an architect / platform engineer / SRE reaches
for weekly. Same shape as the existing sizers: pure `core/**` math →
computed results + a generated config/rule snippet, on the **T2
`BalancedFlowScaffold`**. Client-only, no backend.

## Wave 1

| # | tool | inputs → output | generates |
|---|---|---|---|
| 0 | **`core/tuning/queueing.ts`** (primitive, no screen) | Little's Law + Erlang-C (M/M/c) | — |
| 1 | **Load Balancer & App Tier Sizer** | peak RPS or concurrent users, avg latency, per-worker RAM, CPU cores/instance, target utilisation, HA (N+1) → app instances, workers/instance, nginx `worker_connections` + backlog, HAProxy `maxconn` | nginx `upstream{}` + tuning, or HAProxy `backend` |
| 2 | **Connection Pool Sizer** | DB `max_connections`, superuser/replication reserve, app instances, threads/instance, pool mode → pool size per instance, fit check, PgBouncer `default_pool_size` | `pgbouncer.ini` block |
| 3 | **Kubernetes Node & Pod Capacity** | per-pod CPU/mem requests, replicas, DaemonSets, system-/kube-reserved, eviction, target util, AZ count → node count, pods/node, headroom, "survives 1 AZ?" · reverse: pods that fit a given node | `ResourceQuota` + node-count note |
| 4 | **SLO & Error Budget** | SLO %, window (28/30/90 d), current success rate → allowed downtime, budget (min / bad requests), budget spent, multi-window burn-rate alert thresholds | Prometheus multi-window burn-rate alert rule |
| 5 | **Availability & Redundancy** | components (availability each, series/parallel), or MTBF/MTTR → composite availability, downtime/yr, effect of N+1 / N+2, nines gap to a target | — |
| 6 | **Storage IOPS & Capacity** | workload read/write %, block size, target IOPS, disk IOPS + size, RAID level (0/1/5/6/10) or replication factor → disks needed, usable capacity, write-penalty-adjusted IOPS, growth runway | — |

## Formulas (sourced in each core file's header comment)

- **Little's Law**: `L = λ · W` — concurrency = arrival rate × service time.
- **Erlang C / M/M/c**: offered load `a = λ·W`; servers `c` s.t. `ρ = a/c < 1`;
  wait probability via the Erlang-C formula; `Wq = C(c,a) / (c·μ − λ)`.
- **Worker count** (Goetz): `N = N_cpu · U_cpu · (1 + W/C)`.
- **Connection pool** (classic): `((core_count · 2) + effective_spindles)` as a
  per-instance ceiling; global `Σ pools ≤ max_connections − reserved`.
- **K8s allocatable**: `capacity − kube-reserved − system-reserved − eviction-threshold`.
- **Burn rate**: budget-consumed-per-hour ÷ (budget ÷ window-hours); alert
  windows 1h/5m (fast, 14.4×) and 6h/30m (slow, 6×) — Google SRE Workbook.
- **RAID write penalty**: RAID1/10 = 2, RAID5 = 4, RAID6 = 6.
  `usable_write_IOPS = (disk_IOPS · n) / penalty` (for the write fraction).
- **Availability**: series `Π Aᵢ`; parallel `1 − Π(1 − Aᵢ)`;
  `A = MTBF / (MTBF + MTTR)`.

Every result panel repeats the "rules of thumb, not a substitute for load
testing" caveat the existing sizers carry.

## Module placement

- Group **`Sizing`** (existing): LB Sizer, Connection Pool, K8s Capacity, Storage IOPS.
- New group **`Reliability`**: SLO & Error Budget, Availability & Redundancy.

## Phases

| phase | scope |
|---|---|
| A | `queueing.ts` + tests |
| B | Load Balancer Sizer (core + test + screen + register) |
| C | Connection Pool Sizer |
| D | Kubernetes Node & Pod Capacity |
| E | SLO & Error Budget |
| F | Availability & Redundancy |
| G | Storage IOPS & Capacity |

Each phase: `bun run build` + `bun run test` green, `grep -rl "from 'react'
app/src/core` empty, screen verified in-browser, its own commit.

## Wave 2 (not now)

Kafka broker/partition sizing · Cache hit-ratio & Redis `maxmemory` · etcd
sizing · Backup window & RTO · VPC CIDR carve-up · On-call staffing ·
Replication lag / RPO · MTU/MSS overhead · Retry/timeout budget · Rate-limit
/ token-bucket · Cloud right-size + reserved break-even · Capacity runway.
