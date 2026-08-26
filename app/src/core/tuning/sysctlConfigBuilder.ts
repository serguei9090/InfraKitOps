import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * Groups the parameter catalog for display and for the generated output's
 * `# Category` section comments. Chosen to fit the actual catalog below
 * rather than forcing every parameter into a generic bucket.
 */
export type SysctlParameterCategory =
  | 'memoryManagement'
  | 'networkPerformance'
  | 'networkSecurity'
  | 'kernelSecurity'
  | 'fileSystemAndLimits'
  | 'processAndScheduling'
  | 'connectionTracking'

/** Category enum values, in the fixed emission order. */
export const sysctlParameterCategoryValues: SysctlParameterCategory[] = [
  'memoryManagement',
  'networkPerformance',
  'networkSecurity',
  'kernelSecurity',
  'fileSystemAndLimits',
  'processAndScheduling',
  'connectionTracking',
]

/**
 * Heading used both as a group title in the UI and as the `# <label>`
 * comment above that category's lines in generated output.
 */
export function sysctlParameterCategoryLabel(category: SysctlParameterCategory): string {
  switch (category) {
    case 'memoryManagement':
      return 'Memory Management'
    case 'networkPerformance':
      return 'Network Performance'
    case 'networkSecurity':
      return 'Network Security Hardening'
    case 'kernelSecurity':
      return 'Kernel & Filesystem Security Hardening'
    case 'fileSystemAndLimits':
      return 'File System & Limits'
    case 'processAndScheduling':
      return 'Processes, Scheduling & NUMA'
    case 'connectionTracking':
      return 'Netfilter Connection Tracking'
  }
}

/**
 * How a parameter's value should be entered. The catalog owns this so the
 * UI can stay generic: it switches on `SysctlValueKind` to pick a widget
 * instead of hard-coding "this key is a dropdown" lists of its own.
 *
 * The distinction that matters is *fixed legal set* versus *open numeric
 * range*. `vm.overcommit_memory` accepts exactly 0, 1 or 2 — typing "3"
 * there is always a mistake, so it gets a dropdown. `net.core.rmem_max` is
 * a byte count with no meaningful enumeration, so it gets a text field.
 */
export type SysctlValueKind = 'integer' | 'tuple' | 'text' | 'boolean' | 'enumerated'

/**
 * One legal value of an `enumerated` parameter, with the human-readable
 * meaning taken from the kernel documentation.
 */
export interface SysctlValueOption {
  /** The literal value written into the config, e.g. `2`. */
  value: string
  /** What that value means, e.g. 'Strict reverse-path filter (RFC 3704)'. */
  label: string
}

/** The two options every `boolean` parameter has. */
export const kBooleanOptions: SysctlValueOption[] = [
  { value: '0', label: 'Disabled (0)' },
  { value: '1', label: 'Enabled (1)' },
]

/**
 * One entry in the parameter catalog: a single sysctl key the user can
 * choose to include in the generated config, with enough context (label,
 * description, value kind, a sensible starting value, optional risk and
 * kernel-version notes) to let someone make an informed choice without
 * leaving the app.
 */
export interface SysctlParameter {
  /** The literal sysctl key, e.g. `vm.swappiness`. */
  key: string
  /** Short human-readable name for UI checkboxes. */
  label: string
  /**
   * Explanation of what the parameter controls. Where a sane value depends
   * on system facts (RAM size, NIC speed, workload) the description says so
   * rather than pretending a universal number exists.
   */
  description: string
  category: SysctlParameterCategory
  /**
   * Starting value shown pre-filled in the UI. For `tuple` it doubles as
   * the format example.
   */
  defaultValue: string
  kind: SysctlValueKind
  /**
   * Legal values for `enumerated`. Empty for every other kind — use
   * `sysctlEffectiveOptions` to get the boolean pair as well.
   */
  options: SysctlValueOption[]
  /**
   * Brief caution surfaced in the UI (warning icon + tooltip) where the
   * source material specifically flagged a risk. Undefined when there isn't one.
   */
  riskNote?: string
  /**
   * Version-specific caveat: when the key was added, removed, renamed, or
   * had its default changed. Undefined when the key has been stable.
   */
  kernelNote?: string
}

/**
 * The choices a picker should offer: `options` for enumerated params, the
 * 0/1 pair for booleans, empty for free-entry kinds.
 */
export function sysctlEffectiveOptions(parameter: SysctlParameter): SysctlValueOption[] {
  switch (parameter.kind) {
    case 'enumerated':
      return parameter.options
    case 'boolean':
      return kBooleanOptions
    case 'integer':
    case 'tuple':
    case 'text':
      return []
  }
}

/**
 * Whether `value` is one this parameter can legally take. Free-entry
 * kinds accept anything non-blank (the kernel is the real validator for
 * a byte count); constrained kinds check membership in the legal set.
 */
export function sysctlIsLegalValue(parameter: SysctlParameter, value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length === 0) return false
  const legal = sysctlEffectiveOptions(parameter)
  if (legal.length === 0) return true
  return legal.some((option) => option.value === trimmed)
}

/**
 * The value that should actually be emitted for a given raw user input:
 * blank falls back to `defaultValue`, and a constrained parameter never
 * emits something outside its documented set — an out-of-range value is
 * replaced by `defaultValue` rather than written into a real kernel
 * config file.
 */
export function sysctlSanitize(parameter: SysctlParameter, rawValue: string | null | undefined): string {
  if (rawValue == null) return parameter.defaultValue
  const trimmed = rawValue.trim()
  if (trimmed.length === 0) return parameter.defaultValue
  return sysctlIsLegalValue(parameter, trimmed) ? trimmed : parameter.defaultValue
}

function param(p: Omit<SysctlParameter, 'options'> & { options?: SysctlValueOption[] }): SysctlParameter {
  return { options: [], ...p }
}

/**
 * The vetted parameter catalog.
 *
 * Deliberately does NOT include `net.ipv4.tcp_tw_recycle`: it was removed
 * from the kernel in 4.12 because it breaks connections for clients behind
 * NAT, so it isn't offered here at all, not even with a warning attached —
 * see the regression test in sysctlConfigBuilder.test.ts that pins this.
 *
 * Also deliberately absent: `kernel.sched_min_granularity_ns`,
 * `kernel.sched_latency_ns` and `kernel.sched_wakeup_granularity_ns`. Those
 * moved out of `/proc/sys/kernel` into `/sys/kernel/debug/sched/` in Linux
 * 5.13, and 6.6's EEVDF scheduler replaced the pair of them with
 * `base_slice_ns`. Writing them via sysctl on any current kernel simply
 * fails, so the catalog offers the scheduler knobs that are still real
 * sysctls (`sched_rt_*`, `sched_autogroup_enabled`, `sched_cfs_bandwidth_slice_us`,
 * `sched_schedstats`, `sched_util_clamp_*`) instead.
 *
 * Note on `vm.zone_reclaim_mode` vs `kernel.numa_balancing`: these are two
 * distinct, unrelated kernel settings that a widely-copied blog post
 * conflated. `zone_reclaim_mode` governs whether the kernel reclaims memory
 * from the local NUMA zone before falling back to a remote zone (generally
 * left at 0 on modern kernels, especially for databases, since reclaiming
 * locally can cost more than a remote-memory access). `numa_balancing` is
 * the automatic NUMA page/task migration toggle. They live in different
 * categories below with their own accurate descriptions.
 */
