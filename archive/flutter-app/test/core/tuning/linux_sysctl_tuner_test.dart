import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/tuning/linux_sysctl_tuner.dart';

void main() {
  const tuner = LinuxSysctlTuner();

  test('matches the spec worked example: 10 Gbps + BBR + 16 GB', () {
    final result = tuner.execute(
      const LinuxSysctlInput(
        interfaceProfile: NetworkInterfaceProfile.tenGigabit,
        enableBbr: true,
        enableTimeWaitReuse: true,
        synBacklog: 8192,
        socketMemoryGb: 16,
      ),
    );

    expect(result.somaxconn, 8192);
    expect(result.tcpMaxSynBacklog, 8192);
    expect(result.rmemMax, 67108864);
    expect(result.wmemMax, 67108864);
    expect(result.tcpRmem, '4096 87380 33554432');
    expect(result.tcpWmem, '4096 65536 33554432');
    expect(result.defaultQdisc, 'fq');
    expect(result.tcpCongestionControl, 'bbr');
    expect(result.configText, contains('net.core.somaxconn = 8192'));
    expect(result.configText, contains('net.ipv4.tcp_tw_reuse = 1'));
    expect(result.configText, contains('Profile: 10 Gbps | BBR: Enabled'));
  });

  test('BBR on vs off changes default_qdisc and tcp_congestion_control', () {
    const baseInput = LinuxSysctlInput(
      interfaceProfile: NetworkInterfaceProfile.tenGigabit,
      enableBbr: true,
      enableTimeWaitReuse: true,
      synBacklog: 4096,
      socketMemoryGb: 8,
    );

    final withBbr = tuner.execute(baseInput);
    expect(withBbr.defaultQdisc, 'fq');
    expect(withBbr.tcpCongestionControl, 'bbr');

    final withoutBbr = tuner.execute(
      LinuxSysctlInput(
        interfaceProfile: baseInput.interfaceProfile,
        enableBbr: false,
        enableTimeWaitReuse: baseInput.enableTimeWaitReuse,
        synBacklog: baseInput.synBacklog,
        socketMemoryGb: baseInput.socketMemoryGb,
      ),
    );
    expect(withoutBbr.defaultQdisc, isNot('fq'));
    expect(withoutBbr.tcpCongestionControl, isNot('bbr'));
    expect(withoutBbr.defaultQdisc, 'pfifo_fast');
    expect(withoutBbr.tcpCongestionControl, 'cubic');
  });

  test('backlog value appears in both somaxconn and tcp_max_syn_backlog', () {
    for (final backlog in [1024, 2048, 16384, 65536]) {
      final result = tuner.execute(
        LinuxSysctlInput(
          interfaceProfile: NetworkInterfaceProfile.oneGigabit,
          enableBbr: false,
          enableTimeWaitReuse: false,
          synBacklog: backlog,
          socketMemoryGb: 2,
        ),
      );

      expect(result.somaxconn, backlog);
      expect(result.tcpMaxSynBacklog, backlog);
      expect(result.configText, contains('net.core.somaxconn = $backlog'));
      expect(
        result.configText,
        contains('net.ipv4.tcp_max_syn_backlog = $backlog'),
      );
    }
  });

  test('tcp_tw_reuse reflects the time-wait reuse toggle', () {
    final enabled = tuner.execute(
      const LinuxSysctlInput(
        interfaceProfile: NetworkInterfaceProfile.oneGigabit,
        enableBbr: false,
        enableTimeWaitReuse: true,
        synBacklog: 1024,
        socketMemoryGb: 1,
      ),
    );
    final disabled = tuner.execute(
      const LinuxSysctlInput(
        interfaceProfile: NetworkInterfaceProfile.oneGigabit,
        enableBbr: false,
        enableTimeWaitReuse: false,
        synBacklog: 1024,
        socketMemoryGb: 1,
      ),
    );

    expect(enabled.configText, contains('net.ipv4.tcp_tw_reuse = 1'));
    expect(disabled.configText, contains('net.ipv4.tcp_tw_reuse = 0'));
  });

  test('higher interface profile allows a larger buffer ceiling', () {
    final oneGig = tuner.execute(
      const LinuxSysctlInput(
        interfaceProfile: NetworkInterfaceProfile.oneGigabit,
        enableBbr: true,
        enableTimeWaitReuse: true,
        synBacklog: 4096,
        socketMemoryGb: 1024,
      ),
    );
    final hundredGig = tuner.execute(
      const LinuxSysctlInput(
        interfaceProfile: NetworkInterfaceProfile.fortyToHundredGigabit,
        enableBbr: true,
        enableTimeWaitReuse: true,
        synBacklog: 4096,
        socketMemoryGb: 1024,
      ),
    );

    expect(hundredGig.rmemMax, greaterThan(oneGig.rmemMax));
  });

  test('rejects a SYN backlog below the minimum', () {
    expect(
      () => tuner.execute(
        const LinuxSysctlInput(
          interfaceProfile: NetworkInterfaceProfile.oneGigabit,
          enableBbr: true,
          enableTimeWaitReuse: true,
          synBacklog: 1023,
          socketMemoryGb: 4,
        ),
      ),
      throwsArgumentError,
    );
  });

  test('rejects a SYN backlog above the maximum', () {
    expect(
      () => tuner.execute(
        const LinuxSysctlInput(
          interfaceProfile: NetworkInterfaceProfile.oneGigabit,
          enableBbr: true,
          enableTimeWaitReuse: true,
          synBacklog: 65537,
          socketMemoryGb: 4,
        ),
      ),
      throwsArgumentError,
    );
  });

  test('rejects an out-of-range socket memory value', () {
    expect(
      () => tuner.execute(
        const LinuxSysctlInput(
          interfaceProfile: NetworkInterfaceProfile.oneGigabit,
          enableBbr: true,
          enableTimeWaitReuse: true,
          synBacklog: 4096,
          socketMemoryGb: 0,
        ),
      ),
      throwsArgumentError,
    );
  });
}
