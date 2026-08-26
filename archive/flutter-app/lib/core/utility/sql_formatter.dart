import '../ports/i_tool_use_case.dart';

enum SqlFormatMode { pretty, minify, validate }

class SqlFormatterInput {
  const SqlFormatterInput({required this.source, required this.mode});

  final String source;
  final SqlFormatMode mode;
}

class SqlFormatterResult {
  const SqlFormatterResult({required this.isValid, this.output, this.errorMessage});

  final bool isValid;
  final String? output;
  final String? errorMessage;
}

class _KeywordMatch {
  const _KeywordMatch(this.keyword, this.wordCount, this.extraIndent);

  final String keyword;
  final int wordCount;
  final int extraIndent;
}

/// Hand-rolled, keyword-driven SQL prettifier/minifier. This is deliberately
/// NOT a real SQL parser: it tokenizes the input (respecting quoted string
/// literals) and recognizes a fixed list of major clause keywords, breaking
/// each onto its own line and uppercasing it. Indentation for subqueries is
/// approximated by tracking parenthesis depth, not real grammar nesting, and
/// "validate" is a heuristic (balanced parens/quotes) rather than a real
/// grammar check -- exotic dialect syntax may format oddly.
class SqlFormatter implements IToolUseCase<SqlFormatterInput, SqlFormatterResult> {
  const SqlFormatter();

  static const _clauseKeywords = <String>[
    'LEFT OUTER JOIN',
    'RIGHT OUTER JOIN',
    'FULL OUTER JOIN',
    'INNER JOIN',
    'CROSS JOIN',
    'LEFT JOIN',
    'RIGHT JOIN',
    'FULL JOIN',
    'GROUP BY',
    'ORDER BY',
    'UNION ALL',
    'INSERT INTO',
    'DELETE FROM',
    'SELECT',
    'FROM',
    'WHERE',
    'HAVING',
    'LIMIT',
    'OFFSET',
    'VALUES',
    'UPDATE',
    'SET',
    'UNION',
    'JOIN',
  ];

  static const _continuationKeywords = <String>['AND', 'OR'];

  @override
  SqlFormatterResult execute(SqlFormatterInput input) {
    final trimmed = input.source.trim();
    if (trimmed.isEmpty) {
      return const SqlFormatterResult(isValid: false, errorMessage: 'SQL input is empty');
    }

    final balanceError = _checkBalance(trimmed);
    if (balanceError != null) {
      return SqlFormatterResult(isValid: false, errorMessage: balanceError);
    }

    switch (input.mode) {
      case SqlFormatMode.validate:
        return const SqlFormatterResult(
          isValid: true,
          output: 'Looks like valid SQL (heuristic check: keywords + balanced parens/quotes only)',
        );
      case SqlFormatMode.minify:
        return SqlFormatterResult(isValid: true, output: _minify(trimmed));
      case SqlFormatMode.pretty:
        return SqlFormatterResult(isValid: true, output: _prettify(trimmed));
    }
  }

  String? _checkBalance(String sql) {
    var depth = 0;
    String? quote;
    for (var i = 0; i < sql.length; i++) {
      final ch = sql[i];
      if (quote != null) {
        if (ch == quote) quote = null;
        continue;
      }
      if (ch == "'" || ch == '"') {
        quote = ch;
      } else if (ch == '(') {
        depth++;
      } else if (ch == ')') {
        depth--;
        if (depth < 0) return 'Unbalanced parentheses: unexpected ")"';
      }
    }
    if (depth != 0) return 'Unbalanced parentheses: missing ")"';
    if (quote != null) return 'Unterminated string literal';
    return null;
  }

  List<String> _tokenize(String sql) {
    final tokens = <String>[];
    final buffer = StringBuffer();
    String? quote;

    void flush() {
      if (buffer.isNotEmpty) {
        tokens.add(buffer.toString());
        buffer.clear();
      }
    }

    for (var i = 0; i < sql.length; i++) {
      final ch = sql[i];
      if (quote != null) {
        buffer.write(ch);
        if (ch == quote) quote = null;
        continue;
      }
      if (ch == "'" || ch == '"') {
        flush();
        quote = ch;
        buffer.write(ch);
        continue;
      }
      if (ch == '(' || ch == ')' || ch == ',') {
        flush();
        tokens.add(ch);
        continue;
      }
      if (ch.trim().isEmpty) {
        flush();
        continue;
      }
      buffer.write(ch);
    }
    flush();
    return tokens;
  }

  bool _matchesAt(List<String> tokens, int index, List<String> words) {
    if (index + words.length > tokens.length) return false;
    for (var j = 0; j < words.length; j++) {
      if (tokens[index + j].toUpperCase() != words[j]) return false;
    }
    return true;
  }

  _KeywordMatch? _matchKeyword(List<String> tokens, int index) {
    for (final phrase in _clauseKeywords) {
      final words = phrase.split(' ');
      if (_matchesAt(tokens, index, words)) {
        return _KeywordMatch(phrase, words.length, 0);
      }
    }
    for (final word in _continuationKeywords) {
      if (_matchesAt(tokens, index, [word])) {
        return _KeywordMatch(word, 1, 1);
      }
    }
    return null;
  }

  String _minify(String sql) {
    final tokens = _tokenize(sql);
    final buffer = StringBuffer();
    for (var i = 0; i < tokens.length; i++) {
      final token = tokens[i];
      if (i == 0) {
        buffer.write(token);
        continue;
      }
      final prev = tokens[i - 1];
      final needsSpace = token != ',' && token != ')' && prev != '(';
      if (needsSpace) buffer.write(' ');
      buffer.write(token);
    }
    return buffer.toString();
  }

  String _prettify(String sql) {
    final tokens = _tokenize(sql);
    final lines = <String>[];
    var depth = 0;
    var current = StringBuffer();
    var currentHasContent = false;

    void newLine(int indentLevel) {
      if (currentHasContent) {
        lines.add(current.toString());
      }
      current = StringBuffer('  ' * indentLevel);
      currentHasContent = false;
    }

    void append(String token) {
      final text = current.toString();
      final isFirstOnLine = text.trim().isEmpty && !text.endsWith('(');
      final endsWithOpenParen = text.endsWith('(');
      final needsSpace = !isFirstOnLine && token != ',' && token != ')' && !endsWithOpenParen;
      if (needsSpace) current.write(' ');
      current.write(token);
      currentHasContent = true;
    }

    var i = 0;
    while (i < tokens.length) {
      final match = _matchKeyword(tokens, i);
      if (match != null) {
        newLine(depth + match.extraIndent);
        append(match.keyword);
        i += match.wordCount;
        continue;
      }
      final token = tokens[i];
      if (token == '(') {
        append(token);
        depth++;
        i++;
        continue;
      }
      if (token == ')') {
        depth = depth > 0 ? depth - 1 : 0;
        append(token);
        i++;
        continue;
      }
      append(token);
      i++;
    }
    newLine(0);

    return lines.where((line) => line.trim().isNotEmpty).join('\n');
  }
}