export const kSysctlParameterCatalog: SysctlParameter[] = [
  // ---------------------------------------------------------------------
  // Memory Management
  // ---------------------------------------------------------------------
  param({
    key: 'vm.swappiness',
    label: 'Swappiness',
    description:
      'Relative cost the kernel assigns to swapping anonymous memory versus reclaiming page cache. Lower keeps more anonymous memory resident. Kernel default is 60.',
    category: 'memoryManagement',
    defaultValue: '10',
    kind: 'integer',
    riskNote: 'Setting this very low can produce OOM kills under genuine memory pressure instead of swapping.',
    kernelNote:
      'Range is 0-100 on older kernels and 0-200 since 5.8, where values above 100 make swap cheaper than page-cache reclaim.',
  }),
  param({
    key: 'vm.dirty_ratio',
    label: 'Dirty Ratio',
    description:
      'Percentage of available memory that may hold dirty (unwritten) pages before a writing process is forced to flush synchronously.',
    category: 'memoryManagement',
    defaultValue: '20',
    kind: 'integer',
    riskNote:
      'Raising this increases the amount of unwritten data at risk on a crash and can cause long write stalls when the limit is hit.',
    kernelNote: 'Mutually exclusive with vm.dirty_bytes — writing one zeroes the other.',
  }),
  param({
    key: 'vm.dirty_background_ratio',
    label: 'Dirty Background Ratio',
    description:
      'Percentage of available memory dirty before the kernel flusher threads start writing back in the background. Keep it below dirty_ratio.',
    category: 'memoryManagement',
    defaultValue: '5',
    kind: 'integer',
    kernelNote: 'Mutually exclusive with vm.dirty_background_bytes.',
  }),
  param({
    key: 'vm.dirty_expire_centisecs',
    label: 'Dirty Expiry Age',
    description:
      'Age in centiseconds (hundredths of a second) at which dirty data becomes old enough to be written out. Kernel default is 3000 (30s).',
    category: 'memoryManagement',
    defaultValue: '3000',
    kind: 'integer',
  }),
  param({
    key: 'vm.dirty_writeback_centisecs',
    label: 'Writeback Wakeup Interval',
    description:
      'How often, in centiseconds, the flusher threads wake to write back dirty data. Kernel default is 500 (5s); 0 disables periodic writeback entirely.',
    category: 'memoryManagement',
    defaultValue: '500',
    kind: 'integer',
    riskNote: '0 disables periodic writeback — dirty pages then only flush under memory pressure or on fsync.',
  }),
  param({
    key: 'vm.overcommit_memory',
    label: 'Overcommit Policy',
    description: 'How the kernel decides whether to honour a memory allocation request.',
    category: 'memoryManagement',
    defaultValue: '0',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — Heuristic: refuse obvious overcommits (kernel default)' },
      { value: '1', label: '1 — Always overcommit, never refuse' },
      { value: '2', label: '2 — Strict accounting against swap + overcommit_ratio' },
    ],
    riskNote:
      'Mode 2 makes allocations fail predictably instead of invoking the OOM killer, but a too-low overcommit_ratio will break workloads that reserve generously.',
  }),
  param({
    key: 'vm.overcommit_ratio',
    label: 'Overcommit Ratio',
    description:
      'Percentage of physical RAM added to swap to form the commit limit. Only has any effect when overcommit_memory is 2.',
    category: 'memoryManagement',
    defaultValue: '50',
    kind: 'integer',
    kernelNote: 'Mutually exclusive with vm.overcommit_kbytes.',
  }),
  param({
    key: 'vm.vfs_cache_pressure',
    label: 'VFS Cache Pressure',
    description:
      'How eagerly the kernel reclaims dentry and inode caches relative to page cache. Below 100 retains more filesystem metadata (good for many-small-files workloads); 0 disables that reclaim entirely.',
    category: 'memoryManagement',
    defaultValue: '50',
    kind: 'integer',
    riskNote: '0 never reclaims dentries/inodes and can drive the machine out of memory.',
  }),
  param({
    key: 'vm.min_free_kbytes',
    label: 'Minimum Free Memory',
    description:
      'Kilobytes the VM keeps free as reserve. The right value scales with total RAM and with how bursty allocation is — a common starting point is roughly 0.5-1% of RAM, and high-memory hosts (50 GB+) are sometimes taken as high as a few percent. There is no universal number; size it against your own machine.',
    category: 'memoryManagement',
    defaultValue: '65536',
    kind: 'integer',
    riskNote: 'Below about 1024 KB the system becomes subtly broken; setting it too high starves userspace and triggers OOM kills.',
  }),
  param({
    key: 'vm.max_map_count',
    label: 'Max Memory Map Areas',
    description:
      'Maximum number of virtual memory areas a single process may have. Kernel default is 65530, which is too low for Elasticsearch/OpenSearch (262144 is their documented floor) and for some JVM and database workloads.',
    category: 'memoryManagement',
    defaultValue: '262144',
    kind: 'integer',
  }),
  param({
    key: 'vm.zone_reclaim_mode',
    label: 'Zone Reclaim Mode',
    description:
      'Whether the kernel reclaims memory from the local NUMA zone before allocating from a remote zone, and how aggressively. This is a memory-reclaim locality setting; it is NOT the automatic NUMA balancing toggle (that is kernel.numa_balancing).',
    category: 'memoryManagement',
    defaultValue: '0',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — Off: allocate from remote zones rather than reclaim' },
      { value: '1', label: '1 — Reclaim from the local zone before going remote' },
      { value: '2', label: '2 — Also write dirty pages during zone reclaim' },
      { value: '4', label: '4 — Also swap pages during zone reclaim' },
    ],
    riskNote:
      'Best left at 0 on modern kernels for most workloads, especially databases: local reclaim often costs more than a remote-memory access. Values 1/2/4 are bits that can be summed; the entries here are the individual documented modes.',
  }),
  param({
    key: 'vm.watermark_scale_factor',
    label: 'Watermark Scale Factor',
    description:
      'Gap between the kswapd wake and sleep watermarks, in ten-thousandths of memory. Default 10 (0.1%); raising it makes kswapd start reclaiming earlier, which helps hosts that allocate in bursts. Maximum is 3000.',
    category: 'memoryManagement',
    defaultValue: '10',
    kind: 'integer',
  }),
  param({
    key: 'vm.nr_hugepages',
    label: 'Static Huge Page Pool',
    description:
      'Number of persistent huge pages to reserve. Sized entirely from the workload (a database SGA/buffer pool, for example) and the huge page size in use — there is no sensible universal value, so compute it from what you intend to back with huge pages.',
    category: 'memoryManagement',
    defaultValue: '0',
    kind: 'integer',
    riskNote: 'Reserved huge pages are removed from general-purpose memory whether or not anything uses them.',
  }),
  param({
    key: 'vm.panic_on_oom',
    label: 'Panic on OOM',
    description:
      'Whether an out-of-memory condition panics the kernel instead of invoking the OOM killer. Useful on clustered nodes where a fast reboot beats a degraded survivor.',
    category: 'memoryManagement',
    defaultValue: '0',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — Run the OOM killer (kernel default)' },
      { value: '1', label: '1 — Panic, except for constrained/cgroup OOMs' },
      { value: '2', label: '2 — Always panic' },
    ],
    riskNote: 'Pair with kernel.panic so the machine actually reboots rather than sitting dead.',
  }),
  param({
    key: 'vm.oom_kill_allocating_task',
    label: 'OOM-Kill the Allocating Task',
    description:
      'When set, the OOM killer kills the task that triggered the out-of-memory condition instead of scanning the task list for the worst offender. Cheaper, but far less selective.',
    category: 'memoryManagement',
    defaultValue: '0',
    kind: 'boolean',
  }),

  // ---------------------------------------------------------------------
  // Network Performance
  // ---------------------------------------------------------------------
  param({
    key: 'net.core.somaxconn',
    label: 'Socket Listen Backlog',
    description:
      'Upper bound on the accept queue depth a listening socket may request via listen(). Applications still have to ask for it — nginx backlog=, Postgres listen_backlog and friends.',
    category: 'networkPerformance',
    defaultValue: '4096',
    kind: 'integer',
    kernelNote: 'Default was 128 before Linux 5.4 and 4096 from 5.4 onwards.',
  }),
  param({
    key: 'net.ipv4.tcp_max_syn_backlog',
    label: 'TCP SYN Backlog',
    description:
      'Maximum number of half-open (SYN_RECV) connections remembered per listener. Usually set to match or exceed somaxconn.',
    category: 'networkPerformance',
    defaultValue: '4096',
    kind: 'integer',
    kernelNote: 'Kernel default scales with system memory; it was also raised to 4096 alongside the 5.4 somaxconn change.',
  }),
  param({
    key: 'net.core.netdev_max_backlog',
    label: 'Per-CPU Device Backlog',
    description:
      'Packets that may queue per CPU between the NIC and the protocol stack. Raise it only if the drop counter in column 2 of /proc/net/softnet_stat is climbing; Red Hat suggest doubling until it stops.',
    category: 'networkPerformance',
    defaultValue: '16384',
    kind: 'integer',
  }),
  param({
    key: 'net.core.netdev_budget',
    label: 'NAPI Poll Budget',
    description:
      'Packets drained per NAPI polling cycle before the softirq yields. Default 300; raise on high-throughput NICs where time_squeeze in /proc/net/softnet_stat is climbing.',
    category: 'networkPerformance',
    defaultValue: '600',
    kind: 'integer',
  }),
  param({
    key: 'net.core.rmem_max',
    label: 'Max Socket Receive Buffer',
    description:
      'Ceiling a socket may request via SO_RCVBUF, in bytes. For bulk TCP the useful ceiling is the bandwidth-delay product of your worst path — derive it from NIC speed and RTT rather than copying a number.',
    category: 'networkPerformance',
    defaultValue: '16777216',
    kind: 'integer',
    kernelNote: 'Kernel default is 4194304 on current kernels; it was 212992 on older ones.',
  }),
  param({
    key: 'net.core.wmem_max',
    label: 'Max Socket Send Buffer',
    description: 'Ceiling a socket may request via SO_SNDBUF, in bytes. Size it from bandwidth-delay product like rmem_max.',
    category: 'networkPerformance',
    defaultValue: '16777216',
    kind: 'integer',
  }),
  param({
    key: 'net.core.rmem_default',
    label: 'Default Socket Receive Buffer',
    description:
      'Starting receive buffer size for sockets that never call setsockopt. Applies to UDP and other protocols; TCP overrides it from tcp_rmem.',
    category: 'networkPerformance',
    defaultValue: '262144',
    kind: 'integer',
  }),
  param({
    key: 'net.core.wmem_default',
    label: 'Default Socket Send Buffer',
    description: 'Starting send buffer size for sockets that never call setsockopt. TCP overrides it from tcp_wmem.',
    category: 'networkPerformance',
    defaultValue: '262144',
    kind: 'integer',
  }),
  param({
    key: 'net.core.optmem_max',
    label: 'Max Ancillary Buffer',
    description: 'Per-socket cap on ancillary/option buffer memory, and on TCP zerocopy bookkeeping. Kernel default is 128 KB.',
    category: 'networkPerformance',
    defaultValue: '131072',
    kind: 'integer',
  }),
  param({
    key: 'net.ipv4.tcp_rmem',
    label: 'TCP Receive Buffer (min default max)',
    description:
      'Three space-separated byte counts: minimum, initial default, and autotuning maximum for TCP receive buffers. The maximum should not exceed net.core.rmem_max and is a bandwidth-delay-product decision.',
    category: 'networkPerformance',
    defaultValue: '4096 131072 16777216',
    kind: 'tuple',
  }),
  param({
    key: 'net.ipv4.tcp_wmem',
    label: 'TCP Send Buffer (min default max)',
    description:
      'Three space-separated byte counts: minimum, initial default, and autotuning maximum for TCP send buffers. The maximum should not exceed net.core.wmem_max.',
    category: 'networkPerformance',
    defaultValue: '4096 65536 16777216',
    kind: 'tuple',
  }),
  param({
    key: 'net.ipv4.tcp_moderate_rcvbuf',
    label: 'TCP Receive Buffer Autotuning',
    description: 'Lets the kernel grow receive buffers automatically within the tcp_rmem range. Enabled by default and should normally stay on.',
    category: 'networkPerformance',
    defaultValue: '1',
    kind: 'boolean',
  }),
  param({
    key: 'net.ipv4.tcp_window_scaling',
    label: 'TCP Window Scaling',
    description: 'RFC 1323 window scaling, required for any window above 64 KB. Enabled by default; only disable when a broken middlebox forces it.',
    category: 'networkPerformance',
    defaultValue: '1',
    kind: 'boolean',
  }),
  param({
    key: 'net.ipv4.tcp_congestion_control',
    label: 'TCP Congestion Control',
    description:
      'Algorithm used for new connections. Legal values are whatever the running kernel has built in or has modules for — check net.ipv4.tcp_available_congestion_control. "cubic" is the usual default; "bbr" needs the tcp_bbr module and pairs with fq.',
    category: 'networkPerformance',
    defaultValue: 'bbr',
    kind: 'text',
    kernelNote: 'BBR has been in mainline since 4.9; BBRv3 landed later and behaves differently under loss. Only "reno" is guaranteed present.',
  }),
  param({
    key: 'net.core.default_qdisc',
    label: 'Default Queueing Discipline',
    description:
      'Queueing discipline applied to interfaces that do not have one configured. "fq" is the usual pairing for BBR; "fq_codel" is the general-purpose bufferbloat default on most distributions.',
    category: 'networkPerformance',
    defaultValue: 'fq',
    kind: 'text',
    kernelNote: 'Kernel default is pfifo_fast; most distributions already override it to fq_codel.',
  }),
  param({
    key: 'net.ipv4.tcp_tw_reuse',
    label: 'TIME_WAIT Socket Reuse',
    description: 'Whether an outbound connection may reuse a socket still in TIME_WAIT when timestamps prove it is safe. Unlike the removed tcp_tw_recycle, this is NAT-safe.',
    category: 'networkPerformance',
    defaultValue: '1',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — Disabled' },
      { value: '1', label: '1 — Enabled globally' },
      { value: '2', label: '2 — Enabled for loopback traffic only' },
    ],
    kernelNote: 'Value 2 (loopback only) was added later and is the default on current kernels. Affects outbound connections only.',
  }),
  param({
    key: 'net.ipv4.tcp_max_tw_buckets',
    label: 'Max TIME_WAIT Sockets',
    description: 'Ceiling on simultaneous TIME_WAIT sockets; beyond it, sockets are destroyed immediately and a warning is logged. Kernel default scales with memory.',
    category: 'networkPerformance',
    defaultValue: '1048576',
    kind: 'integer',
    riskNote: 'Each bucket costs kernel memory. Do not raise it as a substitute for fixing connection churn.',
  }),
  param({
    key: 'net.ipv4.tcp_fin_timeout',
    label: 'FIN_WAIT_2 Timeout',
    description: 'Seconds an orphaned connection may sit in FIN_WAIT_2 before being torn down. Kernel default is 60.',
    category: 'networkPerformance',
    defaultValue: '30',
    kind: 'integer',
  }),
  param({
    key: 'net.ipv4.tcp_keepalive_time',
    label: 'Keepalive Idle Time',
    description: 'Seconds of idleness before the first keepalive probe. Kernel default is 7200 (2 hours), which is far longer than most load balancers and NAT gateways hold state.',
    category: 'networkPerformance',
    defaultValue: '300',
    kind: 'integer',
  }),
  param({
    key: 'net.ipv4.tcp_keepalive_probes',
    label: 'Keepalive Probe Count',
    description: 'Unanswered keepalive probes before the connection is declared dead. Kernel default is 9.',
    category: 'networkPerformance',
    defaultValue: '5',
    kind: 'integer',
  }),
  param({
    key: 'net.ipv4.tcp_keepalive_intvl',
    label: 'Keepalive Probe Interval',
    description: 'Seconds between keepalive probes. Total detection time is roughly keepalive_time + probes x intvl. Kernel default is 75.',
    category: 'networkPerformance',
    defaultValue: '15',
    kind: 'integer',
  }),
  param({
    key: 'net.ipv4.ip_local_port_range',
    label: 'Ephemeral Port Range (low high)',
    description:
      'Two space-separated port numbers bounding the ephemeral range used for outbound connections. Widening it prevents EADDRNOTAVAIL on hosts making many outbound connections. Kernel default is "32768 60999".',
    category: 'networkPerformance',
    defaultValue: '10240 65535',
    kind: 'tuple',
    riskNote: 'Do not let the range swallow ports your own services listen on, and keep the low bound above 1024.',
  }),
  param({
    key: 'net.ipv4.tcp_fastopen',
    label: 'TCP Fast Open',
    description: 'Bitmask enabling RFC 7413 data-in-SYN: bit 0x1 is the client role, 0x2 the server role.',
    category: 'networkPerformance',
    defaultValue: '3',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — Disabled' },
      { value: '1', label: '1 — Client role only (kernel default)' },
      { value: '2', label: '2 — Server role only' },
      { value: '3', label: '3 — Client and server' },
    ],
    riskNote:
      'Servers must also opt in per-listener via TCP_FASTOPEN. Some middleboxes drop data-carrying SYNs, and TFO cookies are a mild client-tracking vector.',
    kernelNote: 'Higher bits (0x4, 0x200, 0x400) exist for cookie-less and default-on behaviour; this tool exposes the common 0-3 combinations.',
  }),
  param({
    key: 'net.ipv4.tcp_slow_start_after_idle',
    label: 'Slow Start After Idle',
    description:
      'RFC 2861 behaviour: reset the congestion window after an idle period. Disabling it helps long-lived, bursty connections (keepalive HTTP, gRPC, replication links) recover full throughput instantly.',
    category: 'networkPerformance',
    defaultValue: '0',
    kind: 'boolean',
    riskNote: 'Disabling it means a burst after idle is sent at the pre-idle rate, which can be unfriendly on a congested path.',
  }),
  param({
    key: 'net.ipv4.tcp_mtu_probing',
    label: 'TCP MTU Probing',
    description: 'Path-MTU black-hole detection, which matters where ICMP Fragmentation Needed is filtered — common with tunnels, VPNs and cloud overlays.',
    category: 'networkPerformance',
    defaultValue: '1',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — Disabled (kernel default)' },
      { value: '1', label: '1 — Enable only after a black hole is detected' },
      { value: '2', label: '2 — Always enabled, starting from tcp_base_mss' },
    ],
  }),
  param({
    key: 'net.ipv4.tcp_notsent_lowat',
    label: 'Unsent Data Low-Water Mark',
    description:
      'Bytes of unsent data allowed in the send queue before poll/epoll stops reporting the socket writable. Small values cut bufferbloat and head-of-line latency for servers that write large responses. Default is effectively unlimited.',
    category: 'networkPerformance',
    defaultValue: '16384',
    kind: 'integer',
    riskNote: 'Too low a value increases syscall overhead on bulk transfers.',
  }),

  // ---------------------------------------------------------------------
  // Network Security Hardening
  // ---------------------------------------------------------------------
  param({
    key: 'net.ipv4.tcp_syncookies',
    label: 'TCP SYN Cookies',
    description: 'Fall back to SYN cookies when the SYN backlog overflows, so a SYN flood cannot deny service to legitimate clients.',
    category: 'networkSecurity',
    defaultValue: '1',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — Disabled' },
      { value: '1', label: '1 — Used only when the backlog overflows (kernel default)' },
      { value: '2', label: '2 — Always issue SYN cookies' },
    ],
    riskNote: 'Mode 2 disables TCP options negotiated in the SYN exchange for every connection — it is a debugging/last-resort setting, not a default.',
  }),
  param({
    key: 'net.ipv4.ip_forward',
    label: 'IPv4 Forwarding',
    description: 'Whether the host routes packets between interfaces. Must be 0 on an ordinary server; routers, NAT gateways, Kubernetes nodes and Docker hosts need 1.',
    category: 'networkSecurity',
    defaultValue: '0',
    kind: 'boolean',
    riskNote: 'Changing this resets all per-interface IPv4 configuration to its role defaults.',
  }),
  param({
    key: 'net.ipv4.conf.all.rp_filter',
    label: 'Reverse Path Filter (all)',
    description: 'Source address validation per RFC 3704. The effective setting for an interface is the max of the all and per-interface values, so setting "all" alone cannot relax anything.',
    category: 'networkSecurity',
    defaultValue: '1',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — No source validation' },
      { value: '1', label: '1 — Strict mode' },
      { value: '2', label: '2 — Loose mode' },
    ],
    riskNote: 'Strict mode breaks asymmetric routing and multi-homed hosts; use loose mode (2) there. There is no IPv6 rp_filter — use nftables fib rules for IPv6.',
  }),
  param({
    key: 'net.ipv4.conf.default.rp_filter',
    label: 'Reverse Path Filter (default)',
    description: 'Reverse path filtering applied to interfaces created after this is set. Pair it with the "all" value so new interfaces inherit the policy.',
    category: 'networkSecurity',
    defaultValue: '1',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — No source validation' },
      { value: '1', label: '1 — Strict mode' },
      { value: '2', label: '2 — Loose mode' },
    ],
  }),
  param({
    key: 'net.ipv4.conf.all.accept_source_route',
    label: 'Accept Source-Routed Packets (all)',
    description: 'Source routing lets a sender dictate the path a packet takes and can be used to reach otherwise unreachable networks. Disable it on anything that is not deliberately a source-routing router.',
    category: 'networkSecurity',
    defaultValue: '0',
    kind: 'boolean',
  }),
  param({
    key: 'net.ipv4.conf.default.accept_source_route',
    label: 'Accept Source-Routed Packets (default)',
    description: 'Source-route acceptance for interfaces created later. Set alongside the "all" value.',
    category: 'networkSecurity',
    defaultValue: '0',
    kind: 'boolean',
  }),
  param({
    key: 'net.ipv4.conf.all.accept_redirects',
    label: 'Accept ICMP Redirects (all)',
    description: "ICMP redirects rewrite the local routing table on the attacker's say-so, which is a classic man-in-the-middle path. Disable on servers.",
    category: 'networkSecurity',
    defaultValue: '0',
    kind: 'boolean',
    kernelNote: 'When forwarding is off, redirects are accepted if EITHER all or the interface value is 1 — so the per-interface value must be cleared too.',
  }),
  param({
    key: 'net.ipv4.conf.default.accept_redirects',
    label: 'Accept ICMP Redirects (default)',
    description: 'ICMP redirect acceptance for interfaces created later.',
    category: 'networkSecurity',
    defaultValue: '0',
    kind: 'boolean',
  }),
  param({
    key: 'net.ipv4.conf.all.secure_redirects',
    label: 'Accept Redirects From Known Gateways Only (all)',
    description: 'When redirects are accepted at all, restrict them to gateways already in the default gateway list. Hardening baselines set this to 0 because accept_redirects is already 0.',
    category: 'networkSecurity',
    defaultValue: '0',
    kind: 'boolean',
    riskNote: 'Overridden by shared_media. Only meaningful when accept_redirects is enabled.',
  }),
  param({
    key: 'net.ipv4.conf.default.secure_redirects',
    label: 'Accept Redirects From Known Gateways Only (default)',
    description: 'Secure-redirect policy for interfaces created later.',
    category: 'networkSecurity',
    defaultValue: '0',
    kind: 'boolean',
  }),
  param({
    key: 'net.ipv4.conf.all.send_redirects',
    label: 'Send ICMP Redirects (all)',
    description: 'Whether this host emits ICMP redirects. Only a router should; sending them from a server leaks topology.',
    category: 'networkSecurity',
    defaultValue: '0',
    kind: 'boolean',
  }),
  param({
    key: 'net.ipv4.conf.default.send_redirects',
    label: 'Send ICMP Redirects (default)',
    description: 'ICMP redirect emission for interfaces created later.',
    category: 'networkSecurity',
    defaultValue: '0',
    kind: 'boolean',
  }),
  param({
    key: 'net.ipv4.conf.all.log_martians',
    label: 'Log Martian Packets (all)',
    description: 'Log packets with impossible source addresses. Valuable forensic signal for spoofing and misrouting.',
    category: 'networkSecurity',
    defaultValue: '1',
    kind: 'boolean',
    riskNote: 'On a noisy network this can flood the kernel log; make sure rate limiting and log rotation are in place.',
  }),
  param({
    key: 'net.ipv4.conf.default.log_martians',
    label: 'Log Martian Packets (default)',
    description: 'Martian logging for interfaces created later.',
    category: 'networkSecurity',
    defaultValue: '1',
    kind: 'boolean',
  }),
  param({
    key: 'net.ipv4.icmp_echo_ignore_broadcasts',
    label: 'Ignore Broadcast ICMP Echo',
    description: 'Drop ICMP echo and timestamp requests sent to broadcast or multicast addresses, denying use of this host as a Smurf amplifier. On by default on modern kernels.',
    category: 'networkSecurity',
    defaultValue: '1',
    kind: 'boolean',
  }),
  param({
    key: 'net.ipv4.icmp_ignore_bogus_error_responses',
    label: 'Ignore Bogus ICMP Errors',
    description: 'Suppress kernel warnings about RFC 1122-violating routers that reply to broadcasts with ICMP errors. Saves log noise rather than blocking an attack.',
    category: 'networkSecurity',
    defaultValue: '1',
    kind: 'boolean',
  }),
  param({
    key: 'net.ipv4.icmp_echo_ignore_all',
    label: 'Ignore All ICMP Echo (ping)',
    description: 'Drop every ICMP echo request. Provides very little security while breaking reachability diagnostics; included because compliance regimes sometimes demand it.',
    category: 'networkSecurity',
    defaultValue: '0',
    kind: 'boolean',
    riskNote: 'Breaks ping-based health checks and monitoring. Path MTU discovery is unaffected (that uses a different ICMP type), but troubleshooting gets much harder.',
  }),
  param({
    key: 'net.ipv4.tcp_rfc1337',
    label: 'RFC 1337 TIME_WAIT Assassination Protection',
    description: 'Drop RST packets aimed at sockets in TIME_WAIT instead of acting on them, closing the TIME_WAIT assassination hazard described in RFC 1337.',
    category: 'networkSecurity',
    defaultValue: '1',
    kind: 'boolean',
  }),
  param({
    key: 'net.ipv4.conf.all.arp_ignore',
    label: 'ARP Reply Policy (all)',
    description: 'Which ARP requests for local addresses this host answers. Restricting it prevents one interface answering for addresses owned by another.',
    category: 'networkSecurity',
    defaultValue: '1',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — Reply for any local address (kernel default)' },
      { value: '1', label: '1 — Reply only for addresses on the receiving interface' },
      { value: '2', label: "2 — As 1, and only within the sender's subnet" },
      { value: '3', label: '3 — Do not reply for scope-host addresses' },
      { value: '8', label: '8 — Never reply for any local address' },
    ],
    riskNote: 'Required by some load balancer topologies (LVS direct routing) and breaks others. The effective value is the max of all and the interface.',
  }),
  param({
    key: 'net.ipv4.conf.all.arp_announce',
    label: 'ARP Source Address Policy (all)',
    description: 'Which local address this host puts in the sender field of outgoing ARP requests. Level 2 always picks the best-matching local address for the target.',
    category: 'networkSecurity',
    defaultValue: '2',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — Any local address on any interface (kernel default)' },
      { value: '1', label: "1 — Avoid addresses outside the target's subnet" },
      { value: '2', label: '2 — Always use the best local address for the target' },
    ],
  }),
  param({
    key: 'net.core.bpf_jit_harden',
    label: 'BPF JIT Hardening',
    description: 'Blinds constants in JIT-compiled BPF programs, defeating JIT spraying at some cost in performance.',
    category: 'networkSecurity',
    defaultValue: '2',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — No hardening (kernel default)' },
      { value: '1', label: '1 — Harden unprivileged BPF programs' },
      { value: '2', label: '2 — Harden all BPF programs' },
    ],
    riskNote: 'Value 2 slows down privileged BPF too — measure before applying to hosts running heavy eBPF tooling (Cilium, bpftrace, Falco).',
  }),
  param({
    key: 'net.ipv6.conf.all.accept_redirects',
    label: 'Accept ICMPv6 Redirects (all)',
    description: 'IPv6 counterpart of accept_redirects. Disable on hosts for the same man-in-the-middle reason.',
    category: 'networkSecurity',
    defaultValue: '0',
    kind: 'boolean',
  }),
  param({
    key: 'net.ipv6.conf.default.accept_redirects',
    label: 'Accept ICMPv6 Redirects (default)',
    description: 'ICMPv6 redirect acceptance for interfaces created later.',
    category: 'networkSecurity',
    defaultValue: '0',
    kind: 'boolean',
  }),
  param({
    key: 'net.ipv6.conf.all.accept_source_route',
    label: 'Accept IPv6 Routing Headers (all)',
    description:
      'Controls the IPv6 routing extension header. Unlike the IPv4 key this is not a plain boolean: any value >= 0 still accepts type 2 routing headers (Mobile IPv6), and only a negative value rejects routing headers outright.',
    category: 'networkSecurity',
    defaultValue: '0',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — Accept type 2 routing headers only (kernel default, CIS value)' },
      { value: '-1', label: '-1 — Reject all routing headers' },
    ],
    riskNote: 'Hardening baselines specify 0 here, which is NOT "reject everything" — the deprecated type 0 header is already refused, but type 2 is still accepted.',
  }),
  param({
    key: 'net.ipv6.conf.default.accept_source_route',
    label: 'Accept IPv6 Routing Headers (default)',
    description: 'IPv6 routing header policy for interfaces created later. Same non-boolean semantics as the "all" key.',
    category: 'networkSecurity',
    defaultValue: '0',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — Accept type 2 routing headers only (kernel default, CIS value)' },
      { value: '-1', label: '-1 — Reject all routing headers' },
    ],
  }),
  param({
    key: 'net.ipv6.conf.all.accept_ra',
    label: 'Accept Router Advertisements (all)',
    description: 'Whether to autoconfigure from IPv6 Router Advertisements. Rogue RAs are the standard IPv6 on-link attack, so statically addressed servers should refuse them.',
    category: 'networkSecurity',
    defaultValue: '0',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — Never accept RAs' },
      { value: '1', label: '1 — Accept RAs only when forwarding is disabled (kernel default)' },
      { value: '2', label: '2 — Accept RAs even when forwarding is enabled' },
    ],
    riskNote: 'Setting 0 on a host that relies on SLAAC removes its address and default route.',
  }),
  param({
    key: 'net.ipv6.conf.default.accept_ra',
    label: 'Accept Router Advertisements (default)',
    description: 'Router Advertisement policy for interfaces created later.',
    category: 'networkSecurity',
    defaultValue: '0',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — Never accept RAs' },
      { value: '1', label: '1 — Accept RAs only when forwarding is disabled (kernel default)' },
      { value: '2', label: '2 — Accept RAs even when forwarding is enabled' },
    ],
  }),
  param({
    key: 'net.ipv6.conf.all.forwarding',
    label: 'IPv6 Forwarding (all)',
    description: 'Whether the host routes IPv6 between interfaces. Enabling it also switches the interface into router mode, changing RA and redirect defaults.',
    category: 'networkSecurity',
    defaultValue: '0',
    kind: 'boolean',
    kernelNote: 'IPv6 forwarding does not behave like the IPv4 key: per-interface control needs the force_forwarding flag on recent kernels.',
  }),
  param({
    key: 'net.ipv6.conf.all.disable_ipv6',
    label: 'Disable IPv6 (all interfaces)',
    description: 'Turns IPv6 off entirely on existing interfaces. Only appropriate for genuinely IPv4-only environments — disabling IPv6 half-way is a common source of outages.',
    category: 'networkSecurity',
    defaultValue: '0',
    kind: 'boolean',
    riskNote: 'Some services (and localhost ::1 users) fail to start with IPv6 disabled. Prefer hardening IPv6 over switching it off.',
  }),
  param({
    key: 'net.ipv6.conf.default.disable_ipv6',
    label: 'Disable IPv6 (default template)',
    description: 'Turns IPv6 off on interfaces created later. Only for genuinely IPv4-only environments.',
    category: 'networkSecurity',
    defaultValue: '0',
    kind: 'boolean',
  }),

  // ---------------------------------------------------------------------
  // Kernel & Filesystem Security Hardening
  // ---------------------------------------------------------------------
  param({
    key: 'kernel.kptr_restrict',
    label: 'Restrict Kernel Pointer Exposure',
    description: 'How much of a kernel address printed via %pK is revealed to userspace. Leaked kernel addresses defeat KASLR.',
    category: 'kernelSecurity',
    defaultValue: '2',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — Hashed pointers (kernel default)' },
      { value: '1', label: '1 — Zeroed unless the reader has CAP_SYSLOG' },
      { value: '2', label: '2 — Always zeroed, regardless of privilege' },
    ],
    riskNote: 'Value 2 breaks perf, systemtap and some profilers that resolve kernel symbols.',
  }),
  param({
    key: 'kernel.dmesg_restrict',
    label: 'Restrict dmesg',
    description: 'Restrict the kernel ring buffer to processes holding CAP_SYSLOG. The log routinely contains addresses and hardware detail useful to an attacker.',
    category: 'kernelSecurity',
    defaultValue: '1',
    kind: 'boolean',
  }),
  param({
    key: 'kernel.sysrq',
    label: 'Magic SysRq Key',
    description: 'Which Magic SysRq functions are permitted. 0 disables it, 1 enables everything, and any other value is a bitmask of function groups.',
    category: 'kernelSecurity',
    defaultValue: '0',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — Disabled entirely' },
      { value: '1', label: '1 — All functions enabled' },
      { value: '4', label: '4 — Keyboard control only (SAK, unraw)' },
      { value: '16', label: '16 — Sync only' },
      { value: '176', label: '176 — Sync + remount read-only + reboot (16+32+128)' },
      { value: '438', label: '438 — Debian/Ubuntu default subset' },
    ],
    riskNote:
      'Anyone with console or serial access can use SysRq. On a physically exposed host, 0 or a narrow bitmask is the safe choice; on a remote-managed host a sync/reboot subset aids recovery.',
  }),
  param({
    key: 'kernel.randomize_va_space',
    label: 'Address Space Randomization',
    description: 'ASLR coverage for user processes. 2 is the default on every mainstream distribution and should not be lowered.',
    category: 'kernelSecurity',
    defaultValue: '2',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — Disabled' },
      { value: '1', label: '1 — Randomize mmap base, stack, VDSO and PIE text' },
      { value: '2', label: '2 — Additionally randomize the heap (recommended)' },
    ],
  }),
  param({
    key: 'kernel.unprivileged_bpf_disabled',
    label: 'Disable Unprivileged BPF',
    description: 'Blocks bpf() from processes without CAP_BPF/CAP_SYS_ADMIN, closing a historically productive source of local privilege escalation.',
    category: 'kernelSecurity',
    defaultValue: '2',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — Unprivileged bpf() allowed' },
      { value: '1', label: '1 — Disabled irreversibly until reboot' },
      { value: '2', label: '2 — Disabled, but an admin can re-enable it' },
    ],
    riskNote: 'Value 1 cannot be undone without a reboot. Prefer 2 unless you are certain nothing on the host needs unprivileged BPF.',
    kernelNote: 'The value-2 semantics and the BPF_UNPRIV_DEFAULT_OFF build default arrived in 5.16; older kernels only understand 0 and 1.',
  }),
  param({
    key: 'kernel.kexec_load_disabled',
    label: 'Disable kexec',
    description: 'Prevents loading a replacement kernel image via kexec, which is otherwise a way for root to sidestep Secure Boot and lockdown.',
    category: 'kernelSecurity',
    defaultValue: '1',
    kind: 'boolean',
    riskNote: 'One-way switch: once set to 1 it cannot be cleared, and kdump crash-dumping will no longer work.',
  }),
  param({
    key: 'kernel.yama.ptrace_scope',
    label: 'Yama ptrace Scope',
    description: 'How far one process may ptrace another. Restricting it stops a compromised process from scraping credentials out of its siblings.',
    category: 'kernelSecurity',
    defaultValue: '1',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — Classic: any same-uid process' },
      { value: '1', label: '1 — Descendants only, unless PR_SET_PTRACER is used' },
      { value: '2', label: '2 — Only processes with CAP_SYS_PTRACE' },
      { value: '3', label: '3 — No ptrace at all, irreversibly' },
    ],
    riskNote: 'Value 3 cannot be lowered without a reboot. Values above 0 break gdb/strace attach-by-PID and some crash handlers.',
    kernelNote: 'Requires the Yama LSM to be built and enabled; the key is absent otherwise.',
  }),
  param({
    key: 'kernel.perf_event_paranoid',
    label: 'perf Event Paranoia',
    description: 'How much performance-monitoring access unprivileged users get. Kernel default is 2.',
    category: 'kernelSecurity',
    defaultValue: '2',
    kind: 'enumerated',
    options: [
      { value: '-1', label: '-1 — Allow almost everything' },
      { value: '0', label: '0 — Disallow raw tracepoint access without CAP_PERFMON' },
      { value: '1', label: '1 — Also disallow CPU event access' },
      { value: '2', label: '2 — Also disallow kernel profiling (kernel default)' },
      { value: '3', label: '3 — Disallow all unprivileged perf use (Debian/Ubuntu patch)' },
    ],
    riskNote: 'Values above 2 exist only on Debian/Ubuntu-patched kernels; on mainline the write is accepted but clamps at 2.',
  }),
  param({
    key: 'kernel.modules_disabled',
    label: 'Disable Module Loading',
    description: 'Freezes the set of loaded kernel modules. A strong late-boot hardening step for appliance-like hosts with a static hardware profile.',
    category: 'kernelSecurity',
    defaultValue: '1',
    kind: 'boolean',
    riskNote:
      'One-way switch until reboot, and it blocks on-demand module loads — filesystems, netfilter tables, congestion-control algorithms. Apply it only after everything the host needs is already loaded, never early in boot.',
  }),
  param({
    key: 'kernel.panic_on_oops',
    label: 'Panic on Oops',
    description: 'Turn a kernel oops into a full panic rather than letting a wounded kernel keep running. Common on clustered nodes where fail-fast is preferable.',
    category: 'kernelSecurity',
    defaultValue: '1',
    kind: 'boolean',
    riskNote: 'A single recoverable oops will take the host down. Pair with kernel.panic so it reboots.',
  }),
  param({
    key: 'kernel.panic',
    label: 'Panic Reboot Delay',
    description: 'Seconds to wait after a panic before rebooting. 0 loops forever (useful with a serial console), a negative value reboots immediately.',
    category: 'kernelSecurity',
    defaultValue: '60',
    kind: 'integer',
  }),
  param({
    key: 'fs.suid_dumpable',
    label: 'Core Dumps From SUID Binaries',
    description: 'Whether privileged or privilege-changing binaries may write core dumps, which can contain secrets they hold in memory.',
    category: 'kernelSecurity',
    defaultValue: '0',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — Never dump privileged processes (kernel default)' },
      { value: '1', label: '1 — Always dump (debug only, unsafe)' },
      { value: '2', label: '2 — Dump only via a fully qualified path or pipe handler' },
    ],
    riskNote: 'Value 1 lets any user read a dump of a setuid binary and is documented as debug-only.',
  }),
  param({
    key: 'fs.protected_hardlinks',
    label: 'Protected Hardlinks',
    description: 'Refuse hardlinks to files the linking user neither owns nor can read and write, closing a long-standing privilege-escalation trick in world-writable directories.',
    category: 'kernelSecurity',
    defaultValue: '1',
    kind: 'boolean',
  }),
  param({
    key: 'fs.protected_symlinks',
    label: 'Protected Symlinks',
    description: 'Refuse to follow symlinks in sticky world-writable directories unless the follower owns the link or the link and directory share an owner. Blocks the classic /tmp symlink race.',
    category: 'kernelSecurity',
    defaultValue: '1',
    kind: 'boolean',
  }),
  param({
    key: 'fs.protected_fifos',
    label: 'Protected FIFOs',
    description: 'Refuse O_CREAT opens of FIFOs the opener does not own inside shared sticky directories, so a planted FIFO cannot hijack a privileged write.',
    category: 'kernelSecurity',
    defaultValue: '2',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — No restriction (kernel default)' },
      { value: '1', label: '1 — Restrict in world-writable sticky directories' },
      { value: '2', label: '2 — Also restrict in group-writable sticky directories' },
    ],
    kernelNote: 'Added in Linux 4.19; the key is absent on older kernels.',
  }),
  param({
    key: 'fs.protected_regular',
    label: 'Protected Regular Files',
    description: 'The same O_CREAT protection as protected_fifos, applied to regular files in shared sticky directories.',
    category: 'kernelSecurity',
    defaultValue: '2',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — No restriction (kernel default)' },
      { value: '1', label: '1 — Restrict in world-writable sticky directories' },
      { value: '2', label: '2 — Also restrict in group-writable sticky directories' },
    ],
    kernelNote: 'Added in Linux 4.19; the key is absent on older kernels.',
  }),

  // ---------------------------------------------------------------------
  // File System & Limits
  // ---------------------------------------------------------------------
  param({
    key: 'fs.file-max',
    label: 'System-Wide File Handle Limit',
    description:
      'Maximum file handles the kernel will allocate across the whole system. Modern kernels already derive a generous value from RAM; raise it only when /proc/sys/fs/file-nr shows you approaching the ceiling.',
    category: 'fileSystemAndLimits',
    defaultValue: '2097152',
    kind: 'integer',
    riskNote: 'This is a system-wide ceiling, not a per-process one — per-process limits come from RLIMIT_NOFILE (ulimit -n / LimitNOFILE=).',
  }),
  param({
    key: 'fs.nr_open',
    label: 'Per-Process File Descriptor Ceiling',
    description: 'Hard upper bound on what RLIMIT_NOFILE may be raised to for a single process. Kernel default is 1048576. Raise this before raising ulimit -n beyond it.',
    category: 'fileSystemAndLimits',
    defaultValue: '1048576',
    kind: 'integer',
  }),
  param({
    key: 'fs.inotify.max_user_watches',
    label: 'inotify Watches Per User',
    description: 'Files a single user may watch across all inotify instances. The usual default of 8192 is exhausted quickly by IDEs, file syncers, and container runtimes watching config trees.',
    category: 'fileSystemAndLimits',
    defaultValue: '524288',
    kind: 'integer',
    riskNote: 'Each watch pins a small amount of unswappable kernel memory, so this is not free on hosts with many users.',
  }),
  param({
    key: 'fs.inotify.max_user_instances',
    label: 'inotify Instances Per User',
    description: 'Number of inotify file descriptors one user may hold open. The default of 128 is low for a host running many watchers (Kubernetes kubelet, log shippers, dev tooling).',
    category: 'fileSystemAndLimits',
    defaultValue: '1024',
    kind: 'integer',
  }),
  param({
    key: 'fs.inotify.max_queued_events',
    label: 'inotify Queue Depth',
    description: 'Events buffered per inotify instance before overflow is signalled. Raise it where a watcher cannot keep up with bursty directory churn.',
    category: 'fileSystemAndLimits',
    defaultValue: '65536',
    kind: 'integer',
  }),
  param({
    key: 'fs.aio-max-nr',
    label: 'Max Async I/O Requests',
    description:
      'System-wide ceiling on outstanding asynchronous I/O requests. Databases using native AIO (Oracle, MySQL/InnoDB) need this raised; the kernel does not pre-allocate for it, so raising it costs nothing until used.',
    category: 'fileSystemAndLimits',
    defaultValue: '1048576',
    kind: 'integer',
  }),

  // ---------------------------------------------------------------------
  // Processes, Scheduling & NUMA
  // ---------------------------------------------------------------------
  param({
    key: 'kernel.pid_max',
    label: 'Maximum PID',
    description: 'Value at which PID allocation wraps. Container hosts run out of the 32768 default quickly. The ceiling is 4194304 on 64-bit systems.',
    category: 'processAndScheduling',
    defaultValue: '4194304',
    kind: 'integer',
    riskNote: 'A handful of old tools assume PIDs fit in five digits. Verify your monitoring before going to the maximum.',
  }),
  param({
    key: 'kernel.threads-max',
    label: 'Maximum Threads',
    description:
      'System-wide cap on threads created via fork(). The kernel derives its default from RAM (roughly enough that thread stacks cannot exhaust memory), so size any override against the machine rather than copying a number. The hard ceiling is 0x3fffffff.',
    category: 'processAndScheduling',
    defaultValue: '1048576',
    kind: 'integer',
    riskNote: 'Raising it above what RAM supports converts a clean thread-creation failure into an OOM.',
  }),
  param({
    key: 'kernel.numa_balancing',
    label: 'Automatic NUMA Balancing',
    description:
      'Automatic migration of pages and tasks toward each other to improve NUMA locality. This is the NUMA balancing toggle; it is unrelated to vm.zone_reclaim_mode, which is a memory-reclaim locality setting.',
    category: 'processAndScheduling',
    defaultValue: '1',
    kind: 'enumerated',
    options: [
      { value: '0', label: '0 — Disabled' },
      { value: '1', label: '1 — Normal NUMA balancing' },
      { value: '2', label: '2 — Memory-tiering mode' },
    ],
    riskNote:
      'The scanning and page migration cost real CPU. Databases and latency-sensitive services that already pin memory with numactl usually want this off — benchmark before changing it in production.',
    kernelNote: 'The value-2 memory-tiering mode is recent; older kernels treat this as a plain 0/1 toggle.',
  }),
  param({
    key: 'kernel.sched_autogroup_enabled',
    label: 'Scheduler Autogrouping',
    description: 'Groups tasks by session so an interactive shell is not starved by a large parallel build. Desirable on workstations, usually disabled on servers where it can distort per-service fairness.',
    category: 'processAndScheduling',
    defaultValue: '0',
    kind: 'boolean',
  }),
  param({
    key: 'kernel.sched_rt_runtime_us',
    label: 'Real-Time CPU Budget',
    description: 'Microseconds per sched_rt_period_us that real-time tasks may consume. The default 950000 of 1000000 reserves 5% for non-RT work, which is what stops a runaway RT task wedging the machine.',
    category: 'processAndScheduling',
    defaultValue: '950000',
    kind: 'integer',
    riskNote: '-1 removes the throttle entirely; a spinning SCHED_FIFO task then locks up the CPU with no way in.',
  }),
  param({
    key: 'kernel.sched_rt_period_us',
    label: 'Real-Time Accounting Period',
    description: 'Length in microseconds of the window over which sched_rt_runtime_us is accounted. Default 1000000 (1s).',
    category: 'processAndScheduling',
    defaultValue: '1000000',
    kind: 'integer',
  }),
  param({
    key: 'kernel.sched_cfs_bandwidth_slice_us',
    label: 'CFS Bandwidth Slice',
    description:
      'Microseconds of CPU quota a cgroup pulls from the global pool at a time. Lowering it reduces the throttling burstiness that container workloads see under CPU limits.',
    category: 'processAndScheduling',
    defaultValue: '3000',
    kind: 'integer',
    kernelNote: 'Still a real sysctl on EEVDF kernels — cgroup bandwidth control survived the CFS-to-EEVDF change even though the old latency/granularity knobs did not.',
  }),
  param({
    key: 'kernel.sched_schedstats',
    label: 'Scheduler Statistics',
    description: 'Collects per-task and per-runqueue scheduler statistics for /proc/schedstat. Needed by some latency analysis tooling; off by default because it is not free.',
    category: 'processAndScheduling',
    defaultValue: '0',
    kind: 'boolean',
  }),
  param({
    key: 'kernel.sched_energy_aware',
    label: 'Energy Aware Scheduling',
    description: 'Enables energy-model-driven task placement on asymmetric-capacity CPUs (big.LITTLE and similar). No effect on symmetric server hardware.',
    category: 'processAndScheduling',
    defaultValue: '1',
    kind: 'boolean',
  }),

  // ---------------------------------------------------------------------
  // Netfilter Connection Tracking
  // ---------------------------------------------------------------------
  param({
    key: 'net.netfilter.nf_conntrack_max',
    label: 'Max Tracked Connections',
    description:
      'Maximum entries in the connection-tracking table. Relevant on anything using iptables/nftables state matching, NAT, Docker or Kubernetes. Note each connection consumes two entries (one per direction).',
    category: 'connectionTracking',
    defaultValue: '262144',
    kind: 'integer',
    riskNote: 'Each entry costs kernel memory; size it against host RAM. When the table fills, new connections are dropped with "nf_conntrack: table full" in dmesg.',
    kernelNote: 'Defaults to the value of nf_conntrack_buckets, which the module derives from total memory at load time.',
  }),
  param({
    key: 'net.netfilter.nf_conntrack_buckets',
    label: 'Conntrack Hash Buckets',
    description:
      'Size of the conntrack hash table. Conventionally set to about a quarter of nf_conntrack_max so average chain length stays near 2 given the two entries per connection.',
    category: 'connectionTracking',
    defaultValue: '65536',
    kind: 'integer',
    riskNote: 'Writable only in the initial network namespace, so it has no effect from inside a container.',
    kernelNote: 'On some kernels this is only settable as the nf_conntrack module parameter hashsize; a sysctl write may be rejected.',
  }),
  param({
    key: 'net.netfilter.nf_conntrack_tcp_timeout_established',
    label: 'Established TCP Conntrack Timeout',
    description:
      'Seconds an idle established TCP flow stays tracked. The kernel default of 432000 (5 days) is what silently fills conntrack tables on busy NAT gateways; a day or less is typical for tuned hosts.',
    category: 'connectionTracking',
    defaultValue: '86400',
    kind: 'integer',
    riskNote: 'Shortening this below the TCP keepalive interval of your clients will drop genuinely idle-but-alive long-lived connections.',
  }),
  param({
    key: 'net.netfilter.nf_conntrack_tcp_timeout_time_wait',
    label: 'TIME_WAIT Conntrack Timeout',
    description: 'Seconds a closed flow stays in the table in TIME_WAIT. Kernel default is 120; lowering it reclaims table space on high-churn gateways.',
    category: 'connectionTracking',
    defaultValue: '30',
    kind: 'integer',
  }),
  param({
    key: 'net.netfilter.nf_conntrack_generic_timeout',
    label: 'Generic Protocol Conntrack Timeout',
    description: 'Seconds a flow of an unrecognised layer-4 protocol stays tracked. Kernel default is 600.',
    category: 'connectionTracking',
    defaultValue: '120',
    kind: 'integer',
  }),
  param({
    key: 'net.netfilter.nf_conntrack_tcp_loose',
    label: 'Pick Up Existing Connections',
    description:
      'Whether conntrack adopts flows whose handshake it never saw. Enabled by default so a firewall restart does not sever existing sessions; disabling it is stricter but drops mid-stream flows.',
    category: 'connectionTracking',
    defaultValue: '0',
    kind: 'boolean',
    riskNote: 'Disabling this will cut every established connection that existed before conntrack loaded, and breaks asymmetric-routing setups.',
  }),
]

