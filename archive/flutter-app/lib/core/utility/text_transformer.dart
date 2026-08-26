import '../ports/i_tool_use_case.dart';

/// Target naming convention for [TextCaseConverter].
enum TextCase {
  camel('camelCase', 'userNameId'),
  pascal('PascalCase', 'UserNameId'),
  snake('snake_case', 'user_name_id'),
  screamingSnake('SCREAMING_SNAKE_CASE', 'USER_NAME_ID'),
  kebab('kebab-case', 'user-name-id'),
  train('Train-Case', 'User-Name-Id'),
  dot('dot.case', 'user.name.id'),
  title('Title Case', 'User Name Id'),
  sentence('Sentence case', 'User name id'),
  lower('lowercase', 'user name id'),
  upper('UPPERCASE', 'USER NAME ID');

  const TextCase(this.label, this.example);

  final String label;
  final String example;

  /// [lower] and [upper] deliberately keep the original punctuation and
  /// spacing instead of re-joining split words, so they can be used to
  /// down/up-case a whole paragraph.
  bool get preservesLayout => this == TextCase.lower || this == TextCase.upper;
}

/// The line-oriented operations, kept in one enum so the UI can build a
/// single "Lines" group in its operation picker.
enum LineOperation {
  sort('Sort lines'),
  deduplicate('Remove duplicate lines'),
  reverse('Reverse line order'),
  trim('Trim each line'),
  removeBlank('Remove blank lines'),
  number('Add line numbers');

  const LineOperation(this.label);

  final String label;
}

class TextTransformResult {
  const TextTransformResult({required this.output, required this.lineCount});

  final String output;

  /// Number of lines in [output] (0 for empty output).
  final int lineCount;

  factory TextTransformResult.of(String output) => TextTransformResult(
        output: output,
        lineCount: output.isEmpty ? 0 : output.split('\n').length,
      );
}

class TextCaseInput {
  const TextCaseInput({required this.text, required this.target});

  final String text;
  final TextCase target;
}

class SlugifyInput {
  const SlugifyInput({
    required this.text,
    this.separator = '-',
    this.lowercase = true,
    this.maxLength,
  });

  final String text;

  /// Character(s) that replace runs of non-alphanumerics. `-` for URLs,
  /// `_` for filenames.
  final String separator;

  final bool lowercase;

  /// Truncate the slug at this many characters, cutting at a separator
  /// boundary so no half-word is left behind. Null means no limit.
  final int? maxLength;
}

class LineOperationInput {
  const LineOperationInput({
    required this.text,
    required this.operation,
    this.descending = false,
    this.caseInsensitive = false,
    this.natural = false,
    this.startNumber = 1,
    this.numberSeparator = '. ',
    this.padNumbers = true,
  });

  final String text;
  final LineOperation operation;

  /// [LineOperation.sort] only.
  final bool descending;

  /// [LineOperation.sort] and [LineOperation.deduplicate].
  final bool caseInsensitive;

  /// [LineOperation.sort] only — compare embedded digit runs numerically so
  /// `item2` sorts before `item10`.
  final bool natural;

  /// [LineOperation.number] only.
  final int startNumber;
  final String numberSeparator;

  /// [LineOperation.number] only — right-align numbers so the text stays
  /// in one column past line 9.
  final bool padNumbers;
}

/// Splits identifiers/prose into words, then re-joins them in a target
/// naming convention.
class TextCaseConverter implements IToolUseCase<TextCaseInput, TextTransformResult> {
  const TextCaseConverter();

  @override
  TextTransformResult execute(TextCaseInput input) {
    return TextTransformResult.of(convert(input.text, input.target));
  }

  String convert(String text, TextCase target) {
    if (target == TextCase.lower) return text.toLowerCase();
    if (target == TextCase.upper) return text.toUpperCase();

    final words = splitWords(text);
    if (words.isEmpty) return '';

    switch (target) {
      case TextCase.camel:
        return [_lower(words.first), ...words.skip(1).map(_capitalize)].join();
      case TextCase.pascal:
        return words.map(_capitalize).join();
      case TextCase.snake:
        return words.map(_lower).join('_');
      case TextCase.screamingSnake:
        return words.map(_upper).join('_');
      case TextCase.kebab:
        return words.map(_lower).join('-');
      case TextCase.train:
        return words.map(_capitalize).join('-');
      case TextCase.dot:
        return words.map(_lower).join('.');
      case TextCase.title:
        return words.map(_capitalize).join(' ');
      case TextCase.sentence:
        return [_capitalize(words.first), ...words.skip(1).map(_lower)].join(' ');
      case TextCase.lower:
      case TextCase.upper:
        return text;
    }
  }

