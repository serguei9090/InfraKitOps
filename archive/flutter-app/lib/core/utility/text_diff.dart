import 'dart:convert';
import 'dart:typed_data';

import '../ports/i_tool_use_case.dart';

enum DiffLineKind { unchanged, added, removed }

/// Compare the two sides as raw text, or canonicalise both as JSON first.
enum DiffMode {
  /// Plain line-based text diff.
  text,

  /// Parse both sides as JSON, re-serialise with sorted keys and a stable
  /// two-space indent, then diff. Reordered keys and reformatted whitespace
  /// therefore show as no difference.
  json,
}

class DiffLine {
  const DiffLine({
    required this.kind,
    required this.text,
    this.leftLineNumber,
    this.rightLineNumber,
  });

  final DiffLineKind kind;

  /// The line's text, exactly as it appeared on its own side (whitespace and
  /// case are normalised for *comparison* only, never for display).
  final String text;

  /// 1-based line number on the left/original side; null for added lines.
  final int? leftLineNumber;

  /// 1-based line number on the right/modified side; null for removed lines.
  final int? rightLineNumber;

  /// `' '`, `'+'` or `'-'` — the unified-diff style marker for this line.
  String get marker => switch (kind) {
    DiffLineKind.unchanged => ' ',
    DiffLineKind.added => '+',
    DiffLineKind.removed => '-',
  };
}

/// A contiguous run of changed lines plus surrounding context, the way a
/// unified diff groups them.
class DiffHunk {
  const DiffHunk({
    required this.leftStart,
    required this.leftLength,
    required this.rightStart,
    required this.rightLength,
    required this.lines,
  });

  final int leftStart;
  final int leftLength;
  final int rightStart;
  final int rightLength;
  final List<DiffLine> lines;

  /// `@@ -1,4 +1,5 @@`
  String get header => '@@ -$leftStart,$leftLength +$rightStart,$rightLength @@';
}

class DiffSummary {
  const DiffSummary({required this.added, required this.removed, required this.changed, required this.unchanged});

  /// Lines present only on the right, with no removed line paired against them.
  final int added;

  /// Lines present only on the left, with no added line paired against them.
  final int removed;

  /// Removed/added pairs inside the same change block, counted once — the
  /// "modified line" count a reader intuitively expects.
  final int changed;

  final int unchanged;

  bool get hasDifferences => added > 0 || removed > 0 || changed > 0;
}

class TextDiffInput {
  const TextDiffInput({
    required this.left,
    required this.right,
    this.mode = DiffMode.text,
    this.ignoreWhitespace = false,
    this.ignoreCase = false,
    this.contextLines = 3,
  });

  final String left;
  final String right;
  final DiffMode mode;

  /// Ignore leading and trailing whitespace when deciding whether two lines
  /// are equal. Display text is untouched.
  final bool ignoreWhitespace;

  /// Compare lines case-insensitively. Display text is untouched.
  final bool ignoreCase;

  /// Unchanged lines kept around each change block when building hunks.
  final int contextLines;
}

class TextDiffResult {
  const TextDiffResult({
    required this.isValid,
    this.errorMessage,
    this.lines = const [],
    this.hunks = const [],
    this.summary = const DiffSummary(added: 0, removed: 0, changed: 0, unchanged: 0),
    this.warnings = const [],
    this.truncated = false,
  });

  final bool isValid;
  final String? errorMessage;

  /// The full diff, every line tagged, in output order.
  final List<DiffLine> lines;

  /// The same lines grouped into unified-diff hunks. Empty when the two sides
  /// are identical.
  final List<DiffHunk> hunks;

  final DiffSummary summary;

  /// Non-fatal advisories, e.g. an input that hit the size cap.
  final List<String> warnings;

  /// True when either side was cut down to fit the size caps.
  final bool truncated;

  bool get isIdentical => isValid && !summary.hasDifferences;
}

