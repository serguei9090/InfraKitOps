import 'dart:convert';

import '../ports/i_tool_use_case.dart';

/// Field separator. European Excel opens `.csv` with `;`, US/UK Excel with
/// `,`, so this has to be selectable or half the users get one column.
enum CsvDelimiter {
  comma('Comma  ,', ','),
  semicolon('Semicolon  ;', ';'),
  tab('Tab', '\t');

  const CsvDelimiter(this.label, this.character);

  final String label;
  final String character;
}

/// RFC 4180 specifies CRLF, and that is what Excel is happiest with, but
/// `\n` is friendlier for anything Unix-side.
enum CsvLineEnding {
  crlf('CRLF  (RFC 4180)', '\r\n'),
  lf('LF  (Unix)', '\n');

  const CsvLineEnding(this.label, this.sequence);

  final String label;
  final String sequence;
}

/// How a nested JSON array is turned into CSV.
enum CsvArrayHandling {
  /// **Default.** Index-suffixed columns: `{"tags":["a","b"]}` becomes the
  /// columns `tags.0` and `tags.1`, matching the dotted-path flattening
  /// used for nested objects. Objects inside arrays keep flattening, so
  /// `{"users":[{"name":"x"}]}` becomes `users.0.name`.
  indexedColumns('Index-suffixed columns  (tags.0, tags.1)'),

  /// The whole array is compact-JSON-encoded into one cell:
  /// `{"tags":["a","b"]}` becomes the single column `tags` holding
  /// `["a","b"]`. Keeps the column count stable when array lengths vary.
  jsonEncoded('JSON-encoded in one cell  (["a","b"])');

  const CsvArrayHandling(this.label);

  final String label;
}

class JsonToCsvInput {
  const JsonToCsvInput({
    required this.json,
    this.delimiter = CsvDelimiter.comma,
    this.lineEnding = CsvLineEnding.crlf,
    this.arrayHandling = CsvArrayHandling.indexedColumns,
    this.includeHeader = true,
  });

  /// A JSON array of objects, as text.
  final String json;

  final CsvDelimiter delimiter;
  final CsvLineEnding lineEnding;
  final CsvArrayHandling arrayHandling;
  final bool includeHeader;
}

class JsonToCsvResult {
  const JsonToCsvResult({required this.csv, required this.headers, required this.rowCount});

  final String csv;

  /// Column order: union of every object's keys, in first-seen order.
  final List<String> headers;

  /// Data rows, excluding the header line.
  final int rowCount;
}

/// Converts a JSON array of objects into RFC 4180 CSV.
///
/// ## What it does with messy input
/// * **Differing key sets** — the header is the union of all keys in
///   first-seen order; a row missing a key gets an empty cell.
/// * **Nested objects** — flattened to dotted paths (`user.name`).
/// * **Nested arrays** — see [CsvArrayHandling]; the default is
///   index-suffixed columns (`tags.0`, `tags.1`).
/// * **null** — an empty cell, so it is indistinguishable from a missing
///   key. That is the conventional CSV behaviour; CSV has no null.
/// * **Empty object / empty array values** — contribute no columns.
///
/// ## Quoting (RFC 4180 §2)
/// A field is quoted when it contains the delimiter, a double quote, CR or
/// LF; embedded double quotes are doubled. Everything else is written bare.
class JsonToCsvConverter implements IToolUseCase<JsonToCsvInput, JsonToCsvResult> {
  const JsonToCsvConverter();

  @override
  JsonToCsvResult execute(JsonToCsvInput input) {
    if (input.json.trim().isEmpty) {
      throw ArgumentError('Input is empty');
    }

    final dynamic decoded;
    try {
      decoded = jsonDecode(input.json);
    } on FormatException catch (e) {
      throw FormatException('Invalid JSON: ${e.message}');
    }

    if (decoded is! List) {
      throw const FormatException(
        'Expected a JSON array of objects at the top level, e.g. [{"a": 1}, {"a": 2}].',
      );
    }
    if (decoded.isEmpty) {
      throw const FormatException('The JSON array is empty — there are no rows to convert.');
    }

    // Flatten every row first so the header can be the union of all keys.
    final rows = <Map<String, String>>[];
    final headers = <String>[];

    for (var i = 0; i < decoded.length; i++) {
      final element = decoded[i];
      if (element is! Map) {
        throw FormatException(
          'Element ${i + 1} of the array is a ${_typeName(element)}, not an object. '
          'Every element must be a JSON object so it can become a CSV row.',
        );
      }
      final flat = <String, String>{};
      _flatten(element, '', flat, input.arrayHandling);
      for (final key in flat.keys) {
        if (!headers.contains(key)) headers.add(key);
      }
      rows.add(flat);
    }

    final delimiter = input.delimiter.character;
    final eol = input.lineEnding.sequence;
    final buffer = StringBuffer();

    if (input.includeHeader) {
      buffer.write(headers.map((h) => escapeCsvField(h, delimiter)).join(delimiter));
      buffer.write(eol);
    }
    for (final row in rows) {
      buffer.write(headers.map((h) => escapeCsvField(row[h] ?? '', delimiter)).join(delimiter));
      buffer.write(eol);
    }

    return JsonToCsvResult(csv: buffer.toString(), headers: headers, rowCount: rows.length);
  }

  /// RFC 4180 §2 field escaping. Public so the CSV rules are directly
  /// testable rather than only observable through a whole conversion.
  static String escapeCsvField(String value, String delimiter) {
    final needsQuotes = value.contains(delimiter) ||
        value.contains('"') ||
        value.contains('\n') ||
        value.contains('\r');
    if (!needsQuotes) return value;
    return '"${value.replaceAll('"', '""')}"';
  }

  void _flatten(Map<dynamic, dynamic> source, String prefix, Map<String, String> out, CsvArrayHandling arrays) {
    for (final entry in source.entries) {
      final key = prefix.isEmpty ? entry.key.toString() : '$prefix.${entry.key}';
      _flattenValue(entry.value, key, out, arrays);
    }
  }

  void _flattenValue(dynamic value, String key, Map<String, String> out, CsvArrayHandling arrays) {
    if (value is Map) {
      if (value.isEmpty) return;
      _flatten(value, key, out, arrays);
      return;
    }
    if (value is List) {
      if (value.isEmpty) return;
      switch (arrays) {
        case CsvArrayHandling.jsonEncoded:
          out[key] = jsonEncode(value);
        case CsvArrayHandling.indexedColumns:
          for (var i = 0; i < value.length; i++) {
            _flattenValue(value[i], '$key.$i', out, arrays);
          }
      }
      return;
    }
    out[key] = _scalar(value);
  }

  String _scalar(dynamic value) {
    if (value == null) return '';
    if (value is String) return value;
    return value.toString();
  }

  String _typeName(dynamic value) {
    if (value == null) return 'null';
    if (value is List) return 'array';
    if (value is num) return 'number';
    if (value is bool) return 'boolean';
    if (value is String) return 'string';
    return value.runtimeType.toString();
  }
}
