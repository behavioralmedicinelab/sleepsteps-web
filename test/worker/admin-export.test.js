// GET /admin/export (SPEC §14.4, §20 M6): the four tables' columns, an order
// that never follows an id, the parts and their cursor, the size caps, the
// dates, the CSV framing and formula guard, and the query plans. Runs in
// workerd against this file's own migrated D1, with a stub token check (the
// gates are in admin.test.js).
import { createExecutionContext } from 'cloudflare:test';
import { env as testEnv } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCsv } from '../../scripts/lib/csv.js';
import { EXPORT_ERRORS, MAX_EXPORT_ROWS } from '../../worker/lib/admin-data.js';
import {
  EVENT_TYPE_ORDER,
  EXPORT_TABLES,
  SUMMARY_QUERIES,
  TABLES_PRESENT_SQL,
} from '../../worker/lib/admin-queries.js';
import { csvRecord, FORMULA_START } from '../../worker/lib/csv.js';
import { createRouter } from '../../worker/router.js';
import { EXPORT_CROSS_SITE } from '../../worker/routes/admin.js';
import { SHAPES } from '../../worker/routes/event.js';
import { AUD, TEAM } from './access-tokens.js';

const PAGES = {
  search: { url: '/search/', title: 'Search', page_view: false, videos: [] },
  pain: { url: '/problems/pain/', title: 'Pain', page_view: true, videos: ['pain-about', 'settling-your-body'] },
  start: { url: '/start/', title: 'Start here', page_view: true, videos: ['how-sleep-works'] },
};
const SITE = { features: { ratings: true, feedback: true, events: true } };
// 2026-11-06 UTC: yesterday is 2026-11-05, last month is October 2026.
const NOW = Date.parse('2026-11-06T13:30:00.000Z');
const PASS = { verify: async () => ({ ok: true }) };
const ENV = (extra = {}) => ({ DB: testEnv.DB, API_HOSTS: 'example.com', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ...extra });
const makeRouter = (admin = {}) => createRouter({ pages: PAGES, site: SITE, admin: { access: PASS, now: () => NOW, ...admin } });
const router = makeRouter();

const get = (query, { on = router, env = ENV(), headers = {} } = {}) =>
  on.fetch(new Request(`https://example.com/admin/export?${query}`, { headers }), env, createExecutionContext());

const A = 'a3c1e0f2-6b4d-4e8a-9f1c-2d3e4f5a6b7c';
const B = 'b4d2f1a3-7c5e-4f9b-8a2d-3e4f5a6b7c8d';

let logged;
beforeEach(async () => {
  await testEnv.DB.batch(['events', 'ratings', 'feedback'].map((t) => testEnv.DB.prepare(`DELETE FROM ${t}`)));
  logged = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    vi.spyOn(console, method).mockImplementation((...args) => logged.push([method, ...args.map(String)]));
  }
});
afterEach(() => vi.restoreAllMocks());

async function insert(table, rows) {
  for (let i = 0; i < rows.length; i += 50) {
    await testEnv.DB.batch(
      rows.slice(i, i + 50).map((row) => {
        const columns = Object.keys(row);
        return testEnv.DB.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).bind(
          ...Object.values(row),
        );
      }),
    );
  }
}
const ev = (type, ts, page, session, detail = {}, id) => ({
  ...(id === undefined ? {} : { id }),
  ts,
  session_id: session,
  page,
  type,
  detail: JSON.stringify(detail),
});
const search = (q, results, ts = '2026-10-15T10:00:00.000Z', id) => ev('search', ts, 'search', null, { q, results }, id);

const BOM = '\uFEFF';
const header = (table) => csvRecord(EXPORT_TABLES.get(table).columns);
/** A response's text with its BOM kept (Response.text() drops it, as the Encoding standard says). */
const textOf = async (res) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());

