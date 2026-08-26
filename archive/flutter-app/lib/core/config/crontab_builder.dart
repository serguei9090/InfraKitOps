import '../ports/i_tool_use_case.dart';

/// Which of the five crontab columns a value belongs to. Each column has its
/// own legal numeric range and its own name table, so nearly every parsing
/// and rendering routine in this file is parameterised by it.
enum CronField { minute, hour, dayOfMonth, month, dayOfWeek }

/// How a single crontab column should be generated in "build" mode.
///
/// Deliberately a small closed set (rather than free text) so the UI can offer
/// a dropdown per column and still guarantee a syntactically valid field.
enum CronFieldSpecKind {
  /// `*`
  every,

  /// `a,b,c`
  list,

  /// `a-b`
  range,

  /// `*/n`
  step,

  /// `a-b/n`
  rangeStep,
}

/// A declarative description of one crontab column, used by
/// [CrontabBuilder.build] to emit the corresponding field text.
class CronFieldSpec {
  const CronFieldSpec._(this.kind, {this.values = const [], this.start, this.end, this.step});

  /// `*` — every legal value for the column.
  const CronFieldSpec.every() : this._(CronFieldSpecKind.every);

  /// `a,b,c` — an explicit list. Duplicates are collapsed, order is preserved
  /// after sorting so the emitted field is stable.
  const CronFieldSpec.values(List<int> values) : this._(CronFieldSpecKind.list, values: values);

  /// `a-b` — an inclusive range.
  const CronFieldSpec.range(int start, int end) : this._(CronFieldSpecKind.range, start: start, end: end);

  /// `*/n` — every n-th value across the whole column.
  const CronFieldSpec.step(int step) : this._(CronFieldSpecKind.step, step: step);

  /// `a-b/n` — every n-th value inside an inclusive range.
  const CronFieldSpec.rangeStep(int start, int end, int step)
    : this._(CronFieldSpecKind.rangeStep, start: start, end: end, step: step);

  final CronFieldSpecKind kind;
  final List<int> values;
  final int? start;
  final int? end;
  final int? step;

  /// Renders this spec as crontab field text, validating it against [field]'s
  /// legal range. Throws [ArgumentError] with a human-readable message when
  /// the spec is out of range or internally inconsistent.
  String render(CronField field) {
    final meta = _metaOf(field);

    void check(int value, String what) {
      if (value < meta.min || value > meta.max) {
        throw ArgumentError(
          '$what $value is out of range for ${meta.label} '
          '(allowed ${meta.min}-${meta.max})',
        );
      }
    }

    switch (kind) {
      case CronFieldSpecKind.every:
        return '*';

      case CronFieldSpecKind.list:
        if (values.isEmpty) {
          throw ArgumentError('At least one value is required for ${meta.label}');
        }
        for (final v in values) {
          check(v, 'Value');
        }
        final sorted = values.toSet().toList()..sort();
        return sorted.join(',');

      case CronFieldSpecKind.range:
        final s = start!;
        final e = end!;
        check(s, 'Range start');
        check(e, 'Range end');
        if (s > e) {
          throw ArgumentError('Range start $s must not be greater than range end $e for ${meta.label}');
        }
        return s == e ? '$s' : '$s-$e';

      case CronFieldSpecKind.step:
        final n = step!;
        if (n < 1 || n > meta.max) {
          throw ArgumentError('Step $n must be between 1 and ${meta.max} for ${meta.label}');
        }
        return n == 1 ? '*' : '*/$n';

      case CronFieldSpecKind.rangeStep:
        final s = start!;
        final e = end!;
        final n = step!;
        check(s, 'Range start');
        check(e, 'Range end');
        if (s > e) {
          throw ArgumentError('Range start $s must not be greater than range end $e for ${meta.label}');
        }
        if (n < 1 || n > meta.max) {
          throw ArgumentError('Step $n must be between 1 and ${meta.max} for ${meta.label}');
        }
        return n == 1 ? '$s-$e' : '$s-$e/$n';
    }
  }
}

/// Structured input for building an expression from scratch.
class CrontabBuildInput {
  const CrontabBuildInput({
    this.minute = const CronFieldSpec.every(),
    this.hour = const CronFieldSpec.every(),
    this.dayOfMonth = const CronFieldSpec.every(),
    this.month = const CronFieldSpec.every(),
    this.dayOfWeek = const CronFieldSpec.every(),
    this.from,
    this.nextRunCount = 5,
  });

