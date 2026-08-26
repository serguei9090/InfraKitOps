import '../ports/i_tool_use_case.dart';

/// Which IP family a parsed CIDR block belongs to.
enum IpVersion { v4, v6 }

class SubnetCalculatorInput {
  const SubnetCalculatorInput({required this.cidr});

  /// CIDR notation, e.g. "192.168.1.0/24" or "2001:db8::/64".
  final String cidr;
}

/// Result of subnetting a CIDR block. [version] tells the UI which fields
/// are populated: IPv4-only fields ([broadcastAddress], [subnetMask],
/// [wildcardMask], [firstUsableAddress], [lastUsableAddress],
/// [usableHostCount]) are null for IPv6 results.
class SubnetCalculatorResult {
  const SubnetCalculatorResult({
    required this.version,
    required this.prefixLength,
    required this.networkAddress,
    required this.firstAddress,
    required this.lastAddress,
    required this.totalAddressCount,
    this.broadcastAddress,
    this.subnetMask,
    this.wildcardMask,
    this.firstUsableAddress,
    this.lastUsableAddress,
    this.usableHostCount,
  });

  final IpVersion version;
  final int prefixLength;

  /// Network address (compressed form for IPv6).
  final String networkAddress;

  /// First address in the block (== networkAddress).
  final String firstAddress;

  /// Last address in the block (== broadcastAddress for IPv4).
  final String lastAddress;

  /// Total number of addresses in the block, as a [BigInt] since IPv6
  /// blocks can be astronomically large (up to 2^128).
  final BigInt totalAddressCount;

  // --- IPv4-only fields ---
  final String? broadcastAddress;
  final String? subnetMask;
  final String? wildcardMask;
  final String? firstUsableAddress;
  final String? lastUsableAddress;
  final int? usableHostCount;
}

/// IPv4/IPv6 subnet calculator: parses CIDR notation and computes network
/// boundaries by hand with integer/BigInt bit masking (no `dart:io` or
/// networking package involved, so it stays pure Dart / core-safe).
///
/// IPv4 addresses are packed into a 32-bit value carried in a 64-bit Dart
/// [int] (safe: no arithmetic here ever exceeds 63 bits). IPv6 addresses are
/// packed into a 128-bit [BigInt].
class SubnetCalculator implements IToolUseCase<SubnetCalculatorInput, SubnetCalculatorResult> {
  const SubnetCalculator();

  static const int _v4FullMask = 0xFFFFFFFF;

  @override
  SubnetCalculatorResult execute(SubnetCalculatorInput input) {
    final cidr = input.cidr.trim();
    if (cidr.isEmpty) {
      throw ArgumentError('Input is empty');
    }

    final slashIndex = cidr.indexOf('/');
    if (slashIndex == -1) {
      throw const FormatException('Missing "/" prefix length, e.g. 192.168.1.0/24');
    }
    if (cidr.indexOf('/', slashIndex + 1) != -1) {
      throw const FormatException('CIDR must contain exactly one "/"');
    }

    final addressPart = cidr.substring(0, slashIndex).trim();
    final prefixPart = cidr.substring(slashIndex + 1).trim();

    if (addressPart.isEmpty) {
      throw const FormatException('Missing IP address before "/"');
    }
    if (prefixPart.isEmpty || !RegExp(r'^\d+$').hasMatch(prefixPart)) {
      throw FormatException('"$prefixPart" is not a valid prefix length');
    }
    final prefixLength = int.parse(prefixPart);

    final isV6 = addressPart.contains(':');
    final isV4 = !isV6 && addressPart.contains('.');
    if (!isV4 && !isV6) {
      throw FormatException('"$addressPart" is not a recognizable IPv4 or IPv6 address');
    }

    if (isV4) {
      if (prefixLength < 0 || prefixLength > 32) {
        throw ArgumentError('IPv4 prefix length must be between 0 and 32, got /$prefixLength');
      }
      return _computeV4(addressPart, prefixLength);
    } else {
      if (prefixLength < 0 || prefixLength > 128) {
        throw ArgumentError('IPv6 prefix length must be between 0 and 128, got /$prefixLength');
      }
      return _computeV6(addressPart, prefixLength);
    }
  }

  // --- IPv4 ---

