// The database after migrations/ is applied (SPEC §17): exactly the three
// tables and their indexes, and no table or column that could hold an IP
// address, a user agent or a client timestamp. Search events are rows in
// `events` (SPEC §10.1), so there is no separate searches table. Feedback
// has no page_title since 0002 (project lead, 2026-11-07), and since 0003 a
// nullable `video`, the video a message is about (project lead, 2026-11-13).
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { FEEDBACK_PART_SQL, RECENT_FEEDBACK_SQL } from '../../worker/lib/admin-queries.js';

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
    // `video` is last, where 0003's ADD COLUMN puts it, and the only column of the three tables added nullable.
    ['feedback', [['id', 'INTEGER', 0, 1], ['ts', 'TEXT', 1, 0], ['page', 'TEXT', 1, 0], ['message', 'TEXT', 1, 0], ['video', 'TEXT', 0, 0]]],
  ])('give %s exactly its columns: [name, type, not null, primary key]', async (table, columns) => {
    const info = await all(`SELECT name, type, "notnull", pk FROM pragma_table_info('${table}') ORDER BY cid`);
    expect(info.map((c) => [c.name, c.type, c.notnull, c.pk])).toEqual(columns);
  });

  it('index events by type and time, the admin queries’ filter (SPEC §14.4)', async () => {
    const columns = await all(`SELECT name FROM pragma_index_info('idx_events_type_ts') ORDER BY seqno`);
    expect(columns.map((c) => c.name)).toEqual(['type', 'ts']);
  });

  it('are 0001_init.sql, 0002_feedback_drop_page_title.sql and 0003_feedback_add_video.sql, in that order', () => {
    expect(env.TEST_MIGRATIONS.map((m) => m.name)).toEqual(['0001_init.sql', '0002_feedback_drop_page_title.sql', '0003_feedback_add_video.sql']);
  });

  /** Run one migration file's own statements, as `wrangler d1 migrations apply` does. */
  const apply = async (name) => {
    const [migration] = env.TEST_MIGRATIONS.filter((m) => m.name === name);
    for (const query of migration.queries) await env.DB.prepare(query).run();
  };

  it('0002 drops feedback.page_title from a database that holds 0001 rows, keeping every row and its other columns', async () => {
    // Put this file's database back into 0001's shape, with rows (without
    // 0003's video, with 0001's page_title), then run 0002's own statements
    // on it, as `wrangler d1 migrations apply` does on the preview database
    // (SPEC §17). 0003 then puts it in the migrated shape again.
    await env.DB.prepare('ALTER TABLE feedback DROP COLUMN video').run();
    await env.DB.prepare('ALTER TABLE feedback ADD COLUMN page_title TEXT').run();
    const old = [
      [7, '2026-11-01T10:00:00.000Z', 'pain', 'Pain', 'first'],
      [9, '2026-11-02T11:00:00.000Z', 'start', null, 'second\nline'],
    ];
    await env.DB.batch(old.map((row) => env.DB.prepare('INSERT INTO feedback (id, ts, page, page_title, message) VALUES (?, ?, ?, ?, ?)').bind(...row)));
    await apply('0002_feedback_drop_page_title.sql');
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
    await apply('0003_feedback_add_video.sql');
  });

  it('0003 adds feedback.video to a database that holds 0002 rows: NULL in each, every row and its other columns kept, the statements of the code before it still work, and this change\'s fail until it is applied', async () => {
    // Back to 0002's shape, with rows as the code before this change wrote
    // them, then 0003's own statement, as on the production and preview
    // databases (SPEC §17, §18.4).
    await env.DB.prepare('ALTER TABLE feedback DROP COLUMN video').run();
    const old = [
      [7, '2026-11-10T10:00:00.000Z', 'pain', 'first'],
      [9, '2026-11-12T11:00:00.000Z', 'start', 'second\nline'],
    ];
    await env.DB.batch(old.map((row) => env.DB.prepare('INSERT INTO feedback (id, ts, page, message) VALUES (?, ?, ?, ?)').bind(...row)));
    const [add] = env.TEST_MIGRATIONS.filter((m) => m.name === '0003_feedback_add_video.sql');
    // One statement, under its header comment: nullable, no default, no index.
    expect(add.queries).toHaveLength(1);
    expect(add.queries[0].replace(/^--.*$/gm, '').trim()).toMatch(/^ALTER TABLE feedback ADD COLUMN video TEXT;?$/);
    // Why the migration goes first (SPEC §17, §18.4): on a database still
    // without it, this change's INSERT (the route's, word for word), its
    // summary query and its export query all fail, and nothing is written.
    const window = ['2026-11-01T00:00:00.000Z', '2026-12-01T00:00:00.000Z'];
    await expect(
      env.DB.prepare('INSERT INTO feedback (ts, page, video, message) VALUES (?, ?, ?, ?)').bind('2026-11-13T01:00:00.000Z', 'home', null, 'too early').run(),
    ).rejects.toThrow(/video/);
    await expect(env.DB.prepare(RECENT_FEEDBACK_SQL).bind(...window).all()).rejects.toThrow(/video/);
    await expect(env.DB.prepare(FEEDBACK_PART_SQL).bind(...window, 500, 0).all()).rejects.toThrow(/video/);
    expect((await all('SELECT id FROM feedback ORDER BY id')).map((r) => r.id)).toEqual([7, 9]);
    await apply('0003_feedback_add_video.sql');
    expect(await all('SELECT id, ts, page, video, message FROM feedback ORDER BY id')).toEqual([
      { id: 7, ts: '2026-11-10T10:00:00.000Z', page: 'pain', video: null, message: 'first' },
      { id: 9, ts: '2026-11-12T11:00:00.000Z', page: 'start', video: null, message: 'second\nline' },
    ]);
    // Nullable, with no default, after the other columns; and no index of its own.
    expect(await all(`SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info('feedback') ORDER BY cid`)).toEqual([
      { name: 'id', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 1 },
      { name: 'ts', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      { name: 'page', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      { name: 'message', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      { name: 'video', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
    ]);
    expect((await all(`SELECT name FROM pragma_index_list('feedback')`)).map((i) => i.name)).toEqual(['idx_feedback_ts']);
    const index = await all(`SELECT name FROM pragma_index_info('idx_feedback_ts') ORDER BY seqno`);
    expect(index.map((c) => c.name)).toEqual(['ts']);
    // The code from before this change names its columns, so production keeps
    // working between the migration and the merge: its INSERT (the route), its
    // summary query and its export query, word for word.
    await env.DB.prepare('INSERT INTO feedback (ts, page, message) VALUES (?, ?, ?)').bind('2026-11-13T02:00:00.000Z', 'home', 'third').run();
    expect(
      (await env.DB.prepare('SELECT ts, page, message FROM feedback WHERE ts >= ?1 AND ts < ?2 ORDER BY ts DESC, id DESC LIMIT 20').bind(...window).all()).results,
    ).toEqual([
      { ts: '2026-11-13T02:00:00.000Z', page: 'home', message: 'third' },
      { ts: '2026-11-12T11:00:00.000Z', page: 'start', message: 'second\nline' },
      { ts: '2026-11-10T10:00:00.000Z', page: 'pain', message: 'first' },
    ]);
    expect(
      (await env.DB.prepare('SELECT id, ts, page, message FROM feedback WHERE ts >= ?1 AND ts < ?2 ORDER BY ts, id LIMIT ?3 OFFSET ?4').bind(...window, 500, 0).all()).results.map((r) => r.id),
    ).toEqual([7, 9, 10]);
    expect(await all('SELECT video FROM feedback WHERE id = 10')).toEqual([{ video: null }]);
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
