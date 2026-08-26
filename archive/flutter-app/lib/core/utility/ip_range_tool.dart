import 'dart:math';

import '../ports/i_tool_use_case.dart';

/// One CIDR block, either produced by summarizing a range or parsed from
/// user-entered notation.
class CidrBlock {
  const CidrBlock({
    required this.networkAddress,
    required this.prefixLength,
    required this.firstAddress,
    required this.lastAddress,
    required this.addressCount,
  });

  /// Dotted-quad network (base) address.
  final String networkAddress;

  final int prefixLength;

  /// First address in the block (identical to [networkAddress]).
  final String firstAddress;

  /// Last address in the block (the IPv4 broadcast address).
  final String lastAddress;

  /// Total addresses covered, including network and broadcast.
  final int addressCount;

  /// `10.0.0.0/24`
  String get cidr => '$networkAddress/$prefixLength';

  @override
  String toString() => cidr;

  @override
  bool operator ==(Object other) =>
      other is CidrBlock && other.networkAddress == networkAddress && other.prefixLength == prefixLength;

  @override
  int get hashCode => Object.hash(networkAddress, prefixLength);
}

/// Input for [IpRangeTool.execute]: an inclusive IPv4 range.
class Ipv4RangeInput {
  const Ipv4RangeInput({required this.startAddress, required this.endAddress});

  final String startAddress;
  final String endAddress;
}

/// The minimal CIDR cover of an inclusive IPv4 range.
class Ipv4RangeResult {
  const Ipv4RangeResult({
    required this.startAddress,
    required this.endAddress,
    required this.totalAddresses,
    required this.blocks,
  });

  final String startAddress;
  final String endAddress;

  /// Inclusive count: `end - start + 1`.
  final int totalAddresses;

  /// The blocks, in ascending address order. They tile the range exactly:
  /// no gaps, no overlap, nothing outside `[start, end]`.
  final List<CidrBlock> blocks;
}

/// A generated RFC 4193 Unique Local Address prefix, plus one carved subnet.
class UlaPrefixResult {
  const UlaPrefixResult({
    required this.globalIdHex,
    required this.prefix48,
    required this.subnetId,
    required this.subnet64,
    required this.exampleAddress,
  });

  /// The 40-bit Global ID as 10 lowercase hex digits.
  final String globalIdHex;

  /// `fdXX:XXXX:XXXX::/48` — the site prefix.
  final String prefix48;

  /// The 16-bit Subnet ID used to carve [subnet64], 0..65535.
  final int subnetId;

  /// `fdXX:XXXX:XXXX:SSSS::/64` — one routable subnet inside [prefix48].
  final String subnet64;

  /// A sample host address inside [subnet64] (`...::1`), handy for configs.
  final String exampleAddress;
}

/// IPv4 range summarization / CIDR expansion, plus an IPv6 ULA generator.
///
/// Pure Dart — no Flutter, no `dart:io`. Deliberately complements (rather
/// than duplicates) `subnet_calculator.dart`: that tool answers "what does
/// this one CIDR block contain?", this one answers "what CIDR blocks cover
/// this arbitrary range?" and "give me a private IPv6 prefix to number a
/// site with".
///
/// IPv4 addresses are held as 32-bit values in a Dart [int] (64-bit, so no
/// arithmetic here overflows). IPv6 is only generated, never parsed, so the
/// ULA side works on raw octets.
class IpRangeTool implements IToolUseCase<Ipv4RangeInput, Ipv4RangeResult> {
  const IpRangeTool();

  static const int _v4FullMask = 0xFFFFFFFF;

  @override
  Ipv4RangeResult execute(Ipv4RangeInput input) =>
      summarizeRange(input.startAddress, input.endAddress);

  // --------------------------------------------------------- range -> CIDR

