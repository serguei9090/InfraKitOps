import '../ports/i_tool_use_case.dart';

/// Where a capture group's value came from.
///
/// Dart's [Match] API exposes group *values* but not group *offsets*, so a
/// capture group can report its text but not its position in the subject.
/// Only the overall match carries [RegexMatchResult.start]/[RegexMatchResult.end].
class RegexCaptureGroup {
  const RegexCaptureGroup({required this.index, required this.value, this.name});

  /// 1-based group number. Group 0 (the whole match) is not repeated here.
  final int index;

  /// The group's name when the pattern used `(?<name>...)`, otherwise null.
  final String? name;

  /// The captured text, or null when the group did not participate in the match.
  final String? value;

  bool get didParticipate => value != null;

  /// `1` or `1 (year)` — the label the UI shows for this group.
  String get label => name == null ? '$index' : '$index ($name)';
}

class RegexMatchResult {
  const RegexMatchResult({
    required this.index,
    required this.start,
    required this.end,
    required this.text,
    required this.groups,
  });

  /// 0-based position of this match within the list of all matches.
  final int index;

  /// Inclusive start offset of the match in the subject string.
  final int start;

  /// Exclusive end offset of the match in the subject string.
  final int end;

  /// The full matched substring (group 0).
  final String text;

  /// Every capture group the pattern declares, numbered and (where the pattern
  /// names them) named. Groups that did not participate are included with a
  /// null [RegexCaptureGroup.value] — a missing group is usually the thing
  /// being debugged, so it is reported rather than dropped.
  final List<RegexCaptureGroup> groups;

  Iterable<RegexCaptureGroup> get namedGroups => groups.where((g) => g.name != null);
}

/// One decomposed piece of the pattern, described in English.
class RegexExplanationToken {
  const RegexExplanationToken({required this.token, required this.description, this.depth = 0});

  /// The literal slice of the pattern this token covers.
  final String token;

  /// A plain-English description of what that slice does.
  final String description;

  /// Group nesting level, so the UI can indent nested constructs.
  final int depth;
}

class RegexTesterInput {
  const RegexTesterInput({
    required this.pattern,
    required this.subject,
    this.caseInsensitive = false,
    this.multiLine = false,
    this.dotAll = false,
    this.unicode = false,
  });

  final String pattern;
  final String subject;

  /// `i` — letters match regardless of case.
  final bool caseInsensitive;

  /// `m` — `^` and `$` match at line breaks, not just string boundaries.
  final bool multiLine;

  /// `s` — `.` also matches newline characters.
  final bool dotAll;

  /// `u` — full Unicode code-point semantics (a surrogate pair counts as one
  /// character) and `\u{...}` escapes.
  final bool unicode;

  /// The flag letters in canonical order, e.g. `gim`. `g` is implicit because
  /// this tool always reports every match.
  String get flagString {
    final buffer = StringBuffer('g');
    if (caseInsensitive) buffer.write('i');
    if (multiLine) buffer.write('m');
    if (dotAll) buffer.write('s');
    if (unicode) buffer.write('u');
    return buffer.toString();
  }
}

class RegexTesterResult {
  const RegexTesterResult({
    required this.isValid,
    this.errorMessage,
    this.matches = const [],
    this.explanation = const [],
    this.warnings = const [],
    this.subjectTruncated = false,
    this.matchesTruncated = false,
  });

  final bool isValid;
  final String? errorMessage;

  /// Every match found, in subject order, capped at [RegexTester.maxMatches].
  final List<RegexMatchResult> matches;

  /// Token-by-token decomposition of the pattern. Populated whenever the
  /// pattern is syntactically valid, even when there are zero matches.
  final List<RegexExplanationToken> explanation;

  /// Non-fatal advisories (e.g. a nested quantifier that risks catastrophic
  /// backtracking, or an input that hit a cap).
  final List<String> warnings;

  /// True when the subject was longer than [RegexTester.maxSubjectLength] and
  /// was cut down before matching.
  final bool subjectTruncated;

  /// True when matching stopped at [RegexTester.maxMatches].
  final bool matchesTruncated;