/** Every part of an export, fetched as the download page's script does: [{ res, text }]. */
async function parts(table, range = 'from=2026-10-01&to=2026-10-31', on = router) {
  const out = [];
  let next = '';
  for (let i = 0; i < 1000; i += 1) {
    const res = await get(`table=${table}&${range}&paged=1${next ? `&${next}` : ''}`, { on });
    expect(res.status, await res.clone().text()).toBe(200);
    out.push({ res, text: await textOf(res) });
    next = res.headers.get('X-Export-Next');
    if (next === null) return out;
  }
  throw new Error('too many parts');
}
const joined = async (...args) => (await parts(...args)).map((p) => p.text).join('');

/** The whole file in one answer, from a router whose parts are big enough. */
async function whole(table, range = 'from=2026-10-01&to=2026-10-31') {
  const res = await get(`table=${table}&${range}`, { on: makeRouter({ pageRows: 100_000 }) });
  expect(res.headers.get('Content-Type')).toMatch(/^text\/csv/);
  return textOf(res);
}

/** A month of mixed events, with explicit ids from `ids()` (one per row, in insert order). */
function sampleEvents(ids) {
  const rows = [
    ev('page_view', '2026-10-01T00:00:00.000Z', 'pain', A),
    ev('page_view', '2026-10-02T09:15:00.123Z', 'pain', B),
    // Two events in the same millisecond.
    ev('page_view', '2026-10-02T09:15:00.123Z', 'start', A),
    ev('page_view', '2026-10-02T09:15:00.123Z', 'pain', A),
    ev('video_play', '2026-10-03T09:00:00.000Z', 'pain', A, { media: 'settling-your-body', furthest: 25 }),
    ev('video_play', '2026-10-03T09:00:00.000Z', 'pain', A, { media: 'settling-your-body', furthest: 75 }),
    ev('audio_play', '2026-10-04T09:00:00.000Z', 'pain', B, { media: 'pain-about', furthest: 100 }),
    ev('handout_open', '2026-10-31T23:59:59.999Z', 'start', B, { media: 'how-sleep-works' }),
    // Five searches in one hour.
    search('restless legs', 0, '2026-10-15T10:00:00.000Z'),
    search('pain at night', 3, '2026-10-15T10:00:00.000Z'),
    search('Pain at night', 3, '2026-10-15T10:00:00.000Z'),
    search('=1+1', 0, '2026-10-15T10:00:00.000Z'),
    search('waking early', 2, '2026-10-15T10:00:00.000Z'),
    // Outside the range.
    ev('page_view', '2026-09-30T23:59:59.999Z', 'pain', A),
    ev('page_view', '2026-11-01T00:00:00.000Z', 'pain', A),
  ];
  return rows.map((row, i) => ({ ...row, id: ids(i, rows.length) }));
}

describe('columns (SPEC §14.4, decision B1)', () => {
  it('has four tables, each header its columns, and no id for events or searches', async () => {
    expect([...EXPORT_TABLES.keys()]).toEqual(['ratings', 'feedback', 'events', 'searches']);
    expect(EXPORT_TABLES.get('ratings').columns).toEqual(['id', 'ts', 'page', 'video', 'stars']);
    expect(EXPORT_TABLES.get('feedback').columns).toEqual(['id', 'ts', 'page', 'page_title', 'message']);
    expect(EXPORT_TABLES.get('events').columns).toEqual(['ts', 'session_id', 'page', 'type', 'media', 'furthest']);
    expect(EXPORT_TABLES.get('searches').columns).toEqual(['ts', 'q', 'results']);
    for (const table of EXPORT_TABLES.keys()) {
      const res = await get(`table=${table}&from=2026-10-01&to=2026-10-31`);
      expect(res.status).toBe(200);
      expect(await textOf(res)).toBe(BOM + header(table));
    }
  });

  it('leaves search rows out of the events file, and the events file holds no free text', async () => {
    expect(EVENT_TYPE_ORDER).toEqual(['page_view', 'video_play', 'audio_play', 'handout_open']);
    expect(EXPORT_TABLES.get('events').types).toEqual(EVENT_TYPE_ORDER);
    expect(EXPORT_TABLES.get('searches').types).toEqual(['search']);
    await insert('events', sampleEvents((i) => 900_000_001 + i));
    const events = await whole('events');
    expect(events).not.toContain('search');
    expect(events).not.toMatch(/restless|night|waking/);
    const searches = await whole('searches');
    expect(parseCsv(searches)).toHaveLength(6);
  });

  it('gives every key of every event type a column in events or searches, and never the raw detail', () => {
    const columns = new Set([...EXPORT_TABLES.get('events').columns, ...EXPORT_TABLES.get('searches').columns]);
    for (const [type, keys] of SHAPES) {
      for (const key of keys) expect(columns.has(key), `${type}.${key}`).toBe(true);
    }
    expect(columns.has('detail')).toBe(false);
    expect(columns.has('id')).toBe(false);
  });
});

