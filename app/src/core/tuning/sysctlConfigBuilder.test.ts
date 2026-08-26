import { describe, expect, it } from 'vitest'
import {
  SysctlConfigBuilder,
  kSysctlParameterCatalog,
  kSysctlPresets,
  kSysctlPresetCaveat,
  sysctlParameterCategoryValues,
  sysctlParameterCategoryLabel,
  sysctlParameterFor,
  sysctlEffectiveOptions,
  sysctlIsLegalValue,
  sysctlSanitize,
  sysctlResolvePreset,
  type SysctlPreset,
} from './sysctlConfigBuilder'

describe('SysctlConfigBuilder', () => {
  const builder = new SysctlConfigBuilder()

  describe('output modes', () => {
    it('temporary mode emits sysctl -w lines grouped under category comments', () => {
      const output = builder.execute({
        selectedValues: {
          'vm.swappiness': '5',
          'vm.dirty_ratio': '15',
          'net.core.somaxconn': '2048',
          'net.ipv4.conf.all.rp_filter': '2',
          'kernel.kptr_restrict': '2',
          'fs.file-max': '500000',
        },
        mode: 'temporary',
      })

      expect(output).toContain('# Memory Management')
      expect(output).toContain('sysctl -w vm.swappiness=5')
      expect(output).toContain('sysctl -w vm.dirty_ratio=15')
      expect(output).toContain('# Network Performance')
      expect(output).toContain('sysctl -w net.core.somaxconn=2048')
      expect(output).toContain('# Network Security Hardening')
      expect(output).toContain('sysctl -w net.ipv4.conf.all.rp_filter=2')
      expect(output).toContain('# Kernel & Filesystem Security Hardening')
      expect(output).toContain('sysctl -w kernel.kptr_restrict=2')
      expect(output).toContain('# File System & Limits')
      expect(output).toContain('sysctl -w fs.file-max=500000')

      // Temporary mode is a direct command list, not a persistent file.
      expect(output).not.toContain('/etc/sysctl.d')
    })

    it('permanent mode emits a sysctl.d-style snippet with an apply reminder', () => {
      const output = builder.execute({
        selectedValues: {
          'fs.file-max': '100000',
          'fs.inotify.max_user_watches': '524288',
          'net.ipv4.tcp_fastopen': '3',
          'net.netfilter.nf_conntrack_max': '262144',
          'kernel.pid_max': '4194304',
        },
        mode: 'permanent',
      })

      expect(output).toContain('/etc/sysctl.d/99-infrakit-custom.conf')
      expect(output).toContain('# File System & Limits')
      expect(output).toContain('fs.file-max = 100000')
      expect(output).toContain('fs.inotify.max_user_watches = 524288')
      expect(output).toContain('# Network Performance')
      expect(output).toContain('net.ipv4.tcp_fastopen = 3')
      expect(output).toContain('# Netfilter Connection Tracking')
      expect(output).toContain('net.netfilter.nf_conntrack_max = 262144')
      expect(output).toContain('# Processes, Scheduling & NUMA')
      expect(output).toContain('kernel.pid_max = 4194304')
      expect(output).toContain('sysctl -p')
      expect(output).toContain('sysctl --system')

      // Permanent mode should not emit the temporary-mode command form.
      expect(output).not.toContain('sysctl -w')
    })

    it('the permanent filename constant matches the path emitted in the header', () => {
      expect(SysctlConfigBuilder.permanentFileName).toBe('99-infrakit-custom.conf')
      expect(SysctlConfigBuilder.permanentConfigPath.endsWith(SysctlConfigBuilder.permanentFileName)).toBe(true)

      const output = builder.execute({
        selectedValues: { 'vm.swappiness': '10' },
        mode: 'permanent',
      })
      expect(output).toContain(SysctlConfigBuilder.permanentConfigPath)
    })
  })

  describe('selection semantics', () => {
    it('only selected parameters appear in the output — unselected ones are absent', () => {
      const output = builder.execute({
        selectedValues: { 'vm.swappiness': '10' },
        mode: 'temporary',
      })

      expect(output).toContain('vm.swappiness')
      expect(output).not.toContain('net.core.somaxconn')
      expect(output).not.toContain('# Network Performance')
      expect(output).not.toContain('# Network Security Hardening')
    })

    it('empty selection produces a clear message, not an empty string or a crash', () => {
      const output = builder.execute({ selectedValues: {}, mode: 'temporary' })

      expect(output).not.toBe('')
      expect(output.toLowerCase()).toContain('no parameters selected')
    })

    it('empty selection message is the same in permanent mode and emits no config lines', () => {
      const output = builder.execute({ selectedValues: {}, mode: 'permanent' })

      expect(output.toLowerCase()).toContain('no parameters selected')
      expect(output).not.toContain(' = ')
      expect(output).not.toContain('sysctl -p')
    })

    it('an empty edited value falls back to the catalog default instead of emitting a blank value', () => {
      const output = builder.execute({
        selectedValues: { 'vm.swappiness': '   ' },
        mode: 'temporary',
      })

      expect(output).toContain('sysctl -w vm.swappiness=10')
    })

    it('unknown/unrecognized keys in the selection map are ignored rather than crashing', () => {
      const output = builder.execute({
        selectedValues: { 'not.a.real.key': '1', 'vm.swappiness': '10' },
        mode: 'temporary',
      })

      expect(output).toContain('vm.swappiness')
      expect(output).not.toContain('not.a.real.key')
    })
  })

  describe('category grouping', () => {
    it('multiple selected parameters in the same category share a single category comment', () => {
      const output = builder.execute({
        selectedValues: {
          'net.core.somaxconn': '4096',
          'net.ipv4.tcp_max_syn_backlog': '4096',
          'net.core.rmem_max': '8388608',
          'net.core.wmem_max': '8388608',
        },
        mode: 'temporary',
      })

      expect(output.split('# Network Performance').length - 1).toBe(1)
    })

    it('categories appear in enum order regardless of selection-map order', () => {
      const output = builder.execute({
        selectedValues: {
          // Deliberately reversed relative to sysctlParameterCategoryValues.
          'net.netfilter.nf_conntrack_max': '262144',
          'kernel.pid_max': '4194304',
          'fs.file-max': '2097152',
          'kernel.kptr_restrict': '2',
          'net.ipv4.tcp_syncookies': '1',
          'net.core.somaxconn': '4096',
          'vm.swappiness': '10',
        },
        mode: 'permanent',
      })

      const headingOrder = sysctlParameterCategoryValues.map((category) =>
        output.indexOf(`# ${sysctlParameterCategoryLabel(category)}`),
      )
      expect(headingOrder.every((i) => i >= 0)).toBe(true)
      const sorted = [...headingOrder].sort((a, b) => a - b)
      expect(headingOrder).toEqual(sorted)
    })

    it('every catalog parameter belongs to a category that has a non-empty label', () => {
      for (const category of sysctlParameterCategoryValues) {
        expect(sysctlParameterCategoryLabel(category)).not.toBe('')
      }
      for (const parameter of kSysctlParameterCatalog) {
        expect(sysctlParameterCategoryValues).toContain(parameter.category)
      }
    })

    it('every category actually has at least one parameter', () => {
      for (const category of sysctlParameterCategoryValues) {
        const matching = kSysctlParameterCatalog.filter((p) => p.category === category)
        expect(matching.length).toBeGreaterThan(0)
      }
    })
  })

  describe('value-kind typing', () => {
    it('enumerated and boolean parameters declare a legal value set; free-entry kinds do not', () => {
      for (const parameter of kSysctlParameterCatalog) {
        switch (parameter.kind) {
          case 'enumerated':
            expect(parameter.options.length).toBeGreaterThan(0)
            expect(sysctlEffectiveOptions(parameter)).toEqual(parameter.options)
            break
          case 'boolean':
            expect(parameter.options.length).toBe(0)
            expect(sysctlEffectiveOptions(parameter).map((o) => o.value)).toEqual(['0', '1'])
            break
          case 'integer':
          case 'tuple':
          case 'text':
            expect(parameter.options.length).toBe(0)
            expect(sysctlEffectiveOptions(parameter).length).toBe(0)
            break
        }
      }
    })

    it("every constrained parameter's own default is one of its legal values", () => {
      for (const parameter of kSysctlParameterCatalog) {
        const legal = sysctlEffectiveOptions(parameter)
        if (legal.length === 0) continue
        expect(legal.map((o) => o.value)).toContain(parameter.defaultValue)
      }
    })

    it('enumerated options have no duplicate values and every option is labelled', () => {
      for (const parameter of kSysctlParameterCatalog) {
        const values = sysctlEffectiveOptions(parameter).map((o) => o.value)
        expect(new Set(values).size).toBe(values.length)
        for (const option of sysctlEffectiveOptions(parameter)) {
          expect(option.label).not.toBe('')
        }
      }
    })

    it('enumerated params never emit an out-of-range value — it is replaced by the default', () => {
      const constrained = kSysctlParameterCatalog.filter((p) => sysctlEffectiveOptions(p).length > 0)
      expect(constrained.length).toBeGreaterThan(0)

      // Feed every constrained parameter garbage at once and assert the
      // output only ever contains documented values for those keys.
      const garbage: Record<string, string> = {}
      for (const p of constrained) garbage[p.key] = '9999'
      const output = builder.execute({ selectedValues: garbage, mode: 'permanent' })

      expect(output).not.toContain('9999')
      for (const parameter of constrained) {
        expect(output).toContain(`${parameter.key} = ${parameter.defaultValue}`)
      }
    })

    it('sanitize accepts documented values, rejects undocumented ones, and passes free text through', () => {
      const overcommit = kSysctlParameterCatalog.find((p) => p.key === 'vm.overcommit_memory')!
      expect(overcommit.kind).toBe('enumerated')
      expect(sysctlSanitize(overcommit, '2')).toBe('2')
      expect(sysctlSanitize(overcommit, '3')).toBe(overcommit.defaultValue)
      expect(sysctlIsLegalValue(overcommit, '1')).toBe(true)
      expect(sysctlIsLegalValue(overcommit, '7')).toBe(false)

      const fastopen = kSysctlParameterCatalog.find((p) => p.key === 'net.ipv4.tcp_fastopen')!
      expect(sysctlEffectiveOptions(fastopen).map((o) => o.value)).toEqual(['0', '1', '2', '3'])
      expect(sysctlSanitize(fastopen, '4')).toBe(fastopen.defaultValue)

      const sysrq = kSysctlParameterCatalog.find((p) => p.key === 'kernel.sysrq')!
      expect(sysrq.kind).toBe('enumerated')
      expect(sysctlSanitize(sysrq, '1')).toBe('1')
      expect(sysctlSanitize(sysrq, '999')).toBe(sysrq.defaultValue)

      const rmem = kSysctlParameterCatalog.find((p) => p.key === 'net.core.rmem_max')!
      expect(rmem.kind).toBe('integer')
      expect(sysctlSanitize(rmem, '33554432')).toBe('33554432')

      const congestion = kSysctlParameterCatalog.find((p) => p.key === 'net.ipv4.tcp_congestion_control')!
      expect(congestion.kind).toBe('text')
      expect(sysctlSanitize(congestion, 'cubic')).toBe('cubic')

      const portRange = kSysctlParameterCatalog.find((p) => p.key === 'net.ipv4.ip_local_port_range')!
      expect(portRange.kind).toBe('tuple')
      expect(sysctlSanitize(portRange, '1024 65535')).toBe('1024 65535')
    })

    it('boolean parameters only ever emit 0 or 1', () => {
      const booleans = kSysctlParameterCatalog.filter((p) => p.kind === 'boolean')
      expect(booleans.length).toBeGreaterThan(0)

      for (const parameter of booleans) {
        expect(sysctlSanitize(parameter, 'true')).toBe(parameter.defaultValue)
        expect(sysctlSanitize(parameter, '2')).toBe(parameter.defaultValue)
        expect(sysctlSanitize(parameter, '0')).toBe('0')
        expect(sysctlSanitize(parameter, '1')).toBe('1')
        expect(['0', '1']).toContain(parameter.defaultValue)
      }
    })

    it('the negative IPv6 routing-header value survives sanitisation (it is not a boolean)', () => {
      const v6 = kSysctlParameterCatalog.find((p) => p.key === 'net.ipv6.conf.all.accept_source_route')!
      expect(v6.kind).toBe('enumerated')
      expect(sysctlSanitize(v6, '-1')).toBe('-1')

      const output = builder.execute({
        selectedValues: { 'net.ipv6.conf.all.accept_source_route': '-1' },
        mode: 'permanent',
      })
      expect(output).toContain('net.ipv6.conf.all.accept_source_route = -1')
    })
  })

  describe('presets', () => {
    it('there is at least a security hardening baseline and a high-concurrency network preset', () => {
      const ids = kSysctlPresets.map((p) => p.id)
      expect(ids).toContain('security-baseline')
      expect(ids).toContain('high-concurrency-network')
      expect(new Set(ids).size).toBe(ids.length)
      for (const preset of kSysctlPresets) {
        expect(preset.name).not.toBe('')
        expect(preset.description).not.toBe('')
        expect(Object.keys(preset.values).length).toBeGreaterThan(0)
      }
    })

    it('every preset key exists in the catalog and every preset value is legal for its parameter', () => {
      for (const preset of kSysctlPresets) {
        for (const [key, value] of Object.entries(preset.values)) {
          const parameter = sysctlParameterFor(key)
          expect(parameter).not.toBeNull()
          expect(sysctlIsLegalValue(parameter!, value)).toBe(true)
          // resolve() must therefore be a no-op on the value.
          expect(sysctlResolvePreset(preset)[key]).toBe(value)
        }
      }
    })

    it('the security baseline preset produces the expected hardening keys', () => {
      const preset = kSysctlPresets.find((p) => p.id === 'security-baseline')!
      const output = builder.execute({ selectedValues: sysctlResolvePreset(preset), mode: 'permanent' })

      const expectedKeys = [
        'net.ipv4.tcp_syncookies',
        'net.ipv4.conf.all.rp_filter',
        'net.ipv4.conf.default.rp_filter',
        'net.ipv4.conf.all.accept_redirects',
        'net.ipv4.conf.all.accept_source_route',
        'net.ipv4.conf.all.send_redirects',
        'net.ipv4.conf.all.log_martians',
        'net.ipv4.icmp_echo_ignore_broadcasts',
        'net.ipv6.conf.all.accept_ra',
        'net.ipv6.conf.all.accept_redirects',
        'kernel.kptr_restrict',
        'kernel.dmesg_restrict',
        'kernel.randomize_va_space',
        'kernel.yama.ptrace_scope',
        'fs.protected_hardlinks',
        'fs.protected_symlinks',
        'fs.suid_dumpable',
      ]
      for (const key of expectedKeys) {
        expect(output).toContain(`${key} = `)
      }

      expect(output).toContain('# Network Security Hardening')
      expect(output).toContain('# Kernel & Filesystem Security Hardening')

      // The baseline stays away from the one-way switches; those must be an
      // explicit, deliberate choice by the operator.
      expect(Object.keys(preset.values)).not.toContain('kernel.kexec_load_disabled')
      expect(Object.keys(preset.values)).not.toContain('kernel.modules_disabled')
      expect(preset.values['kernel.yama.ptrace_scope']).not.toBe('3')
      expect(preset.values['kernel.unprivileged_bpf_disabled']).not.toBe('1')
    })

    it('the high-concurrency network preset produces the expected throughput keys', () => {
      const preset = kSysctlPresets.find((p) => p.id === 'high-concurrency-network')!
      const output = builder.execute({ selectedValues: sysctlResolvePreset(preset), mode: 'temporary' })

      const expectedKeys = [
        'net.core.somaxconn',
        'net.ipv4.tcp_max_syn_backlog',
        'net.core.netdev_max_backlog',
        'net.core.rmem_max',
        'net.core.wmem_max',
        'net.ipv4.tcp_rmem',
        'net.ipv4.tcp_wmem',
        'net.ipv4.tcp_tw_reuse',
        'net.ipv4.ip_local_port_range',
        'net.ipv4.tcp_fin_timeout',
        'net.ipv4.tcp_slow_start_after_idle',
        'net.core.default_qdisc',
        'net.ipv4.tcp_congestion_control',
        'fs.file-max',
      ]
      for (const key of expectedKeys) {
        expect(output).toContain(`sysctl -w ${key}=`)
      }
    })

    it('presets are additive: merging two presets keeps both key sets', () => {
      const security = sysctlResolvePreset(kSysctlPresets.find((p) => p.id === 'security-baseline')!)
      const network = sysctlResolvePreset(kSysctlPresets.find((p) => p.id === 'high-concurrency-network')!)

      const merged = { ...security, ...network }
      const output = builder.execute({ selectedValues: merged, mode: 'permanent' })

      expect(output).toContain('kernel.kptr_restrict = ')
      expect(output).toContain('net.core.somaxconn = ')
      expect(Object.keys(merged).length).toBeGreaterThan(Object.keys(security).length)
      expect(Object.keys(merged).length).toBeGreaterThan(Object.keys(network).length)
    })

    it('resolve() drops unknown keys and repairs illegal values', () => {
      const preset: SysctlPreset = {
        id: 'synthetic',
        name: 'Synthetic',
        description: 'Test-only preset with a bad key and a bad value.',
        values: {
          'not.a.real.key': '1',
          'vm.overcommit_memory': '42',
          'vm.swappiness': '7',
        },
      }

      const resolved = sysctlResolvePreset(preset)
      expect('not.a.real.key' in resolved).toBe(false)
      expect(resolved['vm.overcommit_memory']).toBe('0')
      expect(resolved['vm.swappiness']).toBe('7')
    })

    it('the preset caveat tells the user to validate against their own workload', () => {
      expect(kSysctlPresetCaveat.toLowerCase()).toContain('workload')
      expect(kSysctlPresetCaveat.toLowerCase()).toContain('validate')
    })
  })

  describe('catalog integrity and accuracy regressions', () => {
    it('tcp_tw_recycle is never offered in the catalog (removed in kernel 4.12, breaks NAT)', () => {
      for (const parameter of kSysctlParameterCatalog) {
        expect(parameter.key).not.toContain('tcp_tw_recycle')
        expect(parameter.label.toLowerCase()).not.toContain('tw_recycle')
      }
      for (const preset of kSysctlPresets) {
        for (const key of Object.keys(preset.values)) {
          expect(key).not.toContain('tcp_tw_recycle')
        }
      }
    })

    it('zone_reclaim_mode and numa_balancing are modeled as two separate, distinct parameters', () => {
      const zoneReclaim = kSysctlParameterCatalog.find((p) => p.key === 'vm.zone_reclaim_mode')!
      const numaBalancing = kSysctlParameterCatalog.find((p) => p.key === 'kernel.numa_balancing')!

      expect(zoneReclaim.key).not.toBe(numaBalancing.key)
      // Guard against the source article's conflation of the two settings:
      // zone_reclaim_mode's own description must describe zone/NUMA-node
      // memory reclaim, not claim to "enable NUMA balancing" (that is what
      // kernel.numa_balancing actually does).
      expect(zoneReclaim.description.toLowerCase()).toContain('zone')
      expect(zoneReclaim.description.toLowerCase()).toContain('reclaim')
      expect(zoneReclaim.description.toLowerCase()).not.toContain('enables automatic numa')
      expect(numaBalancing.description.toLowerCase()).toContain('migrat')
      // Each description explicitly disclaims being the other.
      expect(zoneReclaim.description.toLowerCase()).toContain('numa_balancing')
      expect(numaBalancing.description.toLowerCase()).toContain('zone_reclaim_mode')
    })

    it('the CFS-era scheduler knobs that moved to debugfs are not offered as sysctls', () => {
      // sched_latency_ns / sched_min_granularity_ns / sched_wakeup_granularity_ns
      // left /proc/sys/kernel for /sys/kernel/debug/sched in Linux 5.13, and
      // EEVDF (6.6) replaced them with base_slice_ns. Offering them here
      // would generate lines that simply fail on any current kernel.
      const gone = ['sched_latency_ns', 'sched_min_granularity_ns', 'sched_wakeup_granularity_ns']
      for (const parameter of kSysctlParameterCatalog) {
        for (const removed of gone) {
          expect(parameter.key).not.toContain(removed)
        }
      }
    })

    it('the full catalog has no duplicate keys', () => {
      const keys = kSysctlParameterCatalog.map((p) => p.key)
      expect(new Set(keys).size).toBe(keys.length)
    })

    it('every catalog entry is fully populated', () => {
      for (const parameter of kSysctlParameterCatalog) {
        expect(parameter.key).not.toBe('')
        expect(parameter.key).toContain('.')
        expect(parameter.label).not.toBe('')
        expect(parameter.description.length).toBeGreaterThan(20)
        expect(parameter.defaultValue.trim()).not.toBe('')
        expect(parameter.riskNote === undefined || parameter.riskNote !== '').toBe(true)
        expect(parameter.kernelNote === undefined || parameter.kernelNote !== '').toBe(true)
      }
    })

    it('tuple defaults really are space-separated multi-value strings', () => {
      const tuples = kSysctlParameterCatalog.filter((p) => p.kind === 'tuple')
      expect(tuples.length).toBeGreaterThan(0)
      for (const parameter of tuples) {
        expect(parameter.defaultValue.trim().split(/\s+/).length).toBeGreaterThan(1)
      }
    })

    it('the catalog covers every documented category with meaningful breadth', () => {
      expect(kSysctlParameterCatalog.length).toBeGreaterThanOrEqual(80)
      // Spot-check that each research area actually landed in the catalog.
      const mustExist = [
        'vm.dirty_expire_centisecs',
        'vm.overcommit_ratio',
        'vm.min_free_kbytes',
        'vm.max_map_count',
        'vm.nr_hugepages',
        'vm.panic_on_oom',
        'vm.oom_kill_allocating_task',
        'net.core.netdev_max_backlog',
        'net.core.rmem_default',
        'net.ipv4.tcp_mtu_probing',
        'net.ipv4.tcp_notsent_lowat',
        'net.ipv4.tcp_max_tw_buckets',
        'net.ipv4.tcp_keepalive_time',
        'net.ipv4.tcp_keepalive_probes',
        'net.ipv4.tcp_keepalive_intvl',
        'net.ipv4.conf.all.secure_redirects',
        'net.ipv4.icmp_ignore_bogus_error_responses',
        'net.ipv6.conf.all.accept_ra',
        'kernel.kexec_load_disabled',
        'kernel.unprivileged_bpf_disabled',
        'kernel.perf_event_paranoid',
        'kernel.yama.ptrace_scope',
        'fs.nr_open',
        'fs.inotify.max_user_instances',
        'fs.aio-max-nr',
        'kernel.threads-max',
        'net.netfilter.nf_conntrack_buckets',
        'net.netfilter.nf_conntrack_tcp_timeout_established',
      ]
      for (const key of mustExist) {
        expect(sysctlParameterFor(key)).not.toBeNull()
      }
    })

    it('sysctlParameterFor returns null for keys that are not in the catalog', () => {
      expect(sysctlParameterFor('net.ipv4.tcp_tw_recycle')).toBeNull()
      expect(sysctlParameterFor('')).toBeNull()
    })
  })
})