  final CronFieldSpec minute;
  final CronFieldSpec hour;
  final CronFieldSpec dayOfMonth;
  final CronFieldSpec month;
  final CronFieldSpec dayOfWeek;

  /// Reference instant for [CrontabResult.nextRuns]. Defaults to "now" when
  /// null; tests always pass an explicit value so results stay deterministic.
  final DateTime? from;

  final int nextRunCount;
}

/// Everything the UI needs to render for one schedule.
class CrontabResult {
  const CrontabResult({
    required this.expression,
    required this.description,
    required this.nextRuns,
    required this.isReboot,
  });

  /// The five-field expression (or the `@shortcut` when one was supplied).
  final String expression;

  /// Plain-English rendering, e.g. "At 09:00 on Monday through Friday".
  final String description;

  /// Upcoming matching instants. Always empty for `@reboot`, which has no
  /// wall-clock schedule at all.
  final List<DateTime> nextRuns;

  final bool isReboot;
}

/// One parsed `a-b/n` term inside a crontab column.
class _Term {
  const _Term({required this.start, required this.end, required this.step, required this.star});

  final int start;
  final int end;
  final int step;

  /// True when this term was written with `*` (as opposed to an explicit
  /// range). Vixie cron tracks exactly this flag on the day-of-month and
  /// day-of-week columns to decide between AND and OR matching.
  final bool star;
}

/// One fully parsed crontab column: the literal terms (kept for describing)
/// plus the expanded set of matching values (used for date math).
class CronColumn {
  // `this._terms` would satisfy prefer_initializing_formals below, but then
  // the constructor's named parameter becomes literally `_terms`, which
  // trips library_private_types_in_public_api differently (see the doc
  // comment on `_terms`). This form satisfies both lints at once.
  const CronColumn._({required this.text, required List<_Term> terms, required this.values, required this.isStar})
    // ignore: prefer_initializing_formals
    : _terms = terms;

  /// The original field text, e.g. `1-5` or `*/15`.
  final String text;

  /// Private: `_Term` is an internal parsing detail, not part of the public
  /// shape. Callers that need "what does this column mean" use [text] or
  /// the explain/next-run-time methods below, not the parsed terms.
  final List<_Term> _terms;

  /// Every value this column matches, already normalised (day-of-week 7 is
  /// folded onto 0).
  final Set<int> values;

  /// True when the field began with `*`. Vixie cron's `DOM_STAR`/`DOW_STAR`.
  final bool isStar;
}

/// A parsed crontab expression, ready for matching and describing.
class CronSchedule {
  const CronSchedule._({
    required this.expression,
    required this.minute,
    required this.hour,
    required this.dayOfMonth,
    required this.month,
    required this.dayOfWeek,
    required this.isReboot,
  });

  /// The normalised five-field expression. For a `@shortcut` input this is
  /// the expansion (`@daily` -> `0 0 * * *`), except `@reboot`.
  final String expression;

  final CronColumn minute;
  final CronColumn hour;
  final CronColumn dayOfMonth;
  final CronColumn month;
  final CronColumn dayOfWeek;

  final bool isReboot;

  /// Implements the classic cron day-matching rule:
  ///
  /// * if day-of-month **or** day-of-week is `*`, both columns must match (AND);
  /// * if **neither** is `*`, a day matches when **either** column matches (OR).
  ///
  /// The OR branch is the gotcha most naive implementations get wrong:
  /// `0 0 13 * 5` fires on every Friday *and* on the 13th, not only on
  /// Friday the 13th.
  bool matchesDate(DateTime time) {
    if (!month.values.contains(time.month)) return false;

    final dom = time.day;
    // Dart: Monday == 1 ... Sunday == 7. Cron: Sunday == 0.
    final dow = time.weekday % 7;

    final domMatch = dayOfMonth.values.contains(dom);
    final dowMatch = dayOfWeek.values.contains(dow);

    if (dayOfMonth.isStar || dayOfWeek.isStar) return domMatch && dowMatch;
    return domMatch || dowMatch;
  }

  /// True when [time] (to minute precision) is a firing time.
  bool matches(DateTime time) {
    if (isReboot) return false;
    return minute.values.contains(time.minute) && hour.values.contains(time.hour) && matchesDate(time);
  }
}