describe('the order never follows events.id (SPEC §10.1, §14.4)', () => {
  it('gives byte-identical files whatever order the ids are in, and no id', async () => {
    const files = [];
    for (const ids of [(i) => 900_000_001 + i, (i, n) => 900_000_001 + (n - 1 - i), (i) => 900_000_001 + ((i * 7) % 15)]) {
      await testEnv.DB.prepare('DELETE FROM events').run();
      await insert('events', sampleEvents(ids));
      files.push([await whole('events'), await whole('searches'), await joined('events', undefined, makeRouter({ pageRows: 2 }))]);
    }
    expect(files[1]).toEqual(files[0]);
    expect(files[2]).toEqual(files[0]);
    for (const text of files[0]) expect(text).not.toMatch(/9000000\d\d/);
  });

  it('orders events by type, then ts, page, session_id and detail', async () => {
    await insert('events', sampleEvents((i) => 900_000_001 + i));
    const rows = parseCsv(await whole('events')).slice(1);
    expect(rows.map((r) => r[3])).toEqual(['page_view', 'page_view', 'page_view', 'page_view', 'video_play', 'video_play', 'audio_play', 'handout_open']);
    expect(rows.slice(1, 4).map((r) => [r[2], r[1]])).toEqual([
      ['pain', A],
      ['pain', B],
      ['start', A],
    ]);
    // The same visit, page and time: ordered by detail text (furthest 25 before 75).
    expect(rows.slice(4, 6).map((r) => r[5])).toEqual(['25', '75']);
  });

  it('orders searches by hour and then text', async () => {
    await insert('events', sampleEvents((i) => 900_000_001 + i));
    const rows = parseCsv(await whole('searches')).slice(1);
    expect(rows.map((r) => r[1])).toEqual(["'=1+1", 'Pain at night', 'pain at night', 'restless legs', 'waking early']);
  });
});