  SubnetCalculatorResult _computeV4(String addressPart, int prefixLength) {
    final addressInt = _parseIPv4(addressPart);

    final maskInt = prefixLength == 0 ? 0 : (_v4FullMask << (32 - prefixLength)) & _v4FullMask;
    final wildcardInt = (~maskInt) & _v4FullMask;
    final networkInt = addressInt & maskInt;
    final broadcastInt = networkInt | wildcardInt;
    final total = BigInt.two.pow(32 - prefixLength);

    String firstUsable;
    String lastUsable;
    int usableHostCount;
    if (prefixLength == 32) {
      // Host route: exactly one address, no network/broadcast distinction.
      usableHostCount = 1;
      firstUsable = _formatIPv4(networkInt);
      lastUsable = _formatIPv4(networkInt);
    } else if (prefixLength == 31) {
      // RFC 3021 point-to-point link: both addresses are usable.
      usableHostCount = 2;
      firstUsable = _formatIPv4(networkInt);
      lastUsable = _formatIPv4(broadcastInt);
    } else {
      usableHostCount = (total - BigInt.two).toInt();
      firstUsable = _formatIPv4(networkInt + 1);
      lastUsable = _formatIPv4(broadcastInt - 1);
    }

    return SubnetCalculatorResult(
      version: IpVersion.v4,
      prefixLength: prefixLength,
      networkAddress: _formatIPv4(networkInt),
      firstAddress: _formatIPv4(networkInt),
      lastAddress: _formatIPv4(broadcastInt),
      totalAddressCount: total,
      broadcastAddress: _formatIPv4(broadcastInt),
      subnetMask: _formatIPv4(maskInt),
      wildcardMask: _formatIPv4(wildcardInt),
      firstUsableAddress: firstUsable,
      lastUsableAddress: lastUsable,
      usableHostCount: usableHostCount,
    );
  }

  int _parseIPv4(String addr) {
    final parts = addr.split('.');
    if (parts.length != 4) {
      throw FormatException('"$addr" is not a valid IPv4 address: expected 4 octets, got ${parts.length}');
    }
    var value = 0;
    for (final p in parts) {
      if (p.isEmpty || !RegExp(r'^\d+$').hasMatch(p)) {
        throw FormatException('"$p" is not a valid IPv4 octet');
      }
      final n = int.parse(p);
      if (n < 0 || n > 255) {
        throw FormatException('"$p" is out of range for an IPv4 octet (0-255)');
      }
      value = (value << 8) | n;
    }
    return value;
  }

  String _formatIPv4(int value) {
    final b0 = (value >> 24) & 0xFF;
    final b1 = (value >> 16) & 0xFF;
    final b2 = (value >> 8) & 0xFF;
    final b3 = value & 0xFF;
    return '$b0.$b1.$b2.$b3';
  }

  // --- IPv6 ---

  SubnetCalculatorResult _computeV6(String addressPart, int prefixLength) {
    final addressBig = _parseIPv6(addressPart);
    final fullMask = (BigInt.one << 128) - BigInt.one;
    final maskBig = prefixLength == 0 ? BigInt.zero : (fullMask << (128 - prefixLength)) & fullMask;
    final networkBig = addressBig & maskBig;
    final wildcardBig = (~maskBig) & fullMask;
    final lastBig = networkBig | wildcardBig;
    final total = BigInt.two.pow(128 - prefixLength);

    return SubnetCalculatorResult(
      version: IpVersion.v6,
      prefixLength: prefixLength,
      networkAddress: _formatIPv6(networkBig),
      firstAddress: _formatIPv6(networkBig),
      lastAddress: _formatIPv6(lastBig),
      totalAddressCount: total,
    );
  }

  BigInt _parseIPv6(String addr) {
    List<String> groups;

    if (addr.contains('::')) {
      final parts = addr.split('::');
      if (parts.length != 2) {
        throw FormatException('"$addr" is not a valid IPv6 address: "::" may appear at most once');
      }
      final left = parts[0].isEmpty ? const <String>[] : parts[0].split(':');
      final right = parts[1].isEmpty ? const <String>[] : parts[1].split(':');
      if (left.length + right.length > 7) {
        throw FormatException('"$addr" is not a valid IPv6 address: too many groups for "::" compression');
      }
      final missing = 8 - left.length - right.length;
      groups = [...left, ...List.filled(missing, '0'), ...right];
    } else {
      groups = addr.split(':');
    }

    if (groups.length != 8) {
      throw FormatException('"$addr" is not a valid IPv6 address: expected 8 groups, got ${groups.length}');
    }

    var value = BigInt.zero;
    for (final g in groups) {
      if (g.isEmpty || g.length > 4 || !RegExp(r'^[0-9a-fA-F]+$').hasMatch(g)) {
        throw FormatException('"$g" is not a valid IPv6 group in "$addr"');
      }
      final part = int.parse(g, radix: 16);
      value = (value << 16) | BigInt.from(part);
    }
    return value;
  }

  String _formatIPv6(BigInt value) {
    final groups = List<int>.generate(8, (i) {
      final shift = (7 - i) * 16;
      return ((value >> shift) & BigInt.from(0xFFFF)).toInt();
    });

    // Find the longest run of consecutive zero groups (length >= 2),
    // preferring the leftmost run on ties, per RFC 5952 compression rules.
    var bestStart = -1;
    var bestLen = 0;
    var i = 0;
    while (i < 8) {
      if (groups[i] == 0) {
        var j = i;
        while (j < 8 && groups[j] == 0) {
          j++;
        }
        final len = j - i;
        if (len > bestLen) {
          bestLen = len;
          bestStart = i;
        }
        i = j;
      } else {
        i++;
      }
    }

    final hexGroups = groups.map((g) => g.toRadixString(16)).toList();

    if (bestLen >= 2) {
      final left = hexGroups.sublist(0, bestStart).join(':');
      final right = hexGroups.sublist(bestStart + bestLen).join(':');
      return '$left::$right';
    }
    return hexGroups.join(':');
  }
}