/** Catalog lookup by key. Returns null for keys not in the catalog. */
export function sysctlParameterFor(key: string): SysctlParameter | null {
  for (const parameter of kSysctlParameterCatalog) {
    if (parameter.key === key) return parameter
  }
  return null
}

/**
 * A named, coherent set of parameters and values the user can apply in one
 * click as a starting point.
 *
 * Presets are *additive*: applying one selects its keys and sets their
 * values, and leaves anything the user had already selected untouched. That
 * is deliberate — someone building a hardened, high-traffic host should be
 * able to stack the security baseline and the network preset without one
 * silently deleting the other's choices. The overlap is small and where it
 * exists the later-applied preset wins for that key only.
 */
export interface SysctlPreset {
  id: string
  name: string
  description: string
  /**
   * Parameter key -> value. Every key here exists in
   * `kSysctlParameterCatalog` and every value is legal for its parameter —
   * pinned by tests.
   */
  values: Record<string, string>
}

/**
 * The preset's values sanitized through the catalog, with any key that is
 * not in the catalog dropped. Use this rather than `preset.values` when
 * applying a preset so a bad entry can never reach a generated config.
 */
export function sysctlResolvePreset(preset: SysctlPreset): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const [key, value] of Object.entries(preset.values)) {
    const parameter = sysctlParameterFor(key)
    if (parameter == null) continue
    resolved[key] = sysctlSanitize(parameter, value)
  }
  return resolved
}

