import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/mac_address_tool.dart';

void main() {
  const tool = MacAddressTool();

  group('normalize / notation parsing', () {
    test('colon, hyphen, dotted and bare notations all normalize the same', () {
      const expected = '001A2B3C4D5E';
      expect(tool.normalize('00:1A:2B:3C:4D:5E'), expected);
      expect(tool.normalize('00-1A-2B-3C-4D-5E'), expected);
      expect(tool.normalize('001A.2B3C.4D5E'), expected);
      expect(tool.normalize('001A2B3C4D5E'), expected);
    });

    test('lowercase input normalizes to uppercase', () {
      expect(tool.normalize('00:1a:2b:3c:4d:5e'), '001A2B3C4D5E');
    });

    test('mixed separators are all stripped', () {
      expect(tool.normalize('00:1A-2B.3C4D5E'), '001A2B3C4D5E');
    });

    test('analyze() reports every notation consistently for the same address', () {
      final a = tool.analyze('00:1A:2B:3C:4D:5E');
      final b = tool.analyze('00-1A-2B-3C-4D-5E');
      final c = tool.analyze('001A.2B3C.4D5E');
      final d = tool.analyze('001A2B3C4D5E');

      for (final analysis in [a, b, c, d]) {
        expect(analysis.normalizedHex, '001A2B3C4D5E');
        expect(analysis.colonForm, '00:1A:2B:3C:4D:5E');
        expect(analysis.hyphenForm, '00-1A-2B-3C-4D-5E');
        expect(analysis.dottedForm, '001A.2B3C.4D5E');
        expect(analysis.bareForm, '001A2B3C4D5E');
      }
    });

    test('allFormats returns every notation keyed by enum', () {
      final formats = tool.allFormats('001A2B3C4D5E');
      expect(formats[MacNotation.colon], '00:1A:2B:3C:4D:5E');
      expect(formats[MacNotation.hyphen], '00-1A-2B-3C-4D-5E');
      expect(formats[MacNotation.dotted], '001A.2B3C.4D5E');
      expect(formats[MacNotation.bare], '001A2B3C4D5E');
    });

    test('inNotation on the analysis matches format()', () {
      final analysis = tool.analyze('00:1A:2B:3C:4D:5E');
      expect(analysis.inNotation(MacNotation.colon), analysis.colonForm);
      expect(analysis.inNotation(MacNotation.hyphen), analysis.hyphenForm);
      expect(analysis.inNotation(MacNotation.dotted), analysis.dottedForm);
      expect(analysis.inNotation(MacNotation.bare), analysis.bareForm);
    });
  });

  group('U/L and I/G bit decoding', () {
    test('02: leading octet is locally administered, unicast', () {
      final a = tool.analyze('02:00:00:00:00:00');
      expect(a.isLocallyAdministered, isTrue);
      expect(a.isUniversallyAdministered, isFalse);
      expect(a.isMulticast, isFalse);
      expect(a.isUnicast, isTrue);
    });

    test('01: leading octet is multicast, universally administered', () {
      final a = tool.analyze('01:00:00:00:00:00');
      expect(a.isMulticast, isTrue);
      expect(a.isUnicast, isFalse);
      expect(a.isLocallyAdministered, isFalse);
      expect(a.isUniversallyAdministered, isTrue);
    });

    test('03: leading octet sets both bits', () {
      final a = tool.analyze('03:00:00:00:00:00');
      expect(a.isLocallyAdministered, isTrue);
      expect(a.isMulticast, isTrue);
    });

    test('00: leading octet sets neither bit', () {
      final a = tool.analyze('00:11:22:33:44:55');
      expect(a.isLocallyAdministered, isFalse);
      expect(a.isMulticast, isFalse);
    });

    test('a real vendor OUI (VMware, 00:50:56) is universally administered, unicast', () {
      final a = tool.analyze('00:50:56:12:34:56');
      expect(a.isLocallyAdministered, isFalse);
      expect(a.isMulticast, isFalse);
    });

    test('broadcast address FF:FF:FF:FF:FF:FF is flagged and is both bits set', () {
      final a = tool.analyze('FF:FF:FF:FF:FF:FF');
      expect(a.isBroadcast, isTrue);
      expect(a.isLocallyAdministered, isTrue);
      expect(a.isMulticast, isTrue);
    });

    test('a non-broadcast address is not flagged as broadcast', () {
      expect(tool.analyze('00:1A:2B:3C:4D:5E').isBroadcast, isFalse);
    });
  });

  group('vendor lookup', () {
    test('hits a known virtualization prefix (VMware 00:50:56)', () {
      final vendor = tool.lookupVendor('005056123456');
      expect(vendor, isNotNull);
      expect(vendor!.vendor, 'VMware');
      expect(vendor.category, OuiCategory.virtualization);
    });

    test('longest-prefix match: Docker (0242, 2-octet prefix) beats a miss', () {
      final vendor = tool.lookupVendor('0242AC110002');
      expect(vendor, isNotNull);
      expect(vendor!.vendor, 'Docker');
      expect(vendor.prefixHex, '0242');
    });

    test('misses an OUI that is not in the curated table', () {
      expect(tool.lookupVendor('AABBCC001122'), isNull);
    });

    test('analyze() surfaces the vendor lookup result inline', () {
      final a = tool.analyze('00:0C:29:AA:BB:CC');
      expect(a.vendor, isNotNull);
      expect(a.vendor!.vendor, 'VMware');
    });

    test('analyze() leaves vendor null for an unlisted OUI', () {
      final a = tool.analyze('AA:BB:CC:00:00:00');
      expect(a.vendor, isNull);
    });

    test('OuiEntry.prefixDisplay renders colon-separated pairs, including odd-length prefixes', () {
      const docker = OuiEntry(prefixHex: '0242', vendor: 'Docker', category: OuiCategory.virtualization);
      expect(docker.prefixDisplay, '02:42');
      const full = OuiEntry(prefixHex: '005056', vendor: 'VMware', category: OuiCategory.virtualization);
      expect(full.prefixDisplay, '00:50:56');
    });

    test('ouiDisplay on the analysis matches the colon form of the OUI', () {
      final a = tool.analyze('00:50:56:12:34:56');
      expect(a.ouiHex, '005056');
      expect(a.ouiDisplay, '00:50:56');
    });
  });

  group('malformed input rejected', () {
    test('empty string throws FormatException', () {
      expect(() => tool.normalize(''), throwsFormatException);
      expect(() => tool.normalize('   '), throwsFormatException);
    });

    test('non-hex characters throw FormatException', () {
      expect(() => tool.normalize('ZZ:11:22:33:44:55'), throwsFormatException);
      expect(() => tool.normalize('gg-11-22-33-44-55'), throwsFormatException);
    });

    test('wrong digit count throws FormatException', () {
      expect(() => tool.normalize('00:1A:2B:3C:4D'), throwsFormatException); // 10 digits
      expect(() => tool.normalize('00:1A:2B:3C:4D:5E:6F'), throwsFormatException); // 14 digits
    });

    test('analyze() propagates the same validation', () {
      expect(() => tool.analyze('not-a-mac'), throwsFormatException);
    });
  });

  group('generation', () {
    test('default options mint a locally-administered, unicast MAC', () {
      final results = tool.generate(const MacGenerationOptions(count: 25));
      expect(results, hasLength(25));
      for (final r in results) {
        expect(r.isLocallyAdministered, isTrue, reason: '${r.colonForm} should have U/L bit set');
        expect(r.isMulticast, isFalse, reason: '${r.colonForm} should be unicast');
      }
    });

    test('locallyAdministered: false clears the U/L bit', () {
      final results = tool.generate(
        const MacGenerationOptions(count: 25, locallyAdministered: false),
      );
      for (final r in results) {
        expect(r.isLocallyAdministered, isFalse, reason: '${r.colonForm} should not have U/L bit set');
      }
    });

    test('unicast: false sets the I/G bit (multicast)', () {
      final results = tool.generate(
        const MacGenerationOptions(count: 25, unicast: false),
      );
      for (final r in results) {
        expect(r.isMulticast, isTrue, reason: '${r.colonForm} should be multicast');
      }
    });

    test('addresses across a batch are not all identical (randomness sanity check)', () {
      final results = tool.generate(const MacGenerationOptions(count: 25));
      final distinct = results.map((r) => r.normalizedHex).toSet();
      expect(distinct.length, greaterThan(1));
    });

    test('a vendor prefix pins the leading octets verbatim, ignoring U/L and unicast options', () {
      final results = tool.generate(
        const MacGenerationOptions(
          count: 10,
          vendorPrefixHex: '00:50:56',
          locallyAdministered: false,
          unicast: false,
        ),
      );
      for (final r in results) {
        expect(r.ouiHex, '005056');
        expect(r.vendor?.vendor, 'VMware');
      }
    });

    test('a short (2-octet) vendor prefix pins only the leading octets given', () {
      final results = tool.generate(
        const MacGenerationOptions(count: 5, vendorPrefixHex: '0242'),
      );
      for (final r in results) {
        expect(r.normalizedHex.startsWith('0242'), isTrue);
      }
    });

    test('count of 1 is allowed and yields exactly one address', () {
      expect(tool.generate(const MacGenerationOptions(count: 1)), hasLength(1));
    });

    test('count of 0 throws ArgumentError', () {
      expect(() => tool.generate(const MacGenerationOptions(count: 0)), throwsArgumentError);
    });

    test('count above 256 throws ArgumentError', () {
      expect(() => tool.generate(const MacGenerationOptions(count: 257)), throwsArgumentError);
    });

    test('count of exactly 256 is allowed', () {
      expect(tool.generate(const MacGenerationOptions(count: 256)), hasLength(256));
    });

    test('an odd-length vendor prefix throws FormatException', () {
      expect(
        () => tool.generate(const MacGenerationOptions(vendorPrefixHex: '005')),
        throwsFormatException,
      );
    });

    test('a non-hex vendor prefix throws FormatException', () {
      expect(
        () => tool.generate(const MacGenerationOptions(vendorPrefixHex: 'ZZ')),
        throwsFormatException,
      );
    });

    test('a vendor prefix longer than 5 octets throws FormatException', () {
      expect(
        () => tool.generate(const MacGenerationOptions(vendorPrefixHex: '0011223344556677')),
        throwsFormatException,
      );
    });
  });
}