/// Bidirectional crontab tool: build an expression from structured input,
/// explain an existing one in plain English, and compute upcoming run times.
///
/// Pure Dart — no packages, no I/O, no Flutter. All date math is done with
/// calendar components rather than `Duration` arithmetic so a UTC input stays
/// UTC and a local input keeps its own wall-clock semantics.
class CrontabBuilder implements IToolUseCase<CrontabBuildInput, CrontabResult> {
  const CrontabBuilder();

  /// Nickname shortcuts understood by Vixie cron and its descendants.
  static const Map<String, String> shortcuts = {
    '@yearly': '0 0 1 1 *',
    '@annually': '0 0 1 1 *',
    '@monthly': '0 0 1 * *',
    '@weekly': '0 0 * * 0',
    '@daily': '0 0 * * *',
    '@midnight': '0 0 * * *',
    '@hourly': '0 * * * *',
  };

  @override
  CrontabResult execute(CrontabBuildInput input) {
    final expression = build(input);
    final from = input.from ?? DateTime.now();
    return CrontabResult(
      expression: expression,
      description: explain(expression),
      nextRuns: nextRunTimes(expression, from, input.nextRunCount),
      isReboot: false,
    );
  }

  /// Same as [execute] but starting from an existing expression.
  CrontabResult describe(String expression, {DateTime? from, int nextRunCount = 5}) {
    final schedule = parse(expression);
    return CrontabResult(
      expression: schedule.isReboot ? '@reboot' : schedule.expression,
      description: describeSchedule(schedule),
      nextRuns: schedule.isReboot ? const [] : _nextRuns(schedule, from ?? DateTime.now(), nextRunCount),
      isReboot: schedule.isReboot,
    );
  }

  // ---------------------------------------------------------------- build --

  /// Renders [input]'s five columns into a crontab expression.
  String build(CrontabBuildInput input) {
    return [
      input.minute.render(CronField.minute),
      input.hour.render(CronField.hour),
      input.dayOfMonth.render(CronField.dayOfMonth),
      input.month.render(CronField.month),
      input.dayOfWeek.render(CronField.dayOfWeek),
    ].join(' ');
  }

  // ---------------------------------------------------------------- parse --

  /// Expands a `@shortcut` to its five-field equivalent, or returns null when
  /// [expression] is not a recognised shortcut. `@reboot` returns null too —
  /// it has no five-field equivalent.
  String? expandShortcut(String expression) => shortcuts[expression.trim().toLowerCase()];

  /// Parses a crontab expression (five fields or a `@shortcut`).
  ///
  /// Throws [FormatException] with an explanatory message on anything that is
  /// not a valid expression.
  CronSchedule parse(String expression) {
    final raw = expression.trim();
    if (raw.isEmpty) {
      throw const FormatException('Expression is empty');
    }

    if (raw.startsWith('@')) {
      final nickname = raw.toLowerCase();
      if (nickname == '@reboot') {
        return CronSchedule._(
          expression: '@reboot',
          minute: _parseColumn('*', CronField.minute),
          hour: _parseColumn('*', CronField.hour),
          dayOfMonth: _parseColumn('*', CronField.dayOfMonth),
          month: _parseColumn('*', CronField.month),
          dayOfWeek: _parseColumn('*', CronField.dayOfWeek),
          isReboot: true,
        );
      }
      final expanded = shortcuts[nickname];
      if (expanded == null) {
        throw FormatException(
          'Unknown shortcut "$raw". Supported: @reboot, @yearly, @annually, '
          '@monthly, @weekly, @daily, @midnight, @hourly',
        );
      }
      return _parseFields(expanded);
    }

    return _parseFields(raw);
  }

  CronSchedule _parseFields(String raw) {
    final fields = raw.split(RegExp(r'\s+')).where((f) => f.isNotEmpty).toList();
    if (fields.length != 5) {
      throw FormatException(
        'Expected 5 fields (minute hour day-of-month month day-of-week) '
        'but found ${fields.length} in "$raw"',
      );
    }

    return CronSchedule._(
      expression: fields.join(' '),
      minute: _parseColumn(fields[0], CronField.minute),
      hour: _parseColumn(fields[1], CronField.hour),
      dayOfMonth: _parseColumn(fields[2], CronField.dayOfMonth),
      month: _parseColumn(fields[3], CronField.month),
      dayOfWeek: _parseColumn(fields[4], CronField.dayOfWeek),
      isReboot: false,
    );
  }