  /// Breaks [text] into words on separators, case boundaries and digit
  /// boundaries.
  ///
  /// Separators are any ASCII character that is not a letter or digit, so
  /// `_ - . / space` and punctuation all split. Case boundaries handle both
  /// `fooBar` → `foo|Bar` and the acronym case `XMLHttpRequest` →
  /// `XML|Http|Request`, which is where naive `toLowerCase()`-then-split
  /// implementations fall over. Digits become their own words, so
  /// `parseHTTP2Response` → `parse|HTTP|2|Response`.
  ///
  /// Non-ASCII characters (accented letters, CJK, …) are treated as word
  /// characters and never split on, since their case rules are not
  /// reliably detectable here — [TextSlugifier] handles folding them.
  static List<String> splitWords(String text) {
    final words = <String>[];
    final buffer = StringBuffer();

    void flush() {
      if (buffer.isNotEmpty) {
        words.add(buffer.toString());
        buffer.clear();
      }
    }

    for (var i = 0; i < text.length; i++) {
      final unit = text.codeUnitAt(i);
      if (_isSeparatorUnit(unit)) {
        flush();
        continue;
      }
      if (buffer.isEmpty) {
        buffer.writeCharCode(unit);
        continue;
      }

      final previous = text.codeUnitAt(i - 1);
      final next = i + 1 < text.length ? text.codeUnitAt(i + 1) : null;

      final digitBoundary = _isDigitUnit(unit) != _isDigitUnit(previous);
      final lowerToUpper = _isUpperUnit(unit) && !_isUpperUnit(previous) && !_isDigitUnit(previous);
      final acronymEnd =
          _isUpperUnit(unit) && _isUpperUnit(previous) && next != null && _isLowerUnit(next);

      if (digitBoundary || lowerToUpper || acronymEnd) flush();
      buffer.writeCharCode(unit);
    }

    flush();
    return words;
  }

  static bool _isSeparatorUnit(int unit) {
    if (unit > 127) return false; // keep accented/CJK characters in the word
    return !_isDigitUnit(unit) && !_isUpperUnit(unit) && !_isLowerUnit(unit);
  }

  static bool _isDigitUnit(int unit) => unit >= 0x30 && unit <= 0x39;

  static bool _isUpperUnit(int unit) => unit >= 0x41 && unit <= 0x5A;

  static bool _isLowerUnit(int unit) => unit >= 0x61 && unit <= 0x7A;

  static String _lower(String word) => word.toLowerCase();

  static String _upper(String word) => word.toUpperCase();

  static String _capitalize(String word) {
    if (word.isEmpty) return word;
    return word[0].toUpperCase() + word.substring(1).toLowerCase();
  }
}

/// URL/filename slugs: fold diacritics, drop everything that is not
/// alphanumeric, collapse and trim the separator.
class TextSlugifier implements IToolUseCase<SlugifyInput, TextTransformResult> {
  const TextSlugifier();

  @override
  TextTransformResult execute(SlugifyInput input) {
    return TextTransformResult.of(
      slugify(
        input.text,
        separator: input.separator,
        lowercase: input.lowercase,
        maxLength: input.maxLength,
      ),
    );
  }

  String slugify(String text, {String separator = '-', bool lowercase = true, int? maxLength}) {
    if (maxLength != null && maxLength < 1) {
      throw ArgumentError('Maximum length must be at least 1');
    }

    var working = foldDiacritics(text);
    if (lowercase) working = working.toLowerCase();

    final buffer = StringBuffer();
    var pendingSeparator = false;
    var wroteAny = false;

    for (var i = 0; i < working.length; i++) {
      final unit = working.codeUnitAt(i);
      final isWordChar = (unit >= 0x30 && unit <= 0x39) ||
          (unit >= 0x41 && unit <= 0x5A) ||
          (unit >= 0x61 && unit <= 0x7A);
      if (isWordChar) {
        // Collapse the run of separators and never emit a leading one.
        if (pendingSeparator && wroteAny) buffer.write(separator);
        pendingSeparator = false;
        buffer.writeCharCode(unit);
        wroteAny = true;
      } else {
        pendingSeparator = true;
      }
    }

    var slug = buffer.toString();
    if (maxLength != null && slug.length > maxLength) {
      slug = slug.substring(0, maxLength);
      if (separator.isNotEmpty) {
        final cut = slug.lastIndexOf(separator);
        if (cut > 0) slug = slug.substring(0, cut);
        // Trim a separator left dangling by the hard cut.
        while (slug.endsWith(separator)) {
          slug = slug.substring(0, slug.length - separator.length);
        }
      }
    }
    return slug;
  }

