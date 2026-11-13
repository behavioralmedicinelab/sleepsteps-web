// worker/lib/date-range.js: UTC days for the admin pages (SPEC §14.4,
// decisions B2, B3 and B5): parsing, the summary's and an export's ranges,
// and the formatting.
import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayStartTs,
  daysIncluding,
  exportPieces,
  exportRange,
  formatDay,
  formatDayLong,
  formatHour,
  formatMonth,
  formatSpan,
  formatTime,
  MAX_EXPORT_DAYS,
  MAX_SUMMARY_DAYS,
  MIN_DAY,
  parseDay,
  previousMonth,
  SUMMARY_DEFAULT_DAYS,
  summaryRange,
  todayDay,
} from '../../worker/lib/date-range.js';

const NOW = Date.parse('2026-11-06T13:30:00.000Z');
const q = (text) => new URLSearchParams(text);

describe('days', () => {
  it('are UTC calendar days, each from 00:00:00.000Z', () => {
    expect(dayStartTs('2026-10-04')).toBe('2026-10-04T00:00:00.000Z');
    expect(todayDay(NOW)).toBe('2026-11-06');
    expect(todayDay(Date.parse('2026-11-06T23:59:59.999Z'))).toBe('2026-11-06');
    expect(todayDay(Date.parse('2026-11-07T00:00:00.000Z'))).toBe('2026-11-07');
    // No daylight-saving day is 23 or 25 hours long in UTC.
    for (const day of ['2026-10-04', '2027-04-04', '2026-11-06']) {
      expect(Date.parse(dayStartTs(addDays(day, 1))) - Date.parse(dayStartTs(day))).toBe(86_400_000);
    }
  });

  it('add and count across months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysIncluding('2026-11-06', '2026-11-06')).toBe(1);
    expect(daysIncluding('2026-10-01', '2026-10-31')).toBe(31);
  });

  it('parse only real YYYY-MM-DD dates from 2026 to 2099', () => {
    for (const good of ['2026-01-01', '2028-02-29', '2099-12-31', '2026-11-07']) expect(parseDay(good), good).toBe(good);
    for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '2026-01-00', '2026-1-01', '2026-01-1', ' 2026-01-01', '2026-01-01 ', '0099-01-01', '2025-12-31', '2100-01-01', '2026-11-07T00:00', '20261107', '2026/11/07', '', null, undefined, 20261107]) {
      expect(parseDay(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('give the previous calendar month', () => {
    expect(previousMonth(NOW)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(previousMonth(Date.parse('2027-01-01T00:00:00.000Z'))).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(previousMonth(Date.parse('2028-03-31T23:59:59.999Z'))).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('summaryRange', () => {
  it('defaults to the 30 days ending today, today included', () => {
    expect(SUMMARY_DEFAULT_DAYS).toBe(30);
    expect(summaryRange(q(''), NOW)).toEqual({
      ok: true,
      from: '2026-10-08',
      to: '2026-11-06',
      start: '2026-10-08T00:00:00.000Z',
      end: '2026-11-07T00:00:00.000Z',
      days: 30,
      isDefault: true,
      today: '2026-11-06',
    });
    // Empty fields (a cleared form) count as absent.
    expect(summaryRange(q('from=&to='), NOW)).toMatchObject({ ok: true, from: '2026-10-08', to: '2026-11-06', isDefault: true });
  });

  it('fills in a missing end with today, and a missing start with 30 days before the end (never before 2026)', () => {
    expect(summaryRange(q('to=2026-01-31'), NOW)).toMatchObject({ ok: true, from: '2026-01-02', to: '2026-01-31', isDefault: false });
    expect(summaryRange(q('to=2026-01-10'), NOW)).toMatchObject({ ok: true, from: MIN_DAY, to: '2026-01-10' });
    expect(summaryRange(q('from=2026-11-01'), NOW)).toMatchObject({ ok: true, from: '2026-11-01', to: '2026-11-06' });
  });

  it('takes the end day whole: to=2026-12-31 ends at 2027-01-01T00:00Z', () => {
    const range = summaryRange(q('from=2026-12-01&to=2026-12-31'), Date.parse('2027-01-05T00:00:00.000Z'));
    expect([range.start, range.end, range.days]).toEqual(['2026-12-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z', 31]);
  });

  it(`accepts at most ${MAX_SUMMARY_DAYS} days`, () => {
    expect(MAX_SUMMARY_DAYS).toBe(92);
    expect(summaryRange(q('from=2026-08-07&to=2026-11-06'), NOW)).toMatchObject({ ok: true, days: 92 });
    expect(summaryRange(q('from=2026-08-06&to=2026-11-06'), NOW)).toEqual({
      ok: false,
      from: '2026-08-06',
      to: '2026-11-06',
      today: '2026-11-06',
      errors: [{ field: 'from', code: 'too-long' }],
    });
  });

  it('puts each error on its field, and returns only dates that passed', () => {
    const errors = (text) => summaryRange(q(text), NOW);
    expect(errors('from=2026-02-30&to=2026-11-01')).toEqual({ ok: false, from: null, to: '2026-11-01', today: '2026-11-06', errors: [{ field: 'from', code: 'from-invalid' }] });
    expect(errors('from=%22%3E%3Cb%3E&to=nope')).toEqual({
      ok: false,
      from: null,
      to: null,
      today: '2026-11-06',
      errors: [
        { field: 'from', code: 'from-invalid' },
        { field: 'to', code: 'to-invalid' },
      ],
    });
    expect(errors('from=2026-11-01&to=2026-11-07').errors).toEqual([{ field: 'to', code: 'future' }]);
    expect(errors('from=2026-11-05&to=2026-11-01').errors).toEqual([{ field: 'from', code: 'order' }]);
    expect(errors('from=2026-11-07').errors).toEqual([{ field: 'from', code: 'order' }]);
    expect(errors('to=2025-12-31').errors).toEqual([{ field: 'to', code: 'to-invalid' }]);
  });
});

describe('exportRange', () => {
  it('defaults to the previous calendar month', () => {
    expect(exportRange(q(''), NOW)).toEqual({
      ok: true,
      from: '2026-10-01',
      to: '2026-10-31',
      start: '2026-10-01T00:00:00.000Z',
      end: '2026-11-01T00:00:00.000Z',
    });
  });

  it('covers complete days only: the end is yesterday at the latest', () => {
    expect(exportRange(q('from=2026-11-01&to=2026-11-05'), NOW)).toMatchObject({ ok: true, to: '2026-11-05' });
    expect(exportRange(q('from=2026-11-01&to=2026-11-06'), NOW)).toEqual({ ok: false, error: 'incomplete' });
    expect(exportRange(q('from=2026-11-07&to=2026-11-07'), NOW)).toEqual({ ok: false, error: 'incomplete' });
  });

  it(`accepts at most ${MAX_EXPORT_DAYS} days, so any calendar month fits`, () => {
    expect(MAX_EXPORT_DAYS).toBe(31);
    expect(daysIncluding('2026-08-01', '2026-08-31')).toBe(31);
    expect(exportRange(q('from=2026-08-01&to=2026-08-31'), NOW)).toMatchObject({ ok: true, from: '2026-08-01', to: '2026-08-31' });
    expect(exportRange(q('from=2026-08-01&to=2026-09-01'), NOW)).toEqual({ ok: false, error: 'too-long' });
  });

  it('needs both dates or neither, real ones, in order', () => {
    expect(exportRange(q('from=2026-10-01'), NOW)).toEqual({ ok: false, error: 'one-date' });
    expect(exportRange(q('to=2026-10-31'), NOW)).toEqual({ ok: false, error: 'one-date' });
    expect(exportRange(q('from=2026-10-01&to='), NOW)).toEqual({ ok: false, error: 'one-date' });
    expect(exportRange(q('from=2026-10-1&to=2026-10-31'), NOW)).toEqual({ ok: false, error: 'date' });
    expect(exportRange(q('from=2026-10-31&to=2026-10-01'), NOW)).toEqual({ ok: false, error: 'order' });
  });
});

describe('exportPieces', () => {
  it('gives one download for a range of up to 31 complete days, ending yesterday', () => {
    expect(exportPieces('2026-10-08', '2026-11-06', NOW)).toEqual([{ from: '2026-10-08', to: '2026-11-05' }]);
    expect(exportPieces('2026-11-06', '2026-11-06', NOW)).toEqual([]);
  });

  it('splits a longer range at the end of each month', () => {
    expect(exportPieces('2026-08-07', '2026-11-06', NOW)).toEqual([
      { from: '2026-08-07', to: '2026-08-31' },
      { from: '2026-09-01', to: '2026-09-30' },
      { from: '2026-10-01', to: '2026-10-31' },
      { from: '2026-11-01', to: '2026-11-05' },
    ]);
    for (const piece of exportPieces('2026-02-15', '2026-05-14', NOW)) {
      expect(exportRange(q(`from=${piece.from}&to=${piece.to}`), NOW).ok, piece.from).toBe(true);
    }
  });
});

describe('formatting (always UTC, no locale data)', () => {
  it('formats days and months', () => {
    expect(formatDay('2026-10-09')).toBe('9 Oct 2026');
    expect(formatDayLong('2026-10-09')).toBe('9 October 2026');
    expect(formatMonth('2026-10-31')).toBe('October 2026');
  });

  it('formats a span of days, naming a shared year once', () => {
    expect(formatSpan('2026-10-09', '2026-10-09')).toBe('9 Oct 2026');
    expect(formatSpan('2026-10-09', '2026-11-05')).toBe('9 Oct to 5 Nov 2026');
    expect(formatSpan('2026-12-28', '2027-01-03')).toBe('28 Dec 2026 to 3 Jan 2027');
  });

  it('formats a stored hour and a time, saying UTC', () => {
    expect(formatHour('2026-11-07T03:00:00.000Z')).toBe('7 Nov 2026, 03:00 to 04:00 UTC');
    expect(formatHour('2026-11-07T23:00:00.000Z')).toBe('7 Nov 2026, 23:00 to 00:00 UTC');
    expect(formatTime(Date.parse('2026-11-07T14:42:59.000Z'))).toBe('7 Nov 2026 at 14:42 UTC');
  });
});