/// Line-based diff built on a real longest-common-subsequence (LCS) dynamic
/// program, so inserting one line shifts nothing else — a naive positional
/// line-by-line comparison reports every following line as changed, which is
/// exactly the failure this implementation exists to avoid.
///
/// ## Algorithm
///
/// 1. Split both sides into lines and derive a *comparison key* per line
///    (optionally trimmed and/or lower-cased). The key drives equality; the
///    original text is what gets displayed.
/// 2. Strip the common prefix and common suffix. These are trivially
///    unchanged and removing them keeps the quadratic step small in the
///    common "one edit in a big file" case.
/// 3. Run the classic O(n·m) LCS DP over the remaining middle, then backtrack
///    to emit removed / added / unchanged lines in order.
///
/// ## Size caps
///
/// The DP table is O(n·m) in both time and memory, so unbounded input hangs
/// the UI thread. Stripping the common prefix/suffix helps but cannot be
/// relied on (two entirely different files share neither), so hard caps are
/// applied to the raw input up front: each side is limited to [maxLines]
/// (2,000 lines) and [maxCharacters] (400,000 characters). Anything longer is
/// truncated, [TextDiffResult.truncated] is set, and a warning explains what
/// was dropped. A worst-case 2,000 x 2,000 table is 4M cells stored in a
/// [Uint16List] (~8 MB) — the largest allocation that still computes
/// instantly, and safe because an LCS length can never exceed 2,000.
class TextDiff implements IToolUseCase<TextDiffInput, TextDiffResult> {
  const TextDiff();

  /// Maximum lines compared per side; extra lines are dropped with a warning.
  static const int maxLines = 2000;

  /// Maximum characters accepted per side before truncation.
  static const int maxCharacters = 400000;

  @override
  TextDiffResult execute(TextDiffInput input) {
    var left = input.left;
    var right = input.right;

    if (input.mode == DiffMode.json) {
      final canonicalLeft = _canonicalJson(left, 'Left');
      if (canonicalLeft.$2 != null) {
        return TextDiffResult(isValid: false, errorMessage: canonicalLeft.$2);
      }
      final canonicalRight = _canonicalJson(right, 'Right');
      if (canonicalRight.$2 != null) {
        return TextDiffResult(isValid: false, errorMessage: canonicalRight.$2);
      }
      left = canonicalLeft.$1!;
      right = canonicalRight.$1!;
    }

    final warnings = <String>[];
    var truncated = false;

    if (left.length > maxCharacters) {
      left = left.substring(0, maxCharacters);
      truncated = true;
      warnings.add('Left side truncated to $maxCharacters characters.');
    }
    if (right.length > maxCharacters) {
      right = right.substring(0, maxCharacters);
      truncated = true;
      warnings.add('Right side truncated to $maxCharacters characters.');
    }

    var leftLines = _splitLines(left);
    var rightLines = _splitLines(right);

    if (leftLines.length > maxLines) {
      warnings.add('Left side truncated to $maxLines lines (was ${leftLines.length}).');
      leftLines = leftLines.sublist(0, maxLines);
      truncated = true;
    }
    if (rightLines.length > maxLines) {
      warnings.add('Right side truncated to $maxLines lines (was ${rightLines.length}).');
      rightLines = rightLines.sublist(0, maxLines);
      truncated = true;
    }

    final lines = _diffLines(
      leftLines,
      rightLines,
      ignoreWhitespace: input.ignoreWhitespace,
      ignoreCase: input.ignoreCase,
    );

    return TextDiffResult(
      isValid: true,
      lines: lines,
      hunks: _buildHunks(lines, input.contextLines),
      summary: _summarise(lines),
      warnings: warnings,
      truncated: truncated,
    );
  }

  // -------------------------------------------------------------------------
  // JSON canonicalisation
  // -------------------------------------------------------------------------

