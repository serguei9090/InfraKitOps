import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/ip_range_tool.dart';

void main() {
  const tool = IpRangeTool();

  /// Asserts that [blocks] exactly tile the inclusive range [startInt]..
  /// [endInt]: sorted ascending, contiguous (no gaps), non-overlapping, and
  /// the total of every block's addressCount equals the range size. This is
  /// a structural check rather than an eyeball of the block list.
  void expectExactTiling(List<CidrBlock> blocks, int startInt, int endInt) {
    expect(blocks, isNotEmpty);

    final totalRangeSize = endInt - startInt + 1;
    final summedSize = blocks.fold<int>(0, (sum, b) => sum + b.addressCount);
    expect(summedSize, totalRangeSize, reason: 'block sizes must sum to the exact range size');

    expect(tool.parseIPv4(blocks.first.firstAddress), startInt, reason: 'first block must start at the range start');
    expect(tool.parseIPv4(blocks.last.lastAddress), endInt, reason: 'last block must end at the range end');

    // Every block must be a valid, aligned power-of-two CIDR block whose
    // size matches its prefix length.
    for (final b in blocks) {
      expect(b.addressCount, 1 << (32 - b.prefixLength));
      final networkInt = tool.parseIPv4(b.networkAddress);
      expect(networkInt & (b.addressCount - 1), 0, reason: '${b.cidr} network address must be aligned to its block size');
    }

    // Contiguity: each block's first address is exactly one past the
    // previous block's last address — no gap and no overlap possible.
    var expectedNext = startInt;
    for (final b in blocks) {
      expect(tool.parseIPv4(b.firstAddress), expectedNext);
      expectedNext = tool.parseIPv4(b.lastAddress) + 1;
    }
    expect(expectedNext, endInt + 1);
  }

  group('summarizeRange -> exact CIDR cover', () {
    test('a range that is already exactly one CIDR block yields one block', () {
      final result = tool.summarizeRange('192.168.1.0', '192.168.1.255');
      expect(result.blocks, hasLength(1));
      expect(result.blocks.single.cidr, '192.168.1.0/24');
      expect(result.totalAddresses, 256);
      expectExactTiling(result.blocks, tool.parseIPv4('192.168.1.0'), tool.parseIPv4('192.168.1.255'));
    });

    test('a single address yields one /32 block', () {
      final result = tool.summarizeRange('10.0.0.5', '10.0.0.5');
      expect(result.blocks, hasLength(1));
      expect(result.blocks.single.cidr, '10.0.0.5/32');
      expect(result.totalAddresses, 1);
    });

    test('an unaligned/odd-sized range needs several blocks that tile exactly (no gaps, no overlap)', () {
      final start = tool.parseIPv4('192.168.1.5');
      final end = tool.parseIPv4('192.168.1.10');
      final result = tool.summarizeRange('192.168.1.5', '192.168.1.10');

      expect(result.totalAddresses, 6);
      expect(result.blocks.length, greaterThan(1));
      expectExactTiling(result.blocks, start, end);
    });

    test('a larger unaligned range across a /24 boundary tiles exactly', () {
      final start = tool.parseIPv4('10.0.0.10');
      final end = tool.parseIPv4('10.0.3.100');
      final result = tool.summarizeRange('10.0.0.10', '10.0.3.100');

      expect(result.totalAddresses, end - start + 1);
      expectExactTiling(result.blocks, start, end);
    });

    test('a range starting at 0.0.0.0 with a small span still tiles exactly', () {
      final start = tool.parseIPv4('0.0.0.0');
      final end = tool.parseIPv4('0.0.0.9');
      final result = tool.summarizeRange('0.0.0.0', '0.0.0.9');
      expectExactTiling(result.blocks, start, end);
    });

    test('blocks are returned in ascending address order', () {
      final result = tool.summarizeRange('172.16.5.5', '172.16.5.40');
      for (var i = 1; i < result.blocks.length; i++) {
        expect(
          tool.parseIPv4(result.blocks[i].firstAddress),
          greaterThan(tool.parseIPv4(result.blocks[i - 1].firstAddress)),
        );
      }
    });

    test('start above end throws ArgumentError', () {
      expect(() => tool.summarizeRange('10.0.0.10', '10.0.0.5'), throwsArgumentError);
    });

    test('a malformed start address throws FormatException', () {
      expect(() => tool.summarizeRange('999.0.0.1', '10.0.0.5'), throwsFormatException);
      expect(() => tool.summarizeRange('10.0.0', '10.0.0.5'), throwsFormatException);
    });

    test('a malformed end address throws FormatException', () {
      expect(() => tool.summarizeRange('10.0.0.1', 'not-an-ip'), throwsFormatException);
    });
  });

  group('CIDR -> range expansion', () {
    test('expands a /24 to its network/first/last and count', () {
      final block = tool.expandCidr('10.0.0.0/24');
      expect(block.networkAddress, '10.0.0.0');
      expect(block.firstAddress, '10.0.0.0');
      expect(block.lastAddress, '10.0.0.255');
      expect(block.addressCount, 256);
      expect(block.prefixLength, 24);
    });

    test('a host part that is not zeroed is masked down to the network address', () {
      final block = tool.expandCidr('192.168.1.37/24');
      expect(block.networkAddress, '192.168.1.0');
      expect(block.firstAddress, '192.168.1.0');
      expect(block.lastAddress, '192.168.1.255');
    });

    test('a /32 covers exactly one address', () {
      final block = tool.expandCidr('10.0.0.5/32');
      expect(block.firstAddress, '10.0.0.5');
      expect(block.lastAddress, '10.0.0.5');
      expect(block.addressCount, 1);
    });

    test('a /0 covers the entire IPv4 space', () {
      final block = tool.expandCidr('1.2.3.4/0');
      expect(block.networkAddress, '0.0.0.0');
      expect(block.lastAddress, '255.255.255.255');
      expect(block.addressCount, 4294967296);
    });

    test('round-trips with summarizeRange: expanding a summarized block reproduces it', () {
      final summarized = tool.summarizeRange('192.168.1.0', '192.168.1.255').blocks.single;
      final expanded = tool.expandCidr(summarized.cidr);
      expect(expanded, summarized);
    });

    test('missing the "/" prefix throws FormatException', () {
      expect(() => tool.expandCidr('10.0.0.0'), throwsFormatException);
    });

    test('more than one "/" throws FormatException', () {
      expect(() => tool.expandCidr('10.0.0.0/24/8'), throwsFormatException);
    });

    test('a prefix length above 32 throws FormatException', () {
      expect(() => tool.expandCidr('10.0.0.0/33'), throwsFormatException);
    });

    test('a malformed address throws FormatException', () {
      expect(() => tool.expandCidr('10.0.0.999/24'), throwsFormatException);
    });
  });

  group('IPv4 codec', () {
    test('rejects an octet with a leading zero', () {
      expect(() => tool.parseIPv4('10.0.0.01'), throwsFormatException);
    });

    test('rejects an octet above 255', () {
      expect(() => tool.parseIPv4('10.0.0.256'), throwsFormatException);
    });

    test('rejects the wrong number of octets', () {
      expect(() => tool.parseIPv4('10.0.0'), throwsFormatException);
      expect(() => tool.parseIPv4('10.0.0.0.0'), throwsFormatException);
    });

    test('parse/format round-trips', () {
      expect(tool.formatIPv4(tool.parseIPv4('203.0.113.42')), '203.0.113.42');
    });
  });

  group('IPv6 ULA generation', () {
    test('generated prefix always starts with fd (L bit set)', () {
      for (var i = 0; i < 100; i++) {
        final ula = tool.generateUla();
        expect(ula.prefix48, startsWith('fd'));
        expect(
          RegExp(r'^fd[0-9a-f]{2}:[0-9a-f]{1,4}:[0-9a-f]{1,4}::/48$').hasMatch(ula.prefix48),
          isTrue,
          reason: 'unexpected shape: ${ula.prefix48}',
        );
      }
    });

    test('the /64 subnet and example address share the /48 prefix', () {
      final ula = tool.generateUla();
      final sitePrefix = ula.prefix48.split('::/48').first;
      expect(ula.subnet64, startsWith(sitePrefix));
      expect(ula.exampleAddress, startsWith(sitePrefix));
      expect(ula.exampleAddress, endsWith('::1'));
    });

    test('an explicit subnetId is honored and reflected in subnet64', () {
      final ula = tool.generateUla(subnetId: 0x00AB);
      expect(ula.subnetId, 0x00AB);
      expect(ula.subnet64, contains(':00ab::/64'));
    });

    test('subnetId out of range throws ArgumentError', () {
      expect(() => tool.generateUla(subnetId: -1), throwsArgumentError);
      expect(() => tool.generateUla(subnetId: 0x10000), throwsArgumentError);
    });

    test('globalIdHex is 10 lowercase hex digits', () {
      final ula = tool.generateUla();
      expect(RegExp(r'^[0-9a-f]{10}$').hasMatch(ula.globalIdHex), isTrue);
    });

    test('repeated generation is not deterministic (randomness sanity check)', () {
      final prefixes = {for (var i = 0; i < 20; i++) tool.generateUla().prefix48};
      expect(prefixes.length, greaterThan(1));
    });

    test('subnetOfUla carves the requested subnet out of a /48 prefix', () {
      final ula = tool.generateUla();
      final carved = tool.subnetOfUla(ula.prefix48, 0x0007);
      expect(carved, ula.prefix48.replaceFirst('::/48', ':0007::/64'));
    });

    test('subnetOfUla rejects a malformed /48 prefix', () {
      expect(() => tool.subnetOfUla('not-a-prefix', 1), throwsFormatException);
      expect(() => tool.subnetOfUla('2001:db8::/48', 1), throwsFormatException); // not fd/fc
    });

    test('subnetOfUla rejects an out-of-range subnetId', () {
      final ula = tool.generateUla();
      expect(() => tool.subnetOfUla(ula.prefix48, -1), throwsArgumentError);
      expect(() => tool.subnetOfUla(ula.prefix48, 0x10000), throwsArgumentError);
    });
  });
}