  /// Replaces Latin letters carrying diacritics with their ASCII base, plus
  /// the handful of ligatures/letters that expand to two characters (ß→ss,
  /// æ→ae, þ→th). Dart has no Unicode normalisation in core, so this is an
  /// explicit table rather than an NFD strip.
  static String foldDiacritics(String text) {
    final buffer = StringBuffer();
    for (final rune in text.runes) {
      if (rune < 0x80) {
        buffer.writeCharCode(rune);
        continue;
      }
      final replacement = _diacritics[String.fromCharCode(rune)];
      buffer.write(replacement ?? String.fromCharCode(rune));
    }
    return buffer.toString();
  }

  static final Map<String, String> _diacritics = _buildDiacriticTable();

  static Map<String, String> _buildDiacriticTable() {
    const groups = <String, String>{
      'a': 'àáâãäåāăą',
      'A': 'ÀÁÂÃÄÅĀĂĄ',
      'c': 'çćĉċč',
      'C': 'ÇĆĈĊČ',
      'd': 'ďđ',
      'D': 'ĎĐ',
      'e': 'èéêëēĕėęě',
      'E': 'ÈÉÊËĒĔĖĘĚ',
      'g': 'ĝğġģ',
      'G': 'ĜĞĠĢ',
      'h': 'ĥħ',
      'H': 'ĤĦ',
      'i': 'ìíîïĩīĭįı',
      'I': 'ÌÍÎÏĨĪĬĮİ',
      'j': 'ĵ',
      'J': 'Ĵ',
      'k': 'ķ',
      'K': 'Ķ',
      'l': 'ĺļľŀł',
      'L': 'ĹĻĽĿŁ',
      'n': 'ñńņňŉ',
      'N': 'ÑŃŅŇ',
      'o': 'òóôõöøōŏő',
      'O': 'ÒÓÔÕÖØŌŎŐ',
      'r': 'ŕŗř',
      'R': 'ŔŖŘ',
      's': 'śŝşš',
      'S': 'ŚŜŞŠ',
      't': 'ţťŧ',
      'T': 'ŢŤŦ',
      'u': 'ùúûüũūŭůűų',
      'U': 'ÙÚÛÜŨŪŬŮŰŲ',
      'w': 'ŵ',
      'W': 'Ŵ',
      'y': 'ýÿŷ',
      'Y': 'ÝŶŸ',
      'z': 'źżž',
      'Z': 'ŹŻŽ',
      'ae': 'æ',
      'AE': 'Æ',
      'oe': 'œ',
      'OE': 'Œ',
      'ss': 'ß',
      'th': 'þ',
      'TH': 'Þ',
      'dh': 'ð',
      'DH': 'Ð',
    };
    final table = <String, String>{};
    groups.forEach((replacement, accented) {
      for (final rune in accented.runes) {
        table[String.fromCharCode(rune)] = replacement;
      }
    });
    return table;
  }
}

/// Sort / dedupe / reverse / trim / de-blank / number, over the lines of a
/// block of text.
class LineOperationRunner implements IToolUseCase<LineOperationInput, TextTransformResult> {
  const LineOperationRunner();

  @override
  TextTransformResult execute(LineOperationInput input) {
    final lines = splitLines(input.text);
    if (lines.isEmpty) return const TextTransformResult(output: '', lineCount: 0);

    final List<String> result;
    switch (input.operation) {
      case LineOperation.sort:
        result = sort(
          lines,
          descending: input.descending,
          caseInsensitive: input.caseInsensitive,
          natural: input.natural,
        );
      case LineOperation.deduplicate:
        result = deduplicate(lines, caseInsensitive: input.caseInsensitive);
      case LineOperation.reverse:
        result = lines.reversed.toList();
      case LineOperation.trim:
        result = [for (final line in lines) line.trim()];
      case LineOperation.removeBlank:
        result = [for (final line in lines) if (line.trim().isNotEmpty) line];
      case LineOperation.number:
        result = number(
          lines,
          start: input.startNumber,
          separator: input.numberSeparator,
          pad: input.padNumbers,
        );
    }

    return TextTransformResult(output: result.join('\n'), lineCount: result.length);
  }