  /// Returns (canonicalText, errorMessage) — exactly one is non-null.
  static (String?, String?) _canonicalJson(String source, String sideLabel) {
    if (source.trim().isEmpty) {
      return (null, '$sideLabel side is empty — JSON mode needs a JSON document on both sides.');
    }
    dynamic decoded;
    try {
      decoded = jsonDecode(source);
    } on FormatException catch (e) {
      return (null, '$sideLabel side is not valid JSON: ${e.message}');
    } catch (e) {
      return (null, '$sideLabel side is not valid JSON: $e');
    }
    try {
      return (const JsonEncoder.withIndent('  ').convert(_sortKeys(decoded)), null);
    } catch (e) {
      return (null, '$sideLabel side could not be re-serialised: $e');
    }
  }

  /// Recursively rebuild maps with their keys in sorted order. List order is
  /// significant in JSON and is preserved.
  static dynamic _sortKeys(dynamic value) {
    if (value is Map) {
      final keys = value.keys.map((k) => k.toString()).toList()..sort();
      return {for (final key in keys) key: _sortKeys(value[key])};
    }
    if (value is List) return value.map(_sortKeys).toList();
    return value;
  }

  // -------------------------------------------------------------------------
  // LCS diff
  // -------------------------------------------------------------------------

  static List<String> _splitLines(String text) {
    if (text.isEmpty) return const [];
    final normalised = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    final lines = normalised.split('\n');
    // A trailing newline produces an empty final element; drop it so "a\n" and
    // "a" diff as identical content rather than differing by a blank line.
    if (lines.isNotEmpty && lines.last.isEmpty) lines.removeLast();
    return lines;
  }

  static String _key(String line, {required bool ignoreWhitespace, required bool ignoreCase}) {
    var key = line;
    if (ignoreWhitespace) key = key.trim();
    if (ignoreCase) key = key.toLowerCase();
    return key;
  }

  static List<DiffLine> _diffLines(
    List<String> left,
    List<String> right, {
    required bool ignoreWhitespace,
    required bool ignoreCase,
  }) {
    final leftKeys = [for (final l in left) _key(l, ignoreWhitespace: ignoreWhitespace, ignoreCase: ignoreCase)];
    final rightKeys = [for (final r in right) _key(r, ignoreWhitespace: ignoreWhitespace, ignoreCase: ignoreCase)];

    final out = <DiffLine>[];

    // 1. Common prefix.
    var prefix = 0;
    while (prefix < leftKeys.length && prefix < rightKeys.length && leftKeys[prefix] == rightKeys[prefix]) {
      out.add(
        DiffLine(
          kind: DiffLineKind.unchanged,
          text: left[prefix],
          leftLineNumber: prefix + 1,
          rightLineNumber: prefix + 1,
        ),
      );
      prefix++;
    }

    // 2. Common suffix (never overlapping the prefix).
    var suffix = 0;
    while (suffix < leftKeys.length - prefix &&
        suffix < rightKeys.length - prefix &&
        leftKeys[leftKeys.length - 1 - suffix] == rightKeys[rightKeys.length - 1 - suffix]) {
      suffix++;
    }

    final leftMid = leftKeys.sublist(prefix, leftKeys.length - suffix);
    final rightMid = rightKeys.sublist(prefix, rightKeys.length - suffix);

    // 3. LCS dynamic program over the middle.
    //    table[i][j] = length of the LCS of leftMid[i..] and rightMid[j..].
    final n = leftMid.length;
    final m = rightMid.length;
    final stride = m + 1;
    // Flat (n+1) x (m+1) table of 16-bit cells; an LCS length is bounded by
    // maxLines (2,000) so it always fits.
    final table = Uint16List((n + 1) * stride);
    for (var i = n - 1; i >= 0; i--) {
      final row = i * stride;
      final next = (i + 1) * stride;
      final leftValue = leftMid[i];
      for (var j = m - 1; j >= 0; j--) {
        table[row + j] = leftValue == rightMid[j]
            ? table[next + j + 1] + 1
            : (table[next + j] >= table[row + j + 1] ? table[next + j] : table[row + j + 1]);
      }
    }

    // 4. Backtrack, emitting lines in order.
    var i = 0;
    var j = 0;
    while (i < n && j < m) {
      if (leftMid[i] == rightMid[j]) {
        out.add(
          DiffLine(
            kind: DiffLineKind.unchanged,
            text: left[prefix + i],
            leftLineNumber: prefix + i + 1,
            rightLineNumber: prefix + j + 1,
          ),
        );
        i++;
        j++;
      } else if (table[(i + 1) * stride + j] >= table[i * stride + j + 1]) {
        out.add(
          DiffLine(kind: DiffLineKind.removed, text: left[prefix + i], leftLineNumber: prefix + i + 1),
        );
        i++;
      } else {
        out.add(
          DiffLine(kind: DiffLineKind.added, text: right[prefix + j], rightLineNumber: prefix + j + 1),
        );
        j++;
      }
    }
    while (i < n) {
      out.add(DiffLine(kind: DiffLineKind.removed, text: left[prefix + i], leftLineNumber: prefix + i + 1));
      i++;
    }
    while (j < m) {
      out.add(DiffLine(kind: DiffLineKind.added, text: right[prefix + j], rightLineNumber: prefix + j + 1));
      j++;
    }

    // 5. Common suffix.
    for (var k = 0; k < suffix; k++) {
      final leftIndex = leftKeys.length - suffix + k;
      final rightIndex = rightKeys.length - suffix + k;
      out.add(
        DiffLine(
          kind: DiffLineKind.unchanged,
          text: left[leftIndex],
          leftLineNumber: leftIndex + 1,
          rightLineNumber: rightIndex + 1,
        ),
      );
    }

    return out;
  }