  int get matchCount => matches.length;
}

/// Runs a regular expression against a subject string and decomposes the
/// pattern into an English explanation.
///
/// ## Safety caps
///
/// A pattern with nested quantifiers such as `(a+)+$` backtracks
/// exponentially, and `RegExp.allMatches` runs synchronously — on a UI thread
/// that means a hang, not a slow result. Dart offers no way to interrupt a
/// running match, so the only real defence is bounding the work:
///
/// * the subject is truncated to [maxSubjectLength] (20,000 characters) and
///   [RegexTesterResult.subjectTruncated] is set;
/// * at most [maxMatches] (1,000) matches are collected, after which
///   [RegexTesterResult.matchesTruncated] is set;
/// * [nestedQuantifierWarning] is emitted when the pattern *looks* like it
///   contains a quantified group that is itself quantified.
///
/// Be honest about the limit: a truly pathological pattern can still take a
/// long time against a 20,000-character subject. The caps bound the damage and
/// the warning tells the user what they are about to do; they do not make
/// catastrophic backtracking impossible.
///
/// ## What the explainer does *not* do
///
/// [explain] is a single-pass token scanner, not a regex grammar/parser. It
/// covers the constructs in the app's regex cheatsheet — character classes and
/// `\d \D \w \W \s \S`, `[...]` sets, anchors `^ $ \b \B`, quantifiers
/// `* + ? {n,m}` including their lazy `?` and possessive-looking forms, groups
/// `(...)`, `(?:...)`, `(?<name>...)`, alternation `|`, lookaround `(?=)`,
/// `(?!)`, `(?<=)`, `(?<!)`, backreferences `\1` / `\k<name>`, and escaped
/// literals. It deliberately does not:
///
/// * build a tree or verify that groups balance (an unbalanced `)` is described
///   as a group close, and the *matching* step is what reports the syntax error);
/// * resolve which sub-expression a quantifier applies to beyond "the preceding
///   element", so it will not tell you a `+` covers a whole group's contents;
/// * interpret the contents of a character class beyond listing its ranges and
///   members, or expand `\p{...}` Unicode property escapes;
/// * describe conditionals, atomic groups, or recursion — constructs Dart's
///   `RegExp` does not support in the first place.
class RegexTester implements IToolUseCase<RegexTesterInput, RegexTesterResult> {
  const RegexTester();

  /// Subject strings longer than this are truncated before matching.
  static const int maxSubjectLength = 20000;

  /// Matching stops after this many matches.
  static const int maxMatches = 1000;

  static const String nestedQuantifierWarning =
      'This pattern contains a quantified group that is itself quantified '
      '(e.g. "(a+)+"). Patterns shaped like this can backtrack exponentially '
      'and take a very long time on a non-matching subject.';

  @override
  RegexTesterResult execute(RegexTesterInput input) {
    if (input.pattern.isEmpty) {
      return const RegexTesterResult(isValid: false, errorMessage: 'Enter a pattern to test.');
    }

    final RegExp regExp;
    try {
      regExp = RegExp(
        input.pattern,
        caseSensitive: !input.caseInsensitive,
        multiLine: input.multiLine,
        dotAll: input.dotAll,
        unicode: input.unicode,
      );
    } on FormatException catch (e) {
      return RegexTesterResult(
        isValid: false,
        errorMessage: 'Invalid pattern: ${e.message}',
        explanation: explain(input.pattern),
      );
    } catch (e) {
      // Defensive: never let an unexpected engine error escape to the UI.
      return RegexTesterResult(
        isValid: false,
        errorMessage: 'Invalid pattern: $e',
        explanation: explain(input.pattern),
      );
    }

    final warnings = <String>[];
    if (_hasNestedQuantifier(input.pattern)) warnings.add(nestedQuantifierWarning);

    var subject = input.subject;
    var subjectTruncated = false;
    if (subject.length > maxSubjectLength) {
      subject = subject.substring(0, maxSubjectLength);
      subjectTruncated = true;
      warnings.add(
        'Subject truncated to $maxSubjectLength characters '
        '(was ${input.subject.length}) to keep matching responsive.',
      );
    }

    final matches = <RegexMatchResult>[];
    var matchesTruncated = false;
    try {
      for (final match in regExp.allMatches(subject)) {
        if (matches.length >= maxMatches) {
          matchesTruncated = true;
          break;
        }
        matches.add(_toResult(matches.length, match));
      }
    } catch (e) {
      return RegexTesterResult(
        isValid: false,
        errorMessage: 'Matching failed: $e',
        explanation: explain(input.pattern),
        warnings: warnings,
      );
    }

    if (matchesTruncated) {
      warnings.add('Stopped after the first $maxMatches matches.');
    }

    return RegexTesterResult(
      isValid: true,
      matches: matches,
      explanation: explain(input.pattern),
      warnings: warnings,
      subjectTruncated: subjectTruncated,
      matchesTruncated: matchesTruncated,
    );
  }

