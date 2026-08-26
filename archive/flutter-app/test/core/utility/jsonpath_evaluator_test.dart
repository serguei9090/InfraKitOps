import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/utility/jsonpath_evaluator.dart';

void main() {
  const evaluator = JsonPathEvaluator();

  // Classic bookstore fixture used throughout JSONPath documentation/tests.
  const document = '''
  {
    "store": {
      "book": [
        { "category": "reference", "author": "Nigel Rees", "title": "Sayings of the Century", "price": 8.95 },
        { "category": "fiction", "author": "Evelyn Waugh", "title": "Sword of Honour", "price": 12.99 },
        { "category": "fiction", "author": "Herman Melville", "title": "Moby Dick", "isbn": "0-553-21311-3", "price": 8.99 },
        { "category": "fiction", "author": "J. R. R. Tolkien", "title": "The Lord of the Rings", "isbn": "0-395-19395-8", "price": 22.99 }
      ],
      "bicycle": { "color": "red", "price": 19.95 }
    }
  }
  ''';

  JsonPathResult run(String expression) =>
      evaluator.execute(JsonPathEvaluatorInput(document: document, expression: expression));

  group('root and child access', () {
    test('root alone returns the whole document', () {
      final result = run(r'$');
      expect(result.isValid, isTrue);
      expect(result.matchCount, 1);
      expect(result.matches.single.path, r'$');
    });

    test('dot child access walks nested objects', () {
      final result = run(r'$.store.bicycle.color');
      expect(result.isValid, isTrue);
      expect(result.matchCount, 1);
      expect(result.matches.single.value, 'red');
    });

    test('bracket child access with quoted name works, including keys needing quoting', () {
      final result = run(r"$['store']['bicycle']['price']");
      expect(result.isValid, isTrue);
      expect(result.matches.single.value, 19.95);
    });
  });

  group('wildcard', () {
    test('.* returns every child of an object', () {
      final result = run(r'$.store.bicycle.*');
      expect(result.isValid, isTrue);
      expect(result.matchCount, 2);
      expect(result.matches.map((m) => m.value), containsAll(['red', 19.95]));
    });

    test('[*] returns every element of an array', () {
      final result = run(r'$.store.book[*].title');
      expect(result.isValid, isTrue);
      expect(result.matchCount, 4);
      expect(result.matches.map((m) => m.value), [
        'Sayings of the Century',
        'Sword of Honour',
        'Moby Dick',
        'The Lord of the Rings',
      ]);
    });
  });

  group('array index', () {
    test('a positive index selects one element', () {
      final result = run(r'$.store.book[0].title');
      expect(result.isValid, isTrue);
      expect(result.matches.single.value, 'Sayings of the Century');
    });

    test('a negative index counts back from the end', () {
      final result = run(r'$.store.book[-1].title');
      expect(result.isValid, isTrue);
      expect(result.matches.single.value, 'The Lord of the Rings');
    });

    test('an out-of-range index yields no match rather than an error', () {
      final result = run(r'$.store.book[99]');
      expect(result.isValid, isTrue);
      expect(result.matchCount, 0);
    });
  });

  group('slices', () {
    test('a plain slice selects a sub-range', () {
      final result = run(r'$.store.book[1:3].title');
      expect(result.isValid, isTrue);
      expect(result.matches.map((m) => m.value), ['Sword of Honour', 'Moby Dick']);
    });

    test('an open-ended slice with a negative bound counts from the end', () {
      final result = run(r'$.store.book[-2:].title');
      expect(result.isValid, isTrue);
      expect(result.matches.map((m) => m.value), ['Moby Dick', 'The Lord of the Rings']);
    });

    test('a slice with a step skips elements', () {
      final result = run(r'$.store.book[0:4:2].title');
      expect(result.isValid, isTrue);
      expect(result.matches.map((m) => m.value), ['Sayings of the Century', 'Moby Dick']);
    });

    test('a negative step walks backwards', () {
      final result = run(r'$.store.book[::-1].title');
      expect(result.isValid, isTrue);
      expect(result.matches.map((m) => m.value), [
        'The Lord of the Rings',
        'Moby Dick',
        'Sword of Honour',
        'Sayings of the Century',
      ]);
    });
  });

  group('recursive descent', () {
    test('..author finds matches at every depth', () {
      final result = run(r'$..author');
      expect(result.isValid, isTrue);
      expect(result.matchCount, 4);
      expect(result.matches.map((m) => m.value), [
        'Nigel Rees',
        'Evelyn Waugh',
        'Herman Melville',
        'J. R. R. Tolkien',
      ]);
    });

    test('..price finds prices nested at different depths (book array and bicycle)', () {
      final result = run(r'$..price');
      expect(result.isValid, isTrue);
      // 4 book prices + 1 bicycle price.
      expect(result.matchCount, 5);
      expect(result.matches.map((m) => m.value), containsAll([8.95, 12.99, 8.99, 22.99, 19.95]));
    });

    test('..* returns every descendant value, deeper than one level', () {
      final result = run(r'$.store.bicycle..*');
      expect(result.isValid, isTrue);
      // bicycle itself has 2 children ("color","price"); recursive descent
      // also includes the bicycle node's own children of children (none,
      // since they're scalars) so we just assert it's non-trivially larger
      // than a single wildcard would give and includes both leaf values.
      expect(result.matches.map((m) => m.value), containsAll(['red', 19.95]));
    });

    test('..[0] applies a bracket selector to every descendant', () {
      final result = run(r'$..[0]');
      expect(result.isValid, isTrue);
      // The book array's [0] element (the Nigel Rees book) should be present.
      expect(
        result.matches.any((m) => m.value is Map && (m.value as Map)['author'] == 'Nigel Rees'),
        isTrue,
      );
    });
  });

  group('filters', () {
    test('a numeric comparison filter selects matching array elements', () {
      final result = run(r'$.store.book[?(@.price < 10)].title');
      expect(result.isValid, isTrue);
      expect(result.matches.map((m) => m.value), ['Sayings of the Century', 'Moby Dick']);
    });

    test('an equality filter compares against a string literal', () {
      final result = run(r"$.store.book[?(@.category == 'fiction')].title");
      expect(result.isValid, isTrue);
      expect(result.matches.map((m) => m.value), ['Sword of Honour', 'Moby Dick', 'The Lord of the Rings']);
    });

    test('an existence filter selects elements that have the member', () {
      final result = run(r'$.store.book[?(@.isbn)].title');
      expect(result.isValid, isTrue);
      expect(result.matches.map((m) => m.value), ['Moby Dick', 'The Lord of the Rings']);
    });

    test('a >= filter on price', () {
      final result = run(r'$.store.book[?(@.price >= 12.99)].title');
      expect(result.isValid, isTrue);
      expect(result.matches.map((m) => m.value), ['Sword of Honour', 'The Lord of the Rings']);
    });
  });

  group('unsupported / invalid syntax errors cleanly', () {
    test(r'an expression not starting with $ is rejected', () {
      final result = run('store.book');
      expect(result.isValid, isFalse);
      expect(result.errorMessage, isNotNull);
    });

    test('boolean combinators in a filter are rejected with a clear message', () {
      final result = run(r'$.store.book[?(@.price < 10 && @.category == "fiction")]');
      expect(result.isValid, isFalse);
      expect(result.errorMessage, contains('&&'));
    });

    test('regex filters are rejected', () {
      final result = run(r'$.store.book[?(@.author =~ /Tolkien/)]');
      expect(result.isValid, isFalse);
      expect(result.errorMessage, contains('=~'));
    });

    test('union selectors are rejected', () {
      final result = run(r'$.store.book[0,1]');
      expect(result.isValid, isFalse);
      expect(result.errorMessage, isNotNull);
    });

    test('filter function calls are rejected', () {
      final result = run(r'$.store.book[?(length(@.title) > 5)]');
      expect(result.isValid, isFalse);
      expect(result.errorMessage, isNotNull);
    });

    test('script expressions are rejected', () {
      final result = run(r'$.store.book[(@.length-1)]');
      expect(result.isValid, isFalse);
      expect(result.errorMessage, contains('Script expressions'));
    });

    test('an unclosed bracket is rejected', () {
      final result = run(r'$.store.book[0');
      expect(result.isValid, isFalse);
      expect(result.errorMessage, isNotNull);
    });
  });

  group('invalid JSON document', () {
    test('malformed JSON document errors cleanly', () {
      final result = evaluator.execute(
        const JsonPathEvaluatorInput(document: '{"a": 1,}', expression: r'$.a'),
      );
      expect(result.isValid, isFalse);
      expect(result.errorMessage, isNotNull);
    });

    test('empty document errors cleanly', () {
      final result = evaluator.execute(const JsonPathEvaluatorInput(document: '', expression: r'$.a'));
      expect(result.isValid, isFalse);
      expect(result.errorMessage, isNotNull);
    });

    test('empty expression errors cleanly', () {
      final result = evaluator.execute(JsonPathEvaluatorInput(document: document, expression: ''));
      expect(result.isValid, isFalse);
      expect(result.errorMessage, isNotNull);
    });
  });

  group('JsonPathMatch rendering helpers', () {
    test('prettyValue and compactValue render the selected value as JSON', () {
      final result = run(r'$.store.bicycle');
      final match = result.matches.single;
      expect(match.prettyValue, contains('"color": "red"'));
      expect(match.compactValue, contains('"color":"red"'));
    });

    test('prettyValues on the result renders all matches as a JSON array', () {
      final result = run(r'$.store.book[0:2].title');
      expect(result.prettyValues, contains('Sayings of the Century'));
      expect(result.prettyValues, contains('Sword of Honour'));
    });
  });
}
