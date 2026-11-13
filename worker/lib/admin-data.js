// The admin pages' data layer (SPEC §14.4): reading D1 and shaping the rows,
// with no HTML, no Response and no env. Imports no JSON, so Node can load
// this module too. The SQL is in admin-queries.js; routes/admin.js decides
// what to answer, and admin-page.js renders.

import { BOM, csvRecord } from './csv.js';
import { MAX_DAY, MAX_EXPORT_DAYS, MIN_DAY } from './date-range.js';
import {
  EXPORT_TABLES,
  SUMMARY_QUERIES,
  TABLES_PRESENT_SQL,
} from './admin-queries.js';

// ---------------------------------------------------------------- summary

/**
 * Run the summary batch for a range.
 * @param {D1Database} db
 * @param {{ start: string, end: string }} range
 * @returns {Promise<{ results: Record<string, object[]>, rowsRead: number | null }>}
 *   rowsRead is the sum of every statement's meta.rows_read, or null if any
 *   is missing. Throws what D1 throws.
 */
export async function readSummary(db, range) {
  const statements = SUMMARY_QUERIES.map(([, sql]) => db.prepare(sql).bind(range.start, range.end));
  const answers = await db.batch(statements);
  const results = {};
  let rowsRead = 0;
  SUMMARY_QUERIES.forEach(([name], i) => {
    const answer = answers?.[i];
    results[name] = Array.isArray(answer?.results) ? answer.results : [];
    const read = answer?.meta?.rows_read;
    rowsRead = rowsRead !== null && Number.isFinite(read) ? rowsRead + read : null;
  });
  return { results, rowsRead };
}

/** After a failed batch: are all three tables there? Throws what D1 throws. */
export async function tablesPresent(db) {
  const row = await db.prepare(TABLES_PRESENT_SQL).first();
  return Number(row?.n) === 3;
}

const count = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Text order for titles: en-AU collation, then code units, so it is total. */
function compareText(a, b) {
  return a.localeCompare(b, 'en-AU') || (a < b ? -1 : a > b ? 1 : 0);
}
const compareCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** A page id -> how the page shows it: its title from pages.json, or the id when it is no longer on the site. */
function pageOf(index, id) {
  const page = index.get(id);
  return { page: id, title: page?.title || id, known: page !== undefined };
}

const meanOf = (row) => (row.n > 0 ? row.total / row.n : null);

/**
 * The summary's D1 rows and the pages.json index -> the page's data. Pure.
 * Every list has a total order on its content, so the same rows give the
 * same page whatever order D1 returns them in (and never an id order).
 *
 * @param {Record<string, object[]>} results  readSummary().results
 * @param {Map} index  pageIndex(pages.json)
 * @returns {{
 *   views: { rows: Array<{ page, title, known, views, visits }>, views: number, visits: number },
 *   ratings: {
 *     total: number,
 *     byVideo: Array<{ video, n, total, mean }>,
 *     byPage: Array<{ page, title, known, n, total, mean }>,
 *     byPageVideo: Array<{ page, title, known, video, n, total, mean }>,
 *   },
 *   searches: { total: number, zero: number, top: Array<{ q, n }> },
 *   feedback: { total: number, recent: Array<{ ts, page, title, known, video, message }> },
 *   plays: { video: Array<{ media, plays, f0, f25, f50, f75, f100 }>, audio: Array<same> },
 *   handouts: Array<{ media, clicks, visits }>,
 * }}
 *   views.rows: every tracked page in pages.json (page_view true), with 0
 *   for those with no views, plus any page with views that is no longer in
 *   pages.json (known false); by views, then title, then id.
 *   ratings: byVideo by count, then video id; byPage by count, then title,
 *   then id; byPageVideo by page title and id, then count, then video id.
 *   mean is total / n, unrounded. searches.top keeps D1's order (count,
 *   then text). feedback.recent keeps D1's order (newest first); its page
 *   shows by its current title in pages.json (feedback stores none), or by
 *   its id when it is no longer there (known false), and its `video` is the
 *   video_id it is about, or null (sent from the footer, or stored before
 *   migration 0003). plays and handouts by count, then video id.
 */
