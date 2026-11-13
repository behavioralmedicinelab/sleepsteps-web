// A stand-in for Cloudflare D1 over Node's built-in SQLite (node:sqlite), for
// `npm run test:a11y` and `npm run a11y:serve` only (SPEC §18.1, §20 M7). The
// repo's real router and admin code run against it in Node, with
// migrations/ applied and a seeded sample of rows, so the admin pages render
// as they would with data. The Worker never uses it; in npm test only
// test/node/a11y-runner.test.js checks it, and the Worker tests run real D1
// in workerd. node:sqlite needs no flag from Node 22.13, the floor in
// package.json's engines.
//
// It implements the D1 calls the Worker makes: prepare(sql).bind(...) with
// all(), first(), raw() and run(), and batch(). meta.rows_read is the number
// of rows returned (real D1 counts rows scanned), which only changes the
// admin page's "This page read … rows" note.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hourTimestamp } from '../../worker/lib/time.js';

/** An in-memory D1 with every migration in `migrationsDir` applied, in file order. */
export function createD1(migrationsDir) {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  const statement = (sql, values = []) => ({
    sql,
    bind: (...args) => statement(sql, args),
    async all() {
      const results = db.prepare(sql).all(...values);
      return { results, success: true, meta: { rows_read: results.length } };
    },
    async first(column) {
      const row = db.prepare(sql).get(...values) ?? null;
      return column === undefined ? row : (row?.[column] ?? null);
    },
    async raw() {
      return db.prepare(sql).all(...values).map((row) => Object.values(row));
    },
    async run() {
      const result = db.prepare(sql).run(...values);
      return { success: true, meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } };
    },
  });
  return {
    prepare: (sql) => statement(sql),
    // D1 runs a batch as one transaction; one connection in one thread is
    // as consistent.
    batch: (statements) => Promise.all(statements.map((s) => s.all())),
    close: () => db.close(),
  };
}

/**
 * Seeds `d1` with a deterministic sample over the 30 days before `nowMs`:
 * visits to the tracked pages with plays, handouts and ratings, searches
 * (some with no results) and feedback, including a long unbroken word and
 * messages about one of their page's videos (as from its "Feedback" button,
 * SPEC §13), and worksheets opened from the pages that list some (SPEC
 * §7.6), so the summary's tables, lists and messages all have rows to
 * show. `pages` is
 * worker/generated/pages.json. Returns the number of rows written.
 */
export async function seedD1(d1, pages, nowMs, { visits = 240, searches = 90, feedback = 140, worksheets = 120 } = {}) {
  let state = 7;
  const rand = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const hex = (n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');
  const day = 86400000;
  const at = () => hourTimestamp(new Date(nowMs - Math.floor(rand() * 29 * day) - day));
  const tracked = Object.entries(pages).filter(([, page]) => page.page_view && page.videos.length);
  const ids = Object.keys(pages);
  const rows = [];
  const event = (ts, session, page, type, detail) =>
    rows.push(['INSERT INTO events (ts, session_id, page, type, detail) VALUES (?, ?, ?, ?, ?)', [ts, session, page, type, JSON.stringify(detail)]]);
  const visit = () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
  for (let i = 0; i < visits; i += 1) {
    const session = visit();
    const ts = at();
    const [page, { videos }] = pick(tracked);
    const media = pick(videos);
    event(ts, session, page, 'page_view', {});
    if (rand() < 0.5) event(ts, session, page, 'video_play', { media, furthest: pick([0, 25, 50, 75, 100]) });
    if (rand() < 0.2) event(ts, session, page, 'audio_play', { media, furthest: pick([0, 25, 50, 75, 100]) });
    if (rand() < 0.2) event(ts, session, page, 'handout_open', { media });
    if (rand() < 0.4) rows.push(['INSERT INTO ratings (ts, page, video, stars) VALUES (?, ?, ?, ?)', [ts, page, media, 1 + Math.floor(rand() * 5)]]);
  }
  const queries = [['night sweats', 3], ['cant sleep', 5], ['chemo brain', 0], ['melatonin dose', 0], ['hot flushes', 2]];
  for (let i = 0; i < searches; i += 1) {
    const [q, results] = pick(queries);
    event(at(), null, 'search', 'search', { q, results });
  }
  const messages = [
    'The video on sleep drive was helpful.',
    'Could you add more about pain at night? I find it hard to settle when my back aches, and the advice about getting up does not seem to fit me.',
    'Averylongwordwithoutanyspacesthatmustbreakratherthanscrollthepagesidewaysatnarrowwidths0123456789',
    'Merci beaucoup — très utile',
  ];
  for (let i = 0; i < feedback; i += 1) {
    const page = pick(ids);
    // About a third of the messages from a page with videos are about one of them.
    const { videos } = pages[page];
    const video = videos.length && rand() < 0.35 ? pick(videos) : null;
    rows.push(['INSERT INTO feedback (ts, page, video, message) VALUES (?, ?, ?, ?)', [at(), page, video, pick(messages)]]);
  }
  // Worksheets opened (worksheet_open, SPEC §10.2), each one of its page's
  // own, as the Worker stores them. They come last, so the rows above are
  // the ones this sample had before worksheets were counted.
  const withWorksheets = Object.entries(pages).filter(([, page]) => page.worksheets?.length);
  for (let i = 0; i < worksheets && withWorksheets.length; i += 1) {
    const [page, { worksheets: listed }] = pick(withWorksheets);
    event(at(), visit(), page, 'worksheet_open', { worksheet: pick(listed) });
  }
  for (const [sql, values] of rows) await d1.prepare(sql).bind(...values).run();
  return rows.length;
}
