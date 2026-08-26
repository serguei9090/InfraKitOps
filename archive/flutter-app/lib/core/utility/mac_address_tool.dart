import 'dart:math';

import '../ports/i_tool_use_case.dart';

/// The four common textual notations a 48-bit MAC address is written in.
enum MacNotation {
  /// `00:1A:2B:3C:4D:5E` — IEEE / Linux / almost everything.
  colon,

  /// `00-1A-2B-3C-4D-5E` — Windows (`ipconfig`, `getmac`).
  hyphen,

  /// `001A.2B3C.4D5E` — Cisco IOS three-groups-of-four form.
  dotted,

  /// `001A2B3C4D5E` — bare hex, as seen in DHCP leases and firmware dumps.
  bare,
}

/// How a curated OUI entry is useful, so the UI can highlight the entries an
/// SRE actually cares about (spotting a virtual NIC) separately from plain
/// hardware-vendor identification.
enum OuiCategory {
  /// Hypervisor / container runtime NICs — the genuinely diagnostic ones.
  virtualization,

  /// Physical hardware vendors (network gear, servers, laptops, SBCs).
  hardware,
}

/// One row of the *curated* OUI table shipped with the app.
///
/// [prefixHex] is uppercase hex with no separators and may be shorter than
/// the usual 6 digits: Docker, for example, only fixes the first two octets
/// (`0242`), so prefixes are matched longest-first rather than assuming a
/// 24-bit OUI.
class OuiEntry {
  const OuiEntry({
    required this.prefixHex,
    required this.vendor,
    required this.category,
    this.note,
  });

  /// Uppercase hex digits, no separators, e.g. `005056` or `0242`.
  final String prefixHex;

  final String vendor;
  final OuiCategory category;

  /// Extra context worth showing, e.g. which product uses the prefix.
  final String? note;

  /// The prefix rendered with colons, e.g. `00:50:56` / `02:42`.
  String get prefixDisplay {
    final pairs = <String>[];
    for (var i = 0; i + 1 < prefixHex.length; i += 2) {
      pairs.add(prefixHex.substring(i, i + 2));
    }
    return pairs.join(':');
  }
}

/// Input for [MacAddressTool.execute]: a MAC address in any notation.
class MacAddressInput {
  const MacAddressInput({required this.mac});

  final String mac;
}

/// Everything [MacAddressTool] can say about a single MAC address.
class MacAddressAnalysis {
  const MacAddressAnalysis({
    required this.normalizedHex,
    required this.colonForm,
    required this.hyphenForm,
    required this.dottedForm,
    required this.bareForm,
    required this.ouiHex,
    required this.isLocallyAdministered,
    required this.isMulticast,
    required this.isBroadcast,
    this.vendor,
  });

  /// Uppercase, separator-free, exactly 12 hex digits.
  final String normalizedHex;

  final String colonForm;
  final String hyphenForm;
  final String dottedForm;
  final String bareForm;

  /// First three octets as uppercase hex, no separators (`001A2B`).
  final String ouiHex;

  /// `00:1A:2B` — the OUI in the conventional display form.
  String get ouiDisplay =>
      '${ouiHex.substring(0, 2)}:${ouiHex.substring(2, 4)}:${ouiHex.substring(4, 6)}';

  /// True when the U/L bit (bit 1, mask `0x02`, of the *first* octet) is set,
  /// meaning the address was assigned locally rather than from an IEEE-
  /// registered OUI. Locally administered addresses have no meaningful
  /// vendor — hypervisors and container runtimes mint them freely.
  final bool isLocallyAdministered;

  /// True when the I/G bit (bit 0, mask `0x01`, of the first octet) is set,
  /// meaning the frame is group-addressed (multicast) rather than unicast.
  final bool isMulticast;

  /// `FF:FF:FF:FF:FF:FF` — the special all-ones broadcast address.
  final bool isBroadcast;