export function summaryModel(results, index) {
  const rowsOf = (name) => (Array.isArray(results?.[name]) ? results[name] : []);

  const views = new Map();
  for (const [id, page] of index) {
    if (page.pageView) views.set(id, { ...pageOf(index, id), views: 0, visits: 0 });
  }
  for (const row of rowsOf('views')) {
    const id = String(row.page);
    views.set(id, { ...pageOf(index, id), views: count(row.views), visits: count(row.visits) });
  }
  const viewRows = [...views.values()].sort(
    (a, b) => b.views - a.views || compareText(a.title, b.title) || compareCode(a.page, b.page),
  );
  const [viewTotals = {}] = rowsOf('viewTotals');

  const byPageVideo = [];
  const byVideo = new Map();
  const byPage = new Map();
  for (const row of rowsOf('ratings')) {
    const page = String(row.page);
    const video = String(row.video);
    const n = count(row.n);
    const total = count(row.total);
    byPageVideo.push({ ...pageOf(index, page), video, n, total });
    const v = byVideo.get(video) ?? { video, n: 0, total: 0 };
    v.n += n;
    v.total += total;
    byVideo.set(video, v);
    const p = byPage.get(page) ?? { ...pageOf(index, page), n: 0, total: 0 };
    p.n += n;
    p.total += total;
    byPage.set(page, p);
  }
  const withMean = (row) => ({ ...row, mean: meanOf(row) });

  const [searchTotals = {}] = rowsOf('searchTotals');
  const [feedbackCount = {}] = rowsOf('feedbackCount');

  const playRows = (type) =>
    rowsOf('plays')
      .filter((row) => row.type === type)
      .map((row) => ({
        media: String(row.media),
        plays: count(row.plays),
        f0: count(row.f0),
        f25: count(row.f25),
        f50: count(row.f50),
        f75: count(row.f75),
        f100: count(row.f100),
      }))
      .sort((a, b) => b.plays - a.plays || compareCode(a.media, b.media));

  return {
    views: { rows: viewRows, views: count(viewTotals.views), visits: count(viewTotals.visits) },
    ratings: {
      total: byPageVideo.reduce((sum, row) => sum + row.n, 0),
      byVideo: [...byVideo.values()].map(withMean).sort((a, b) => b.n - a.n || compareCode(a.video, b.video)),
      byPage: [...byPage.values()].map(withMean).sort((a, b) => b.n - a.n || compareText(a.title, b.title) || compareCode(a.page, b.page)),
      byPageVideo: byPageVideo
        .map(withMean)
        .sort((a, b) => compareText(a.title, b.title) || compareCode(a.page, b.page) || b.n - a.n || compareCode(a.video, b.video)),
    },
    searches: {
      total: count(searchTotals.searches),
      zero: count(searchTotals.zero),
      top: rowsOf('zeroSearches').map((row) => ({ q: String(row.q ?? ''), n: count(row.n) })),
    },
    feedback: {
      total: count(feedbackCount.n),
      recent: rowsOf('recentFeedback').map((row) => ({
        ts: String(row.ts),
        ...pageOf(index, String(row.page)),
        video: row.video === null || row.video === undefined ? null : String(row.video),
        message: String(row.message ?? ''),
      })),
    },
    plays: { video: playRows('video_play'), audio: playRows('audio_play') },
    handouts: rowsOf('handouts')
      .map((row) => ({ media: String(row.media), clicks: count(row.clicks), visits: count(row.visits) }))
      .sort((a, b) => b.clicks - a.clicks || compareCode(a.media, b.media)),
  };
}

// ---------------------------------------------------------------- exports

/**
 * The most rows one download may hold (decision B5). An export reads about
 * 2 rows per row sent, and each download start counts its rows first (one
 * index entry each, twice when it opens the download page), so a download
 * at the cap reads about 400,000 rows: 8% of the free plan's 5 M a day for
 * the whole account. At the free plan's write ceiling (about 50,000 events
 * a day) one day still fits.
 */
export const MAX_EXPORT_ROWS = 100_000;

/** 12345 -> "12,345", with no locale data. */
export const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** The plain-text answers to an export request that can't be served (400). Fixed texts: none quotes the request. */
export const EXPORT_ERRORS = Object.freeze({
  table: 'Choose a table: ratings, feedback, events or searches.',
  'one-date': 'Give both from and to, or neither for last month.',
  date: `Give from and to as dates from ${MIN_DAY} to ${MAX_DAY}, written YYYY-MM-DD.`,
  order: 'The from date must be on or before the to date.',
  incomplete: 'Downloads cover complete days only (UTC), so the to date must be yesterday or earlier.',
  'too-long': `A download covers at most ${MAX_EXPORT_DAYS} days. Download longer periods a month at a time.`,
  'too-many-rows': `This download would have more than ${thousands(MAX_EXPORT_ROWS)} rows, too many for one file. Choose fewer days.`,
  cursor: "This part of the download isn't valid. Start the download again.",
});

/**
 * A stored ts, exactly as toISOString() writes it. Since 2026-11-07 every
 * stored ts is an hour (SPEC §14.1), but a preview's older test rows can
 * hold any time, so any millisecond is accepted.
 */
export const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SKIP_RE = /^\d{1,7}$/;

/**
 * A part's cursor from the query (paged=1): `type` (events tables only),
 * `ts` and `skip`. None of them: the first part. The cursor holds no id
 * and no free text.
 *
 * `skip` is at most `maxSkip`, the download's row cap. A real cursor's skip
 * counts rows already sent, all among the rows the first request counted
 * (at most the cap), so it never exceeds it. A forged one can't make the
 * part's OFFSET step over more rows than one download may hold: only a
 * request with no cursor runs the capped count.
 * @param {URLSearchParams} params
 * @param {object} spec    an EXPORT_TABLES entry
 * @param {{ start: string, end: string }} range
 * @param {number} [maxSkip]  the row cap per download
 * @returns {{ cursor: null | { type: string | null, ts: string, skip: number } } | { error: 'cursor' }}
 */
