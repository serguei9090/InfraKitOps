import 'package:flutter_test/flutter_test.dart';
import 'package:infrakit_studio/core/config/crontab_builder.dart';

void main() {
  const builder = CrontabBuilder();

  group('build', () {
    test('every-field default produces the every-minute expression', () {
      expect(builder.build(const CrontabBuildInput()), '* * * * *');
    });

    test('builds weekday-morning schedule from structured input', () {
      final expression = builder.build(
        const CrontabBuildInput(
          minute: CronFieldSpec.values([0]),
          hour: CronFieldSpec.values([9]),
          dayOfWeek: CronFieldSpec.range(1, 5),
        ),
      );

      expect(expression, '0 9 * * 1-5');
    });

    test('renders lists sorted and de-duplicated, ranges and steps', () {
      expect(
        builder.build(
          const CrontabBuildInput(
            minute: CronFieldSpec.values([30, 0, 30, 15]),
            hour: CronFieldSpec.step(6),
            dayOfMonth: CronFieldSpec.range(1, 15),
            month: CronFieldSpec.rangeStep(1, 12, 3),
          ),
        ),
        '0,15,30 */6 1-15 1-12/3 *',
      );
    });

    test('step of 1 collapses back to a plain star', () {
      expect(builder.build(const CrontabBuildInput(minute: CronFieldSpec.step(1))), '* * * * *');
    });

    test('rejects out-of-range structured input', () {
      expect(
        () => builder.build(const CrontabBuildInput(minute: CronFieldSpec.values([60]))),
        throwsA(isA<ArgumentError>()),
      );
      expect(() => builder.build(const CrontabBuildInput(hour: CronFieldSpec.range(0, 24))), throwsArgumentError);
      expect(
        () => builder.build(const CrontabBuildInput(dayOfMonth: CronFieldSpec.values([0]))),
        throwsArgumentError,
      );
      expect(() => builder.build(const CrontabBuildInput(month: CronFieldSpec.values([13]))), throwsArgumentError);
      expect(() => builder.build(const CrontabBuildInput(dayOfWeek: CronFieldSpec.values([8]))), throwsArgumentError);
      expect(() => builder.build(const CrontabBuildInput(minute: CronFieldSpec.values([]))), throwsArgumentError);
      expect(() => builder.build(const CrontabBuildInput(hour: CronFieldSpec.range(10, 2))), throwsArgumentError);
    });

    test('day-of-week accepts both 0 and 7 for Sunday', () {
      expect(builder.build(const CrontabBuildInput(dayOfWeek: CronFieldSpec.values([0]))), '* * * * 0');
      expect(builder.build(const CrontabBuildInput(dayOfWeek: CronFieldSpec.values([7]))), '* * * * 7');
      expect(builder.parse('* * * * 7').dayOfWeek.values, {0});
      expect(builder.parse('* * * * 0').dayOfWeek.values, {0});
    });
  });

  group('round-trip build -> explain', () {
    test('weekday 09:00 explains in plain English', () {
      final expression = builder.build(
        const CrontabBuildInput(
          minute: CronFieldSpec.values([0]),
          hour: CronFieldSpec.values([9]),
          dayOfWeek: CronFieldSpec.range(1, 5),
        ),
      );

      expect(expression, '0 9 * * 1-5');
      expect(builder.explain(expression), 'At 09:00 on Monday through Friday');
    });

    test('quarter-hourly explains as an interval', () {
      final expression = builder.build(const CrontabBuildInput(minute: CronFieldSpec.step(15)));
      expect(expression, '*/15 * * * *');
      expect(builder.explain(expression), 'Every 15 minutes');
    });

    test('monthly-in-a-month-range round-trips through explain', () {
      final expression = builder.build(
        const CrontabBuildInput(
          minute: CronFieldSpec.values([30]),
          hour: CronFieldSpec.values([2]),
          dayOfMonth: CronFieldSpec.values([1]),
          month: CronFieldSpec.range(1, 3),
        ),
      );

      expect(expression, '30 2 1 1-3 *');
      expect(builder.explain(expression), 'At 02:30 on day-of-month 1 in January through March');
    });

    test('multiple explicit times are listed', () {
      final expression = builder.build(
        const CrontabBuildInput(minute: CronFieldSpec.values([0]), hour: CronFieldSpec.values([9, 17])),
      );
      expect(expression, '0 9,17 * * *');
      expect(builder.explain(expression), 'At 09:00 and 17:00');
    });
  });

  group('explain', () {
    test('every minute', () {
      expect(builder.explain('* * * * *'), 'Every minute');
    });

    test('minute past every hour', () {
      expect(builder.explain('5 * * * *'), 'At minute 5 of every hour');
    });

    test('understands month and day names, case-insensitively', () {
      expect(builder.explain('0 0 * JAN mon'), 'At 00:00 in January on Monday');
      expect(builder.parse('0 0 * jan-mar MON-FRI').month.values, {1, 2, 3});
      expect(builder.parse('0 0 * * SUN').dayOfWeek.values, {0});
    });

    test('falls back to a field-by-field description for complex fields', () {
      final text = builder.explain('*/10 9-17 * * *');
      expect(text, contains('every 10 minutes'));
      expect(text, contains('9 through 17'));
    });
  });

  group('shortcuts', () {
    test('@reboot has no wall-clock schedule', () {
      final result = builder.describe('@reboot', from: DateTime.utc(2026, 1, 1));
      expect(result.isReboot, isTrue);
      expect(result.expression, '@reboot');
      expect(result.nextRuns, isEmpty);
      expect(result.description, contains('startup'));
    });

    test('@yearly and @annually both expand to Jan 1 midnight', () {
      expect(builder.expandShortcut('@yearly'), '0 0 1 1 *');
      expect(builder.expandShortcut('@annually'), '0 0 1 1 *');
      expect(builder.parse('@yearly').expression, '0 0 1 1 *');
      expect(builder.explain('@annually'), 'At 00:00 on day-of-month 1 in January');
    });

    test('@monthly expands to the first of every month', () {
      expect(builder.parse('@monthly').expression, '0 0 1 * *');
      expect(builder.explain('@monthly'), 'At 00:00 on day-of-month 1');
    });

    test('@weekly expands to Sunday midnight', () {
      expect(builder.parse('@weekly').expression, '0 0 * * 0');
      expect(builder.explain('@weekly'), 'At 00:00 on Sunday');
    });

    test('@daily and @midnight both expand to midnight every day', () {
      expect(builder.parse('@daily').expression, '0 0 * * *');
      expect(builder.parse('@midnight').expression, '0 0 * * *');
      expect(builder.explain('@daily'), 'At 00:00');
    });

    test('@hourly expands to the top of every hour', () {
      expect(builder.parse('@hourly').expression, '0 * * * *');
      expect(builder.explain('@hourly'), 'At minute 0 of every hour');
    });

    test('shortcut casing is ignored', () {
      expect(builder.parse('@DAILY').expression, '0 0 * * *');
    });

    test('unknown shortcut is rejected', () {
      expect(() => builder.parse('@fortnightly'), throwsFormatException);
    });
  });

  group('day-of-month / day-of-week OR semantics', () {
    // The classic cron gotcha: when NEITHER the day-of-month nor the
    // day-of-week field is `*`, cron fires when EITHER matches, not both.
    // `0 0 13 * 5` therefore means "every Friday AND every 13th", which in
    // July 2026 is the 3rd, 10th, 13th, 17th, 24th and 31st — NOT just
    // Friday the 13th (there is no Friday the 13th in July 2026 at all).
    test('both restricted => OR, not AND', () {
      final runs = builder.nextRunTimes('0 0 13 * 5', DateTime.utc(2026, 7, 1), 6);

      expect(runs, [
        DateTime.utc(2026, 7, 3), // Friday
        DateTime.utc(2026, 7, 10), // Friday
        DateTime.utc(2026, 7, 13), // Monday the 13th - matched by day-of-month
        DateTime.utc(2026, 7, 17), // Friday
        DateTime.utc(2026, 7, 24), // Friday
        DateTime.utc(2026, 7, 31), // Friday
      ]);

      // Explicit sanity check that AND semantics would have been wrong.
      expect(runs.contains(DateTime.utc(2026, 7, 13)), isTrue);
      expect(DateTime.utc(2026, 7, 13).weekday, DateTime.monday);
    });

    test('day-of-week star => AND (day-of-month alone decides)', () {
      final runs = builder.nextRunTimes('0 0 13 * *', DateTime.utc(2026, 7, 1), 3);
      expect(runs, [DateTime.utc(2026, 7, 13), DateTime.utc(2026, 8, 13), DateTime.utc(2026, 9, 13)]);
    });

    test('day-of-month star => AND (day-of-week alone decides)', () {
      final runs = builder.nextRunTimes('0 0 * * 5', DateTime.utc(2026, 7, 1), 3);
      expect(runs, [DateTime.utc(2026, 7, 3), DateTime.utc(2026, 7, 10), DateTime.utc(2026, 7, 17)]);
    });

    test('the OR case is flagged in the explanation', () {
      expect(builder.explain('0 0 13 * 5'), contains('EITHER'));
      expect(builder.explain('0 0 13 * *'), isNot(contains('EITHER')));
    });
  });

  group('next run times', () {
    test('crosses a month boundary', () {
      final runs = builder.nextRunTimes('0 0 * * *', DateTime.utc(2026, 1, 30, 12), 4);
      expect(runs, [
        DateTime.utc(2026, 1, 31),
        DateTime.utc(2026, 2, 1),
        DateTime.utc(2026, 2, 2),
        DateTime.utc(2026, 2, 3),
      ]);
    });

    test('crosses a year boundary and honours a 31-day-only schedule', () {
      final runs = builder.nextRunTimes('0 3 31 * *', DateTime.utc(2026, 11, 15), 3);
      expect(runs, [
        DateTime.utc(2026, 12, 31, 3),
        DateTime.utc(2027, 1, 31, 3),
        DateTime.utc(2027, 3, 31, 3), // February has no 31st
      ]);
    });

    test('leap-day schedule skips non-leap years without hanging', () {
      final runs = builder.nextRunTimes('0 0 29 2 *', DateTime.utc(2026, 3, 1), 2);
      expect(runs, [DateTime.utc(2028, 2, 29), DateTime.utc(2032, 2, 29)]);
    });

    test('unsatisfiable schedule returns empty instead of looping forever', () {
      expect(builder.nextRunTimes('0 0 30 2 *', DateTime.utc(2026, 1, 1), 1), isEmpty);
    });

    test('UTC input stays UTC and is DST-agnostic', () {
      // 02:30 daily across the northern-hemisphere DST switch. In UTC there
      // is no switch at all, so every run is exactly 24h apart.
      final runs = builder.nextRunTimes('30 2 * * *', DateTime.utc(2026, 3, 7, 12), 4);

      expect(runs.every((r) => r.isUtc), isTrue);
      expect(runs, [
        DateTime.utc(2026, 3, 8, 2, 30),
        DateTime.utc(2026, 3, 9, 2, 30),
        DateTime.utc(2026, 3, 10, 2, 30),
        DateTime.utc(2026, 3, 11, 2, 30),
      ]);
      for (var i = 1; i < runs.length; i++) {
        expect(runs[i].difference(runs[i - 1]), const Duration(hours: 24));
      }
    });

    test('results are strictly after the start instant', () {
      final runs = builder.nextRunTimes('0 0 * * *', DateTime.utc(2026, 5, 4), 1);
      expect(runs.single, DateTime.utc(2026, 5, 5));
    });

    test('steps and lists resolve within the hour', () {
      final runs = builder.nextRunTimes('0,15,30,45 * * * *', DateTime.utc(2026, 5, 4, 10, 20), 3);
      expect(runs, [
        DateTime.utc(2026, 5, 4, 10, 30),
        DateTime.utc(2026, 5, 4, 10, 45),
        DateTime.utc(2026, 5, 4, 11, 0),
      ]);
    });

    test('local-time input stays local', () {
      final runs = builder.nextRunTimes('0 0 * * *', DateTime(2026, 5, 4, 12), 1);
      expect(runs.single.isUtc, isFalse);
      expect(runs.single, DateTime(2026, 5, 5));
    });

    test('count of zero or less yields nothing', () {
      expect(builder.nextRunTimes('* * * * *', DateTime.utc(2026, 1, 1), 0), isEmpty);
    });
  });

  group('invalid expressions', () {
    test('wrong field count', () {
      expect(() => builder.parse('* * * *'), throwsFormatException);
      expect(() => builder.parse('* * * * * *'), throwsFormatException);
    });

    test('empty input', () {
      expect(() => builder.parse('   '), throwsFormatException);
    });

    test('minute out of range', () {
      expect(() => builder.parse('60 * * * *'), throwsFormatException);
    });

    test('hour out of range', () {
      expect(() => builder.parse('0 24 * * *'), throwsFormatException);
    });

    test('day-of-month out of range', () {
      expect(() => builder.parse('0 0 32 * *'), throwsFormatException);
      expect(() => builder.parse('0 0 0 * *'), throwsFormatException);
    });

    test('month out of range', () {
      expect(() => builder.parse('0 0 1 13 *'), throwsFormatException);
    });

    test('day-of-week out of range', () {
      expect(() => builder.parse('0 0 * * 8'), throwsFormatException);
    });

    test('unknown name', () {
      expect(() => builder.parse('0 0 * SMARCH *'), throwsFormatException);
      expect(() => builder.parse('0 0 * * FUNDAY'), throwsFormatException);
    });

    test('malformed step', () {
      expect(() => builder.parse('*/0 * * * *'), throwsFormatException);
      expect(() => builder.parse('*/abc * * * *'), throwsFormatException);
      expect(() => builder.parse('/5 * * * *'), throwsFormatException);
      expect(() => builder.parse('*/99 * * * *'), throwsFormatException);
    });

    test('inverted range', () {
      expect(() => builder.parse('0 0 * * 5-1'), throwsFormatException);
    });

    test('empty list item', () {
      expect(() => builder.parse('0,,5 * * * *'), throwsFormatException);
    });

    test('error messages name the offending field', () {
      expect(
        () => builder.parse('0 0 32 * *'),
        throwsA(isA<FormatException>().having((e) => e.message, 'message', contains('day-of-month'))),
      );
    });
  });

  group('execute (IToolUseCase)', () {
    test('returns expression, description and next runs together', () {
      final result = const CrontabBuilder().execute(
        CrontabBuildInput(
          minute: const CronFieldSpec.values([0]),
          hour: const CronFieldSpec.values([9]),
          dayOfWeek: const CronFieldSpec.range(1, 5),
          from: DateTime.utc(2026, 7, 1, 12),
          nextRunCount: 3,
        ),
      );

      expect(result.expression, '0 9 * * 1-5');
      expect(result.description, 'At 09:00 on Monday through Friday');
      expect(result.isReboot, isFalse);
      expect(result.nextRuns, [
        DateTime.utc(2026, 7, 2, 9), // Thursday
        DateTime.utc(2026, 7, 3, 9), // Friday
        DateTime.utc(2026, 7, 6, 9), // Monday (weekend skipped)
      ]);
    });
  });
}
