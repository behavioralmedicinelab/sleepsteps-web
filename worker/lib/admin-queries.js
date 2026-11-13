// Every SQL statement the admin pages run (SPEC §14.4, §17). Imports no JSON,
// so Node can load this module too.
//
// All are static strings run with prepare().bind(), with ?NNN bindings:
// nothing from a request is ever put into SQL text. They only read.
//
// events.id is never selected, shown or used for ordering: ids are
// sequential, so a search's id falls among the ids of the visit it came from
// (SPEC §10.1, §14.4). No statement uses SELECT *, and every events read is
// an aggregate or has a complete ORDER BY on content. Measured locally:
// `ORDER BY ts` alone returns rows with the same ts in id order, which is
// why the export's tie-break runs through every column.
//
// Every events read filters on `type` and a `ts` window, so it uses
// idx_events_type_ts; ratings and feedback reads use their `ts` index. A
// test checks each plan (test/worker/admin-export.test.js).

// The summary page: one env.DB.batch() of these, each bound with ?1 = the
// range's start and ?2 = its end (dayStartTs of `from`, and of the day after
// `to`). Batched statements run as one transaction, so they read one
// consistent snapshot, and a batch counts as one query toward D1's limit
// per invocation.

/** Page views and visits (distinct session_id) per page. */
export const VIEWS_SQL =
  "SELECT page, COUNT(*) AS views, COUNT(DISTINCT session_id) AS visits FROM events WHERE type = 'page_view' AND ts >= ?1 AND ts < ?2 GROUP BY page";

/** All page views, and the visits that viewed any tracked page (each counted once). */
export const VIEW_TOTALS_SQL =
  "SELECT COUNT(*) AS views, COUNT(DISTINCT session_id) AS visits FROM events WHERE type = 'page_view' AND ts >= ?1 AND ts < ?2";

/** Rating counts and star totals per page and video; per-video and per-page sums are made from these. */
export const RATINGS_SQL =
  'SELECT page, video, COUNT(*) AS n, SUM(stars) AS total FROM ratings WHERE ts >= ?1 AND ts < ?2 GROUP BY page, video';

/** How many searches, and how many found nothing. */
export const SEARCH_TOTALS_SQL =
  "SELECT COUNT(*) AS searches, COALESCE(SUM(json_extract(detail, '$.results') = 0), 0) AS zero FROM events WHERE type = 'search' AND ts >= ?1 AND ts < ?2";

/** The 20 most frequent zero-result searches, ignoring ASCII capitals (SQLite's lower()); ties by text. */
export const ZERO_SEARCHES_SQL =
  "SELECT lower(json_extract(detail, '$.q')) AS q, COUNT(*) AS n FROM events WHERE type = 'search' AND ts >= ?1 AND ts < ?2 AND json_extract(detail, '$.results') = 0 GROUP BY 1 ORDER BY n DESC, q LIMIT 20";

/** How many feedback messages. */
export const FEEDBACK_COUNT_SQL = 'SELECT COUNT(*) AS n FROM feedback WHERE ts >= ?1 AND ts < ?2';

/**
 * The 20 most recent messages, by ts and then id, newest first (SPEC §14.4).
 * feedback.id is its own sequence. The page is shown by its current title
 * from pages.json: feedback stores no title (migration 0002). `video` is the
 * video a message is about, or NULL (migration 0003).
 */
export const RECENT_FEEDBACK_SQL =
  'SELECT ts, page, video, message FROM feedback WHERE ts >= ?1 AND ts < ?2 ORDER BY ts DESC, id DESC LIMIT 20';

/**
 * Plays per item and format: a play is one (session, page, item) group at
 * its highest `furthest`, so the five bucket counts add up to `plays`.
 */
export const PLAYS_SQL =
  "WITH best AS (SELECT type, json_extract(detail, '$.media') AS media, MAX(json_extract(detail, '$.furthest')) AS furthest FROM events WHERE type IN ('video_play', 'audio_play') AND ts >= ?1 AND ts < ?2 GROUP BY type, session_id, page, media) " +
  'SELECT type, media, COUNT(*) AS plays, SUM(furthest = 0) AS f0, SUM(furthest = 25) AS f25, SUM(furthest = 50) AS f50, SUM(furthest = 75) AS f75, SUM(furthest = 100) AS f100 FROM best GROUP BY type, media';

/** Handout clicks and the visits that clicked, per video. */
export const HANDOUTS_SQL =
  "SELECT json_extract(detail, '$.media') AS media, COUNT(*) AS clicks, COUNT(DISTINCT session_id) AS visits FROM events WHERE type = 'handout_open' AND ts >= ?1 AND ts < ?2 GROUP BY media";

/** The summary batch, in order: [name, sql]. */
export const SUMMARY_QUERIES = Object.freeze([
  ['views', VIEWS_SQL],
  ['viewTotals', VIEW_TOTALS_SQL],
  ['ratings', RATINGS_SQL],
  ['searchTotals', SEARCH_TOTALS_SQL],
  ['zeroSearches', ZERO_SEARCHES_SQL],
  ['feedbackCount', FEEDBACK_COUNT_SQL],
  ['recentFeedback', RECENT_FEEDBACK_SQL],
  ['plays', PLAYS_SQL],
  ['handouts', HANDOUTS_SQL],
]);

/** After a failed batch only: are the site's tables there at all? (3 when migrated.) */
export const TABLES_PRESENT_SQL =
  "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('ratings', 'feedback', 'events')";