  /// Curated-table match, or null when the OUI isn't one of the well-known
  /// prefixes bundled with the app. A null vendor never means "unassigned".
  final OuiEntry? vendor;

  bool get isUniversallyAdministered => !isLocallyAdministered;
  bool get isUnicast => !isMulticast;

  /// The address rendered in the requested notation.
  String inNotation(MacNotation notation) => switch (notation) {
        MacNotation.colon => colonForm,
        MacNotation.hyphen => hyphenForm,
        MacNotation.dotted => dottedForm,
        MacNotation.bare => bareForm,
      };
}

/// Options for [MacAddressTool.generate].
class MacGenerationOptions {
  const MacGenerationOptions({
    this.count = 1,
    this.locallyAdministered = true,
    this.unicast = true,
    this.vendorPrefixHex,
  });

  /// How many addresses to mint. Must be >= 1.
  final int count;

  /// Sets the U/L bit (`0x02`) on the first octet when true, clears it when
  /// false. Ignored when [vendorPrefixHex] is supplied — a real vendor OUI
  /// defines its own flag bits and rewriting them would produce an address
  /// that no longer belongs to that vendor.
  final bool locallyAdministered;

  /// Clears the I/G bit (`0x01`) when true (unicast), sets it when false
  /// (multicast). Also ignored when [vendorPrefixHex] is supplied.
  final bool unicast;

  /// Optional fixed leading hex digits (separators allowed, e.g. `00:50:56`
  /// or `525400`). Must be an even number of hex digits, 2..10.
  final String? vendorPrefixHex;
}

/// MAC address normalizer, analyzer, and generator.
///
/// Pure Dart: no `dart:io`, no Flutter. Complements
/// `lib/core/utility/subnet_calculator.dart` (layer 3) by covering layer 2.
///
/// ## Vendor lookup is a *curated subset*, not the IEEE registry
///
/// The real IEEE OUI/MA-L registry is roughly 35,000 assignments and several
/// megabytes of CSV — far too much to bundle into a client-first offline app
/// for a feature this peripheral. [kCuratedOuiTable] therefore ships a small
/// hand-picked table biased toward the prefixes that are actually *load
/// bearing* during triage: hypervisor and container-runtime NIC prefixes
/// (VMware, VirtualBox, Xen, Hyper-V, KVM/QEMU, Docker, Parallels), plus a
/// handful of very common hardware vendors. A miss means "not in our small
/// table" and never "unassigned by the IEEE"; the UI must say so.
class MacAddressTool implements IToolUseCase<MacAddressInput, MacAddressAnalysis> {
  const MacAddressTool();

  /// Bit 0 of the first octet. Set => group address (multicast).
  static const int igBitMask = 0x01;

  /// Bit 1 of the first octet. Set => locally administered.
  static const int ulBitMask = 0x02;

  @override
  MacAddressAnalysis execute(MacAddressInput input) => analyze(input.mac);

  /// Parses [raw] in any supported notation and returns the full analysis.
  ///
  /// Throws [FormatException] if the input isn't a well-formed 48-bit MAC.
  MacAddressAnalysis analyze(String raw) {
    final hex = normalize(raw);
    final firstOctet = int.parse(hex.substring(0, 2), radix: 16);
    final oui = hex.substring(0, 6);

    return MacAddressAnalysis(
      normalizedHex: hex,
      colonForm: format(hex, MacNotation.colon),
      hyphenForm: format(hex, MacNotation.hyphen),
      dottedForm: format(hex, MacNotation.dotted),
      bareForm: format(hex, MacNotation.bare),
      ouiHex: oui,
      isLocallyAdministered: (firstOctet & ulBitMask) != 0,
      isMulticast: (firstOctet & igBitMask) != 0,
      isBroadcast: hex == 'FFFFFFFFFFFF',
      vendor: lookupVendor(hex),
    );
  }

  // ------------------------------------------------------------- normalize

