import 'dart:convert';

import '../ports/i_tool_use_case.dart';

/// One value the expression selected, together with the normalised path that
/// identifies where it lives in the document.
class JsonPathMatch {
  const JsonPathMatch({required this.path, required this.value});

  /// Bracket-notation path, e.g. `$['store']['book'][0]['title']`.
  final String path;

  /// The selected value — a Map, List, String, num, bool, or null.
  final dynamic value;

  /// The value rendered as pretty JSON, for display.
  String get prettyValue {
    try {
      return const JsonEncoder.withIndent('  ').convert(value);
    } catch (_) {
      return '$value';
    }
  }

  /// A short one-line rendering, for list rows.
  String get compactValue {
    try {
      return jsonEncode(value);
    } catch (_) {
      return '$value';
    }
  }
}

class JsonPathEvaluatorInput {
  const JsonPathEvaluatorInput({required this.document, required this.expression});

  /// The JSON document, as text. Parsed here so malformed JSON produces a
  /// clean error result rather than an exception at the call site.
  final String document;

  /// The JSONPath expression, e.g. `$.store.book[?(@.price < 10)].title`.
  final String expression;
}

class JsonPathResult {
  const JsonPathResult({required this.isValid, this.errorMessage, this.matches = const []});

  final bool isValid;
  final String? errorMessage;
  final List<JsonPathMatch> matches;

  int get matchCount => matches.length;

  /// All matched values as a pretty-printed JSON array — the natural "result"
  /// blob for a copy button.
  String get prettyValues {
    try {
      return const JsonEncoder.withIndent('  ').convert([for (final m in matches) m.value]);
    } catch (_) {
      return '[]';
    }
  }
}

/// A hand-written evaluator for the commonly-used subset of JSONPath.
///
/// ## Supported
///
/// | Syntax | Meaning |
/// |---|---|
/// | `$` | the root node (an expression must start here) |
/// | `.name` | child by name |
/// | `['name']`, `["name"]` | child by name (quoted, so keys with dots/spaces work) |
/// | `.*`, `[*]` | wildcard — every child of an object or array |
/// | `[0]` | array index |
/// | `[-1]` | negative index, counting back from the end |
/// | `[start:end]`, `[start:end:step]` | array slice; any part may be omitted, negatives count from the end, a negative step walks backwards |
/// | `..name` | recursive descent — every `name` child at any depth |
/// | `..*` | every descendant value |
/// | `..[0]` | a bracket selector applied to every descendant |
/// | `[?(@.x == 'a')]` | filter by comparison against a literal, using `==`, `!=`, `<`, `<=`, `>`, `>=` |
/// | `[?(@.x)]` | filter by existence of a (non-null) member |
///
/// Filter left-hand sides may be `@`, `@.a`, `@.a.b`, or `@['a']['b']`.
/// Literals may be numbers, single- or double-quoted strings, `true`, `false`,
/// and `null`. `<`, `<=`, `>`, `>=` compare numbers numerically and strings
/// lexicographically; a mismatched pair simply does not match.
///
/// ## Deliberately NOT supported
///
/// These raise a clear error instead of silently returning wrong results:
///
/// * boolean combinators in filters — `&&`, `||`, `!`;
/// * regex match filters — `[?(@.name =~ /pattern/)]`;
/// * nested/sub-path filters and function extensions — `[?(@.a[0].b > 1)]` is
///   fine (plain member chains work), but `length()`, `count()`, `match()`,
///   `search()`, and script expressions `[(...)]` are not;
/// * union selectors — `['a','b']` and `[0,1]`;
/// * parent/sibling navigation, since JSONPath has no such operator;
/// * `$` appearing anywhere other than the start of the expression.
///
/// ## Result ordering
///
/// Matches come back in document order (pre-order traversal), which is what
/// recursive descent and wildcards are usually read as producing.
class JsonPathEvaluator implements IToolUseCase<JsonPathEvaluatorInput, JsonPathResult> {
  const JsonPathEvaluator();