  CronColumn _parseColumn(String text, CronField field) {
    final meta = _metaOf(field);
    final trimmed = text.trim();
    if (trimmed.isEmpty) {
      throw FormatException('The ${meta.label} field is empty');
    }

    final terms = <_Term>[];
    final values = <int>{};

    for (final piece in trimmed.split(',')) {
      final item = piece.trim();
      if (item.isEmpty) {
        throw FormatException('Empty list item in the ${meta.label} field "$trimmed"');
      }

      var body = item;
      var step = 1;

      final slash = item.indexOf('/');
      if (slash >= 0) {
        body = item.substring(0, slash).trim();
        final stepText = item.substring(slash + 1).trim();
        if (body.isEmpty) {
          throw FormatException('Missing value before "/" in the ${meta.label} field "$item"');
        }
        step = int.tryParse(stepText) ?? -1;
        if (step < 1) {
          throw FormatException('Invalid step "$stepText" in the ${meta.label} field "$item" (must be 1 or more)');
        }
        if (step > meta.max) {
          throw FormatException('Step $step is larger than the ${meta.label} range ${meta.min}-${meta.max}');
        }
        if (item.substring(slash + 1).contains('/')) {
          throw FormatException('Multiple "/" separators in the ${meta.label} field "$item"');
        }
      }

      int start;
      int end;
      var star = false;

      if (body == '*') {
        star = true;
        start = meta.min;
        end = meta.max;
      } else {
        final dash = _rangeSeparatorIndex(body);
        if (dash > 0) {
          start = _parseValue(body.substring(0, dash), field, item);
          end = _parseValue(body.substring(dash + 1), field, item);
          if (start > end) {
            throw FormatException(
              'Range start $start is greater than range end $end in the ${meta.label} field "$item"',
            );
          }
        } else {
          start = _parseValue(body, field, item);
          // `5/10` is the widely-supported "from 5, every 10" extension.
          end = slash >= 0 ? meta.max : start;
        }
      }

      terms.add(_Term(start: start, end: end, step: step, star: star));
      for (var v = start; v <= end; v += step) {
        values.add(_normalise(v, field));
      }
    }

    if (values.isEmpty) {
      throw FormatException('The ${meta.label} field "$trimmed" matches no values');
    }

    return CronColumn._(text: trimmed, terms: terms, values: values, isStar: trimmed.startsWith('*'));
  }

  /// Finds the `-` that separates a range, skipping a leading sign so that a
  /// malformed `-5` reports as a bad value rather than an empty range bound.
  int _rangeSeparatorIndex(String body) => body.indexOf('-', 1);

  int _parseValue(String text, CronField field, String context) {
    final meta = _metaOf(field);
    final token = text.trim();
    if (token.isEmpty) {
      throw FormatException('Missing value in the ${meta.label} field "$context"');
    }

    final named = meta.names[token.toUpperCase()];
    final value = named ?? int.tryParse(token);
    if (value == null) {
      throw FormatException(
        'Invalid value "$token" in the ${meta.label} field'
        '${meta.names.isEmpty ? '' : ' (expected a number or a name like ${meta.nameExample})'}',
      );
    }
    if (value < meta.min || value > meta.max) {
      throw FormatException(
        'Value $value is out of range for the ${meta.label} field (allowed ${meta.min}-${meta.max})',
      );
    }
    return value;
  }

  /// Day-of-week accepts both 0 and 7 for Sunday; fold 7 onto 0 so matching
  /// only ever has to test one representation.
  int _normalise(int value, CronField field) {
    if (field == CronField.dayOfWeek && value == 7) return 0;
    return value;
  }

  // -------------------------------------------------------------- explain --

  /// Parses [expression] and returns a plain-English description.
  String explain(String expression) => describeSchedule(parse(expression));