/**
 * The shared caveat shown next to the preset buttons. Presets are a
 * starting point, not a recommendation for a specific machine.
 */
export const kSysctlPresetCaveat =
  'Presets are a starting point, not a verdict. Values that depend on RAM, NIC ' +
  'speed or workload are only rough defaults here — review every line, and ' +
  'validate against your own workload in a staging environment before applying ' +
  'to production.'

/** The built-in presets. */
export const kSysctlPresets: SysctlPreset[] = [
  {
    id: 'security-baseline',
    name: 'Security hardening baseline',
    description:
      'Network and kernel hardening drawn from CIS-style baselines: anti-spoofing, no ICMP redirects, IPv6 RA/redirect refusal, restricted kernel information exposure, and the filesystem link/FIFO protections. Excludes the irreversible switches (kexec_load_disabled, modules_disabled, ptrace_scope 3) — select those deliberately.',
    values: {
      // Network
      'net.ipv4.tcp_syncookies': '1',
      'net.ipv4.ip_forward': '0',
      'net.ipv4.conf.all.rp_filter': '1',
      'net.ipv4.conf.default.rp_filter': '1',
      'net.ipv4.conf.all.accept_source_route': '0',
      'net.ipv4.conf.default.accept_source_route': '0',
      'net.ipv4.conf.all.accept_redirects': '0',
      'net.ipv4.conf.default.accept_redirects': '0',
      'net.ipv4.conf.all.secure_redirects': '0',
      'net.ipv4.conf.default.secure_redirects': '0',
      'net.ipv4.conf.all.send_redirects': '0',
      'net.ipv4.conf.default.send_redirects': '0',
      'net.ipv4.conf.all.log_martians': '1',
      'net.ipv4.conf.default.log_martians': '1',
      'net.ipv4.icmp_echo_ignore_broadcasts': '1',
      'net.ipv4.icmp_ignore_bogus_error_responses': '1',
      'net.ipv4.tcp_rfc1337': '1',
      'net.ipv6.conf.all.accept_redirects': '0',
      'net.ipv6.conf.default.accept_redirects': '0',
      'net.ipv6.conf.all.accept_source_route': '-1',
      'net.ipv6.conf.default.accept_source_route': '-1',
      'net.ipv6.conf.all.accept_ra': '0',
      'net.ipv6.conf.default.accept_ra': '0',
      'net.ipv6.conf.all.forwarding': '0',
      'net.core.bpf_jit_harden': '2',
      // Kernel & filesystem
      'kernel.kptr_restrict': '2',
      'kernel.dmesg_restrict': '1',
      'kernel.sysrq': '0',
      'kernel.randomize_va_space': '2',
      'kernel.unprivileged_bpf_disabled': '2',
      'kernel.yama.ptrace_scope': '1',
      'kernel.perf_event_paranoid': '2',
      'fs.suid_dumpable': '0',
      'fs.protected_hardlinks': '1',
      'fs.protected_symlinks': '1',
      'fs.protected_fifos': '2',
      'fs.protected_regular': '2',
    },
  },
  {
    id: 'high-concurrency-network',
    name: 'High-concurrency network server',
    description:
      'Queue depths, socket buffers, ephemeral ports and connection lifecycle timings for a host terminating a large number of concurrent TCP connections — reverse proxy, API gateway, load balancer. Buffer sizes assume a 10 GbE-class NIC; recompute them from your own bandwidth-delay product.',
    values: {
      'net.core.somaxconn': '65535',
      'net.ipv4.tcp_max_syn_backlog': '65535',
      'net.core.netdev_max_backlog': '16384',
      'net.core.netdev_budget': '600',
      'net.core.rmem_max': '16777216',
      'net.core.wmem_max': '16777216',
      'net.core.rmem_default': '262144',
      'net.core.wmem_default': '262144',
      'net.ipv4.tcp_rmem': '4096 131072 16777216',
      'net.ipv4.tcp_wmem': '4096 65536 16777216',
      'net.ipv4.tcp_moderate_rcvbuf': '1',
      'net.ipv4.tcp_congestion_control': 'bbr',
      'net.core.default_qdisc': 'fq',
      'net.ipv4.tcp_tw_reuse': '1',
      'net.ipv4.tcp_max_tw_buckets': '1048576',
      'net.ipv4.tcp_fin_timeout': '15',
      'net.ipv4.tcp_keepalive_time': '300',
      'net.ipv4.tcp_keepalive_probes': '5',
      'net.ipv4.tcp_keepalive_intvl': '15',
      'net.ipv4.ip_local_port_range': '10240 65535',
      'net.ipv4.tcp_slow_start_after_idle': '0',
      'net.ipv4.tcp_mtu_probing': '1',
      'net.ipv4.tcp_fastopen': '3',
      'net.ipv4.tcp_syncookies': '1',
      'fs.file-max': '2097152',
      'fs.nr_open': '1048576',
    },
  },
  {
    id: 'container-host',
    name: 'Container / Kubernetes node',
    description:
      'What a container host needs beyond stock defaults: forwarding on, a much larger PID space, conntrack sized for pod-to-pod churn, inotify limits that survive a busy kubelet, and the mmap count Elasticsearch-class workloads demand.',
    values: {
      'net.ipv4.ip_forward': '1',
      'kernel.pid_max': '4194304',
      'kernel.threads-max': '1048576',
      'fs.file-max': '2097152',
      'fs.nr_open': '1048576',
      'fs.inotify.max_user_watches': '524288',
      'fs.inotify.max_user_instances': '1024',
      'fs.inotify.max_queued_events': '65536',
      'vm.max_map_count': '262144',
      'net.core.somaxconn': '32768',
      'net.netfilter.nf_conntrack_max': '1048576',
      'net.netfilter.nf_conntrack_buckets': '262144',
      'net.netfilter.nf_conntrack_tcp_timeout_established': '86400',
      'net.netfilter.nf_conntrack_tcp_timeout_time_wait': '30',
      'kernel.sched_cfs_bandwidth_slice_us': '3000',
    },
  },
  {
    id: 'database-host',
    name: 'Database host (memory & I/O)',
    description:
      'Writeback, overcommit and NUMA behaviour for a machine dominated by one large database process. min_free_kbytes and nr_hugepages are RAM- and instance-sized and are deliberately left out — set those from your own numbers.',
    values: {
      'vm.swappiness': '1',
      'vm.dirty_ratio': '15',
      'vm.dirty_background_ratio': '5',
      'vm.dirty_expire_centisecs': '500',
      'vm.dirty_writeback_centisecs': '100',
      'vm.overcommit_memory': '2',
      'vm.overcommit_ratio': '80',
      'vm.vfs_cache_pressure': '50',
      'vm.max_map_count': '262144',
      'vm.zone_reclaim_mode': '0',
      'kernel.numa_balancing': '0',
      'fs.aio-max-nr': '1048576',
      'fs.file-max': '2097152',
      'fs.nr_open': '1048576',
      'net.ipv4.tcp_keepalive_time': '300',
      'net.ipv4.tcp_slow_start_after_idle': '0',
    },
  },
]