  @override
  JsonPathResult execute(JsonPathEvaluatorInput input) {
    if (input.document.trim().isEmpty) {
      return const JsonPathResult(isValid: false, errorMessage: 'Paste a JSON document to query.');
    }

    dynamic document;
    try {
      document = jsonDecode(input.document);
    } on FormatException catch (e) {
      return JsonPathResult(isValid: false, errorMessage: 'Invalid JSON document: ${e.message}');
    } catch (e) {
      return JsonPathResult(isValid: false, errorMessage: 'Invalid JSON document: $e');
    }

    if (input.expression.trim().isEmpty) {
      return const JsonPathResult(isValid: false, errorMessage: 'Enter a JSONPath expression, e.g. \$.store.book[*].title');
    }

    final List<_Segment> segments;
    try {
      segments = _parse(input.expression.trim());
    } on _JsonPathError catch (e) {
      return JsonPathResult(isValid: false, errorMessage: e.message);
    } catch (e) {
      return JsonPathResult(isValid: false, errorMessage: 'Could not parse expression: $e');
    }

    try {
      var nodes = <JsonPathMatch>[JsonPathMatch(path: r'$', value: document)];
      for (final segment in segments) {
        final next = <JsonPathMatch>[];
        for (final node in nodes) {
          segment.apply(node, next);
        }
        nodes = next;
      }
      return JsonPathResult(isValid: true, matches: nodes);
    } on _JsonPathError catch (e) {
      return JsonPathResult(isValid: false, errorMessage: e.message);
    } catch (e) {
      return JsonPathResult(isValid: false, errorMessage: 'Evaluation failed: $e');
    }
  }

  // -------------------------------------------------------------------------
  // Parser
  // -------------------------------------------------------------------------

  static List<_Segment> _parse(String expression) {
    var expr = expression;
    if (!expr.startsWith(r'$')) {
      if (expr.startsWith('.') || expr.startsWith('[')) {
        expr = '\$$expr';
      } else {
        throw const _JsonPathError('A JSONPath expression must start with "\$" (the document root).');
      }
    }

    final segments = <_Segment>[];
    var i = 1;

    while (i < expr.length) {
      final c = expr[i];

      if (c == r'$') {
        throw const _JsonPathError('"\$" is only valid at the very start of an expression.');
      }

      if (c == '.') {
        if (i + 1 < expr.length && expr[i + 1] == '.') {
          // Recursive descent: "self and all descendants", then whatever
          // selector follows applies to each of those nodes.
          segments.add(const _RecursiveSegment());
          i += 2;
          if (i >= expr.length) {
            throw const _JsonPathError('".." must be followed by a name, "*", or a bracket selector.');
          }
          if (expr[i] == '[') continue; // e.g. "$..[0]"
          if (expr[i] == '*') {
            segments.add(const _WildcardSegment());
            i++;
            continue;
          }
          final name = _readName(expr, i);
          if (name.isEmpty) {
            throw const _JsonPathError('".." must be followed by a name, "*", or a bracket selector.');
          }
          segments.add(_ChildSegment(name));
          i += name.length;
          continue;
        }

        i++;
        if (i >= expr.length) {
          throw const _JsonPathError('Expression ends with "." — expected a child name or "*" after it.');
        }
        if (expr[i] == '*') {
          segments.add(const _WildcardSegment());
          i++;
          continue;
        }
        final name = _readName(expr, i);
        if (name.isEmpty) {
          throw _JsonPathError('Expected a child name after "." at position $i.');
        }
        segments.add(_ChildSegment(name));
        i += name.length;
        continue;
      }

      if (c == '[') {
        final close = _matchingBracket(expr, i);
        if (close < 0) {
          throw _JsonPathError('Unclosed "[" at position $i.');
        }
        segments.add(_parseBracket(expr.substring(i + 1, close).trim()));
        i = close + 1;
        continue;
      }

      throw _JsonPathError('Unexpected character "$c" at position $i — expected "." or "[".');
    }

    if (segments.isNotEmpty && segments.last is _RecursiveSegment) {
      throw const _JsonPathError('".." must be followed by a name, "*", or a bracket selector.');
    }

    return segments;
  }

  static String _readName(String expr, int start) {
    var end = start;
    while (end < expr.length && !'.[]()*?@,:\'"'.contains(expr[end])) {
      end++;
    }
    return expr.substring(start, end);
  }

