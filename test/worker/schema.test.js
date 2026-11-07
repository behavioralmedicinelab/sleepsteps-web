// The database after migrations/ is applied (SPEC §17): exactly the three
// tables and their indexes, and no table or column that could hold an IP
// address, a user agent or a client timestamp. Search events are rows in
// `events` (SPEC §10.1), so there is no separate searches table. Feedback
// has no page_title since 0002 (project lead, 2026-11-07).
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const all = async (sql) => (await env.DB.prepare(sql).all()).results;

describe('migrations (SPEC §17)', () => {
  it('create exactly the ratings, feedback and events tables and one index each', async () => {
    const objects = await all(
      `SELECT type, name, tbl_name FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'
       ORDER BY type, name`,
    );
    expect(objects).toEqual([
      { type: 'index', name: 'idx_events_type_ts', tbl_name: 'events' },
      { type: 'index', name: 'idx_feedback_ts', tbl_name: 'feedback' },
      { type: 'index', name: 'idx_ratings_ts', tbl_name: 'ratings' },
      { type: 'table', name: 'events', tbl_name: 'events' },
      { type: 'table', name: 'feedback', tbl_name: 'feedback' },
      { type: 'table', name: 'ratings', tbl_name: 'ratings' },
    ]);
  });

  it.each([
    ['events', [['id', 'INTEGER', 0, 1], ['ts', 'TEXT', 1, 0], ['session_id', 'TEXT', 0, 0], ['page', 'TEXT', 1, 0], ['type', 'TEXT', 1, 0], ['detail', 'TEXT', 0, 0]]],
    ['ratings', [['id', 'INTEGER', 0, 1], ['ts', 'TEXT', 1, 0], ['page', 'TEXT', 1, 0], ['video', 'TEXT', 1, 0], ['stars', 'INTEGER', 1, 0]]],
    ['feedback', [['id', 'INTEGER', 0, 1], ['ts', 'TEXT', 1, 0], ['page', 'TEXT', 1, 0], ['message', 'TEXT', 1, 0]]],
  ])('give %s exactly its columns: [name, type, not null, primary key]', async (table, columns) => {
    const info = await all(`SELECT name, type, "notnull", pk FROM pragma_table_info('${table}') ORDER BY cid`);
    expect(info.map((c) => [c.name, c.type, c.notnull, c.pk])).toEqual(columns);
  });

  it('index events by type and time, the admin queries’ filter (SPEC §14.4)', async () => {
    const columns = await all(`SELECT name FROM pragma_index_info('idx_events_type_ts') ORDER BY seqno`);
    expect(columns.map((c) => c.name)).toEqual(['type', 'ts']);
  });

  it('are 0001_init.sql and 0002_feedback_drop_page_title.sql, in that order', () => {
    expect(env.TEST_MIGRATIONS.map((m) => m.name)).toEqual(['0001_init.sql', '0002_feedback_drop_page_title.sql']);
  });

  it('0002 drops feedback.page_title from a database that holds 0001 rows, keeping every row and its other columns', async () => {
    // Put this file's database back into 0001's shape, with rows, then run
    // 0002's own statements on it, as `wrangler d1 migrations apply` does on
    // the preview database (SPEC §17). It ends in the migrated shape again.
    const [drop] = env.TEST_MIGRATIONS.filter((m) => m.name === '0002_feedback_drop_page_title.sql');
    await env.DB.prepare('ALTER TABLE feedback ADD COLUMN page_title TEXT').run();
    const old = [
      [7, '2026-11-01T10:00:00.000Z', 'pain', 'Pain', 'first'],
      [9, '2026-11-02T11:00:00.000Z', 'start', null, 'second\nline'],
    ];
    await env.DB.batch(old.map((row) => env.DB.prepare('INSERT INTO feedback (id, ts, page, page_title, message) VALUES (?, ?, ?, ?, ?)').bind(...row)));
    for (const query of drop.queries) await env.DB.prepare(query).run();
    expect(await all('SELECT id, ts, page, message FROM feedback ORDER BY id')).toEqual([
      { id: 7, ts: '2026-11-01T10:00:00.000Z', page: 'pain', message: 'first' },
      { id: 9, ts: '2026-11-02T11:00:00.000Z', page: 'start', message: 'second\nline' },
    ]);
    const info = await all(`SELECT name FROM pragma_table_info('feedback') ORDER BY cid`);
    expect(info.map((c) => c.name)).toEqual(['id', 'ts', 'page', 'message']);
    // Its index is untouched.
    const index = await all(`SELECT name FROM pragma_index_info('idx_feedback_ts') ORDER BY seqno`);
    expect(index.map((c) => c.name)).toEqual(['ts']);
    await env.DB.prepare('DELETE FROM feedback').run();
  });

  it('use no AUTOINCREMENT: ids are row ids (d1_migrations has its own)', async () => {
    const tables = await all(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name IN ('ratings', 'feedback', 'events')`);
    expect(tables).toHaveLength(3);
    for (const { sql } of tables) expect(sql).not.toMatch(/AUTOINCREMENT/i);
  });

  it('allow a search row: no visit code and no detail other than its own', async () => {
    await env.DB.prepare('INSERT INTO events (ts, session_id, page, type, detail) VALUES (?, ?, ?, ?, ?)')
      .bind('2026-11-06T13:00:00.000Z', null, 'search', 'search', '{"q":"x","results":0}')
      .run();
    expect(await all(`SELECT session_id, page, type FROM events WHERE type = 'search'`)).toEqual([
      { session_id: null, page: 'search', type: 'search' },
    ]);
    await env.DB.prepare('DELETE FROM events').run();
  });

  it('refuse ratings outside 1-5', async () => {
    const insert = (stars) =>
      env.DB.prepare('INSERT INTO ratings (ts, page, video, stars) VALUES (?, ?, ?, ?)').bind('2026-11-06T00:00:00.000Z', 'pain', 'pain-about', stars).run();
    await expect(insert(0)).rejects.toThrow();
    await expect(insert(6)).rejects.toThrow();
    await insert(5);
    await env.DB.prepare('DELETE FROM ratings').run();
  });
});