  RegexMatchResult _toResult(int index, RegExpMatch match) {
    // Map group number -> name, so a named group is reported once with both.
    final namesByNumber = <int, String>{};
    for (final name in match.groupNames) {
      final value = match.namedGroup(name);
      for (var i = 1; i <= match.groupCount; i++) {
        if (namesByNumber.containsKey(i)) continue;
        if (identical(match.group(i), value) || match.group(i) == value) {
          namesByNumber[i] = name;
          break;
        }
      }
    }

    final groups = <RegexCaptureGroup>[
      for (var i = 1; i <= match.groupCount; i++)
        RegexCaptureGroup(index: i, name: namesByNumber[i], value: match.group(i)),
    ];

    // Named groups whose number could not be resolved by value matching (two
    // groups capturing identical text, for instance) are still reported.
    for (final name in match.groupNames) {
      if (groups.any((g) => g.name == name)) continue;
      groups.add(RegexCaptureGroup(index: groups.length + 1, name: name, value: match.namedGroup(name)));
    }

    return RegexMatchResult(
      index: index,
      start: match.start,
      end: match.end,
      text: match.group(0) ?? '',
      groups: groups,
    );
  }

  /// Heuristic scan for `(...+)+` / `(...*)*` shapes — a quantifier applied to
  /// a group whose body already ends in a quantifier. False positives are
  /// possible (the result is a warning, never an error).
  static bool _hasNestedQuantifier(String pattern) {
    for (var i = 0; i < pattern.length; i++) {
      if (pattern[i] != '(') continue;
      final close = _matchingParen(pattern, i);
      if (close < 0) continue;
      final after = close + 1;
      if (after >= pattern.length) continue;
      final outer = pattern[after];
      if (outer != '*' && outer != '+' && !(outer == '{' && pattern.indexOf('}', after) > after)) {
        continue;
      }
      // Body must itself contain an unbounded quantifier.
      final body = pattern.substring(i + 1, close);
      for (var j = 0; j < body.length; j++) {
        if (body[j] == r'\') {
          j++;
          continue;
        }
        if (body[j] == '*' || body[j] == '+') return true;
      }
    }
    return false;
  }

  static int _matchingParen(String pattern, int open) {
    var depth = 0;
    for (var i = open; i < pattern.length; i++) {
      final c = pattern[i];
      if (c == r'\') {
        i++;
        continue;
      }
      if (c == '[') {
        i = _endOfClass(pattern, i);
        if (i < 0) return -1;
        continue;
      }
      if (c == '(') depth++;
      if (c == ')') {
        depth--;
        if (depth == 0) return i;
      }
    }
    return -1;
  }

  static int _endOfClass(String pattern, int open) {
    for (var i = open + 1; i < pattern.length; i++) {
      if (pattern[i] == r'\') {
        i++;
        continue;
      }
      if (pattern[i] == ']' && i > open + 1) return i;
      if (pattern[i] == ']' && i == open + 1) continue; // "[]]" edge case
    }
    return -1;
  }

  // -------------------------------------------------------------------------
  // Pattern explainer
  // -------------------------------------------------------------------------