  static int _matchingBracket(String expr, int open) {
    var depth = 0;
    String? quote;
    for (var i = open; i < expr.length; i++) {
      final c = expr[i];
      if (quote != null) {
        if (c == r'\') {
          i++;
        } else if (c == quote) {
          quote = null;
        }
        continue;
      }
      if (c == "'" || c == '"') {
        quote = c;
        continue;
      }
      if (c == '[') depth++;
      if (c == ']') {
        depth--;
        if (depth == 0) return i;
      }
    }
    return -1;
  }

  static _Segment _parseBracket(String body) {
    if (body.isEmpty) throw const _JsonPathError('Empty "[]" selector.');

    if (body == '*') return const _WildcardSegment();

    if (body.startsWith('?')) return _parseFilter(body);

    if (body.startsWith('(')) {
      throw const _JsonPathError('Script expressions "[(...)]" are not supported.');
    }

    if ((body.startsWith("'") && body.endsWith("'") && body.length >= 2) ||
        (body.startsWith('"') && body.endsWith('"') && body.length >= 2)) {
      final inner = body.substring(1, body.length - 1);
      if (inner.contains(body[0])) {
        throw const _JsonPathError('Union selectors like "[\'a\',\'b\']" are not supported.');
      }
      return _ChildSegment(inner.replaceAll(r'\\', r'\'));
    }

    if (body.contains(',')) {
      throw const _JsonPathError('Union selectors like "[0,1]" or "[\'a\',\'b\']" are not supported.');
    }

    if (body.contains(':')) return _parseSlice(body);

    final index = int.tryParse(body);
    if (index != null) return _IndexSegment(index);

    throw _JsonPathError('Unsupported bracket selector "[$body]".');
  }

  static _Segment _parseSlice(String body) {
    final parts = body.split(':');
    if (parts.length > 3) {
      throw _JsonPathError('Slice "[$body]" has too many ":" separators.');
    }

    int? part(int index) {
      if (index >= parts.length) return null;
      final text = parts[index].trim();
      if (text.isEmpty) return null;
      final value = int.tryParse(text);
      if (value == null) {
        throw _JsonPathError('Slice bound "$text" in "[$body]" is not an integer.');
      }
      return value;
    }

    final step = part(2) ?? 1;
    if (step == 0) throw const _JsonPathError('Slice step cannot be 0.');
    return _SliceSegment(start: part(0), end: part(1), step: step);
  }

  static _Segment _parseFilter(String body) {
    // body looks like "?(...)" or, tolerantly, "?...".
    var inner = body.substring(1).trim();
    if (inner.startsWith('(') && inner.endsWith(')')) {
      inner = inner.substring(1, inner.length - 1).trim();
    }
    if (inner.isEmpty) throw const _JsonPathError('Empty filter expression "[?()]".');

    if (inner.contains('&&') || inner.contains('||')) {
      throw const _JsonPathError(
        'Filters combining conditions with "&&" or "||" are not supported — '
        'only a single comparison or existence test.',
      );
    }
    if (inner.contains('=~')) {
      throw const _JsonPathError('Regex match filters "=~" are not supported.');
    }
    if (inner.startsWith('!')) {
      throw const _JsonPathError('Negated filters "[?(!@.x)]" are not supported.');
    }
    if (RegExp(r'\w+\s*\(').hasMatch(inner)) {
      throw const _JsonPathError('Filter functions such as length() or match() are not supported.');
    }

    for (final op in const ['==', '!=', '<=', '>=', '<', '>']) {
      final at = inner.indexOf(op);
      if (at < 0) continue;
      // Skip "<"/">" that are really part of "<=" / ">=", already handled.
      if ((op == '<' || op == '>') && at + 1 < inner.length && inner[at + 1] == '=') continue;
      final lhs = inner.substring(0, at).trim();
      final rhs = inner.substring(at + op.length).trim();
      if (lhs.isEmpty || rhs.isEmpty) {
        throw _JsonPathError('Filter "$inner" is missing an operand around "$op".');
      }
      return _FilterSegment(path: _parseFilterPath(lhs), op: op, literal: _parseLiteral(rhs));
    }

    if (inner.contains('=')) {
      throw const _JsonPathError('Use "==" for equality in a filter, not "=".');
    }

    // Existence test.
    return _FilterSegment(path: _parseFilterPath(inner), op: null, literal: null);
  }

  /// `@`, `@.a.b`, `@['a']['b']` -> the member chain to follow from each
  /// candidate node. An empty list means the node itself.
  static List<String> _parseFilterPath(String text) {
    var expr = text.trim();
    if (!expr.startsWith('@')) {
      throw _JsonPathError('Filter operand "$text" must start with "@" (the current node).');
    }
    expr = expr.substring(1);

    final parts = <String>[];
    var i = 0;
    while (i < expr.length) {
      if (expr[i] == '.') {
        i++;
        final name = _readName(expr, i);
        if (name.isEmpty) throw _JsonPathError('Filter operand "$text" has an empty member name.');
        parts.add(name);
        i += name.length;
        continue;
      }
      if (expr[i] == '[') {
        final close = _matchingBracket(expr, i);
        if (close < 0) throw _JsonPathError('Filter operand "$text" has an unclosed "[".');
        var inner = expr.substring(i + 1, close).trim();
        if ((inner.startsWith("'") && inner.endsWith("'")) || (inner.startsWith('"') && inner.endsWith('"'))) {
          inner = inner.substring(1, inner.length - 1);
        }
        if (inner.isEmpty) throw _JsonPathError('Filter operand "$text" has an empty "[]".');
        parts.add(inner);
        i = close + 1;
        continue;
      }
      throw _JsonPathError('Unsupported filter operand "$text".');
    }
    return parts;
  }

  static Object? _parseLiteral(String text) {
    final trimmed = text.trim();
    if (trimmed.startsWith('@')) {
      throw const _JsonPathError('Filters comparing two "@" paths are not supported — compare against a literal.');
    }
    if (trimmed == 'true') return true;
    if (trimmed == 'false') return false;
    if (trimmed == 'null') return null;
    if ((trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2)) {
      return trimmed.substring(1, trimmed.length - 1);
    }
    final number = num.tryParse(trimmed);
    if (number != null) return number;
    throw _JsonPathError('Filter literal "$trimmed" is not a number, quoted string, true, false, or null.');
  }
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

abstract class _Segment {
  const _Segment();

  /// Append every node this segment selects from [node] onto [out].
  void apply(JsonPathMatch node, List<JsonPathMatch> out);
}

class _ChildSegment extends _Segment {
  const _ChildSegment(this.name);

  final String name;

  @override
  void apply(JsonPathMatch node, List<JsonPathMatch> out) {
    final value = node.value;
    if (value is Map && value.containsKey(name)) {
      out.add(JsonPathMatch(path: "${node.path}['$name']", value: value[name]));
    }
  }
}

class _WildcardSegment extends _Segment {
  const _WildcardSegment();

  @override
  void apply(JsonPathMatch node, List<JsonPathMatch> out) {
    final value = node.value;
    if (value is Map) {
      for (final key in value.keys) {
        out.add(JsonPathMatch(path: "${node.path}['$key']", value: value[key]));
      }
    } else if (value is List) {
      for (var i = 0; i < value.length; i++) {
        out.add(JsonPathMatch(path: '${node.path}[$i]', value: value[i]));
      }
    }
  }
}

class _IndexSegment extends _Segment {
  const _IndexSegment(this.index);

  final int index;

  @override
  void apply(JsonPathMatch node, List<JsonPathMatch> out) {
    final value = node.value;
    if (value is! List) return;
    final resolved = index < 0 ? value.length + index : index;
    if (resolved < 0 || resolved >= value.length) return;
    out.add(JsonPathMatch(path: '${node.path}[$resolved]', value: value[resolved]));
  }
}

class _SliceSegment extends _Segment {
  const _SliceSegment({required this.start, required this.end, required this.step});

  final int? start;
  final int? end;
  final int step;

  @override
  void apply(JsonPathMatch node, List<JsonPathMatch> out) {
    final value = node.value;
    if (value is! List) return;
    final length = value.length;
    if (length == 0) return;

    int normalise(int raw) {
      final resolved = raw < 0 ? length + raw : raw;
      return resolved < 0 ? 0 : (resolved > length ? length : resolved);
    }

    if (step > 0) {
      final from = start == null ? 0 : normalise(start!);
      final to = end == null ? length : normalise(end!);
      for (var i = from; i < to; i += step) {
        out.add(JsonPathMatch(path: '${node.path}[$i]', value: value[i]));
      }
    } else {
      // Negative step walks backwards; bounds clamp to length-1 / -1.
      var from = start == null ? length - 1 : (start! < 0 ? length + start! : start!);
      var to = end == null ? -1 : (end! < 0 ? length + end! : end!);
      if (from > length - 1) from = length - 1;
      if (to < -1) to = -1;
      for (var i = from; i > to; i += step) {
        if (i < 0 || i >= length) break;
        out.add(JsonPathMatch(path: '${node.path}[$i]', value: value[i]));
      }
    }
  }
}

/// "Self and every descendant", in pre-order. The selector that follows in the
/// expression is applied to each of these nodes, which is how `$..name` and
/// `$..[0]` both fall out of one segment type.
class _RecursiveSegment extends _Segment {
  const _RecursiveSegment();

  @override
  void apply(JsonPathMatch node, List<JsonPathMatch> out) {
    out.add(node);
    _descend(node, out);
  }

  static void _descend(JsonPathMatch node, List<JsonPathMatch> out) {
    final value = node.value;
    if (value is Map) {
      for (final key in value.keys) {
        final child = JsonPathMatch(path: "${node.path}['$key']", value: value[key]);
        out.add(child);
        _descend(child, out);
      }
    } else if (value is List) {
      for (var i = 0; i < value.length; i++) {
        final child = JsonPathMatch(path: '${node.path}[$i]', value: value[i]);
        out.add(child);
        _descend(child, out);
      }
    }
  }
}

class _FilterSegment extends _Segment {
  const _FilterSegment({required this.path, required this.op, required this.literal});

  /// Member chain to follow from each candidate; empty means the node itself.
  final List<String> path;

  /// Comparison operator, or null for an existence test.
  final String? op;

  final Object? literal;

  @override
  void apply(JsonPathMatch node, List<JsonPathMatch> out) {
    final value = node.value;
    if (value is List) {
      for (var i = 0; i < value.length; i++) {
        final candidate = JsonPathMatch(path: '${node.path}[$i]', value: value[i]);
        if (_test(candidate.value)) out.add(candidate);
      }
    } else if (value is Map) {
      // Applying a filter to an object's members is a widely-implemented
      // extension; without it "$..[?(@.x)]" would silently miss object nodes.
      for (final key in value.keys) {
        final candidate = JsonPathMatch(path: "${node.path}['$key']", value: value[key]);
        if (_test(candidate.value)) out.add(candidate);
      }
    }
  }

  bool _test(dynamic candidate) {
    dynamic current = candidate;
    var exists = true;
    for (final part in path) {
      if (current is Map && current.containsKey(part)) {
        current = current[part];
        continue;
      }
      if (current is List) {
        final index = int.tryParse(part);
        if (index != null) {
          final resolved = index < 0 ? current.length + index : index;
          if (resolved >= 0 && resolved < current.length) {
            current = current[resolved];
            continue;
          }
        }
      }
      exists = false;
      break;
    }

    if (op == null) return exists && current != null;
    // A member that does not exist is "Nothing": it equals no literal, so an
    // "!=" test against it holds and every other comparison fails.
    if (!exists) return op == '!=';
    return _compare(current, literal, op!);
  }

  static bool _compare(dynamic left, Object? right, String op) {
    switch (op) {
      case '==':
        return _equal(left, right);
      case '!=':
        return !_equal(left, right);
    }

    int? ordering;
    if (left is num && right is num) {
      ordering = left.compareTo(right);
    } else if (left is String && right is String) {
      ordering = left.compareTo(right);
    }
    if (ordering == null) return false; // Incomparable types never match.

    return switch (op) {
      '<' => ordering < 0,
      '<=' => ordering <= 0,
      '>' => ordering > 0,
      '>=' => ordering >= 0,
      _ => false,
    };
  }

  static bool _equal(dynamic left, Object? right) {
    if (left is num && right is num) return left == right;
    return left == right;
  }
}

class _JsonPathError implements Exception {
  const _JsonPathError(this.message);

  final String message;

  @override
  String toString() => message;
}