export function parseCursor(params, spec, range, maxSkip = MAX_EXPORT_ROWS) {
  const type = params.get('type');
  const ts = params.get('ts');
  const skip = params.get('skip');
  if (type === null && ts === null && skip === null) return { cursor: null };
  const typeOk = spec.types ? spec.types.includes(type) : type === null;
  if (!typeOk || ts === null || !TS_RE.test(ts) || ts < range.start || ts >= range.end) return { error: 'cursor' };
  if (skip === null || !SKIP_RE.test(skip) || Number(skip) > maxSkip) return { error: 'cursor' };
  return { cursor: { type: spec.types ? type : null, ts, skip: Number(skip) } };
}

/** The cursor as the X-Export-Next header carries it: "type=…&ts=…&skip=…" (no type for ratings and feedback). */
export function cursorQuery(cursor) {
  const params = new URLSearchParams();
  if (cursor.type !== null) params.set('type', cursor.type);
  params.set('ts', cursor.ts);
  params.set('skip', String(cursor.skip));
  return params.toString();
}

/**
 * How many rows the range holds, counting at most `cap + 1`, so the count
 * reads at most that many index entries. Throws what D1 throws.
 */
export async function countRows(db, spec, range, cap) {
  const row = await db.prepare(spec.countSql).bind(range.start, range.end, cap + 1).first();
  return count(row?.n);
}

/**
 * One part of an export: up to `limit` rows from `cursor` on (or from the
 * start), and the cursor for the next part, or null when nothing remains.
 *
 * For each type from the cursor's on (one pass for ratings and feedback),
 * it asks for one row more than it still wants, at OFFSET skip. If more come
 * back than are wanted, the part is full: the next cursor is the last taken
 * row's ts, with skip the number of rows with exactly that ts already sent.
 * Otherwise it takes them all and moves to the next type, from the range's
 * start. So a part makes at most one query per type, and `next` is null
 * exactly when nothing remains. The skip count is safe because every row in
 * an export's range is final (complete days only).
 *
 * Every stored ts is an hour (SPEC §14.1), so a skip often counts rows of a
 * large group: everything of one type in one hour. The statements order
 * that group by content (page, session_id, detail for events; id for ratings
 * and feedback, their own sequences), never by events.id, so the first
 * `skip` rows of a group are the same rows on every request: no gap and no
 * repeat at a part boundary. Rows that tie on every ORDER BY term are
 * identical in every exported column, so which of them comes first can't
 * change the file. The cost: SQLite reads the whole hour for each part that
 * starts or ends in it (lib/admin-queries.js).
 *
 * @param {D1Database} db
 * @param {object} spec    an EXPORT_TABLES entry
 * @param {{ start: string, end: string }} range
 * @param {{ type: string | null, ts: string, skip: number } | null} cursor
 * @param {number} limit   at least 1
 * @returns {Promise<{ rows: unknown[][], next: object | null }>}  rows as
 *   arrays in spec.columns order. Throws what D1 throws.
 */
export async function buildPart(db, spec, range, cursor, limit) {
  const types = spec.types ?? [null];
  const tsAt = spec.columns.indexOf('ts');
  const rows = [];
  let i = cursor ? types.indexOf(cursor.type) : 0;
  if (i < 0) i = types.length;
  for (; i < types.length; i += 1) {
    const type = types[i];
    const from = cursor && cursor.type === type ? cursor : { type, ts: range.start, skip: 0 };
    const want = limit - rows.length;
    const statement = db.prepare(spec.partSql);
    const bound = type === null
      ? statement.bind(from.ts, range.end, want + 1, from.skip)
      : statement.bind(type, from.ts, range.end, want + 1, from.skip);
    const got = await bound.raw();
    if (got.length > want) {
      const taken = got.slice(0, want);
      rows.push(...taken);
      if (taken.length === 0) return { rows, next: { type, ts: from.ts, skip: from.skip } };
      const lastTs = taken[taken.length - 1][tsAt];
      const same = taken.filter((row) => row[tsAt] === lastTs).length;
      return { rows, next: { type, ts: lastTs, skip: (lastTs === from.ts ? from.skip : 0) + same } };
    }
    rows.push(...got);
  }
  return { rows, next: null };
}

/** A part's CSV text: the BOM and header first when it is the first part; every record ends with CRLF. */
export function csvText(spec, rows, first) {
  return (first ? BOM + csvRecord(spec.columns) : '') + rows.map(csvRecord).join('');
}

/** The download's file name, built only from a checked table and checked days. */
export const exportFilename = (table, from, to) => `sleepsteps-${table}-${from}-to-${to}.csv`;

export { EXPORT_TABLES };