  /// Decompose [pattern] into tokens with an English description each.
  /// See the class doc for the constructs this covers and the ones it does not.
  List<RegexExplanationToken> explain(String pattern) {
    final tokens = <RegexExplanationToken>[];
    var depth = 0;
    var groupNumber = 0;
    var i = 0;
    final literal = StringBuffer();

    void flushLiteral({bool keepLastChar = false}) {
      if (literal.isEmpty) return;
      var text = literal.toString();
      literal.clear();
      if (keepLastChar && text.length > 1) {
        final head = text.substring(0, text.length - 1);
        tokens.add(
          RegexExplanationToken(token: head, description: 'Matches the literal text "$head".', depth: depth),
        );
        text = text.substring(text.length - 1);
      }
      tokens.add(
        RegexExplanationToken(
          token: text,
          description: text.length == 1
              ? 'Matches the literal character "$text".'
              : 'Matches the literal text "$text".',
          depth: depth,
        ),
      );
    }

    bool nextIsQuantifier() {
      if (i + 1 >= pattern.length) return false;
      final c = pattern[i + 1];
      return c == '*' || c == '+' || c == '?' || (c == '{' && _braceQuantifierEnd(pattern, i + 1) > 0);
    }

    void add(String token, String description, {int? atDepth}) {
      tokens.add(RegexExplanationToken(token: token, description: description, depth: atDepth ?? depth));
    }

    while (i < pattern.length) {
      final c = pattern[i];

      switch (c) {
        case r'\':
          flushLiteral(keepLastChar: false);
          final consumed = _escapeToken(pattern, i);
          i += consumed.$1;
          add(consumed.$2, consumed.$3);
          continue;

        case '[':
          flushLiteral();
          final end = _endOfClass(pattern, i);
          if (end < 0) {
            add(pattern.substring(i), 'Unterminated character class — missing a closing "]".');
            i = pattern.length;
            continue;
          }
          final token = pattern.substring(i, end + 1);
          add(token, _describeCharacterClass(pattern.substring(i + 1, end)));
          i = end + 1;
          continue;

        case '(':
          flushLiteral();
          final opened = _groupOpener(pattern, i);
          final token = opened.$1;
          String description;
          if (opened.$2 == _GroupKind.capturing) {
            groupNumber++;
            description = 'Start of capturing group $groupNumber — the text it matches is stored as group $groupNumber.';
          } else if (opened.$2 == _GroupKind.named) {
            groupNumber++;
            description =
                'Start of named capturing group "${opened.$3}" (also group $groupNumber) — its match is retrievable by name.';
          } else {
            description = opened.$3;
          }
          add(token, description);
          depth++;
          i += token.length;
          continue;

        case ')':
          flushLiteral();
          if (depth > 0) depth--;
          add(')', 'End of the group opened above.');
          i++;
          continue;

        case '|':
          flushLiteral();
          add('|', 'Alternation — matches either the expression before this or the one after it.');
          i++;
          continue;

        case '^':
          flushLiteral();
          add('^', 'Anchor: start of the string (start of a line when multiline mode is on).');
          i++;
          continue;

        case r'$':
          flushLiteral();
          add(r'$', 'Anchor: end of the string (end of a line when multiline mode is on).');
          i++;
          continue;

        case '.':
          flushLiteral();
          add('.', 'Matches any single character except a line break (any character at all when dotAll is on).');
          i++;
          continue;

        case '*':
        case '+':
        case '?':
          flushLiteral();
          final lazy = i + 1 < pattern.length && pattern[i + 1] == '?';
          final token = lazy ? '$c?' : c;
          add(token, _describeQuantifier(c, lazy));
          i += token.length;
          continue;

        case '{':
          final end = _braceQuantifierEnd(pattern, i);
          if (end < 0) {
            // Not a quantifier — a literal brace.
              literal.write(c);
            i++;
            continue;
          }
          flushLiteral();
          final lazy = end + 1 < pattern.length && pattern[end + 1] == '?';
          final token = pattern.substring(i, lazy ? end + 2 : end + 1);
          add(token, _describeBraceQuantifier(pattern.substring(i + 1, end), lazy));
          i = lazy ? end + 2 : end + 1;
          continue;

        default:
          // A literal run; if a quantifier follows, split the last character
          // off so the explanation reads "b" then "one or more times".
          literal.write(c);
          if (nextIsQuantifier()) flushLiteral(keepLastChar: true);
          i++;
          continue;
      }
    }
    flushLiteral();
    return tokens;
  }

