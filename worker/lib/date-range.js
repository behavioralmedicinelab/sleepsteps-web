// Dates for the admin pages (SPEC §14.4): UTC calendar days, parsing and the
// two ranges (the summary's and an export's). Imports no JSON, so Node can
// load this module too. Pure: every function takes `nowMs` instead of
// reading the clock.
//
// Days are UTC calendar days (project lead, decision B2, 2026-11-07), written
// "YYYY-MM-DD", and `to` is included. A day runs from 00:00:00.000Z to the
// next day's 00:00:00.000Z, and is compared as an ISO string with the stored
// `ts`, which is always toISOString() output. There is no time-zone code
// here: every date and time the admin pages show says UTC.
//
// The summary accepts at most MAX_SUMMARY_DAYS days and defaults to the
// SUMMARY_DEFAULT_DAYS days ending today. An export covers complete days only
// (to <= yesterday), at most MAX_EXPORT_DAYS days, and defaults to the
// previous calendar month, so the monthly files follow each other with no
// gap and each holds rows that can no longer change.

/** The first and last years a date may name. Nothing was stored before 2026. */
const MIN_YEAR = 2026;
const MAX_YEAR = 2099;
export const MIN_DAY = `${MIN_YEAR}-01-01`;
export const MAX_DAY = `${MAX_YEAR}-12-31`;

/**
 * The longest summary range, in days (decision B3). A summary load reads
 * about 2.6 times the events in its range (measured locally), so the cost
 * follows traffic: at 2,000 events a day a 92-day load reads about 0.5 M
 * rows (10% of the free plan's 5 M a day for the whole account), and at
 * 5,000 a day about 1.2 M (24%). The page shows the rows it read.
 */
export const MAX_SUMMARY_DAYS = 92;

/** The summary's default range: this many days, ending today. */
export const SUMMARY_DEFAULT_DAYS = 30;

/**
 * The longest export range, in days: any calendar month fits in one file
 * (decision B5). Longer periods are downloaded a month at a time.
 */
export const MAX_EXPORT_DAYS = 31;

const DAY_MS = 86_400_000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTHS = Object.freeze([
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]);

/**
 * "YYYY-MM-DD" -> the same string if it names a real date in MIN_YEAR to
 * MAX_YEAR, or null. Exactly that form: no time, no spaces, two-digit month
 * and day.
 */
export function parseDay(text) {
  if (typeof text !== 'string') return null;
  const match = DAY_RE.exec(text);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return text;
}

/** A valid day -> the time its UTC midnight starts, in ms. */
const dayMs = (day) => Date.parse(`${day}T00:00:00.000Z`);

/** A time in ms -> its UTC day. */
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The day `n` days after `day` (before, for negative `n`). */
export const addDays = (day, n) => dayOf(dayMs(day) + n * DAY_MS);

/** How many days from `from` to `to`, both included (1 for the same day). */
export const daysIncluding = (from, to) => Math.round((dayMs(to) - dayMs(from)) / DAY_MS) + 1;

/** The ISO timestamp of `day`'s start, as stored `ts` values are written. */
export const dayStartTs = (day) => `${day}T00:00:00.000Z`;

/** Today's UTC day. */
export const todayDay = (nowMs) => dayOf(nowMs);

/** The first and last days of the calendar month before `nowMs`'s. */
export function previousMonth(nowMs) {
  const now = new Date(nowMs);
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { from: dayOf(first.getTime()), to: dayOf(last.getTime()) };
}

/** The range's bounds as stored timestamps: `start` included, `end` (the day after `to`) excluded. */
const bounds = (from, to) => ({ start: dayStartTs(from), end: dayStartTs(addDays(to, 1)) });

