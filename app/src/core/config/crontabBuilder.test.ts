import { describe, expect, it } from 'vitest'
import {
  CrontabBuilder,
  cronValues,
  cronRange,
  cronRangeStep,
  cronStep,
  utcInstant,
  localInstant,
  type CrontabInstant,
} from './crontabBuilder'

function instantsEqual(a: CrontabInstant, b: CrontabInstant): boolean {
  return a.isUtc === b.isUtc && a.date.getTime() === b.date.getTime()
}

function expectInstants(actual: CrontabInstant[], expected: CrontabInstant[]): void {
  expect(actual.length).toBe(expected.length)
  for (let i = 0; i < actual.length; i++) {
    expect(instantsEqual(actual[i], expected[i]), `instant ${i}: ${actual[i].date.toISOString()} vs ${expected[i].date.toISOString()}`).toBe(true)
  }
}

describe('CrontabBuilder', () => {
  const builder = new CrontabBuilder()

  describe('build', () => {
    it('every-field default produces the every-minute expression', () => {
      expect(builder.build({})).toBe('* * * * *')
    })

    it('builds weekday-morning schedule from structured input', () => {
      const expression = builder.build({
        minute: cronValues([0]),
        hour: cronValues([9]),
        dayOfWeek: cronRange(1, 5),
      })

      expect(expression).toBe('0 9 * * 1-5')
    })

    it('renders lists sorted and de-duplicated, ranges and steps', () => {
      expect(
        builder.build({
          minute: cronValues([30, 0, 30, 15]),
          hour: cronStep(6),
          dayOfMonth: cronRange(1, 15),
          month: cronRangeStep(1, 12, 3),
        }),
      ).toBe('0,15,30 */6 1-15 1-12/3 *')
    })

    it('step of 1 collapses back to a plain star', () => {
      expect(builder.build({ minute: cronStep(1) })).toBe('* * * * *')
    })

    it('rejects out-of-range structured input', () => {
      expect(() => builder.build({ minute: cronValues([60]) })).toThrow()
      expect(() => builder.build({ hour: cronRange(0, 24) })).toThrow()
      expect(() => builder.build({ dayOfMonth: cronValues([0]) })).toThrow()
      expect(() => builder.build({ month: cronValues([13]) })).toThrow()
      expect(() => builder.build({ dayOfWeek: cronValues([8]) })).toThrow()
      expect(() => builder.build({ minute: cronValues([]) })).toThrow()
      expect(() => builder.build({ hour: cronRange(10, 2) })).toThrow()
    })

    it('day-of-week accepts both 0 and 7 for Sunday', () => {
      expect(builder.build({ dayOfWeek: cronValues([0]) })).toBe('* * * * 0')
      expect(builder.build({ dayOfWeek: cronValues([7]) })).toBe('* * * * 7')
      expect(builder.parse('* * * * 7').dayOfWeek.values).toEqual(new Set([0]))
      expect(builder.parse('* * * * 0').dayOfWeek.values).toEqual(new Set([0]))
    })
  })

  describe('round-trip build -> explain', () => {
    it('weekday 09:00 explains in plain English', () => {
      const expression = builder.build({
        minute: cronValues([0]),
        hour: cronValues([9]),
        dayOfWeek: cronRange(1, 5),
      })

      expect(expression).toBe('0 9 * * 1-5')
      expect(builder.explain(expression)).toBe('At 09:00 on Monday through Friday')
    })

    it('quarter-hourly explains as an interval', () => {
      const expression = builder.build({ minute: cronStep(15) })
      expect(expression).toBe('*/15 * * * *')
      expect(builder.explain(expression)).toBe('Every 15 minutes')
    })

    it('monthly-in-a-month-range round-trips through explain', () => {
      const expression = builder.build({
        minute: cronValues([30]),
        hour: cronValues([2]),
        dayOfMonth: cronValues([1]),
        month: cronRange(1, 3),
      })

      expect(expression).toBe('30 2 1 1-3 *')
      expect(builder.explain(expression)).toBe('At 02:30 on day-of-month 1 in January through March')
    })

    it('multiple explicit times are listed', () => {
      const expression = builder.build({ minute: cronValues([0]), hour: cronValues([9, 17]) })
      expect(expression).toBe('0 9,17 * * *')
      expect(builder.explain(expression)).toBe('At 09:00 and 17:00')
    })
  })

  describe('explain', () => {
    it('every minute', () => {
      expect(builder.explain('* * * * *')).toBe('Every minute')
    })

    it('minute past every hour', () => {
      expect(builder.explain('5 * * * *')).toBe('At minute 5 of every hour')
    })

    it('understands month and day names, case-insensitively', () => {
      expect(builder.explain('0 0 * JAN mon')).toBe('At 00:00 in January on Monday')
      expect(builder.parse('0 0 * jan-mar MON-FRI').month.values).toEqual(new Set([1, 2, 3]))
      expect(builder.parse('0 0 * * SUN').dayOfWeek.values).toEqual(new Set([0]))
    })

    it('falls back to a field-by-field description for complex fields', () => {
      const text = builder.explain('*/10 9-17 * * *')
      expect(text).toContain('every 10 minutes')
      expect(text).toContain('9 through 17')
    })
  })

  describe('shortcuts', () => {
    it('@reboot has no wall-clock schedule', () => {
      const result = builder.describe('@reboot', { from: utcInstant(2026, 1, 1) })
      expect(result.isReboot).toBe(true)
      expect(result.expression).toBe('@reboot')
      expect(result.nextRuns).toHaveLength(0)
      expect(result.description).toContain('startup')
    })

    it('@yearly and @annually both expand to Jan 1 midnight', () => {
      expect(builder.expandShortcut('@yearly')).toBe('0 0 1 1 *')
      expect(builder.expandShortcut('@annually')).toBe('0 0 1 1 *')
      expect(builder.parse('@yearly').expression).toBe('0 0 1 1 *')
      expect(builder.explain('@annually')).toBe('At 00:00 on day-of-month 1 in January')
    })

    it('@monthly expands to the first of every month', () => {
      expect(builder.parse('@monthly').expression).toBe('0 0 1 * *')
      expect(builder.explain('@monthly')).toBe('At 00:00 on day-of-month 1')
    })

    it('@weekly expands to Sunday midnight', () => {
      expect(builder.parse('@weekly').expression).toBe('0 0 * * 0')
      expect(builder.explain('@weekly')).toBe('At 00:00 on Sunday')
    })

    it('@daily and @midnight both expand to midnight every day', () => {
      expect(builder.parse('@daily').expression).toBe('0 0 * * *')
      expect(builder.parse('@midnight').expression).toBe('0 0 * * *')
      expect(builder.explain('@daily')).toBe('At 00:00')
    })

    it('@hourly expands to the top of every hour', () => {
      expect(builder.parse('@hourly').expression).toBe('0 * * * *')
      expect(builder.explain('@hourly')).toBe('At minute 0 of every hour')
    })

    it('shortcut casing is ignored', () => {
      expect(builder.parse('@DAILY').expression).toBe('0 0 * * *')
    })

    it('unknown shortcut is rejected', () => {
      expect(() => builder.parse('@fortnightly')).toThrow()
    })
  })

  describe('day-of-month / day-of-week OR semantics', () => {
    // The classic cron gotcha: when NEITHER the day-of-month nor the
    // day-of-week field is `*`, cron fires when EITHER matches, not both.
    // `0 0 13 * 5` therefore means "every Friday AND every 13th", which in
    // July 2026 is the 3rd, 10th, 13th, 17th, 24th and 31st — NOT just
    // Friday the 13th (there is no Friday the 13th in July 2026 at all).
    it('both restricted => OR, not AND', () => {
      const runs = builder.nextRunTimes('0 0 13 * 5', utcInstant(2026, 7, 1), 6)

      expectInstants(runs, [
        utcInstant(2026, 7, 3), // Friday
        utcInstant(2026, 7, 10), // Friday
        utcInstant(2026, 7, 13), // Monday the 13th - matched by day-of-month
        utcInstant(2026, 7, 17), // Friday
        utcInstant(2026, 7, 24), // Friday
        utcInstant(2026, 7, 31), // Friday
      ])

      // Explicit sanity check that AND semantics would have been wrong.
      expect(runs.some((r) => instantsEqual(r, utcInstant(2026, 7, 13)))).toBe(true)
      expect(new Date(Date.UTC(2026, 6, 13)).getUTCDay()).toBe(1) // Monday
    })

    it('day-of-week star => AND (day-of-month alone decides)', () => {
      const runs = builder.nextRunTimes('0 0 13 * *', utcInstant(2026, 7, 1), 3)
      expectInstants(runs, [utcInstant(2026, 7, 13), utcInstant(2026, 8, 13), utcInstant(2026, 9, 13)])
    })

    it('day-of-month star => AND (day-of-week alone decides)', () => {
      const runs = builder.nextRunTimes('0 0 * * 5', utcInstant(2026, 7, 1), 3)
      expectInstants(runs, [utcInstant(2026, 7, 3), utcInstant(2026, 7, 10), utcInstant(2026, 7, 17)])
    })

    it('the OR case is flagged in the explanation', () => {
      expect(builder.explain('0 0 13 * 5')).toContain('EITHER')
      expect(builder.explain('0 0 13 * *')).not.toContain('EITHER')
    })
  })

  describe('next run times', () => {
    it('crosses a month boundary', () => {
      const runs = builder.nextRunTimes('0 0 * * *', utcInstant(2026, 1, 30, 12), 4)
      expectInstants(runs, [
        utcInstant(2026, 1, 31),
        utcInstant(2026, 2, 1),
        utcInstant(2026, 2, 2),
        utcInstant(2026, 2, 3),
      ])
    })

    it('crosses a year boundary and honours a 31-day-only schedule', () => {
      const runs = builder.nextRunTimes('0 3 31 * *', utcInstant(2026, 11, 15), 3)
      expectInstants(runs, [
        utcInstant(2026, 12, 31, 3),
        utcInstant(2027, 1, 31, 3),
        utcInstant(2027, 3, 31, 3), // February has no 31st
      ])
    })

    it('leap-day schedule skips non-leap years without hanging', () => {
      const runs = builder.nextRunTimes('0 0 29 2 *', utcInstant(2026, 3, 1), 2)
      expectInstants(runs, [utcInstant(2028, 2, 29), utcInstant(2032, 2, 29)])
    })

    it('unsatisfiable schedule returns empty instead of looping forever', () => {
      expect(builder.nextRunTimes('0 0 30 2 *', utcInstant(2026, 1, 1), 1)).toHaveLength(0)
    })

    it('UTC input stays UTC and is DST-agnostic', () => {
      // 02:30 daily across the northern-hemisphere DST switch. In UTC there
      // is no switch at all, so every run is exactly 24h apart.
      const runs = builder.nextRunTimes('30 2 * * *', utcInstant(2026, 3, 7, 12), 4)

      expect(runs.every((r) => r.isUtc)).toBe(true)
      expectInstants(runs, [
        utcInstant(2026, 3, 8, 2, 30),
        utcInstant(2026, 3, 9, 2, 30),
        utcInstant(2026, 3, 10, 2, 30),
        utcInstant(2026, 3, 11, 2, 30),
      ])
      for (let i = 1; i < runs.length; i++) {
        expect(runs[i].date.getTime() - runs[i - 1].date.getTime()).toBe(24 * 60 * 60 * 1000)
      }
    })

    it('results are strictly after the start instant', () => {
      const runs = builder.nextRunTimes('0 0 * * *', utcInstant(2026, 5, 4), 1)
      expect(instantsEqual(runs[0], utcInstant(2026, 5, 5))).toBe(true)
    })

    it('steps and lists resolve within the hour', () => {
      const runs = builder.nextRunTimes('0,15,30,45 * * * *', utcInstant(2026, 5, 4, 10, 20), 3)
      expectInstants(runs, [
        utcInstant(2026, 5, 4, 10, 30),
        utcInstant(2026, 5, 4, 10, 45),
        utcInstant(2026, 5, 4, 11, 0),
      ])
    })

    it('local-time input stays local', () => {
      const runs = builder.nextRunTimes('0 0 * * *', localInstant(2026, 5, 4, 12), 1)
      expect(runs[0].isUtc).toBe(false)
      expect(instantsEqual(runs[0], localInstant(2026, 5, 5))).toBe(true)
    })

    it('count of zero or less yields nothing', () => {
      expect(builder.nextRunTimes('* * * * *', utcInstant(2026, 1, 1), 0)).toHaveLength(0)
    })
  })

  describe('invalid expressions', () => {
    it('wrong field count', () => {
      expect(() => builder.parse('* * * *')).toThrow()
      expect(() => builder.parse('* * * * * *')).toThrow()
    })

    it('empty input', () => {
      expect(() => builder.parse('   ')).toThrow()
    })

    it('minute out of range', () => {
      expect(() => builder.parse('60 * * * *')).toThrow()
    })

    it('hour out of range', () => {
      expect(() => builder.parse('0 24 * * *')).toThrow()
    })

    it('day-of-month out of range', () => {
      expect(() => builder.parse('0 0 32 * *')).toThrow()
      expect(() => builder.parse('0 0 0 * *')).toThrow()
    })

    it('month out of range', () => {
      expect(() => builder.parse('0 0 1 13 *')).toThrow()
    })

    it('day-of-week out of range', () => {
      expect(() => builder.parse('0 0 * * 8')).toThrow()
    })

    it('unknown name', () => {
      expect(() => builder.parse('0 0 * SMARCH *')).toThrow()
      expect(() => builder.parse('0 0 * * FUNDAY')).toThrow()
    })

    it('malformed step', () => {
      expect(() => builder.parse('*/0 * * * *')).toThrow()
      expect(() => builder.parse('*/abc * * * *')).toThrow()
      expect(() => builder.parse('/5 * * * *')).toThrow()
      expect(() => builder.parse('*/99 * * * *')).toThrow()
    })

    it('inverted range', () => {
      expect(() => builder.parse('0 0 * * 5-1')).toThrow()
    })

    it('empty list item', () => {
      expect(() => builder.parse('0,,5 * * * *')).toThrow()
    })

    it('error messages name the offending field', () => {
      expect(() => builder.parse('0 0 32 * *')).toThrow(/day-of-month/)
    })
  })

  describe('execute (IToolUseCase)', () => {
    it('returns expression, description and next runs together', () => {
      const result = new CrontabBuilder().execute({
        minute: cronValues([0]),
        hour: cronValues([9]),
        dayOfWeek: cronRange(1, 5),
        from: utcInstant(2026, 7, 1, 12),
        nextRunCount: 3,
      })

      expect(result.expression).toBe('0 9 * * 1-5')
      expect(result.description).toBe('At 09:00 on Monday through Friday')
      expect(result.isReboot).toBe(false)
      expectInstants(result.nextRuns, [
        utcInstant(2026, 7, 2, 9), // Thursday
        utcInstant(2026, 7, 3, 9), // Friday
        utcInstant(2026, 7, 6, 9), // Monday (weekend skipped)
      ])
    })
  })
})