  /// Plain-English rendering of an already-parsed schedule.
  String describeSchedule(CronSchedule schedule) {
    if (schedule.isReboot) {
      return 'At system startup (once, each time the machine boots)';
    }

    final segments = <String>[_describeTime(schedule)];

    if (!_isFullStar(schedule.dayOfMonth)) {
      segments.add('on day-of-month ${_describeColumn(schedule.dayOfMonth, CronField.dayOfMonth)}');
    }
    if (!_isFullStar(schedule.month)) {
      segments.add('in ${_describeColumn(schedule.month, CronField.month)}');
    }
    if (!_isFullStar(schedule.dayOfWeek)) {
      segments.add('on ${_describeColumn(schedule.dayOfWeek, CronField.dayOfWeek)}');
    }

    var text = segments.join(' ');

    if (!schedule.dayOfMonth.isStar && !schedule.dayOfWeek.isStar) {
      text += ' (day-of-month and day-of-week are both restricted, so cron '
          'fires when EITHER matches)';
    }

    return text;
  }

  bool _isFullStar(CronColumn column) =>
      column._terms.length == 1 && column._terms.first.star && column._terms.first.step == 1;

  String _describeTime(CronSchedule schedule) {
    final minuteTerms = schedule.minute._terms;
    final hourTerms = schedule.hour._terms;

    final minuteStar = _isFullStar(schedule.minute);
    final hourStar = _isFullStar(schedule.hour);
    final minuteStepOnly = minuteTerms.length == 1 && minuteTerms.first.star;
    final hourStepOnly = hourTerms.length == 1 && hourTerms.first.star;

    final minuteSingles = _singlesOf(minuteTerms);
    final hourSingles = _singlesOf(hourTerms);

    if (minuteStar && hourStar) return 'Every minute';
    if (hourStar && minuteStepOnly) return 'Every ${minuteTerms.first.step} minutes';
    if (minuteStar && hourStepOnly) {
      return 'Every minute of every ${hourTerms.first.step} hours';
    }

    if (hourStar && minuteSingles != null) {
      return 'At minute ${_joinAnd(minuteSingles.map((m) => '$m').toList())} of every hour';
    }
    if (minuteStar && hourSingles != null) {
      return 'Every minute of hour ${_joinAnd(hourSingles.map((h) => '$h').toList())}';
    }

    if (minuteSingles != null && hourSingles != null && minuteSingles.length * hourSingles.length <= 12) {
      final times = <String>[];
      for (final h in hourSingles) {
        for (final m in minuteSingles) {
          times.add('${_pad2(h)}:${_pad2(m)}');
        }
      }
      times.sort();
      return 'At ${_joinAnd(times)}';
    }

    return 'At minute ${_describeColumn(schedule.minute, CronField.minute)}, '
        'hour ${_describeColumn(schedule.hour, CronField.hour)}';
  }

  /// Returns the sorted single values when every term is a plain single
  /// value, otherwise null.
  List<int>? _singlesOf(List<_Term> terms) {
    final out = <int>[];
    for (final t in terms) {
      if (t.star || t.start != t.end) return null;
      out.add(t.start);
    }
    out.sort();
    return out;
  }

  String _describeColumn(CronColumn column, CronField field) {
    final meta = _metaOf(field);
    return _joinAnd(column._terms.map((t) => _describeTerm(t, meta)).toList());
  }

  String _describeTerm(_Term term, _FieldMeta meta) {
    if (term.star) {
      return term.step == 1 ? 'every ${meta.singular}' : 'every ${term.step} ${meta.plural}';
    }
    if (term.start == term.end) return meta.display(term.start);
    if (term.step == 1) {
      return '${meta.display(term.start)} through ${meta.display(term.end)}';
    }
    return 'every ${term.step} ${meta.plural} from ${meta.display(term.start)} through ${meta.display(term.end)}';
  }

  String _joinAnd(List<String> parts) {
    if (parts.isEmpty) return '';
    if (parts.length == 1) return parts.first;
    return '${parts.sublist(0, parts.length - 1).join(', ')} and ${parts.last}';
  }

  String _pad2(int value) => value.toString().padLeft(2, '0');

  // ------------------------------------------------------------ next runs --

  /// Returns the next [count] instants strictly after [from] that match
  /// [expression]. `@reboot` yields an empty list.
  ///
  /// The search advances by the coarsest field that fails (month, then day,
  /// then hour, then minute), so even a sparse schedule such as
  /// `0 0 29 2 *` resolves in a handful of iterations instead of stepping
  /// through millions of minutes.
  List<DateTime> nextRunTimes(String expression, DateTime from, int count) {
    final schedule = parse(expression);
    if (schedule.isReboot) return const [];
    return _nextRuns(schedule, from, count);
  }