  /// Splits on CRLF/CR/LF and drops a single trailing empty line so a text
  /// block ending in a newline does not gain a phantom row.
  static List<String> splitLines(String text) {
    if (text.isEmpty) return const [];
    final lines = text.split(RegExp(r'\r\n|\r|\n'));
    if (lines.isNotEmpty && lines.last.isEmpty) lines.removeLast();
    return lines;
  }

  List<String> sort(
    List<String> lines, {
    bool descending = false,
    bool caseInsensitive = false,
    bool natural = false,
  }) {
    final sorted = [...lines];
    int compare(String a, String b) {
      final left = caseInsensitive ? a.toLowerCase() : a;
      final right = caseInsensitive ? b.toLowerCase() : b;
      final result = natural ? compareNatural(left, right) : left.compareTo(right);
      // Fall back to the exact strings so a case-insensitive sort is still
      // deterministic for lines that differ only in case.
      return result != 0 ? result : a.compareTo(b);
    }

    sorted.sort(compare);
    return descending ? sorted.reversed.toList() : sorted;
  }

  /// Keeps the first occurrence of each line and drops later repeats.
  List<String> deduplicate(List<String> lines, {bool caseInsensitive = false}) {
    final seen = <String>{};
    final result = <String>[];
    for (final line in lines) {
      if (seen.add(caseInsensitive ? line.toLowerCase() : line)) result.add(line);
    }
    return result;
  }

  List<String> number(
    List<String> lines, {
    int start = 1,
    String separator = '. ',
    bool pad = true,
  }) {
    final width = pad ? '${start + lines.length - 1}'.length : 0;
    return [
      for (var i = 0; i < lines.length; i++)
        '${'${start + i}'.padLeft(width)}$separator${lines[i]}',
    ];
  }

  /// "Natural" comparison: runs of digits compare as numbers, so `item2`
  /// comes before `item10`. Leading zeros do not change the value, only the
  /// tie-break.
  static int compareNatural(String a, String b) {
    var i = 0;
    var j = 0;
    while (i < a.length && j < b.length) {
      final aDigit = _isDigit(a.codeUnitAt(i));
      final bDigit = _isDigit(b.codeUnitAt(j));

      if (aDigit && bDigit) {
        final aStart = i;
        final bStart = j;
        while (i < a.length && _isDigit(a.codeUnitAt(i))) {
          i++;
        }
        while (j < b.length && _isDigit(b.codeUnitAt(j))) {
          j++;
        }
        final aRun = a.substring(aStart, i);
        final bRun = b.substring(bStart, j);
        final aTrimmed = aRun.replaceFirst(RegExp(r'^0+(?=\d)'), '');
        final bTrimmed = bRun.replaceFirst(RegExp(r'^0+(?=\d)'), '');
        if (aTrimmed.length != bTrimmed.length) {
          return aTrimmed.length - bTrimmed.length;
        }
        final digits = aTrimmed.compareTo(bTrimmed);
        if (digits != 0) return digits;
        // Same numeric value: shorter (fewer leading zeros) sorts first.
        if (aRun.length != bRun.length) return aRun.length - bRun.length;
        continue;
      }

      final charComparison = a.codeUnitAt(i).compareTo(b.codeUnitAt(j));
      if (charComparison != 0) return charComparison;
      i++;
      j++;
    }
    return (a.length - i).compareTo(b.length - j);
  }

  static bool _isDigit(int unit) => unit >= 0x30 && unit <= 0x39;
}

/// One entry point the UI can hold, so the four screens' worth of small
/// spec 2.5 items live behind a single object.
class TextTransformer {
  const TextTransformer();

  static const caseConverter = TextCaseConverter();
  static const slugifier = TextSlugifier();
  static const lineRunner = LineOperationRunner();

  TextTransformResult convertCase(String text, TextCase target) =>
      caseConverter.execute(TextCaseInput(text: text, target: target));

  TextTransformResult slugify(
    String text, {
    String separator = '-',
    bool lowercase = true,
    int? maxLength,
  }) =>
      slugifier.execute(
        SlugifyInput(text: text, separator: separator, lowercase: lowercase, maxLength: maxLength),
      );

  TextTransformResult runLineOperation(LineOperationInput input) => lineRunner.execute(input);
}
