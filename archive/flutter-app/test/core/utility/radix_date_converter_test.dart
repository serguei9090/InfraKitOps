import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/radix_date_converter.dart';

void main() {
  group('RadixConverter', () {
    const converter = RadixConverter();

    test('converts decimal to hexadecimal', () {
      final result = converter.execute(
        const RadixConversionInput(value: '255', fromBase: NumberBase.decimal, toBase: NumberBase.hexadecimal),
      );
      expect(result.value, 'ff');
    });

    test('converts hexadecimal to binary', () {
      final result = converter.execute(
        const RadixConversionInput(value: 'FF', fromBase: NumberBase.hexadecimal, toBase: NumberBase.binary),
      );
      expect(result.value, '11111111');
    });

    test('rejects digits invalid for the source base', () {
      expect(
        () => converter.execute(
          const RadixConversionInput(value: '102', fromBase: NumberBase.binary, toBase: NumberBase.decimal),
        ),
        throwsFormatException,
      );
    });
  });

  group('RomanNumeralConverter', () {
    const converter = RomanNumeralConverter();

    test('converts decimal to Roman numerals', () {
      final result = converter.execute(
        const RomanNumeralInput(value: '1994', operation: RomanNumeralOperation.toRoman),
      );
      expect(result.value, 'MCMXCIV');
    });

    test('converts Roman numerals to decimal', () {
      final result = converter.execute(
        const RomanNumeralInput(value: 'MCMXCIV', operation: RomanNumeralOperation.toDecimal),
      );
      expect(result.value, '1994');
    });

    test('rejects non-canonical Roman numerals', () {
      expect(
        () => converter.execute(
          const RomanNumeralInput(value: 'IIII', operation: RomanNumeralOperation.toDecimal),
        ),
        throwsFormatException,
      );
    });

    test('rejects out-of-range values', () {
      expect(
        () => converter.execute(
          const RomanNumeralInput(value: '4000', operation: RomanNumeralOperation.toRoman),
        ),
        throwsArgumentError,
      );
    });
  });

  group('TimestampConverter', () {
    const converter = TimestampConverter();

    test('converts epoch seconds to ISO-8601', () {
      final result = converter.execute(
        const TimestampConversionInput(
          value: '0',
          direction: TimestampDirection.epochToIso,
          unit: EpochUnit.seconds,
        ),
      );
      expect(result.value, '1970-01-01T00:00:00.000Z');
    });

    test('converts ISO-8601 to epoch seconds', () {
      final result = converter.execute(
        const TimestampConversionInput(
          value: '2024-01-01T00:00:00Z',
          direction: TimestampDirection.isoToEpoch,
          unit: EpochUnit.seconds,
        ),
      );
      expect(result.value, '1704067200');
    });

    test('rejects an invalid ISO-8601 timestamp', () {
      expect(
        () => converter.execute(
          const TimestampConversionInput(
            value: 'not-a-date',
            direction: TimestampDirection.isoToEpoch,
            unit: EpochUnit.seconds,
          ),
        ),
        throwsFormatException,
      );
    });
  });
}