  static final RegExp _allowedChars = RegExp(r'^[0-9A-Fa-f:.\-\s]+$');
  static final RegExp _separators = RegExp(r'[:.\-\s]');

  /// Strips separators and validates, returning 12 uppercase hex digits.
  ///
  /// Accepts `00:1A:2B:3C:4D:5E`, `00-1A-2B-3C-4D-5E`, `001A.2B3C.4D5E`,
  /// `001A2B3C4D5E` and any mixture of those separators.
  ///
  /// Throws [FormatException] on anything else.
  String normalize(String raw) {
    final trimmed = raw.trim();
    if (trimmed.isEmpty) {
      throw const FormatException('Enter a MAC address.');
    }
    if (!_allowedChars.hasMatch(trimmed)) {
      throw FormatException(
        '"$trimmed" contains characters that are not hex digits or MAC separators (: - .).',
      );
    }

    final hex = trimmed.replaceAll(_separators, '').toUpperCase();
    if (hex.length != 12) {
      throw FormatException(
        'A MAC address has 12 hex digits (48 bits); "$trimmed" has ${hex.length}.',
      );
    }
    return hex;
  }

  /// Renders 12 normalized hex digits in [notation].
  String format(String normalizedHex, MacNotation notation) {
    final hex = normalizedHex.toUpperCase();
    if (hex.length != 12) {
      throw FormatException('Expected 12 normalized hex digits, got ${hex.length}.');
    }
    final octets = [
      for (var i = 0; i < 12; i += 2) hex.substring(i, i + 2),
    ];
    return switch (notation) {
      MacNotation.colon => octets.join(':'),
      MacNotation.hyphen => octets.join('-'),
      MacNotation.dotted =>
        '${hex.substring(0, 4)}.${hex.substring(4, 8)}.${hex.substring(8, 12)}',
      MacNotation.bare => hex,
    };
  }

  /// Every notation of one address, in a stable display order.
  Map<MacNotation, String> allFormats(String normalizedHex) => {
        for (final n in MacNotation.values) n: format(normalizedHex, n),
      };

  // ---------------------------------------------------------------- vendor

  /// Longest-prefix match against [kCuratedOuiTable]. Returns null on a miss,
  /// which only means "not in the curated subset".
  OuiEntry? lookupVendor(String normalizedHex) {
    final hex = normalizedHex.toUpperCase().replaceAll(_separators, '');
    OuiEntry? best;
    for (final entry in kCuratedOuiTable) {
      if (hex.startsWith(entry.prefixHex)) {
        if (best == null || entry.prefixHex.length > best.prefixHex.length) {
          best = entry;
        }
      }
    }
    return best;
  }

  // -------------------------------------------------------------- generate

  static final Random _random = Random.secure();

  /// Mints [MacGenerationOptions.count] random MAC addresses.
  ///
  /// Randomness comes from [Random.secure] so generated addresses are not
  /// predictable from one another — these get pasted into real network
  /// configs, so a seeded PRNG would be the wrong default.
  ///
  /// Throws [ArgumentError] / [FormatException] on invalid options.
  List<MacAddressAnalysis> generate([
    MacGenerationOptions options = const MacGenerationOptions(),
  ]) {
    if (options.count < 1) {
      throw ArgumentError('Generate at least one address (count was ${options.count}).');
    }
    if (options.count > 256) {
      throw ArgumentError('Generate at most 256 addresses at a time.');
    }

    String? prefix;
    final rawPrefix = options.vendorPrefixHex;
    if (rawPrefix != null && rawPrefix.trim().isNotEmpty) {
      prefix = rawPrefix.trim().replaceAll(_separators, '').toUpperCase();
      if (!RegExp(r'^[0-9A-F]+$').hasMatch(prefix)) {
        throw FormatException('"$rawPrefix" is not a hex vendor prefix.');
      }
      if (prefix.length.isOdd) {
        throw FormatException('A vendor prefix must be whole octets; "$rawPrefix" is not.');
      }
      if (prefix.length < 2 || prefix.length > 10) {
        throw FormatException('A vendor prefix must be 1 to 5 octets, got ${prefix.length ~/ 2}.');
      }
    }

    return [
      for (var i = 0; i < options.count; i++) analyze(_randomHex(options, prefix)),
    ];
  }

