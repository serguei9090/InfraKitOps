import { describe, expect, it } from 'vitest'
import { cronNext, cronNextRuns, describeCron, isValidCron, parseCron } from './cron'

describe('cron', () => {
  it('rejects malformed expressions', () => {
    for (const bad of ['', '* * *', '60 * * * *', '* 24 * * *', '*/0 * * * *', 'x * * * *']) {
      expect(isValidCron(bad), bad).toBe(false)
    }
  })

  it('accepts field forms and macros', () => {
    for (const ok of ['* * * * *', '*/15 * * * *', '0 9 * * 1-5', '30 2 1,15 * *', '@daily', '0 0 * * 7']) {
      expect(isValidCron(ok), ok).toBe(true)
    }
    expect(parseCron('0 0 * * 7').dow.has(0)).toBe(true) // 7 → Sunday
  })

  it('computes the next run time (local zone)', () => {
    const base = new Date(2026, 7, 31, 10, 15, 0) // local Monday 10:15
    const q = cronNext('*/15 * * * *', base)!
    expect([q.getHours(), q.getMinutes()]).toEqual([10, 30])

    const h = cronNext('0 * * * *', base)!
    expect([h.getHours(), h.getMinutes()]).toEqual([11, 0])

    const day = cronNext('@daily', base)!
    expect([day.getDate(), day.getHours(), day.getMinutes()]).toEqual([1, 0, 0])
  })

  it('returns a run series', () => {
    const base = new Date(2026, 7, 31, 10, 15, 0)
    const runs = cronNextRuns('0 * * * *', 3, base)
    expect(runs.map((d) => d.getHours())).toEqual([11, 12, 13])
  })

  it('describes common expressions', () => {
    expect(describeCron('@daily')).toMatch(/every day/)
    expect(describeCron('*/5 * * * *')).toBe('every 5 minutes')
    expect(describeCron('30 6 * * *')).toBe('every day at 06:30')
  })
})