describe('parts (paged=1)', () => {
  it('joins parts of 2 and of 3 rows into exactly the one-file export', async () => {
    await insert('events', sampleEvents((i) => 900_000_001 + i));
    await insert('ratings', Array.from({ length: 7 }, (_, i) => ({ ts: `2026-10-0${1 + (i % 3)}T10:00:00.000Z`, page: 'pain', video: 'pain-about', stars: 1 + (i % 5) })));
    await insert('feedback', Array.from({ length: 5 }, (_, i) => ({ ts: '2026-10-09T10:00:00.000Z', page: 'pain', page_title: 'Pain', message: `m${i}` })));
    for (const table of EXPORT_TABLES.keys()) {
      const reference = await whole(table);
      for (const pageRows of [1, 2, 3]) expect(await joined(table, undefined, makeRouter({ pageRows })), `${table} ${pageRows}`).toBe(reference);
    }
  });

  it('pages a tie group of 12 searches in one hour, 5 at a time, completely and in order', async () => {
    const words = Array.from({ length: 12 }, (_, i) => `query ${String(i).padStart(2, '0')}`);
    await insert('events', words.map((q, i) => search(q, i, '2026-10-20T07:00:00.000Z', 900_000_200 - i)));
    const got = await parts('searches', undefined, makeRouter({ pageRows: 5 }));
    expect(got.map((p) => p.res.headers.get('X-Export-Rows'))).toEqual(['5', '5', '2']);
    expect(got[0].res.headers.get('X-Export-Next')).toBe('type=search&ts=2026-10-20T07%3A00%3A00.000Z&skip=5');
    expect(got[1].res.headers.get('X-Export-Next')).toBe('type=search&ts=2026-10-20T07%3A00%3A00.000Z&skip=10');
    const rows = parseCsv(got.map((p) => p.text).join('')).slice(1);
    expect(rows.map((r) => r[1])).toEqual(words);
  });

  it('puts the BOM and header in the first part only, ends every part with CRLF, and leaves X-Export-Next off the last', async () => {
    await insert('events', sampleEvents((i) => 900_000_001 + i));
    const got = await parts('events', undefined, makeRouter({ pageRows: 3 }));
    expect(got).toHaveLength(3);
    expect(got[0].text.startsWith(BOM + header('events'))).toBe(true);
    for (const part of got.slice(1)) {
      expect(part.text.startsWith(BOM)).toBe(false);
      expect(part.text).not.toContain('session_id');
    }
    for (const part of got) expect(part.text.endsWith('\r\n')).toBe(true);
    expect(got.map((p) => p.res.headers.get('X-Export-Rows'))).toEqual(['3', '3', '2']);
    expect(got.at(-1).res.headers.has('X-Export-Next')).toBe(false);
    for (const part of got) {
      expect(part.res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8; header=present');
      expect(part.res.headers.get('Content-Disposition')).toBe('attachment; filename="sleepsteps-events-2026-10-01-to-2026-10-31.csv"');
    }
  });

  it('moves from one type to the next, including a part that ends exactly at a type boundary', async () => {
    await insert('events', [
      ev('page_view', '2026-10-01T10:00:00.000Z', 'pain', A),
      ev('page_view', '2026-10-01T11:00:00.000Z', 'pain', A),
      ev('handout_open', '2026-10-01T09:00:00.000Z', 'pain', A, { media: 'pain-about' }),
    ]);
    const got = await parts('events', undefined, makeRouter({ pageRows: 2 }));
    expect(got.map((p) => p.res.headers.get('X-Export-Next'))).toEqual(['type=handout_open&ts=2026-10-01T00%3A00%3A00.000Z&skip=0', null]);
    await testEnv.DB.prepare("DELETE FROM events WHERE type = 'handout_open'").run();
    const only = await parts('events', undefined, makeRouter({ pageRows: 2 }));
    expect(only).toHaveLength(1);
    expect(only[0].res.headers.get('X-Export-Rows')).toBe('2');
  });

  it('refuses a bad cursor with 400 and a fixed message', async () => {
    const base = 'table=events&from=2026-10-01&to=2026-10-31&paged=1';
    const cases = [
      'type=search&ts=2026-10-01T00:00:00.000Z&skip=0',
      'type=nope&ts=2026-10-01T00:00:00.000Z&skip=0',
      'ts=2026-10-01T00:00:00.000Z&skip=0',
      'type=page_view&ts=2026-10-01T00:00:00Z&skip=0',
      'type=page_view&ts=2026-10-01&skip=0',
      'type=page_view&ts=2026-09-30T23:59:59.999Z&skip=0',
      'type=page_view&ts=2026-11-01T00:00:00.000Z&skip=0',
      'type=page_view&ts=2026-10-01T00:00:00.000Z&skip=-1',
      'type=page_view&ts=2026-10-01T00:00:00.000Z&skip=1.5',
      'type=page_view&ts=2026-10-01T00:00:00.000Z&skip=12345678',
      // A skip over the row cap: no real cursor has one (SPEC §14.4).
      'type=page_view&ts=2026-10-01T00:00:00.000Z&skip=9999999',
      `type=page_view&ts=2026-10-01T00:00:00.000Z&skip=${MAX_EXPORT_ROWS + 1}`,
      'type=page_view&ts=2026-10-01T00:00:00.000Z',
      'type=page_view&skip=0',
      'skip=0',
    ];
    for (const cursor of cases) {
      const res = await get(`${base}&${cursor}`);
      expect(res.status, cursor).toBe(400);
      expect(await res.text()).toBe(EXPORT_ERRORS.cursor);
    }
    const ratings = await get('table=ratings&from=2026-10-01&to=2026-10-31&paged=1&type=page_view&ts=2026-10-01T00:00:00.000Z&skip=0');
    expect(ratings.status).toBe(400);
    const ok = await get('table=ratings&from=2026-10-01&to=2026-10-31&paged=1&ts=2026-10-01T00:00:00.000Z&skip=0');
    expect(ok.status).toBe(200);
  });

  it('accepts a skip up to the row cap and refuses one over it, before reading D1', async () => {
    const base = 'table=events&from=2026-10-01&to=2026-10-31&paged=1&type=page_view&ts=2026-10-01T00:00:00.000Z';
    expect((await get(`${base}&skip=${MAX_EXPORT_ROWS}`)).status).toBe(200);
    const capped = makeRouter({ maxExportRows: 4 });
    expect((await get(`${base}&skip=4`, { on: capped })).status).toBe(200);
    const reads = [];
    const env = new Proxy(ENV(), { get: (t, n) => (reads.push(n), t[n]) });
    const res = await get(`${base}&skip=5`, { on: capped, env });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(EXPORT_ERRORS.cursor);
    expect(reads).not.toContain('DB');
  });
});

describe('an export another site started (Sec-Fetch-Site)', () => {
  const QUERIES = [
    'table=events&from=2026-10-01&to=2026-10-31',
    'table=events&from=2026-10-01&to=2026-10-31&paged=1',
    'table=events&from=2026-10-01&to=2026-10-31&paged=1&type=page_view&ts=2026-10-01T00:00:00.000Z&skip=0',
    'table=nope',
  ];

  it.each(['cross-site', 'same-site', 'Same-Origin', ''])('answers %j with 403 and a fixed text, reading no D1 and logging nothing', async (site) => {
    const reads = [];
    const env = new Proxy(ENV(), { get: (t, n) => (reads.push(n), t[n]) });
    for (const query of QUERIES) {
      const res = await get(query, { env, headers: { 'Sec-Fetch-Site': site } });
      expect(res.status, query).toBe(403);
      expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
      expect(res.headers.get('Content-Disposition')).toBeNull();
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(await res.text()).toBe(EXPORT_CROSS_SITE);
    }
    expect(reads).not.toContain('DB');
    expect(logged).toEqual([]);
  });

  it.each([['same-origin'], ['none'], [undefined]])('serves %s (the admin pages, a typed address or bookmark, or no header)', async (site) => {
    await insert('ratings', [{ id: 7, ts: '2026-10-05T10:00:00.123Z', page: 'pain', video: 'pain-about', stars: 4 }]);
    const headers = site === undefined ? {} : { 'Sec-Fetch-Site': site };
    const res = await get('table=ratings&from=2026-10-01&to=2026-10-31', { headers });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8; header=present');
    const part = await get('table=ratings&from=2026-10-01&to=2026-10-31&paged=1', { headers });
    expect(part.status).toBe(200);
  });

  it('leaves the summary page alone: the redirect back from the Access sign-in arrives cross-site', async () => {
    const res = await router.fetch(
      new Request('https://example.com/admin/', { headers: { 'Sec-Fetch-Site': 'cross-site' } }),
      ENV(),
      createExecutionContext(),
    );
    expect(res.status).toBe(200);
  });
});

describe('without paged', () => {
  it('sends a range that fits in one part as one CSV file', async () => {
    await insert('ratings', [{ id: 7, ts: '2026-10-05T10:00:00.123Z', page: 'pain', video: 'pain-about', stars: 4 }]);
    const res = await get('table=ratings&from=2026-10-01&to=2026-10-31');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8; header=present');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="sleepsteps-ratings-2026-10-01-to-2026-10-31.csv"');
    expect(res.headers.has('X-Export-Next')).toBe(false);
    expect(await textOf(res)).toBe(`${BOM}${header('ratings')}7,"2026-10-05T10:00:00.123Z","pain","pain-about",4\r\n`);
  });

  it('opens the download page (200 HTML, with its CSP) for a range over one part, sending no CSV', async () => {
    await insert('events', sampleEvents((i) => 900_000_001 + i));
    const res = await get('table=events&from=2026-10-01&to=2026-10-31', { on: makeRouter({ pageRows: 3 }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toBeNull();
    expect(res.headers.get('Content-Security-Policy')).toBe(
      `default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self'; form-action 'self' https://${TEAM}; base-uri 'none'; frame-ancestors 'none'`,
    );
    const body = await res.text();
    expect(body.startsWith(BOM)).toBe(false);
    expect(body).toContain('data-filename="sleepsteps-events-2026-10-01-to-2026-10-31.csv"');
    expect(body).not.toContain(A);
  });
});

describe('the size caps (decision B5)', () => {
  it('caps rows per download at 100,000', () => {
    expect(MAX_EXPORT_ROWS).toBe(100_000);
    expect(EXPORT_ERRORS['too-many-rows']).toContain('100,000');
  });

  it('refuses a download over the row cap with 400, before building anything (one file, the page, or a first part)', async () => {
    await insert('events', Array.from({ length: 5 }, (_, i) => ev('page_view', `2026-10-0${i + 1}T10:00:00.000Z`, 'pain', A)));
    const capped = makeRouter({ maxExportRows: 4, pageRows: 2 });
    for (const query of ['table=events&from=2026-10-01&to=2026-10-31', 'table=events&from=2026-10-01&to=2026-10-31&paged=1']) {
      const res = await get(query, { on: capped });
      expect(res.status, query).toBe(400);
      expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
      expect(await res.text()).toBe(EXPORT_ERRORS['too-many-rows']);
    }
    const fits = makeRouter({ maxExportRows: 5, pageRows: 2 });
    expect((await get('table=events&from=2026-10-01&to=2026-10-31', { on: fits })).headers.get('Content-Type')).toMatch(/^text\/html/);
    expect(await joined('events', undefined, fits)).toBe(await whole('events'));
  });

  it('refuses more than 31 days', async () => {
    const res = await get('table=events&from=2026-08-01&to=2026-09-01');
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(EXPORT_ERRORS['too-long']);
    expect((await get('table=events&from=2026-08-01&to=2026-08-31')).status).toBe(200);
  });

  it('counts at most cap + 1 rows, reading no more than that', async () => {
    await insert('events', Array.from({ length: 60 }, (_, i) => ev('page_view', `2026-10-01T10:00:${String(i).padStart(2, '0')}.000Z`, 'pain', A)));
    const { results, meta } = await testEnv.DB.prepare(EXPORT_TABLES.get('events').countSql)
      .bind('2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 11)
      .all();
    expect(results).toEqual([{ n: 11 }]);
    // Bounded by the cap, not by the 60 rows in the range.
    expect(meta.rows_read).toBeLessThanOrEqual(2 * 11);
  });
});

describe('dates', () => {
  it('defaults to the previous UTC month', async () => {
    const res = await get('table=feedback');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="sleepsteps-feedback-2026-10-01-to-2026-10-31.csv"');
  });

  it.each([
    ['from=2026-10-01', 'one-date'],
    ['to=2026-10-31', 'one-date'],
    ['from=2026-10-01&to=2026-11-06', 'incomplete'],
    ['from=2026-11-06&to=2026-11-06', 'incomplete'],
    ['from=2026-11-01&to=2026-11-30', 'incomplete'],
    ['from=2026-10-31&to=2026-10-01', 'order'],
    ['from=2026-10-1&to=2026-10-31', 'date'],
    ['from=2026-02-29&to=2026-03-01', 'date'],
    ['from=2025-12-01&to=2025-12-31', 'date'],
    ['from=%22%3E%3Cb%3E&to=2026-10-31', 'date'],
  ])('answers 400 for %s', async (query, error) => {
    const res = await get(`table=events&${query}`);
    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe(EXPORT_ERRORS[error]);
  });

  it('accepts yesterday as the end date', async () => {
    expect((await get('table=events&from=2026-11-01&to=2026-11-05')).status).toBe(200);
  });

  it('answers 400 for an unknown table', async () => {
    for (const query of ['', 'table=', 'table=Events', 'table=search', 'table=__proto__', 'table=constructor', 'table=events%00']) {
      const res = await get(`${query}&from=2026-10-01&to=2026-10-31`);
      expect(res.status, query).toBe(400);
      expect(await res.text()).toBe(EXPORT_ERRORS.table);
    }
  });

  it('builds the file name only from the checked table and dates', async () => {
    const res = await get('table=searches&from=2026-10-01&to=2026-10-31&filename=evil.html&x=%22');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="sleepsteps-searches-2026-10-01-to-2026-10-31.csv"');
  });
});

describe('the CSV (RFC 4180, OWASP)', () => {
  it('starts with the UTF-8 BOM bytes, ends records with CRLF, leaves NULL empty and numbers bare', async () => {
    await insert('feedback', [{ id: 12, ts: '2026-10-05T10:00:00.000Z', page: 'pain', page_title: null, message: 'a "quoted", line\nbreak' }]);
    const res = await get('table=feedback&from=2026-10-01&to=2026-10-31');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    // The header's cells are text, so they are quoted too.
    expect(text).toBe(`${BOM}"id","ts","page","page_title","message"\r\n12,"2026-10-05T10:00:00.000Z","pain",,"a ""quoted"", line\nbreak"\r\n`);
  });

  it('defuses a search and a feedback message that start with = (and every other formula start)', async () => {
    const starts = ['=SUM(1)', '＝1', '+1', '-1', '@x', '\tx', '\rx', '\nx', "'x", '＋1', '－1', '＠x'];
    await insert('feedback', starts.map((message, i) => ({ id: 100 + i, ts: '2026-10-05T10:00:00.000Z', page: 'pain', page_title: 'Pain', message })));
    await insert('events', [search('=HYPERLINK("http://x")', 0), search('plain', 1)]);
    const feedback = parseCsv(await whole('feedback')).slice(1);
    expect(feedback.map((r) => r[4])).toEqual(starts.map((s) => `'${s}`));
    const searches = parseCsv(await whole('searches')).slice(1);
    expect(searches.map((r) => r[1])).toEqual(['\'=HYPERLINK("http://x")', 'plain']);
    for (const message of starts) expect(FORMULA_START.test(message), JSON.stringify(message)).toBe(true);
  });

  it('round-trips the stored text: parse, then remove one leading apostrophe', async () => {
    const texts = ['commas, here', 'quotes "like this"', 'line\nbreak', 'é and “curly” quotes', 'emoji 😴', "'already quoted", '=1', 'tab\tinside', '  spaces  '];
    await insert('feedback', texts.map((message, i) => ({ id: 200 + i, ts: '2026-10-06T10:00:00.000Z', page: 'pain', page_title: message, message })));
    await insert('events', texts.map((q, i) => search(q, i, '2026-10-07T10:00:00.000Z')));
    const unguard = (cell) => (cell.startsWith("'") ? cell.slice(1) : cell);
    const feedback = parseCsv(await whole('feedback')).slice(1);
    expect(feedback.map((r) => unguard(r[4]))).toEqual(texts);
    expect(feedback.map((r) => unguard(r[3]))).toEqual(texts);
    const searches = parseCsv(await whole('searches')).slice(1).map((r) => unguard(r[1]));
    expect(searches.sort()).toEqual([...texts].sort());
  });
});

describe('query plans (SPEC §17)', () => {
  const plan = async (sql, binds) => {
    const { results } = await testEnv.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds).all();
    return results.map((row) => row.detail).join('\n');
  };
  const S = '2026-10-01T00:00:00.000Z';
  const E = '2026-11-01T00:00:00.000Z';

  it('uses the ts indexes for every summary statement, never scanning events', async () => {
    for (const [name, sql] of SUMMARY_QUERIES) {
      const detail = await plan(sql, [S, E]);
      expect(detail, name).toMatch(/idx_events_type_ts|idx_ratings_ts|idx_feedback_ts/);
      expect(detail, name).not.toMatch(/SCAN events\b(?! USING)/);
    }
  });

  it('pages events by type with the index, sorting only the last three ORDER BY terms', async () => {
    for (const table of ['events', 'searches']) {
      const detail = await plan(EXPORT_TABLES.get(table).partSql, ['page_view', S, E, 11, 0]);
      expect(detail, table).toMatch(/idx_events_type_ts/);
      expect(detail, table).toMatch(/LAST 3 TERMS OF ORDER BY/);
      expect(detail, table).not.toMatch(/SCAN events\b(?! USING)/);
    }
  });

  it('pages ratings and feedback in index order, with no sort', async () => {
    for (const table of ['ratings', 'feedback']) {
      const detail = await plan(EXPORT_TABLES.get(table).partSql, [S, E, 11, 0]);
      expect(detail, table).toMatch(table === 'ratings' ? /idx_ratings_ts/ : /idx_feedback_ts/);
      expect(detail, table).not.toMatch(/TEMP B-TREE/);
    }
  });

  it('counts with the covering indexes', async () => {
    for (const table of EXPORT_TABLES.keys()) {
      const detail = await plan(EXPORT_TABLES.get(table).countSql, [S, E, 11]);
      expect(detail, table).toMatch(/COVERING INDEX idx_(events_type|ratings|feedback)_ts/);
    }
  });

  it('checks for the tables in sqlite_master', async () => {
    expect(await testEnv.DB.prepare(TABLES_PRESENT_SQL).first()).toEqual({ n: 3 });
  });
});

describe('a database failure', () => {
  it('answers a plain 500 with one fixed line and no CSV, before or during a part', async () => {
    const failing = (at) => ({
      prepare: () => ({
        bind: () => ({
          first: async () => {
            if (at === 'count') throw new Error('D1_ERROR: zq-row "secret"');
            return { n: 3 };
          },
          raw: async () => {
            throw new Error('D1_ERROR: zq-row "secret"');
          },
        }),
      }),
    });
    for (const [at, query] of [
      ['count', 'table=feedback'],
      ['part', 'table=feedback'],
      ['part', 'table=events&from=2026-10-01&to=2026-10-31&paged=1&type=page_view&ts=2026-10-01T00:00:00.000Z&skip=0'],
    ]) {
      const res = await get(query, { env: ENV({ DB: failing(at) }) });
      expect(res.status).toBe(500);
      expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
      expect(res.headers.get('Content-Disposition')).toBeNull();
      expect(await res.text()).toBe('Server error');
    }
    expect(logged).toEqual([1, 2, 3].map(() => ['error', '/admin: database read failed', 'D1_ERROR']));
  });
});