  /// Computes the minimal set of CIDR blocks that exactly covers the
  /// inclusive range [start]..[end].
  ///
  /// Standard greedy summarization: at each position take the largest
  /// CIDR block that is (a) aligned to the current address and (b) does not
  /// run past [end], then advance past it. Alignment is read straight off the
  /// current address's trailing zero bits, which is why this produces the
  /// minimal cover rather than merely *a* cover.
  ///
  /// Throws [FormatException] on malformed addresses and [ArgumentError] if
  /// [start] is above [end].
  Ipv4RangeResult summarizeRange(String start, String end) {
    final startInt = parseIPv4(start);
    final endInt = parseIPv4(end);

    if (startInt > endInt) {
      throw ArgumentError(
        'The start address ($start) is above the end address ($end) — swap them.',
      );
    }

    final blocks = <CidrBlock>[];
    var current = startInt;

    // `current <= endInt` is safe here: both are <= 0xFFFFFFFF and Dart ints
    // are 64-bit, so `current` can pass `endInt` without wrapping.
    while (current <= endInt) {
      // Largest block whose base can be `current`: limited by the lowest set
      // bit. current == 0 has no set bits, so the whole /0 space is aligned.
      final alignmentBits = current == 0 ? 32 : _trailingZeros(current);

      // ...and by how many addresses are actually left in the range.
      final remaining = endInt - current + 1;
      var hostBits = alignmentBits;
      while (hostBits > 0 && (1 << hostBits) > remaining) {
        hostBits--;
      }

      final size = 1 << hostBits;
      final prefixLength = 32 - hostBits;
      blocks.add(
        CidrBlock(
          networkAddress: formatIPv4(current),
          prefixLength: prefixLength,
          firstAddress: formatIPv4(current),
          lastAddress: formatIPv4(current + size - 1),
          addressCount: size,
        ),
      );
      current += size;
    }

    return Ipv4RangeResult(
      startAddress: formatIPv4(startInt),
      endAddress: formatIPv4(endInt),
      totalAddresses: endInt - startInt + 1,
      blocks: List.unmodifiable(blocks),
    );
  }

  /// Number of trailing zero bits in the low 32 bits of [value].
  int _trailingZeros(int value) {
    var count = 0;
    var v = value & _v4FullMask;
    if (v == 0) return 32;
    while ((v & 1) == 0) {
      v >>= 1;
      count++;
    }
    return count;
  }

  // --------------------------------------------------------- CIDR -> range

  /// Expands `a.b.c.d/n` to its network/first/last addresses and total count.
  ///
  /// A host part that isn't already zeroed (e.g. `192.168.1.37/24`) is
  /// masked down to the network address rather than rejected — that's what
  /// every routing tool does, and rejecting it would be a nuisance.
  ///
  /// Throws [FormatException] on malformed input.
  CidrBlock expandCidr(String cidr) {
    final text = cidr.trim();
    if (text.isEmpty) {
      throw const FormatException('Enter a CIDR block, e.g. 192.168.1.0/24.');
    }

    final slash = text.indexOf('/');
    if (slash == -1) {
      throw const FormatException('Missing "/" prefix length, e.g. 192.168.1.0/24.');
    }
    if (text.indexOf('/', slash + 1) != -1) {
      throw const FormatException('A CIDR block contains exactly one "/".');
    }

    final addressPart = text.substring(0, slash).trim();
    final prefixPart = text.substring(slash + 1).trim();
    if (!RegExp(r'^\d{1,2}$').hasMatch(prefixPart)) {
      throw FormatException('"$prefixPart" is not a valid IPv4 prefix length.');
    }
    final prefixLength = int.parse(prefixPart);
    if (prefixLength > 32) {
      throw FormatException('An IPv4 prefix length is 0-32, got /$prefixLength.');
    }

    final addressInt = parseIPv4(addressPart);
    final mask = prefixLength == 0 ? 0 : (_v4FullMask << (32 - prefixLength)) & _v4FullMask;
    final network = addressInt & mask;
    final last = network | ((~mask) & _v4FullMask);

    return CidrBlock(
      networkAddress: formatIPv4(network),
      prefixLength: prefixLength,
      firstAddress: formatIPv4(network),
      lastAddress: formatIPv4(last),
      addressCount: 1 << (32 - prefixLength),
    );
  }

  // ------------------------------------------------------------ IPv4 codec

  /// Parses a dotted-quad IPv4 address into a 32-bit int.
  ///
  /// Throws [FormatException] on anything that isn't four 0-255 decimal
  /// octets. Leading zeros are rejected outright because they are read as
  /// octal by some resolvers and decimal by others — an address that means
  /// two different things is not an address worth accepting.
  int parseIPv4(String address) {
    final text = address.trim();
    if (text.isEmpty) {
      throw const FormatException('Enter an IPv4 address.');
    }
    final parts = text.split('.');
    if (parts.length != 4) {
      throw FormatException('"$text" is not an IPv4 address: expected 4 octets, got ${parts.length}.');
    }
    var value = 0;
    for (final part in parts) {
      if (part.isEmpty || !RegExp(r'^\d{1,3}$').hasMatch(part)) {
        throw FormatException('"$part" is not a valid IPv4 octet in "$text".');
      }
      if (part.length > 1 && part.startsWith('0')) {
        throw FormatException('"$part" has a leading zero — write octets without one (e.g. 10, not 010).');
      }
      final octet = int.parse(part);
      if (octet > 255) {
        throw FormatException('"$part" is out of range for an IPv4 octet (0-255).');
      }
      value = (value << 8) | octet;
    }
    return value;
  }

