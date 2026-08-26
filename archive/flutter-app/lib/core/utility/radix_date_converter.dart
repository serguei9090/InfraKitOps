import '../ports/i_tool_use_case.dart';

enum NumberBase {
  binary(2),
  octal(8),
  decimal(10),
  hexadecimal(16);

  const NumberBase(this.radix);

  final int radix;
}

class RadixConversionInput {
  const RadixConversionInput({
    required this.value,
    required this.fromBase,
    required this.toBase,
  });

  final String value;
  final NumberBase fromBase;
  final NumberBase toBase;
}

class RadixConversionResult {
  const RadixConversionResult({required this.value});

  final String value;
}

/// Converts non-negative integers between binary, octal, decimal and
/// hexadecimal. Uses [BigInt] rather than [int] so arbitrarily large
/// hex/binary values (beyond 64-bit) still round-trip correctly.
class RadixConverter implements IToolUseCase<RadixConversionInput, RadixConversionResult> {
  const RadixConverter();

  @override
  RadixConversionResult execute(RadixConversionInput input) {
    final cleaned = input.value.trim();
    if (cleaned.isEmpty) {
      throw ArgumentError('Input is empty');
    }

    BigInt parsed;
    try {
      parsed = BigInt.parse(cleaned, radix: input.fromBase.radix);
    } on FormatException {
      throw FormatException('"$cleaned" is not a valid base ${input.fromBase.radix} number');
    }

    if (parsed.isNegative) {
      throw ArgumentError('Negative numbers are not supported');
    }

    return RadixConversionResult(value: parsed.toRadixString(input.toBase.radix));
  }
}

enum RomanNumeralOperation { toRoman, toDecimal }

class RomanNumeralInput {
  const RomanNumeralInput({required this.value, required this.operation});

  final String value;
  final RomanNumeralOperation operation;
}

class RomanNumeralResult {
  const RomanNumeralResult({required this.value});

  final String value;
}

const _romanValues = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
const _romanSymbols = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
const _romanDigitValues = {'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100, 'D': 500, 'M': 1000};

/// Roman numeral <-> decimal, hand-rolled with the standard subtractive
/// notation (values 1-3999, the classically representable range).
class RomanNumeralConverter implements IToolUseCase<RomanNumeralInput, RomanNumeralResult> {
  const RomanNumeralConverter();

  @override
  RomanNumeralResult execute(RomanNumeralInput input) {
    switch (input.operation) {
      case RomanNumeralOperation.toRoman:
        return RomanNumeralResult(value: _toRoman(input.value.trim()));
      case RomanNumeralOperation.toDecimal:
        return RomanNumeralResult(value: _toDecimal(input.value.trim()));
    }
  }

  String _toRoman(String value) {
    if (value.isEmpty) {
      throw ArgumentError('Input is empty');
    }
    final n = int.tryParse(value);
    if (n == null) {
      throw FormatException('"$value" is not a valid integer');
    }
    if (n < 1 || n > 3999) {
      throw ArgumentError('Roman numerals only support values from 1 to 3999');
    }

    var remaining = n;
    final buffer = StringBuffer();
    for (var i = 0; i < _romanValues.length; i++) {
      while (remaining >= _romanValues[i]) {
        remaining -= _romanValues[i];
        buffer.write(_romanSymbols[i]);
      }
    }
    return buffer.toString();
  }

  String _toDecimal(String value) {
    if (value.isEmpty) {
      throw ArgumentError('Input is empty');
    }
    final normalized = value.toUpperCase();

    var total = 0;
    for (var i = 0; i < normalized.length; i++) {
      final current = _romanDigitValues[normalized[i]];
      if (current == null) {
        throw FormatException('"${normalized[i]}" is not a valid Roman numeral character');
      }
      final next = i + 1 < normalized.length ? _romanDigitValues[normalized[i + 1]] : null;
      if (next != null && current < next) {
        total -= current;
      } else {
        total += current;
      }
    }

    // Reject non-canonical forms (e.g. "IIII", "VX") by re-rendering the
    // computed value and requiring it to match the input exactly.
    if (total < 1 || total > 3999 || _toRoman(total.toString()) != normalized) {
      throw FormatException('"$value" is not a valid Roman numeral');
    }

    return total.toString();
  }
}

enum EpochUnit { seconds, milliseconds }

enum TimestampDirection { epochToIso, isoToEpoch }

class TimestampConversionInput {
  const TimestampConversionInput({
    required this.value,
    required this.direction,
    required this.unit,
  });

  final String value;
  final TimestampDirection direction;
  final EpochUnit unit;
}

class TimestampConversionResult {
  const TimestampConversionResult({required this.value});

  final String value;
}

/// Unix epoch <-> ISO-8601, always normalized through UTC so the result does
/// not depend on the host machine's local time zone.
class TimestampConverter implements IToolUseCase<TimestampConversionInput, TimestampConversionResult> {
  const TimestampConverter();

  @override
  TimestampConversionResult execute(TimestampConversionInput input) {
    final trimmed = input.value.trim();
    if (trimmed.isEmpty) {
      throw ArgumentError('Input is empty');
    }

    switch (input.direction) {
      case TimestampDirection.epochToIso:
        return TimestampConversionResult(value: _epochToIso(trimmed, input.unit));
      case TimestampDirection.isoToEpoch:
        return TimestampConversionResult(value: _isoToEpoch(trimmed, input.unit));
    }
  }

  String _epochToIso(String value, EpochUnit unit) {
    final n = int.tryParse(value);
    if (n == null) {
      throw FormatException('"$value" is not a valid integer epoch value');
    }
    final milliseconds = unit == EpochUnit.seconds ? n * 1000 : n;
    final dateTime = DateTime.fromMillisecondsSinceEpoch(milliseconds, isUtc: true);
    return dateTime.toIso8601String();
  }

  String _isoToEpoch(String value, EpochUnit unit) {
    DateTime dateTime;
    try {
      dateTime = DateTime.parse(value);
    } on FormatException {
      throw FormatException('"$value" is not a valid ISO-8601 timestamp');
    }
    // DateTime.parse interprets a string with no 'Z'/offset suffix as local
    // time, so results for such inputs vary with the host's time zone unless
    // an explicit offset is supplied.
    final utc = dateTime.toUtc();
    final milliseconds = utc.millisecondsSinceEpoch;
    final result = unit == EpochUnit.seconds ? (milliseconds / 1000).round() : milliseconds;
    return result.toString();
  }
}