  // -------------------------------------------------------------------------
  // Summary & hunks
  // -------------------------------------------------------------------------

  /// Within each contiguous run of non-unchanged lines, `min(removed, added)`
  /// lines are reported as *changed* and only the excess as pure added/removed.
  static DiffSummary _summarise(List<DiffLine> lines) {
    var added = 0;
    var removed = 0;
    var changed = 0;
    var unchanged = 0;

    var blockAdded = 0;
    var blockRemoved = 0;

    void closeBlock() {
      final paired = blockAdded < blockRemoved ? blockAdded : blockRemoved;
      changed += paired;
      added += blockAdded - paired;
      removed += blockRemoved - paired;
      blockAdded = 0;
      blockRemoved = 0;
    }

    for (final line in lines) {
      switch (line.kind) {
        case DiffLineKind.unchanged:
          closeBlock();
          unchanged++;
        case DiffLineKind.added:
          blockAdded++;
        case DiffLineKind.removed:
          blockRemoved++;
      }
    }
    closeBlock();

    return DiffSummary(added: added, removed: removed, changed: changed, unchanged: unchanged);
  }

  static List<DiffHunk> _buildHunks(List<DiffLine> lines, int contextLines) {
    final changedIndexes = <int>[];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].kind != DiffLineKind.unchanged) changedIndexes.add(i);
    }
    if (changedIndexes.isEmpty) return const [];

    final context = contextLines < 0 ? 0 : contextLines;
    final ranges = <List<int>>[];
    for (final index in changedIndexes) {
      final start = (index - context) < 0 ? 0 : index - context;
      final end = (index + context) >= lines.length ? lines.length - 1 : index + context;
      if (ranges.isNotEmpty && start <= ranges.last[1] + 1) {
        if (end > ranges.last[1]) ranges.last[1] = end;
      } else {
        ranges.add([start, end]);
      }
    }

    return [
      for (final range in ranges) _hunkFor(lines.sublist(range[0], range[1] + 1)),
    ];
  }

  static DiffHunk _hunkFor(List<DiffLine> slice) {
    int? leftStart;
    int? rightStart;
    var leftLength = 0;
    var rightLength = 0;

    for (final line in slice) {
      if (line.leftLineNumber != null) {
        leftStart ??= line.leftLineNumber;
        leftLength++;
      }
      if (line.rightLineNumber != null) {
        rightStart ??= line.rightLineNumber;
        rightLength++;
      }
    }

    return DiffHunk(
      leftStart: leftStart ?? 0,
      leftLength: leftLength,
      rightStart: rightStart ?? 0,
      rightLength: rightLength,
      lines: slice,
    );
  }
}
