import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/sql_formatter.dart';

void main() {
  const formatter = SqlFormatter();

  test('pretty-prints major clauses onto their own uppercased line', () {
    final result = formatter.execute(
      const SqlFormatterInput(
        source: 'select id, name from users where age > 18 order by name',
        mode: SqlFormatMode.pretty,
      ),
    );

    expect(result.isValid, isTrue);
    expect(result.output, 'SELECT id, name\nFROM users\nWHERE age > 18\nORDER BY name');
  });

  test('indents AND/OR continuations and subqueries under parens', () {
    final result = formatter.execute(
      const SqlFormatterInput(
        source: 'select * from (select id from t) sub where a = 1 and b = 2',
        mode: SqlFormatMode.pretty,
      ),
    );

    expect(result.isValid, isTrue);
    expect(result.output, contains('  SELECT id'));
    expect(result.output, contains('  AND b = 2'));
  });

  test('minifies collapsing whitespace onto a single line', () {
    final result = formatter.execute(
      const SqlFormatterInput(
        source: 'select   id,\n  name\nfrom   users',
        mode: SqlFormatMode.minify,
      ),
    );

    expect(result.isValid, isTrue);
    expect(result.output, 'select id, name from users');
  });

  test('validate reports valid SQL', () {
    final result = formatter.execute(
      const SqlFormatterInput(source: 'SELECT * FROM users', mode: SqlFormatMode.validate),
    );

    expect(result.isValid, isTrue);
  });

  test('rejects SQL with unbalanced parentheses', () {
    final result = formatter.execute(
      const SqlFormatterInput(
        source: 'SELECT * FROM users WHERE (id = 1',
        mode: SqlFormatMode.validate,
      ),
    );

    expect(result.isValid, isFalse);
    expect(result.errorMessage, isNotNull);
  });

  test('rejects empty input', () {
    final result = formatter.execute(
      const SqlFormatterInput(source: '   ', mode: SqlFormatMode.validate),
    );

    expect(result.isValid, isFalse);
  });
}