  /// Returns (charactersConsumed, tokenText, description) for the escape at [i].
  static (int, String, String) _escapeToken(String pattern, int i) {
    if (i + 1 >= pattern.length) {
      return (1, r'\', r'A trailing backslash with nothing to escape.');
    }
    final c = pattern[i + 1];
    final token = '\\$c';

    switch (c) {
      case 'd':
        return (2, token, 'Matches any digit, 0-9.');
      case 'D':
        return (2, token, 'Matches any character that is not a digit.');
      case 'w':
        return (2, token, 'Matches a word character: a letter, digit, or underscore.');
      case 'W':
        return (2, token, 'Matches any character that is not a word character.');
      case 's':
        return (2, token, 'Matches any whitespace character: space, tab, or line break.');
      case 'S':
        return (2, token, 'Matches any non-whitespace character.');
      case 'b':
        return (2, token, 'Word boundary: the position between a word character and a non-word character.');
      case 'B':
        return (2, token, 'Not a word boundary: any position that is not a word boundary.');
      case 'n':
        return (2, token, 'Matches a newline character.');
      case 'r':
        return (2, token, 'Matches a carriage return.');
      case 't':
        return (2, token, 'Matches a tab character.');
      case 'f':
        return (2, token, 'Matches a form feed.');
      case 'v':
        return (2, token, 'Matches a vertical tab.');
      case '0':
        return (2, token, 'Matches a NUL character.');
      case 'k':
        {
          if (i + 2 < pattern.length && pattern[i + 2] == '<') {
            final close = pattern.indexOf('>', i + 3);
            if (close > 0) {
              final name = pattern.substring(i + 3, close);
              return (
                close - i + 1,
                pattern.substring(i, close + 1),
                'Backreference: matches the same text that named group "$name" captured.',
              );
            }
          }
          return (2, token, 'Escaped "k".');
        }
      case 'u':
        {
          if (i + 2 < pattern.length && pattern[i + 2] == '{') {
            final close = pattern.indexOf('}', i + 3);
            if (close > 0) {
              final hex = pattern.substring(i + 3, close);
              return (
                close - i + 1,
                pattern.substring(i, close + 1),
                'Matches the Unicode code point U+${hex.toUpperCase()} (requires unicode mode).',
              );
            }
          }
          if (i + 5 < pattern.length) {
            final hex = pattern.substring(i + 2, i + 6);
            return (6, pattern.substring(i, i + 6), 'Matches the Unicode code unit U+${hex.toUpperCase()}.');
          }
          return (2, token, 'Unicode escape (incomplete).');
        }
      case 'x':
        {
          if (i + 3 < pattern.length) {
            final hex = pattern.substring(i + 2, i + 4);
            return (4, pattern.substring(i, i + 4), 'Matches the character with hex code 0x${hex.toUpperCase()}.');
          }
          return (2, token, 'Hex escape (incomplete).');
        }
      case 'p':
      case 'P':
        {
          if (i + 2 < pattern.length && pattern[i + 2] == '{') {
            final close = pattern.indexOf('}', i + 3);
            if (close > 0) {
              final prop = pattern.substring(i + 3, close);
              final negated = c == 'P' ? 'not ' : '';
              return (
                close - i + 1,
                pattern.substring(i, close + 1),
                'Matches any character ${negated}in the Unicode property "$prop" (requires unicode mode). '
                    'The property itself is not decomposed further.',
              );
            }
          }
          return (2, token, 'Unicode property escape (incomplete).');
        }
      default:
        if (RegExp(r'[1-9]').hasMatch(c)) {
          return (2, token, 'Backreference: matches the same text that capturing group $c captured.');
        }
        return (2, token, 'Matches a literal "$c" (the backslash removes any special meaning).');
    }
  }

  static String _describeQuantifier(String c, bool lazy) {
    final base = switch (c) {
      '*' => 'Repeats the preceding element zero or more times',
      '+' => 'Repeats the preceding element one or more times',
      _ => 'Makes the preceding element optional — zero or one time',
    };
    return lazy ? '$base, lazily (as few as possible).' : '$base, greedily (as many as possible).';
  }

  static String _describeBraceQuantifier(String body, bool lazy) {
    final greed = lazy ? ', lazily (as few as possible)' : ', greedily (as many as possible)';
    final parts = body.split(',');
    if (parts.length == 1) {
      return 'Repeats the preceding element exactly ${parts[0]} times.';
    }
    if (parts[1].trim().isEmpty) {
      return 'Repeats the preceding element ${parts[0]} or more times$greed.';
    }
    return 'Repeats the preceding element between ${parts[0]} and ${parts[1]} times, inclusive$greed.';
  }

  static String _describeCharacterClass(String body) {
    final negated = body.startsWith('^');
    final content = negated ? body.substring(1) : body;
    final parts = <String>[];

    var i = 0;
    while (i < content.length) {
      if (content[i] == r'\' && i + 1 < content.length) {
        final esc = _escapeToken(content, i);
        parts.add(esc.$2);
        i += esc.$1;
        continue;
      }
      if (i + 2 < content.length && content[i + 1] == '-' && content[i + 2] != ']') {
        parts.add('${content[i]}-${content[i + 2]}');
        i += 3;
        continue;
      }
      parts.add(content[i]);
      i++;
    }

    final listed = parts.isEmpty ? '(empty)' : parts.join(', ');
    return negated
        ? 'Character class: matches any one character NOT in this set — $listed.'
        : 'Character class: matches any one character from this set — $listed.';
  }

  /// End index of a `{n}` / `{n,}` / `{n,m}` quantifier that starts at [open],
  /// or -1 when the brace is not a quantifier (and so is a literal).
  static int _braceQuantifierEnd(String pattern, int open) {
    final close = pattern.indexOf('}', open + 1);
    if (close < 0) return -1;
    final body = pattern.substring(open + 1, close);
    if (body.isEmpty) return -1;
    if (!RegExp(r'^\d+(,\d*)?$').hasMatch(body)) return -1;
    return close;
  }

  /// Returns (tokenText, kind, extra) for the group opener starting at [i],
  /// where `extra` is the group name for named groups and the description for
  /// non-capturing/lookaround kinds.
  static (String, _GroupKind, String) _groupOpener(String pattern, int i) {
    final rest = pattern.substring(i);
    if (rest.startsWith('(?:')) {
      return ('(?:', _GroupKind.other, 'Start of a non-capturing group — groups the sub-pattern without capturing it.');
    }
    if (rest.startsWith('(?=')) {
      return (
        '(?=',
        _GroupKind.other,
        'Positive lookahead: the following sub-pattern must match here, but it is not consumed.',
      );
    }
    if (rest.startsWith('(?!')) {
      return (
        '(?!',
        _GroupKind.other,
        'Negative lookahead: the following sub-pattern must NOT match here; nothing is consumed.',
      );
    }
    if (rest.startsWith('(?<=')) {
      return (
        '(?<=',
        _GroupKind.other,
        'Positive lookbehind: the text immediately before this position must match the sub-pattern.',
      );
    }
    if (rest.startsWith('(?<!')) {
      return (
        '(?<!',
        _GroupKind.other,
        'Negative lookbehind: the text immediately before this position must NOT match the sub-pattern.',
      );
    }
    if (rest.startsWith('(?<')) {
      final close = rest.indexOf('>');
      if (close > 0) {
        return (rest.substring(0, close + 1), _GroupKind.named, rest.substring(3, close));
      }
    }
    return ('(', _GroupKind.capturing, '');
  }
}

enum _GroupKind { capturing, named, other }
