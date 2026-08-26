import { describe, expect, it } from 'vitest'
import { LinuxSysctlTuner } from './linuxSysctlTuner'

describe('LinuxSysctlTuner', () => {
  const tuner = new LinuxSysctlTuner()

  it('matches the spec worked example: 10 Gbps + BBR + 16 GB', () => {
    const result = tuner.execute({
      interfaceProfile: 'tenGigabit',
      enableBbr: true,
      enableTimeWaitReuse: true,
      synBacklog: 8192,
      socketMemoryGb: 16,
    })

    expect(result.somaxconn).toBe(8192)
    expect(result.tcpMaxSynBacklog).toBe(8192)
    expect(result.rmemMax).toBe(67108864)
    expect(result.wmemMax).toBe(67108864)
    expect(result.tcpRmem).toBe('4096 87380 33554432')
    expect(result.tcpWmem).toBe('4096 65536 33554432')
    expect(result.defaultQdisc).toBe('fq')
    expect(result.tcpCongestionControl).toBe('bbr')
    expect(result.configText).toContain('net.core.somaxconn = 8192')
    expect(result.configText).toContain('net.ipv4.tcp_tw_reuse = 1')
    expect(result.configText).toContain('Profile: 10 Gbps | BBR: Enabled')
  })

  it('BBR on vs off changes default_qdisc and tcp_congestion_control', () => {
    const baseInput = {
      interfaceProfile: 'tenGigabit' as const,
      enableBbr: true,
      enableTimeWaitReuse: true,
      synBacklog: 4096,
      socketMemoryGb: 8,
    }

    const withBbr = tuner.execute(baseInput)
    expect(withBbr.defaultQdisc).toBe('fq')
    expect(withBbr.tcpCongestionControl).toBe('bbr')

    const withoutBbr = tuner.execute({ ...baseInput, enableBbr: false })
    expect(withoutBbr.defaultQdisc).not.toBe('fq')
    expect(withoutBbr.tcpCongestionControl).not.toBe('bbr')
    expect(withoutBbr.defaultQdisc).toBe('pfifo_fast')
    expect(withoutBbr.tcpCongestionControl).toBe('cubic')
  })

  it('backlog value appears in both somaxconn and tcp_max_syn_backlog', () => {
    for (const backlog of [1024, 2048, 16384, 65536]) {
      const result = tuner.execute({
        interfaceProfile: 'oneGigabit',
        enableBbr: false,
        enableTimeWaitReuse: false,
        synBacklog: backlog,
        socketMemoryGb: 2,
      })

      expect(result.somaxconn).toBe(backlog)
      expect(result.tcpMaxSynBacklog).toBe(backlog)
      expect(result.configText).toContain(`net.core.somaxconn = ${backlog}`)
      expect(result.configText).toContain(`net.ipv4.tcp_max_syn_backlog = ${backlog}`)
    }
  })

  it('tcp_tw_reuse reflects the time-wait reuse toggle', () => {
    const enabled = tuner.execute({
      interfaceProfile: 'oneGigabit',
      enableBbr: false,
      enableTimeWaitReuse: true,
      synBacklog: 1024,
      socketMemoryGb: 1,
    })
    const disabled = tuner.execute({
      interfaceProfile: 'oneGigabit',
      enableBbr: false,
      enableTimeWaitReuse: false,
      synBacklog: 1024,
      socketMemoryGb: 1,
    })

    expect(enabled.configText).toContain('net.ipv4.tcp_tw_reuse = 1')
    expect(disabled.configText).toContain('net.ipv4.tcp_tw_reuse = 0')
  })

  it('higher interface profile allows a larger buffer ceiling', () => {
    const oneGig = tuner.execute({
      interfaceProfile: 'oneGigabit',
      enableBbr: true,
      enableTimeWaitReuse: true,
      synBacklog: 4096,
      socketMemoryGb: 1024,
    })
    const hundredGig = tuner.execute({
      interfaceProfile: 'fortyToHundredGigabit',
      enableBbr: true,
      enableTimeWaitReuse: true,
      synBacklog: 4096,
      socketMemoryGb: 1024,
    })

    expect(hundredGig.rmemMax).toBeGreaterThan(oneGig.rmemMax)
  })

  it('rejects a SYN backlog below the minimum', () => {
    expect(() =>
      tuner.execute({
        interfaceProfile: 'oneGigabit',
        enableBbr: true,
        enableTimeWaitReuse: true,
        synBacklog: 1023,
        socketMemoryGb: 4,
      }),
    ).toThrow()
  })

  it('rejects a SYN backlog above the maximum', () => {
    expect(() =>
      tuner.execute({
        interfaceProfile: 'oneGigabit',
        enableBbr: true,
        enableTimeWaitReuse: true,
        synBacklog: 65537,
        socketMemoryGb: 4,
      }),
    ).toThrow()
  })

  it('rejects an out-of-range socket memory value', () => {
    expect(() =>
      tuner.execute({
        interfaceProfile: 'oneGigabit',
        enableBbr: true,
        enableTimeWaitReuse: true,
        synBacklog: 4096,
        socketMemoryGb: 0,
      }),
    ).toThrow()
  })
})
