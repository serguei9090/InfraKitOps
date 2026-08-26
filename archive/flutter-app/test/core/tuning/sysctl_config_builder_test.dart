import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/tuning/sysctl_config_builder.dart';

void main() {
  const builder = SysctlConfigBuilder();

  group('output modes', () {
    test('temporary mode emits sysctl -w lines grouped under category comments', () {
      final output = builder.execute(
        const SysctlConfigBuilderInput(
          selectedValues: {
            'vm.swappiness': '5',
            'vm.dirty_ratio': '15',
            'net.core.somaxconn': '2048',
            'net.ipv4.conf.all.rp_filter': '2',
            'kernel.kptr_restrict': '2',
            'fs.file-max': '500000',
          },
          mode: OutputMode.temporary,
        ),
      );

      expect(output, contains('# Memory Management'));
      expect(output, contains('sysctl -w vm.swappiness=5'));
      expect(output, contains('sysctl -w vm.dirty_ratio=15'));
      expect(output, contains('# Network Performance'));
      expect(output, contains('sysctl -w net.core.somaxconn=2048'));
      expect(output, contains('# Network Security Hardening'));
      expect(output, contains('sysctl -w net.ipv4.conf.all.rp_filter=2'));
      expect(output, contains('# Kernel & Filesystem Security Hardening'));
      expect(output, contains('sysctl -w kernel.kptr_restrict=2'));
      expect(output, contains('# File System & Limits'));
      expect(output, contains('sysctl -w fs.file-max=500000'));

      // Temporary mode is a direct command list, not a persistent file.
      expect(output, isNot(contains('/etc/sysctl.d')));
    });

    test('permanent mode emits a sysctl.d-style snippet with an apply reminder', () {
      final output = builder.execute(
        const SysctlConfigBuilderInput(
          selectedValues: {
            'fs.file-max': '100000',
            'fs.inotify.max_user_watches': '524288',
            'net.ipv4.tcp_fastopen': '3',
            'net.netfilter.nf_conntrack_max': '262144',
            'kernel.pid_max': '4194304',
          },
          mode: OutputMode.permanent,
        ),
      );

      expect(output, contains('/etc/sysctl.d/99-infrakit-custom.conf'));
      expect(output, contains('# File System & Limits'));
      expect(output, contains('fs.file-max = 100000'));
      expect(output, contains('fs.inotify.max_user_watches = 524288'));
      expect(output, contains('# Network Performance'));
      expect(output, contains('net.ipv4.tcp_fastopen = 3'));
      expect(output, contains('# Netfilter Connection Tracking'));
      expect(output, contains('net.netfilter.nf_conntrack_max = 262144'));
      expect(output, contains('# Processes, Scheduling & NUMA'));
      expect(output, contains('kernel.pid_max = 4194304'));
      expect(output, contains('sysctl -p'));
      expect(output, contains('sysctl --system'));

      // Permanent mode should not emit the temporary-mode command form.
      expect(output, isNot(contains('sysctl -w')));
    });

    test('the permanent filename constant matches the path emitted in the header', () {
      expect(SysctlConfigBuilder.permanentFileName, '99-infrakit-custom.conf');
      expect(SysctlConfigBuilder.permanentConfigPath, endsWith(SysctlConfigBuilder.permanentFileName));

      final output = builder.execute(
        const SysctlConfigBuilderInput(selectedValues: {'vm.swappiness': '10'}, mode: OutputMode.permanent),
      );
      expect(output, contains(SysctlConfigBuilder.permanentConfigPath));
    });
  });

  group('selection semantics', () {
    test('only selected parameters appear in the output — unselected ones are absent', () {
      final output = builder.execute(
        const SysctlConfigBuilderInput(
          selectedValues: {'vm.swappiness': '10'},
          mode: OutputMode.temporary,
        ),
      );

      expect(output, contains('vm.swappiness'));
      expect(output, isNot(contains('net.core.somaxconn')));
      expect(output, isNot(contains('# Network Performance')));
      expect(output, isNot(contains('# Network Security Hardening')));
    });

    test('empty selection produces a clear message, not an empty string or a crash', () {
      final output = builder.execute(
        const SysctlConfigBuilderInput(selectedValues: {}, mode: OutputMode.temporary),
      );

      expect(output, isNotEmpty);
      expect(output.toLowerCase(), contains('no parameters selected'));
    });

    test('empty selection message is the same in permanent mode and emits no config lines', () {
      final output = builder.execute(
        const SysctlConfigBuilderInput(selectedValues: {}, mode: OutputMode.permanent),
      );

      expect(output.toLowerCase(), contains('no parameters selected'));
      expect(output, isNot(contains(' = ')));
      expect(output, isNot(contains('sysctl -p')));
    });

    test('an empty edited value falls back to the catalog default instead of emitting a blank value', () {
      final output = builder.execute(
        const SysctlConfigBuilderInput(
          selectedValues: {'vm.swappiness': '   '},
          mode: OutputMode.temporary,
        ),
      );

      expect(output, contains('sysctl -w vm.swappiness=10'));
    });

    test('unknown/unrecognized keys in the selection map are ignored rather than crashing', () {
      final output = builder.execute(
        const SysctlConfigBuilderInput(
          selectedValues: {'not.a.real.key': '1', 'vm.swappiness': '10'},
          mode: OutputMode.temporary,
        ),
      );

      expect(output, contains('vm.swappiness'));
      expect(output, isNot(contains('not.a.real.key')));
    });
  });

  group('category grouping', () {
    test('multiple selected parameters in the same category share a single category comment', () {
      final output = builder.execute(
        const SysctlConfigBuilderInput(
          selectedValues: {
            'net.core.somaxconn': '4096',
            'net.ipv4.tcp_max_syn_backlog': '4096',
            'net.core.rmem_max': '8388608',
            'net.core.wmem_max': '8388608',
          },
          mode: OutputMode.temporary,
        ),
      );

      expect('# Network Performance'.allMatches(output).length, 1);
    });

    test('categories appear in enum order regardless of selection-map order', () {
      final output = builder.execute(
        const SysctlConfigBuilderInput(
          selectedValues: {
            // Deliberately reversed relative to SysctlParameterCategory.values.
            'net.netfilter.nf_conntrack_max': '262144',
            'kernel.pid_max': '4194304',
            'fs.file-max': '2097152',
            'kernel.kptr_restrict': '2',
            'net.ipv4.tcp_syncookies': '1',
            'net.core.somaxconn': '4096',
            'vm.swappiness': '10',
          },
          mode: OutputMode.permanent,
        ),
      );

      final headingOrder = [
        for (final category in SysctlParameterCategory.values) output.indexOf('# ${category.label}'),
      ];
      expect(headingOrder, everyElement(greaterThanOrEqualTo(0)));
      final sorted = [...headingOrder]..sort();
      expect(headingOrder, sorted, reason: 'category sections must be emitted in enum order');
    });

    test('every catalog parameter belongs to a category that has a non-empty label', () {
      for (final category in SysctlParameterCategory.values) {
        expect(category.label, isNotEmpty);
      }
      for (final parameter in kSysctlParameterCatalog) {
        expect(SysctlParameterCategory.values, contains(parameter.category));
      }
    });

    test('every category actually has at least one parameter', () {
      for (final category in SysctlParameterCategory.values) {
        expect(
          kSysctlParameterCatalog.where((p) => p.category == category),
          isNotEmpty,
          reason: '${category.label} has no parameters',
        );
      }
    });
  });

  group('value-kind typing', () {
    test('enumerated and boolean parameters declare a legal value set; free-entry kinds do not', () {
      for (final parameter in kSysctlParameterCatalog) {
        switch (parameter.kind) {
          case SysctlValueKind.enumerated:
            expect(parameter.options, isNotEmpty, reason: '${parameter.key} is enumerated but has no options');
            expect(parameter.effectiveOptions, parameter.options);
          case SysctlValueKind.boolean:
            expect(parameter.options, isEmpty, reason: '${parameter.key} is boolean; options are implicit');
            expect(parameter.effectiveOptions.map((o) => o.value), ['0', '1']);
          case SysctlValueKind.integer:
          case SysctlValueKind.tuple:
          case SysctlValueKind.text:
            expect(parameter.options, isEmpty, reason: '${parameter.key} is free-entry but declares options');
            expect(parameter.effectiveOptions, isEmpty);
        }
      }
    });

    test('every constrained parameter\'s own default is one of its legal values', () {
      for (final parameter in kSysctlParameterCatalog) {
        final legal = parameter.effectiveOptions;
        if (legal.isEmpty) continue;
        expect(
          legal.map((o) => o.value),
          contains(parameter.defaultValue),
          reason: '${parameter.key} default "${parameter.defaultValue}" is not in its own option set',
        );
      }
    });

    test('enumerated options have no duplicate values and every option is labelled', () {
      for (final parameter in kSysctlParameterCatalog) {
        final values = parameter.effectiveOptions.map((o) => o.value).toList();
        expect(values.toSet().length, values.length, reason: '${parameter.key} has duplicate option values');
        for (final option in parameter.effectiveOptions) {
          expect(option.label, isNotEmpty, reason: '${parameter.key} option ${option.value} has no label');
        }
      }
    });

    test('enumerated params never emit an out-of-range value — it is replaced by the default', () {
      final constrained = kSysctlParameterCatalog.where((p) => p.effectiveOptions.isNotEmpty).toList();
      expect(constrained, isNotEmpty);

      // Feed every constrained parameter garbage at once and assert the
      // output only ever contains documented values for those keys.
      final garbage = {for (final p in constrained) p.key: '9999'};
      final output = builder.execute(
        SysctlConfigBuilderInput(selectedValues: garbage, mode: OutputMode.permanent),
      );

      expect(output, isNot(contains('9999')));
      for (final parameter in constrained) {
        expect(
          output,
          contains('${parameter.key} = ${parameter.defaultValue}'),
          reason: '${parameter.key} should have fallen back to its default',
        );
      }
    });

    test('sanitize() accepts documented values, rejects undocumented ones, and passes free text through', () {
      final overcommit = kSysctlParameterCatalog.singleWhere((p) => p.key == 'vm.overcommit_memory');
      expect(overcommit.kind, SysctlValueKind.enumerated);
      expect(overcommit.sanitize('2'), '2');
      expect(overcommit.sanitize('3'), overcommit.defaultValue);
      expect(overcommit.isLegalValue('1'), isTrue);
      expect(overcommit.isLegalValue('7'), isFalse);

      final fastopen = kSysctlParameterCatalog.singleWhere((p) => p.key == 'net.ipv4.tcp_fastopen');
      expect(fastopen.effectiveOptions.map((o) => o.value), ['0', '1', '2', '3']);
      expect(fastopen.sanitize('4'), fastopen.defaultValue);

      final sysrq = kSysctlParameterCatalog.singleWhere((p) => p.key == 'kernel.sysrq');
      expect(sysrq.kind, SysctlValueKind.enumerated);
      expect(sysrq.sanitize('1'), '1');
      expect(sysrq.sanitize('999'), sysrq.defaultValue);

      final rmem = kSysctlParameterCatalog.singleWhere((p) => p.key == 'net.core.rmem_max');
      expect(rmem.kind, SysctlValueKind.integer);
      expect(rmem.sanitize('33554432'), '33554432');

      final congestion = kSysctlParameterCatalog.singleWhere((p) => p.key == 'net.ipv4.tcp_congestion_control');
      expect(congestion.kind, SysctlValueKind.text);
      expect(congestion.sanitize('cubic'), 'cubic');

      final portRange = kSysctlParameterCatalog.singleWhere((p) => p.key == 'net.ipv4.ip_local_port_range');
      expect(portRange.kind, SysctlValueKind.tuple);
      expect(portRange.sanitize('1024 65535'), '1024 65535');
    });

    test('boolean parameters only ever emit 0 or 1', () {
      final booleans = kSysctlParameterCatalog.where((p) => p.kind == SysctlValueKind.boolean).toList();
      expect(booleans, isNotEmpty);

      for (final parameter in booleans) {
        expect(parameter.sanitize('true'), parameter.defaultValue);
        expect(parameter.sanitize('2'), parameter.defaultValue);
        expect(parameter.sanitize('0'), '0');
        expect(parameter.sanitize('1'), '1');
        expect(['0', '1'], contains(parameter.defaultValue), reason: '${parameter.key} has a non-boolean default');
      }
    });

    test('the negative IPv6 routing-header value survives sanitisation (it is not a boolean)', () {
      final v6 = kSysctlParameterCatalog.singleWhere((p) => p.key == 'net.ipv6.conf.all.accept_source_route');
      expect(v6.kind, SysctlValueKind.enumerated);
      expect(v6.sanitize('-1'), '-1');

      final output = builder.execute(
        const SysctlConfigBuilderInput(
          selectedValues: {'net.ipv6.conf.all.accept_source_route': '-1'},
          mode: OutputMode.permanent,
        ),
      );
      expect(output, contains('net.ipv6.conf.all.accept_source_route = -1'));
    });
  });

  group('presets', () {
    test('there is at least a security hardening baseline and a high-concurrency network preset', () {
      final ids = kSysctlPresets.map((p) => p.id).toList();
      expect(ids, contains('security-baseline'));
      expect(ids, contains('high-concurrency-network'));
      expect(ids.toSet().length, ids.length, reason: 'preset ids must be unique');
      for (final preset in kSysctlPresets) {
        expect(preset.name, isNotEmpty);
        expect(preset.description, isNotEmpty);
        expect(preset.values, isNotEmpty);
      }
    });

    test('every preset key exists in the catalog and every preset value is legal for its parameter', () {
      for (final preset in kSysctlPresets) {
        preset.values.forEach((key, value) {
          final parameter = sysctlParameterFor(key);
          expect(parameter, isNotNull, reason: '${preset.id} references unknown key $key');
          expect(
            parameter!.isLegalValue(value),
            isTrue,
            reason: '${preset.id} sets $key=$value which is not a documented value',
          );
          // resolve() must therefore be a no-op on the value.
          expect(preset.resolve()[key], value);
        });
      }
    });

    test('the security baseline preset produces the expected hardening keys', () {
      final preset = kSysctlPresets.singleWhere((p) => p.id == 'security-baseline');
      final output = builder.execute(
        SysctlConfigBuilderInput(selectedValues: preset.resolve(), mode: OutputMode.permanent),
      );

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
      ];
      for (final key in expectedKeys) {
        expect(output, contains('$key = '), reason: '$key missing from the security baseline output');
      }

      expect(output, contains('# Network Security Hardening'));
      expect(output, contains('# Kernel & Filesystem Security Hardening'));

      // The baseline stays away from the one-way switches; those must be an
      // explicit, deliberate choice by the operator.
      expect(preset.values.keys, isNot(contains('kernel.kexec_load_disabled')));
      expect(preset.values.keys, isNot(contains('kernel.modules_disabled')));
      expect(preset.values['kernel.yama.ptrace_scope'], isNot('3'));
      expect(preset.values['kernel.unprivileged_bpf_disabled'], isNot('1'));
    });

    test('the high-concurrency network preset produces the expected throughput keys', () {
      final preset = kSysctlPresets.singleWhere((p) => p.id == 'high-concurrency-network');
      final output = builder.execute(
        SysctlConfigBuilderInput(selectedValues: preset.resolve(), mode: OutputMode.temporary),
      );

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
      ];
      for (final key in expectedKeys) {
        expect(output, contains('sysctl -w $key='), reason: '$key missing from the network preset output');
      }
    });

    test('presets are additive: merging two presets keeps both key sets', () {
      final security = kSysctlPresets.singleWhere((p) => p.id == 'security-baseline').resolve();
      final network = kSysctlPresets.singleWhere((p) => p.id == 'high-concurrency-network').resolve();

      final merged = {...security, ...network};
      final output = builder.execute(
        SysctlConfigBuilderInput(selectedValues: merged, mode: OutputMode.permanent),
      );

      expect(output, contains('kernel.kptr_restrict = '));
      expect(output, contains('net.core.somaxconn = '));
      expect(merged.length, greaterThan(security.length));
      expect(merged.length, greaterThan(network.length));
    });

    test('resolve() drops unknown keys and repairs illegal values', () {
      const preset = SysctlPreset(
        id: 'synthetic',
        name: 'Synthetic',
        description: 'Test-only preset with a bad key and a bad value.',
        values: {
          'not.a.real.key': '1',
          'vm.overcommit_memory': '42',
          'vm.swappiness': '7',
        },
      );

      final resolved = preset.resolve();
      expect(resolved.containsKey('not.a.real.key'), isFalse);
      expect(resolved['vm.overcommit_memory'], '0');
      expect(resolved['vm.swappiness'], '7');
    });

    test('the preset caveat tells the user to validate against their own workload', () {
      expect(kSysctlPresetCaveat.toLowerCase(), contains('workload'));
      expect(kSysctlPresetCaveat.toLowerCase(), contains('validate'));
    });
  });

  group('catalog integrity and accuracy regressions', () {
    test('tcp_tw_recycle is never offered in the catalog (removed in kernel 4.12, breaks NAT)', () {
      for (final parameter in kSysctlParameterCatalog) {
        expect(parameter.key, isNot(contains('tcp_tw_recycle')));
        expect(parameter.label.toLowerCase(), isNot(contains('tw_recycle')));
      }
      for (final preset in kSysctlPresets) {
        for (final key in preset.values.keys) {
          expect(key, isNot(contains('tcp_tw_recycle')));
        }
      }
    });

    test('zone_reclaim_mode and numa_balancing are modeled as two separate, distinct parameters', () {
      final zoneReclaim = kSysctlParameterCatalog.singleWhere((p) => p.key == 'vm.zone_reclaim_mode');
      final numaBalancing = kSysctlParameterCatalog.singleWhere((p) => p.key == 'kernel.numa_balancing');

      expect(zoneReclaim.key, isNot(equals(numaBalancing.key)));
      // Guard against the source article's conflation of the two settings:
      // zone_reclaim_mode's own description must describe zone/NUMA-node
      // memory reclaim, not claim to "enable NUMA balancing" (that is what
      // kernel.numa_balancing actually does).
      expect(zoneReclaim.description.toLowerCase(), contains('zone'));
      expect(zoneReclaim.description.toLowerCase(), contains('reclaim'));
      expect(zoneReclaim.description.toLowerCase(), isNot(contains('enables automatic numa')));
      expect(numaBalancing.description.toLowerCase(), contains('migrat'));
      // Each description explicitly disclaims being the other.
      expect(zoneReclaim.description.toLowerCase(), contains('numa_balancing'));
      expect(numaBalancing.description.toLowerCase(), contains('zone_reclaim_mode'));
    });

    test('the CFS-era scheduler knobs that moved to debugfs are not offered as sysctls', () {
      // sched_latency_ns / sched_min_granularity_ns / sched_wakeup_granularity_ns
      // left /proc/sys/kernel for /sys/kernel/debug/sched in Linux 5.13, and
      // EEVDF (6.6) replaced them with base_slice_ns. Offering them here
      // would generate lines that simply fail on any current kernel.
      const gone = ['sched_latency_ns', 'sched_min_granularity_ns', 'sched_wakeup_granularity_ns'];
      for (final parameter in kSysctlParameterCatalog) {
        for (final removed in gone) {
          expect(parameter.key, isNot(contains(removed)), reason: '${parameter.key} is a debugfs knob, not a sysctl');
        }
      }
    });

    test('the full catalog has no duplicate keys', () {
      final keys = kSysctlParameterCatalog.map((p) => p.key).toList();
      expect(keys.toSet().length, keys.length);
    });

    test('every catalog entry is fully populated', () {
      for (final parameter in kSysctlParameterCatalog) {
        expect(parameter.key, isNotEmpty);
        expect(parameter.key, contains('.'), reason: '${parameter.key} does not look like a sysctl key');
        expect(parameter.label, isNotEmpty);
        expect(parameter.description.length, greaterThan(20), reason: '${parameter.key} has a stub description');
        expect(parameter.defaultValue.trim(), isNotEmpty, reason: '${parameter.key} has a blank default');
        expect(parameter.riskNote, anyOf(isNull, isNotEmpty));
        expect(parameter.kernelNote, anyOf(isNull, isNotEmpty));
      }
    });

    test('tuple defaults really are space-separated multi-value strings', () {
      final tuples = kSysctlParameterCatalog.where((p) => p.kind == SysctlValueKind.tuple);
      expect(tuples, isNotEmpty);
      for (final parameter in tuples) {
        expect(
          parameter.defaultValue.trim().split(RegExp(r'\s+')).length,
          greaterThan(1),
          reason: '${parameter.key} is a tuple but its default has one component',
        );
      }
    });

    test('the catalog covers every documented category with meaningful breadth', () {
      expect(kSysctlParameterCatalog.length, greaterThanOrEqualTo(80));
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
      ];
      for (final key in mustExist) {
        expect(sysctlParameterFor(key), isNotNull, reason: '$key is missing from the catalog');
      }
    });

    test('sysctlParameterFor returns null for keys that are not in the catalog', () {
      expect(sysctlParameterFor('net.ipv4.tcp_tw_recycle'), isNull);
      expect(sysctlParameterFor(''), isNull);
    });
  });
}