  /// Renders a 32-bit int as a dotted-quad address.
  String formatIPv4(int value) {
    final v = value & _v4FullMask;
    return '${(v >> 24) & 0xFF}.${(v >> 16) & 0xFF}.${(v >> 8) & 0xFF}.${v & 0xFF}';
  }

  // ------------------------------------------------------- IPv6 ULA (4193)

  static final Random _random = Random.secure();

  /// Generates an RFC 4193 Unique Local Address prefix: `fd` + a 40-bit
  /// Global ID, yielding `fdXX:XXXX:XXXX::/48`, plus a `/64` carved out of it
  /// using [subnetId] (random when omitted).
  ///
  /// **On the Global ID:** RFC 4193 §3.2.2 describes a specific derivation —
  /// concatenate an EUI-64 with an NTP-format timestamp, SHA-1 the result,
  /// and take the low 40 bits. That ritual exists purely to make collisions
  /// unlikely without a central registry; the RFC itself notes any method
  /// producing a well-distributed 40-bit value works. This generator uses
  /// [Random.secure] directly instead, which is the common practical
  /// approach and gives the same collision properties without needing a
  /// hardware MAC address. It is therefore **RFC 4193-shaped, not an
  /// RFC-exact derivation** — do not describe it as the latter.
  ///
  /// The `L` bit is always 1 (hence `fd00::/8`); `fc00::/8` is reserved for a
  /// centrally-assigned scheme that was never defined, so it must not be
  /// generated.
  ///
  /// Throws [ArgumentError] if [subnetId] is outside 0..65535.
  UlaPrefixResult generateUla({int? subnetId}) {
    if (subnetId != null && (subnetId < 0 || subnetId > 0xFFFF)) {
      throw ArgumentError('A subnet ID is a 16-bit value (0-65535), got $subnetId.');
    }
    final subnet = subnetId ?? _random.nextInt(0x10000);

    // 40 bits of Global ID, drawn as five independent octets.
    final globalId = List<int>.generate(5, (_) => _random.nextInt(256));
    final globalIdHex = globalId.map(_hex2).join();

    // Address layout: fd | 40-bit global id | 16-bit subnet id | 64-bit iface
    // group0 = 0xfd<<8 | globalId[0], then two groups of the remaining 32
    // bits, then the subnet id as group3.
    final group0 = (0xFD << 8) | globalId[0];
    final group1 = (globalId[1] << 8) | globalId[2];
    final group2 = (globalId[3] << 8) | globalId[4];

    String g(int v) => v.toRadixString(16).padLeft(4, '0');

    final prefix48 = '${g(group0)}:${g(group1)}:${g(group2)}::/48';
    final subnetBase = '${g(group0)}:${g(group1)}:${g(group2)}:${g(subnet)}';

    return UlaPrefixResult(
      globalIdHex: globalIdHex,
      prefix48: prefix48,
      subnetId: subnet,
      subnet64: '$subnetBase::/64',
      exampleAddress: '$subnetBase::1',
    );
  }

  /// Carves a specific `/64` out of an already-generated site prefix.
  ///
  /// [prefix48] must be the `fdXX:XXXX:XXXX::/48` form [generateUla]
  /// produces. Throws [FormatException] / [ArgumentError] otherwise.
  String subnetOfUla(String prefix48, int subnetId) {
    if (subnetId < 0 || subnetId > 0xFFFF) {
      throw ArgumentError('A subnet ID is a 16-bit value (0-65535), got $subnetId.');
    }
    final match = RegExp(
      r'^(f[cd][0-9a-f]{2}):([0-9a-f]{1,4}):([0-9a-f]{1,4})::/48$',
      caseSensitive: false,
    ).firstMatch(prefix48.trim());
    if (match == null) {
      throw FormatException('"$prefix48" is not a ULA /48 prefix like fd12:3456:789a::/48.');
    }
    String g(String v) => int.parse(v, radix: 16).toRadixString(16).padLeft(4, '0');
    final base = '${g(match.group(1)!)}:${g(match.group(2)!)}:${g(match.group(3)!)}'
        ':${subnetId.toRadixString(16).padLeft(4, '0')}';
    return '$base::/64';
  }

  String _hex2(int v) => v.toRadixString(16).padLeft(2, '0');
}