  List<DateTime> _nextRuns(CronSchedule schedule, DateTime from, int count) {
    if (count <= 0) return const [];

    final results = <DateTime>[];
    // Truncate to minute precision, then step forward one minute: results are
    // strictly after `from`.
    var cursor = _at(from, from.year, from.month, from.day, from.hour, from.minute + 1);

    // Cron schedules can legitimately be years apart (`0 0 29 2 *`), but an
    // unsatisfiable one (`0 0 30 2 *`) must not spin forever.
    final horizon = from.year + 8;
    var guard = 0;

    while (results.length < count && cursor.year <= horizon && guard < 200000) {
      guard++;

      if (!schedule.month.values.contains(cursor.month)) {
        cursor = _at(cursor, cursor.year, cursor.month + 1, 1, 0, 0);
        continue;
      }
      if (!schedule.matchesDate(cursor)) {
        cursor = _at(cursor, cursor.year, cursor.month, cursor.day + 1, 0, 0);
        continue;
      }
      if (!schedule.hour.values.contains(cursor.hour)) {
        cursor = _at(cursor, cursor.year, cursor.month, cursor.day, cursor.hour + 1, 0);
        continue;
      }
      if (!schedule.minute.values.contains(cursor.minute)) {
        cursor = _at(cursor, cursor.year, cursor.month, cursor.day, cursor.hour, cursor.minute + 1);
        continue;
      }

      results.add(cursor);
      cursor = _at(cursor, cursor.year, cursor.month, cursor.day, cursor.hour, cursor.minute + 1);
    }

    return results;
  }

  /// Builds a DateTime in the same zone as [reference]. Out-of-range
  /// components (month 13, day 32, hour 24, minute 60) normalise, which is
  /// exactly the rollover behaviour the search loop above relies on.
  DateTime _at(DateTime reference, int year, int month, int day, int hour, int minute) {
    return reference.isUtc
        ? DateTime.utc(year, month, day, hour, minute)
        : DateTime(year, month, day, hour, minute);
  }
}

// --------------------------------------------------------------- metadata --

class _FieldMeta {
  const _FieldMeta({
    required this.label,
    required this.singular,
    required this.plural,
    required this.min,
    required this.max,
    this.names = const {},
    this.displayNames = const [],
    this.nameExample = '',
  });

  final String label;
  final String singular;
  final String plural;
  final int min;
  final int max;

  /// Accepted textual aliases (uppercase) mapped to their numeric value.
  final Map<String, int> names;

  /// Full names used when describing, indexed from [min].
  final List<String> displayNames;

  final String nameExample;

  String display(int value) {
    if (displayNames.isEmpty) return '$value';
    final index = value - min;
    if (index < 0 || index >= displayNames.length) return '$value';
    return displayNames[index];
  }
}

const _monthNames = <String, int>{
  'JAN': 1,
  'FEB': 2,
  'MAR': 3,
  'APR': 4,
  'MAY': 5,
  'JUN': 6,
  'JUL': 7,
  'AUG': 8,
  'SEP': 9,
  'OCT': 10,
  'NOV': 11,
  'DEC': 12,
};

const _dayNames = <String, int>{'SUN': 0, 'MON': 1, 'TUE': 2, 'WED': 3, 'THU': 4, 'FRI': 5, 'SAT': 6};

const _metas = <CronField, _FieldMeta>{
  CronField.minute: _FieldMeta(label: 'minute', singular: 'minute', plural: 'minutes', min: 0, max: 59),
  CronField.hour: _FieldMeta(label: 'hour', singular: 'hour', plural: 'hours', min: 0, max: 23),
  CronField.dayOfMonth: _FieldMeta(
    label: 'day-of-month',
    singular: 'day-of-month',
    plural: 'days-of-month',
    min: 1,
    max: 31,
  ),
  CronField.month: _FieldMeta(
    label: 'month',
    singular: 'month',
    plural: 'months',
    min: 1,
    max: 12,
    names: _monthNames,
    nameExample: 'JAN',
    displayNames: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
  ),
  CronField.dayOfWeek: _FieldMeta(
    label: 'day-of-week',
    singular: 'day-of-week',
    plural: 'days-of-week',
    min: 0,
    // 7 is the second legal spelling of Sunday.
    max: 7,
    names: _dayNames,
    nameExample: 'MON',
    displayNames: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  ),
};

_FieldMeta _metaOf(CronField field) => _metas[field]!;
