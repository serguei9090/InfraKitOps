import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/subnet_calculator.dart';

void main() {
  group('SubnetCalculator IPv4', () {
    const calculator = SubnetCalculator();

    test('192.168.1.0/24 -> classic class-C subnet', () {
      final result = calculator.execute(const SubnetCalculatorInput(cidr: '192.168.1.0/24'));

      expect(result.version, IpVersion.v4);
      expect(result.networkAddress, '192.168.1.0');
      expect(result.broadcastAddress, '192.168.1.255');
      expect(result.subnetMask, '255.255.255.0');
      expect(result.wildcardMask, '0.0.0.255');
      expect(result.firstUsableAddress, '192.168.1.1');
      expect(result.lastUsableAddress, '192.168.1.254');
      expect(result.usableHostCount, 254);
      expect(result.totalAddressCount, BigInt.from(256));
    });

    test('10.0.0.0/8 -> classic class-A subnet', () {
      final result = calculator.execute(const SubnetCalculatorInput(cidr: '10.0.0.0/8'));

      expect(result.networkAddress, '10.0.0.0');
      expect(result.broadcastAddress, '10.255.255.255');
      expect(result.subnetMask, '255.0.0.0');
      expect(result.usableHostCount, 16777214);
      expect(result.totalAddressCount, BigInt.from(16777216));
    });

    test('10.0.0.0/22 -> multi-octet boundary subnet', () {
      final result = calculator.execute(const SubnetCalculatorInput(cidr: '10.0.0.0/22'));

      expect(result.networkAddress, '10.0.0.0');
      expect(result.broadcastAddress, '10.0.3.255');
      expect(result.subnetMask, '255.255.252.0');
      expect(result.wildcardMask, '0.0.3.255');
      expect(result.usableHostCount, 1022);
    });

    test('accepts a non-aligned host address and derives the network', () {
      final result = calculator.execute(const SubnetCalculatorInput(cidr: '192.168.1.130/24'));

      expect(result.networkAddress, '192.168.1.0');
      expect(result.broadcastAddress, '192.168.1.255');
    });

    test('/31 point-to-point link has 2 usable addresses, no broadcast concept', () {
      final result = calculator.execute(const SubnetCalculatorInput(cidr: '192.168.1.0/31'));

      expect(result.usableHostCount, 2);
      expect(result.firstUsableAddress, '192.168.1.0');
      expect(result.lastUsableAddress, '192.168.1.1');
    });

    test('/32 host route has exactly 1 usable address', () {
      final result = calculator.execute(const SubnetCalculatorInput(cidr: '192.168.1.5/32'));

      expect(result.usableHostCount, 1);
      expect(result.firstUsableAddress, '192.168.1.5');
      expect(result.lastUsableAddress, '192.168.1.5');
      expect(result.broadcastAddress, '192.168.1.5');
    });

    test('/0 covers the entire IPv4 address space', () {
      final result = calculator.execute(const SubnetCalculatorInput(cidr: '0.0.0.0/0'));

      expect(result.networkAddress, '0.0.0.0');
      expect(result.broadcastAddress, '255.255.255.255');
      expect(result.subnetMask, '0.0.0.0');
      expect(result.wildcardMask, '255.255.255.255');
    });
  });

  group('SubnetCalculator IPv6', () {
    const calculator = SubnetCalculator();

    test('2001:db8::/64 -> compressed network and full 64-bit host range', () {
      final result = calculator.execute(const SubnetCalculatorInput(cidr: '2001:db8::/64'));

      expect(result.version, IpVersion.v6);
      expect(result.prefixLength, 64);
      expect(result.networkAddress, '2001:db8::');
      expect(result.firstAddress, '2001:db8::');
      expect(result.lastAddress, '2001:db8::ffff:ffff:ffff:ffff');
      expect(result.totalAddressCount, BigInt.two.pow(64));
      // IPv4-only fields must stay null for an IPv6 result.
      expect(result.broadcastAddress, isNull);
      expect(result.subnetMask, isNull);
      expect(result.usableHostCount, isNull);
    });

    test('::1/128 -> loopback host route', () {
      final result = calculator.execute(const SubnetCalculatorInput(cidr: '::1/128'));

      expect(result.networkAddress, '::1');
      expect(result.firstAddress, '::1');
      expect(result.lastAddress, '::1');
      expect(result.totalAddressCount, BigInt.one);
    });

    test('prefers the leftmost longest zero run when compressing', () {
      final result = calculator.execute(const SubnetCalculatorInput(cidr: '2001:db8:0:0:1:0:0:1/128'));

      expect(result.networkAddress, '2001:db8::1:0:0:1');
    });

    test('::/0 covers the entire IPv6 address space', () {
      final result = calculator.execute(const SubnetCalculatorInput(cidr: '::/0'));

      expect(result.networkAddress, '::');
      expect(result.lastAddress, 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff');
      expect(result.totalAddressCount, BigInt.two.pow(128));
    });
  });

  group('SubnetCalculator invalid input', () {
    const calculator = SubnetCalculator();

    test('rejects an empty input', () {
      expect(
        () => calculator.execute(const SubnetCalculatorInput(cidr: '')),
        throwsArgumentError,
      );
    });

    test('rejects a missing "/" prefix length', () {
      expect(
        () => calculator.execute(const SubnetCalculatorInput(cidr: '192.168.1.0')),
        throwsFormatException,
      );
    });

    test('rejects an out-of-range IPv4 prefix length (/33)', () {
      expect(
        () => calculator.execute(const SubnetCalculatorInput(cidr: '192.168.1.0/33')),
        throwsArgumentError,
      );
    });

    test('rejects an out-of-range IPv6 prefix length (/129)', () {
      expect(
        () => calculator.execute(const SubnetCalculatorInput(cidr: '2001:db8::/129')),
        throwsArgumentError,
      );
    });

    test('rejects an IPv4 address with the wrong octet count', () {
      expect(
        () => calculator.execute(const SubnetCalculatorInput(cidr: '192.168.1/24')),
        throwsFormatException,
      );
    });

    test('rejects an out-of-range IPv4 octet', () {
      expect(
        () => calculator.execute(const SubnetCalculatorInput(cidr: '192.168.1.256/24')),
        throwsFormatException,
      );
    });

    test('rejects an IPv6 address with an invalid hex group', () {
      expect(
        () => calculator.execute(const SubnetCalculatorInput(cidr: 'gggg::1/64')),
        throwsFormatException,
      );
    });

    test('rejects an IPv6 address with more than one "::"', () {
      expect(
        () => calculator.execute(const SubnetCalculatorInput(cidr: '2001::db8::1/64')),
        throwsFormatException,
      );
    });

    test('rejects an unrecognizable address format', () {
      expect(
        () => calculator.execute(const SubnetCalculatorInput(cidr: 'not-an-ip/24')),
        throwsFormatException,
      );
    });
  });
}