  String _randomHex(MacGenerationOptions options, String? prefix) {
    final octets = List<int>.generate(6, (_) => _random.nextInt(256));

    if (prefix != null) {
      // The chosen vendor prefix owns the leading octets verbatim — including
      // its U/L and I/G bits. Overwriting them would break the very thing the
      // caller asked for (an address that looks like it came from that OUI).
      for (var i = 0; i * 2 < prefix.length; i++) {
        octets[i] = int.parse(prefix.substring(i * 2, i * 2 + 2), radix: 16);
      }
    } else {
      var first = octets[0];
      first = options.locallyAdministered ? (first | ulBitMask) : (first & ~ulBitMask);
      first = options.unicast ? (first & ~igBitMask) : (first | igBitMask);
      octets[0] = first & 0xFF;
    }

    return octets.map((o) => o.toRadixString(16).padLeft(2, '0').toUpperCase()).join();
  }
}

/// The curated OUI subset. **Not** the IEEE registry — see the class doc on
/// [MacAddressTool] for why, and say so in any UI that surfaces a match.
///
/// Virtualization prefixes come first because they're the ones that answer a
/// real operational question ("is this host a VM, and under what?").
const List<OuiEntry> kCuratedOuiTable = [
  // --- Virtualization / containers ---------------------------------------
  OuiEntry(
    prefixHex: '005056',
    vendor: 'VMware',
    category: OuiCategory.virtualization,
    note: 'vSphere/ESXi-assigned VM NIC (the range vCenter hands out).',
  ),
  OuiEntry(
    prefixHex: '000C29',
    vendor: 'VMware',
    category: OuiCategory.virtualization,
    note: 'VMware Workstation / Player / auto-generated ESXi NIC.',
  ),
  OuiEntry(
    prefixHex: '000569',
    vendor: 'VMware',
    category: OuiCategory.virtualization,
    note: 'Original VMware ESX OUI.',
  ),
  OuiEntry(
    prefixHex: '001C14',
    vendor: 'VMware',
    category: OuiCategory.virtualization,
    note: 'Additional VMware-registered OUI.',
  ),
  OuiEntry(
    prefixHex: '080027',
    vendor: 'Oracle VirtualBox',
    category: OuiCategory.virtualization,
    note: 'Registered to Cadmus Computer Systems; used by VirtualBox guests.',
  ),
  OuiEntry(
    prefixHex: '0A0027',
    vendor: 'Oracle VirtualBox',
    category: OuiCategory.virtualization,
    note: 'VirtualBox host-only adapter (locally administered variant).',
  ),
  OuiEntry(
    prefixHex: '00163E',
    vendor: 'Xen / LXC',
    category: OuiCategory.virtualization,
    note: 'XenSource OUI — Xen/XCP-ng/Citrix guests, and the default LXC/LXD container NIC prefix.',
  ),
  OuiEntry(
    prefixHex: '00155D',
    vendor: 'Microsoft Hyper-V',
    category: OuiCategory.virtualization,
    note: 'Hyper-V dynamic MAC pool.',
  ),
  OuiEntry(
    prefixHex: '001C42',
    vendor: 'Parallels',
    category: OuiCategory.virtualization,
    note: 'Parallels Desktop virtual NIC.',
  ),
  OuiEntry(
    prefixHex: '525400',
    vendor: 'QEMU / KVM',
    category: OuiCategory.virtualization,
    note: 'QEMU default locally-administered prefix (libvirt guests).',
  ),
  OuiEntry(
    prefixHex: '0242',
    vendor: 'Docker',
    category: OuiCategory.virtualization,
    note: 'Container veth / docker0 bridge; only the first two octets are fixed.',
  ),

  // --- Single-board computers -------------------------------------------
  OuiEntry(
    prefixHex: 'B827EB',
    vendor: 'Raspberry Pi Foundation',
    category: OuiCategory.hardware,
    note: 'Pi 1 through Pi 3.',
  ),
  OuiEntry(
    prefixHex: 'DCA632',
    vendor: 'Raspberry Pi Trading',
    category: OuiCategory.hardware,
    note: 'Pi 4 family.',
  ),
  OuiEntry(
    prefixHex: 'E45F01',
    vendor: 'Raspberry Pi Trading',
    category: OuiCategory.hardware,
    note: 'Pi 4 / Compute Module 4 and later.',
  ),
  OuiEntry(
    prefixHex: '28CDC1',
    vendor: 'Raspberry Pi Trading',
    category: OuiCategory.hardware,
    note: 'Pi Pico W and newer boards.',
  ),

  // --- Network & server hardware ----------------------------------------
  OuiEntry(prefixHex: '00000C', vendor: 'Cisco Systems', category: OuiCategory.hardware),
  OuiEntry(prefixHex: '000A41', vendor: 'Cisco Systems', category: OuiCategory.hardware),
  OuiEntry(prefixHex: '001B0D', vendor: 'Cisco Systems', category: OuiCategory.hardware),
  OuiEntry(prefixHex: '00234D', vendor: 'Cisco Systems', category: OuiCategory.hardware),

  OuiEntry(prefixHex: '00AA00', vendor: 'Intel', category: OuiCategory.hardware),
  OuiEntry(prefixHex: '0002B3', vendor: 'Intel', category: OuiCategory.hardware),
  OuiEntry(prefixHex: '001B21', vendor: 'Intel', category: OuiCategory.hardware, note: 'Intel server/desktop NICs.'),
  OuiEntry(prefixHex: '001E67', vendor: 'Intel', category: OuiCategory.hardware),
  OuiEntry(prefixHex: 'A0369F', vendor: 'Intel', category: OuiCategory.hardware),

  OuiEntry(prefixHex: '001422', vendor: 'Dell', category: OuiCategory.hardware),
  OuiEntry(prefixHex: '00219B', vendor: 'Dell', category: OuiCategory.hardware),
  OuiEntry(prefixHex: '0026B9', vendor: 'Dell', category: OuiCategory.hardware),
  OuiEntry(prefixHex: 'B82A72', vendor: 'Dell', category: OuiCategory.hardware),
  OuiEntry(prefixHex: 'F8BC12', vendor: 'Dell', category: OuiCategory.hardware),

  OuiEntry(prefixHex: '001B78', vendor: 'Hewlett-Packard', category: OuiCategory.hardware),
  OuiEntry(prefixHex: '0017A4', vendor: 'Hewlett-Packard', category: OuiCategory.hardware),
  OuiEntry(prefixHex: '0025B3', vendor: 'Hewlett-Packard', category: OuiCategory.hardware),
  OuiEntry(prefixHex: '3CD92B', vendor: 'Hewlett-Packard', category: OuiCategory.hardware),
  OuiEntry(prefixHex: '9457A5', vendor: 'Hewlett Packard Enterprise', category: OuiCategory.hardware),

  OuiEntry(prefixHex: '000393', vendor: 'Apple', category: OuiCategory.hardware),
  OuiEntry(prefixHex: '001B63', vendor: 'Apple', category: OuiCategory.hardware),
  OuiEntry(prefixHex: '002500', vendor: 'Apple', category: OuiCategory.hardware),
  OuiEntry(prefixHex: '3C0754', vendor: 'Apple', category: OuiCategory.hardware),
  OuiEntry(prefixHex: 'F01898', vendor: 'Apple', category: OuiCategory.hardware),
];