/** A query parameter, with an empty value (a cleared date field) read as absent. */
function param(params, name) {
  const value = params?.get?.(name);
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * The summary page's range, from the `from` and `to` query parameters.
 *
 * Both absent: the SUMMARY_DEFAULT_DAYS days ending today. `to` absent:
 * today. `from` absent: the SUMMARY_DEFAULT_DAYS days ending on `to`, but
 * never before MIN_DAY (the date field's min).
 *
 * @param {URLSearchParams} params
 * @param {number} nowMs
 * @returns {{ ok: true, from: string, to: string, start: string, end: string, days: number, isDefault: boolean, today: string }
 *   | { ok: false, from: string | null, to: string | null, today: string, errors: Array<{ field: 'from' | 'to', code: string }> }}
 *   On failure `from` and `to` are the values that passed parseDay (else
 *   null), so a raw parameter is never echoed. The codes: from-invalid,
 *   to-invalid, future (`to` after today), order (`from` after `to`) and
 *   too-long (over MAX_SUMMARY_DAYS days).
 */
export function summaryRange(params, nowMs) {
  const today = todayDay(nowMs);
  const rawFrom = param(params, 'from');
  const rawTo = param(params, 'to');
  const isDefault = rawFrom === null && rawTo === null;

  let from = rawFrom === null ? null : parseDay(rawFrom);
  const to = rawTo === null ? today : parseDay(rawTo);
  const errors = [];
  if (rawFrom !== null && from === null) errors.push({ field: 'from', code: 'from-invalid' });
  if (to === null) errors.push({ field: 'to', code: 'to-invalid' });
  if (errors.length > 0) return { ok: false, from, to, today, errors };

  if (from === null) {
    const start = addDays(to, 1 - SUMMARY_DEFAULT_DAYS);
    from = start < MIN_DAY ? MIN_DAY : start;
  }
  let error = null;
  if (to > today) error = { field: 'to', code: 'future' };
  else if (from > to) error = { field: 'from', code: 'order' };
  else if (daysIncluding(from, to) > MAX_SUMMARY_DAYS) error = { field: 'from', code: 'too-long' };
  if (error) return { ok: false, from, to, today, errors: [error] };

  return { ok: true, from, to, ...bounds(from, to), days: daysIncluding(from, to), isDefault, today };
}

/**
 * An export's range, from the `from` and `to` query parameters: both absent
 * means the previous calendar month; otherwise both must be valid days, with
 * from <= to <= yesterday and at most MAX_EXPORT_DAYS days.
 * @returns {{ ok: true, from: string, to: string, start: string, end: string }
 *   | { ok: false, error: 'one-date' | 'date' | 'order' | 'incomplete' | 'too-long' }}
 */
export function exportRange(params, nowMs) {
  const rawFrom = param(params, 'from');
  const rawTo = param(params, 'to');
  let from;
  let to;
  if (rawFrom === null && rawTo === null) {
    ({ from, to } = previousMonth(nowMs));
  } else if (rawFrom === null || rawTo === null) {
    return { ok: false, error: 'one-date' };
  } else {
    from = parseDay(rawFrom);
    to = parseDay(rawTo);
    if (from === null || to === null) return { ok: false, error: 'date' };
  }
  if (from > to) return { ok: false, error: 'order' };
  if (to >= todayDay(nowMs)) return { ok: false, error: 'incomplete' };
  if (daysIncluding(from, to) > MAX_EXPORT_DAYS) return { ok: false, error: 'too-long' };
  return { ok: true, from, to, ...bounds(from, to) };
}

/**
 * The export ranges that cover a summary range's complete days: `from` to
 * min(`to`, yesterday), as one range if it is at most MAX_EXPORT_DAYS days,
 * otherwise split at each calendar month's end. Empty if the range starts
 * today.
 * @returns {Array<{ from: string, to: string }>}
 */
export function exportPieces(from, to, nowMs) {
  const yesterday = addDays(todayDay(nowMs), -1);
  const last = to > yesterday ? yesterday : to;
  if (from > last) return [];
  if (daysIncluding(from, last) <= MAX_EXPORT_DAYS) return [{ from, to: last }];
  const pieces = [];
  let start = from;
  while (start <= last) {
    const date = new Date(dayMs(start));
    const monthEnd = dayOf(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
    const end = monthEnd < last ? monthEnd : last;
    pieces.push({ from: start, to: end });
    start = addDays(end, 1);
  }
  return pieces;
}

// Formatting, with a fixed month table so the output never depends on the
// runtime's locale data.

const parts = (day) => day.split('-').map(Number);

/** "2026-10-09" -> "9 Oct 2026". */
export function formatDay(day) {
  const [year, month, date] = parts(day);
  return `${date} ${MONTHS[month - 1].slice(0, 3)} ${year}`;
}

/** "2026-10-09" -> "9 October 2026". */
export function formatDayLong(day) {
  const [year, month, date] = parts(day);
  return `${date} ${MONTHS[month - 1]} ${year}`;
}

/**
 * Two days, `from` <= `to` -> "9 Oct to 5 Nov 2026" (one year),
 * "28 Dec 2026 to 3 Jan 2027" (two years) or "9 Oct 2026" (one day).
 */
export function formatSpan(from, to) {
  if (from === to) return formatDay(from);
  if (parts(from)[0] !== parts(to)[0]) return `${formatDay(from)} to ${formatDay(to)}`;
  return `${formatDay(from).replace(/ \d{4}$/, '')} to ${formatDay(to)}`;
}

/** "2026-10-01" (any day of the month) -> "October 2026". */
export function formatMonth(day) {
  const [year, month] = parts(day);
  return `${MONTHS[month - 1]} ${year}`;
}

const pad = (n) => String(n).padStart(2, '0');

/** A stored hour ("2026-11-07T03:00:00.000Z") -> "7 Nov 2026, 03:00 to 04:00 UTC". */
export function formatHour(ts) {
  const ms = Date.parse(ts);
  const date = new Date(ms);
  const next = new Date(ms + 3_600_000);
  return `${formatDay(dayOf(ms))}, ${pad(date.getUTCHours())}:00 to ${pad(next.getUTCHours())}:00 UTC`;
}

/** A time in ms -> "7 Nov 2026 at 03:42 UTC". */
export function formatTime(ms) {
  const date = new Date(ms);
  return `${formatDay(dayOf(ms))} at ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}