/**
 * Whether the generated snippet applies immediately and is lost on reboot
 * (`temporary`, via `sysctl -w`) or is written as a persistent
 * `/etc/sysctl.d/*.conf` file (`permanent`).
 */
export type OutputMode = 'temporary' | 'permanent'

/**
 * Input for `SysctlConfigBuilder`: which parameters the user actually
 * selected, and the value they want for each (pre-filled from the
 * catalog's default, editable). Only keys present in `selectedValues` are
 * considered "selected" — this is what keeps the generated output a
 * minimal, intentional diff rather than a dump of every known parameter.
 */
export interface SysctlConfigBuilderInput {
  /** Parameter key -> user-edited value. Keys not found in the catalog are ignored. */
  selectedValues: Record<string, string>
  mode: OutputMode
}

/**
 * Builds a `sysctl -w` command list (temporary) or a
 * `/etc/sysctl.d/99-infrakit-custom.conf`-style snippet (permanent) from
 * whichever parameters the user selected — anywhere from one to the whole
 * catalog. Complementary to the fixed network-profile output of
 * `LinuxSysctlTuner`: this tool is the broad, pick-your-own-parameters
 * catalog.
 */
export class SysctlConfigBuilder implements IToolUseCase<SysctlConfigBuilderInput, string> {
  /**
   * Suggested filename for the "Save as file" action, and the basename of
   * `permanentConfigPath`. `99-` sorts last so this drop-in wins over the
   * distribution's own files.
   */
  static readonly permanentFileName = '99-infrakit-custom.conf'

