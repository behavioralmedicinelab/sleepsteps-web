// The database after migrations/ is applied (SPEC §17): exactly the three
// tables and their indexes, and no table or column that could hold an IP
// address, a user agent or a client timestamp. Search events are rows in
// `events` (SPEC §10.1), so there is no separate searches table.
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
    ['feedback', [['id', 'INTEGER', 0, 1], ['ts', 'TEXT', 1, 0], ['page', 'TEXT', 1, 0], ['page_title', 'TEXT', 0, 0], ['message', 'TEXT', 1, 0]]],
  ])('give %s exactly its columns: [name, type, not null, primary key]', async (table, columns) => {
    const info = await all(`SELECT name, type, "notnull", pk FROM pragma_table_info('${table}') ORDER BY cid`);
    expect(info.map((c) => [c.name, c.type, c.notnull, c.pk])).toEqual(columns);
  });

  it('index events by type and time, the admin queries’ filter (SPEC §14.4)', async () => {
    const columns = await all(`SELECT name FROM pragma_index_info('idx_events_type_ts') ORDER BY seqno`);
    expect(columns.map((c) => c.name)).toEqual(['type', 'ts']);
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
