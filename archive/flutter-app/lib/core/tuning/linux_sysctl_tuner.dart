import '../ports/i_tool_use_case.dart';

/// Network interface speed tier. Determines the ceiling applied to the
/// socket-buffer scaling (see [LinuxSysctlTuner._bufferCeilingBytes]) so a
/// 1 Gbps box doesn't get told to reserve absurd amounts of buffer memory
/// while a 40/100 Gbps node isn't capped too low for a long-fat-network path.
enum NetworkInterfaceProfile {
  oneGigabit,
  tenGigabit,
  fortyToHundredGigabit;

  /// Short label used in the generated config's header comment and in radio
  /// button copy, e.g. "10 Gbps".
  String get label {
    switch (this) {
      case NetworkInterfaceProfile.oneGigabit:
        return '1 Gbps';
      case NetworkInterfaceProfile.tenGigabit:
        return '10 Gbps';
      case NetworkInterfaceProfile.fortyToHundredGigabit:
        return '40/100 Gbps';
    }
  }

  /// Longer description for the radio option, mirroring the spec wireframe.
  String get description {
    switch (this) {
      case NetworkInterfaceProfile.oneGigabit:
        return '1 Gbps Network Interface';
      case NetworkInterfaceProfile.tenGigabit:
        return '10 Gbps Network Interface';
      case NetworkInterfaceProfile.fortyToHundredGigabit:
        return '40 / 100 Gbps High-Throughput Node';
    }
  }
}

class LinuxSysctlInput {
  const LinuxSysctlInput({
    required this.interfaceProfile,
    required this.enableBbr,
    required this.enableTimeWaitReuse,
    required this.synBacklog,
    required this.socketMemoryGb,
  });

  final NetworkInterfaceProfile interfaceProfile;
  final bool enableBbr;
  final bool enableTimeWaitReuse;

  /// TCP SYN backlog queue size. Valid range: [LinuxSysctlTuner.minSynBacklog]
  /// .. [LinuxSysctlTuner.maxSynBacklog] inclusive.
  final int synBacklog;

  /// System memory (GB) allocated for network socket buffers. Valid range:
  /// [LinuxSysctlTuner.minSocketMemoryGb] .. [LinuxSysctlTuner.maxSocketMemoryGb]
  /// inclusive.
  final int socketMemoryGb;
}

class LinuxSysctlResult {
  const LinuxSysctlResult({
    required this.configText,
    required this.somaxconn,
    required this.tcpMaxSynBacklog,
    required this.rmemMax,
    required this.wmemMax,
    required this.tcpRmem,
    required this.tcpWmem,
    required this.defaultQdisc,
    required this.tcpCongestionControl,
  });

  /// Full, ready-to-write contents of `/etc/sysctl.d/99-network-performance.conf`.
  final String configText;

  final int somaxconn;
  final int tcpMaxSynBacklog;
  final int rmemMax;
  final int wmemMax;
  final String tcpRmem;
  final String tcpWmem;
  final String defaultQdisc;
  final String tcpCongestionControl;
}