  static readonly permanentConfigPath = `/etc/sysctl.d/${SysctlConfigBuilder.permanentFileName}`

  execute(input: SysctlConfigBuilderInput): string {
    const selected: Array<[SysctlParameter, string]> = []
    for (const parameter of kSysctlParameterCatalog) {
      const rawValue = input.selectedValues[parameter.key]
      if (rawValue == null) continue
      // sysctlSanitize both fills in blanks and refuses to emit a value
      // outside an enumerated parameter's documented set.
      selected.push([parameter, sysctlSanitize(parameter, rawValue)])
    }

    if (selected.length === 0) {
      return (
        '# No parameters selected.\n' +
        '# Check one or more parameters on the left — or apply a preset — ' +
        'to generate a sysctl configuration.'
      )
    }

    const lines: string[] = []
    if (input.mode === 'permanent') {
      lines.push(`# ${SysctlConfigBuilder.permanentConfigPath}`)
      lines.push('')
    }

    let firstCategory = true
    for (const category of sysctlParameterCategoryValues) {
      const entriesInCategory = selected.filter(([parameter]) => parameter.category === category)
      if (entriesInCategory.length === 0) continue

      if (!firstCategory) lines.push('')
      firstCategory = false

      lines.push(`# ${sysctlParameterCategoryLabel(category)}`)
      for (const [parameter, value] of entriesInCategory) {
        const line =
          input.mode === 'temporary' ? `sysctl -w ${parameter.key}=${value}` : `${parameter.key} = ${value}`
        lines.push(line)
      }
    }

    if (input.mode === 'permanent') {
      lines.push('')
      lines.push(`# Apply with: sudo sysctl -p ${SysctlConfigBuilder.permanentConfigPath}`)
      lines.push('# or reload every drop-in file with: sudo sysctl --system')
    }

    return lines.join('\n').replace(/\s+$/, '')
  }
}
