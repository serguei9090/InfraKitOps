import type { IToolUseCase } from '../ports/IToolUseCase'

/**
 * Network interface speed tier. Determines the ceiling applied to the
 * socket-buffer scaling (see `bufferCeilingBytes` below) so a 1 Gbps box
 * doesn't get told to reserve absurd amounts of buffer memory while a
 * 40/100 Gbps node isn't capped too low for a long-fat-network path.
 */
export type NetworkInterfaceProfile = 'oneGigabit' | 'tenGigabit' | 'fortyToHundredGigabit'

/** Short label used in the generated config's header comment and in radio button copy. */
export function networkInterfaceProfileLabel(profile: NetworkInterfaceProfile): string {
  switch (profile) {
    case 'oneGigabit':
      return '1 Gbps'
    case 'tenGigabit':
      return '10 Gbps'
    case 'fortyToHundredGigabit':
      return '40/100 Gbps'
  }
}

/** Longer description for the radio option, mirroring the spec wireframe. */
export function networkInterfaceProfileDescription(profile: NetworkInterfaceProfile): string {
  switch (profile) {
    case 'oneGigabit':
      return '1 Gbps Network Interface'
    case 'tenGigabit':
      return '10 Gbps Network Interface'
    case 'fortyToHundredGigabit':
      return '40 / 100 Gbps High-Throughput Node'
  }
}

export interface LinuxSysctlInput {
  interfaceProfile: NetworkInterfaceProfile
  enableBbr: boolean
  enableTimeWaitReuse: boolean
  /**
   * TCP SYN backlog queue size. Valid range: minSynBacklog..maxSynBacklog
   * inclusive.
   */
  synBacklog: number
  /**
   * System memory (GB) allocated for network socket buffers. Valid range:
   * minSocketMemoryGb..maxSocketMemoryGb inclusive.
   */
  socketMemoryGb: number
}

export interface LinuxSysctlResult {
  /** Full, ready-to-write contents of `/etc/sysctl.d/99-network-performance.conf`. */
  configText: string
  somaxconn: number
  tcpMaxSynBacklog: number
  rmemMax: number
  wmemMax: number
  tcpRmem: string
  tcpWmem: string
  defaultQdisc: string
  tcpCongestionControl: string
}

/**
 * Linux Kernel Sysctl tuner: given an interface speed profile and a handful
 * of network-stack knobs, generates a valid `/etc/sysctl.d/99-network-
 * performance.conf` style text block. Pure math/string formatting, zero I/O,
 * zero React — lives in the core so it is unit-testable in milliseconds
 * and reusable by any UI adapter.
 */
export class LinuxSysctlTuner implements IToolUseCase<LinuxSysctlInput, LinuxSysctlResult> {
  static readonly minSynBacklog = 1024
  static readonly maxSynBacklog = 65536

  static readonly minSocketMemoryGb = 1
  static readonly maxSocketMemoryGb = 1024

  private static readonly mib = 1024 * 1024

  /**
   * Kernel-recommended tcp_rmem/tcp_wmem "min" and "default" values. These
   * stay constant across profiles/inputs; only the "max" column scales.
   */
  private static readonly tcpRmemMin = 4096
  private static readonly tcpRmemDefault = 87380
  private static readonly tcpWmemMin = 4096
  private static readonly tcpWmemDefault = 65536

  execute(input: LinuxSysctlInput): LinuxSysctlResult {
    if (
      input.synBacklog < LinuxSysctlTuner.minSynBacklog ||
      input.synBacklog > LinuxSysctlTuner.maxSynBacklog
    ) {
      throw new Error(
        `synBacklog (${input.synBacklog}) must be between ${LinuxSysctlTuner.minSynBacklog} and ${LinuxSysctlTuner.maxSynBacklog}`,
      )
    }
    if (
      input.socketMemoryGb < LinuxSysctlTuner.minSocketMemoryGb ||
      input.socketMemoryGb > LinuxSysctlTuner.maxSocketMemoryGb
    ) {
      throw new Error(
        `socketMemoryGb (${input.socketMemoryGb}) must be between ${LinuxSysctlTuner.minSocketMemoryGb} and ${LinuxSysctlTuner.maxSocketMemoryGb}`,
      )
    }

    const somaxconn = input.synBacklog
    const tcpMaxSynBacklog = input.synBacklog
    const tcpTwReuse = input.enableTimeWaitReuse ? 1 : 0
    const defaultQdisc = input.enableBbr ? 'fq' : 'pfifo_fast'
    const tcpCongestionControl = input.enableBbr ? 'bbr' : 'cubic'

    // Scale the TCP buffer ceiling with the memory the operator set aside
    // for socket buffers (2 MiB of max buffer per GB allocated), capped by
    // the interface profile's ceiling so a modest 1G box isn't told to
    // reserve hundreds of MB and a 100G node isn't capped too low.
    const ceilingBytes = this.bufferCeilingBytes(input.interfaceProfile)
    const scaledMax = input.socketMemoryGb * 2 * LinuxSysctlTuner.mib
    const tcpBufferMax = clamp(scaledMax, LinuxSysctlTuner.mib, ceilingBytes)
    const rmemWmemMax = clamp(tcpBufferMax * 2, 2 * LinuxSysctlTuner.mib, ceilingBytes * 2)

    const tcpRmem = `${LinuxSysctlTuner.tcpRmemMin} ${LinuxSysctlTuner.tcpRmemDefault} ${tcpBufferMax}`
    const tcpWmem = `${LinuxSysctlTuner.tcpWmemMin} ${LinuxSysctlTuner.tcpWmemDefault} ${tcpBufferMax}`

    const lines: string[] = [
      '# /etc/sysctl.d/99-network-performance.conf',
      `# Profile: ${networkInterfaceProfileLabel(input.interfaceProfile)} | BBR: ${input.enableBbr ? 'Enabled' : 'Disabled'}`,
      '',
      `net.core.somaxconn = ${somaxconn}`,
      `net.ipv4.tcp_max_syn_backlog = ${tcpMaxSynBacklog}`,
      `net.ipv4.tcp_tw_reuse = ${tcpTwReuse}`,
      '',
      `net.core.default_qdisc = ${defaultQdisc}`,
      `net.ipv4.tcp_congestion_control = ${tcpCongestionControl}`,
      '',
      `net.core.rmem_max = ${rmemWmemMax}`,
      `net.core.wmem_max = ${rmemWmemMax}`,
      `net.ipv4.tcp_rmem = ${tcpRmem}`,
      `net.ipv4.tcp_wmem = ${tcpWmem}`,
    ]

    return {
      configText: lines.join('\n') + '\n',
      somaxconn,
      tcpMaxSynBacklog,
      rmemMax: rmemWmemMax,
      wmemMax: rmemWmemMax,
      tcpRmem,
      tcpWmem,
      defaultQdisc,
      tcpCongestionControl,
    }
  }

  /**
   * Ceiling (bytes) for the tcp_rmem/tcp_wmem "max" column, per interface
   * profile. rmem_max/wmem_max are double this value.
   */
  private bufferCeilingBytes(profile: NetworkInterfaceProfile): number {
    switch (profile) {
      case 'oneGigabit':
        return 8 * LinuxSysctlTuner.mib
      case 'tenGigabit':
        return 32 * LinuxSysctlTuner.mib
      case 'fortyToHundredGigabit':
        return 128 * LinuxSysctlTuner.mib
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