/// Linux Kernel Sysctl tuner: given an interface speed profile and a handful
/// of network-stack knobs, generates a valid `/etc/sysctl.d/99-network-
/// performance.conf` style text block. Pure math/string formatting, zero I/O,
/// zero Flutter — lives in the core so it is unit-testable in milliseconds
/// and reusable by any UI adapter.
class LinuxSysctlTuner
    implements IToolUseCase<LinuxSysctlInput, LinuxSysctlResult> {
  const LinuxSysctlTuner();

  static const int minSynBacklog = 1024;
  static const int maxSynBacklog = 65536;

  static const int minSocketMemoryGb = 1;
  static const int maxSocketMemoryGb = 1024;

  static const int _mib = 1024 * 1024;

  /// Kernel-recommended tcp_rmem/tcp_wmem "min" and "default" values. These
  /// stay constant across profiles/inputs; only the "max" column scales.
  static const int _tcpRmemMin = 4096;
  static const int _tcpRmemDefault = 87380;
  static const int _tcpWmemMin = 4096;
  static const int _tcpWmemDefault = 65536;

  @override
  LinuxSysctlResult execute(LinuxSysctlInput input) {
    if (input.synBacklog < minSynBacklog || input.synBacklog > maxSynBacklog) {
      throw ArgumentError.value(
        input.synBacklog,
        'synBacklog',
        'must be between $minSynBacklog and $maxSynBacklog',
      );
    }
    if (input.socketMemoryGb < minSocketMemoryGb ||
        input.socketMemoryGb > maxSocketMemoryGb) {
      throw ArgumentError.value(
        input.socketMemoryGb,
        'socketMemoryGb',
        'must be between $minSocketMemoryGb and $maxSocketMemoryGb',
      );
    }

    final somaxconn = input.synBacklog;
    final tcpMaxSynBacklog = input.synBacklog;
    final tcpTwReuse = input.enableTimeWaitReuse ? 1 : 0;
    final defaultQdisc = input.enableBbr ? 'fq' : 'pfifo_fast';
    final tcpCongestionControl = input.enableBbr ? 'bbr' : 'cubic';

    // Scale the TCP buffer ceiling with the memory the operator set aside
    // for socket buffers (2 MiB of max buffer per GB allocated), capped by
    // the interface profile's ceiling so a modest 1G box isn't told to
    // reserve hundreds of MB and a 100G node isn't capped too low.
    final ceilingBytes = _bufferCeilingBytes(input.interfaceProfile);
    final scaledMax = input.socketMemoryGb * 2 * _mib;
    final tcpBufferMax = scaledMax.clamp(_mib, ceilingBytes);
    final rmemWmemMax = (tcpBufferMax * 2).clamp(2 * _mib, ceilingBytes * 2);

    final tcpRmem = '$_tcpRmemMin $_tcpRmemDefault $tcpBufferMax';
    final tcpWmem = '$_tcpWmemMin $_tcpWmemDefault $tcpBufferMax';

    final buffer = StringBuffer()
      ..writeln('# /etc/sysctl.d/99-network-performance.conf')
      ..writeln(
        '# Profile: ${input.interfaceProfile.label} | BBR: ${input.enableBbr ? 'Enabled' : 'Disabled'}',
      )
      ..writeln()
      ..writeln('net.core.somaxconn = $somaxconn')
      ..writeln('net.ipv4.tcp_max_syn_backlog = $tcpMaxSynBacklog')
      ..writeln('net.ipv4.tcp_tw_reuse = $tcpTwReuse')
      ..writeln()
      ..writeln('net.core.default_qdisc = $defaultQdisc')
      ..writeln('net.ipv4.tcp_congestion_control = $tcpCongestionControl')
      ..writeln()
      ..writeln('net.core.rmem_max = $rmemWmemMax')
      ..writeln('net.core.wmem_max = $rmemWmemMax')
      ..writeln('net.ipv4.tcp_rmem = $tcpRmem')
      ..writeln('net.ipv4.tcp_wmem = $tcpWmem');

    return LinuxSysctlResult(
      configText: buffer.toString(),
      somaxconn: somaxconn,
      tcpMaxSynBacklog: tcpMaxSynBacklog,
      rmemMax: rmemWmemMax,
      wmemMax: rmemWmemMax,
      tcpRmem: tcpRmem,
      tcpWmem: tcpWmem,
      defaultQdisc: defaultQdisc,
      tcpCongestionControl: tcpCongestionControl,
    );
  }

  /// Ceiling (bytes) for the tcp_rmem/tcp_wmem "max" column, per interface
  /// profile. rmem_max/wmem_max are double this value.
  int _bufferCeilingBytes(NetworkInterfaceProfile profile) {
    switch (profile) {
      case NetworkInterfaceProfile.oneGigabit:
        return 8 * _mib;
      case NetworkInterfaceProfile.tenGigabit:
        return 32 * _mib;
      case NetworkInterfaceProfile.fortyToHundredGigabit:
        return 128 * _mib;
    }
  }
}