// The exports. Each part runs one statement per event type (type = ?1), so
// SQLite walks idx_events_type_ts and stops early. (Measured: `type IN (all)`
// with `ORDER BY ts LIMIT n` sorts the whole range on every part, and with no
// type filter it scans the table.) The cursor's ts is the lower bound and its
// skip the OFFSET (see buildPart in lib/admin-data.js).
//
// Every stored ts is rounded down to the hour (SPEC §14.1), so all of a
// type's rows in one hour share a ts and the index can't order them: SQLite
// reads and sorts that whole hour (the "LAST 3 TERMS" of ORDER BY) for each
// part that starts or ends in it, and OFFSET then skips the rows already
// sent. A part costs about 2 rows read (index entry and row) per row it
// touches, so an export reads about 2 x (1 + G / part size) rows per row
// sent while each hour of a type holds G rows, fewer than a part, and about
// 2 x G / part size inside an hour bigger than a part (SPEC §14.4, §17,
// §21).

/** The usage-event types in the events file, in file order. Searches have a file of their own. */
export const EVENT_TYPE_ORDER = Object.freeze(['page_view', 'video_play', 'audio_play', 'handout_open']);

/** Events: no id, never the raw detail; detail is split into columns. */
export const EVENTS_PART_SQL =
  "SELECT ts, session_id, page, type, json_extract(detail, '$.media') AS media, json_extract(detail, '$.furthest') AS furthest FROM events WHERE type = ?1 AND ts >= ?2 AND ts < ?3 ORDER BY ts, page, session_id, detail LIMIT ?4 OFFSET ?5";

/** Searches: their own file (decision B1), so the events file holds no free text. */
export const SEARCHES_PART_SQL =
  "SELECT ts, json_extract(detail, '$.q') AS q, json_extract(detail, '$.results') AS results FROM events WHERE type = ?1 AND ts >= ?2 AND ts < ?3 ORDER BY ts, page, session_id, detail LIMIT ?4 OFFSET ?5";

/**
 * Ratings keep their id: its own sequence, not interleaved with events.id
 * (SPEC §15.3). So the ratings of one hour, which share a ts, come in id
 * order, as the file's id column shows anyway; the same holds for feedback.
 */
export const RATINGS_PART_SQL =
  'SELECT id, ts, page, video, stars FROM ratings WHERE ts >= ?1 AND ts < ?2 ORDER BY ts, id LIMIT ?3 OFFSET ?4';

/**
 * Feedback keeps its id, for the same reason. It stores no page title
 * (migration 0002); `video` is NULL, an empty cell, for a message that isn't
 * about a video (migration 0003).
 */
export const FEEDBACK_PART_SQL =
  'SELECT id, ts, page, video, message FROM feedback WHERE ts >= ?1 AND ts < ?2 ORDER BY ts, id LIMIT ?3 OFFSET ?4';

// Before a download starts: how many rows it holds, counting at most ?3 (the
// row cap plus one), so the count itself reads at most that many index
// entries.

export const EVENTS_COUNT_SQL =
  "SELECT COUNT(*) AS n FROM (SELECT 1 FROM events WHERE type IN ('page_view', 'video_play', 'audio_play', 'handout_open') AND ts >= ?1 AND ts < ?2 LIMIT ?3)";
export const SEARCHES_COUNT_SQL =
  "SELECT COUNT(*) AS n FROM (SELECT 1 FROM events WHERE type = 'search' AND ts >= ?1 AND ts < ?2 LIMIT ?3)";
export const RATINGS_COUNT_SQL = 'SELECT COUNT(*) AS n FROM (SELECT 1 FROM ratings WHERE ts >= ?1 AND ts < ?2 LIMIT ?3)';
export const FEEDBACK_COUNT_CAPPED_SQL = 'SELECT COUNT(*) AS n FROM (SELECT 1 FROM feedback WHERE ts >= ?1 AND ts < ?2 LIMIT ?3)';

/**
 * The export tables (SPEC §14.4), by the `table` parameter:
 *   types     the event types, in file order (null: not an events table)
 *   columns   the header row, in the statement's column order
 *   partSql   one part's statement
 *   countSql  the capped count
 *   pageRows  rows per part. Workers Free allows 10 ms of CPU a request;
 *             feedback rows are longer, so its parts are smaller
 */
export const EXPORT_TABLES = new Map([
  ['ratings', Object.freeze({ types: null, columns: Object.freeze(['id', 'ts', 'page', 'video', 'stars']), partSql: RATINGS_PART_SQL, countSql: RATINGS_COUNT_SQL, pageRows: 2000 })],
  ['feedback', Object.freeze({ types: null, columns: Object.freeze(['id', 'ts', 'page', 'video', 'message']), partSql: FEEDBACK_PART_SQL, countSql: FEEDBACK_COUNT_CAPPED_SQL, pageRows: 500 })],
  ['events', Object.freeze({ types: EVENT_TYPE_ORDER, columns: Object.freeze(['ts', 'session_id', 'page', 'type', 'media', 'furthest']), partSql: EVENTS_PART_SQL, countSql: EVENTS_COUNT_SQL, pageRows: 2000 })],
  ['searches', Object.freeze({ types: Object.freeze(['search']), columns: Object.freeze(['ts', 'q', 'results']), partSql: SEARCHES_PART_SQL, countSql: SEARCHES_COUNT_SQL, pageRows: 2000 })],
]);
