// POST /api/rate (SPEC §12, §14.1, §14.2). Imports no JSON, so Node can load
// this module too.
//
// The body is exactly { page_id, video_id, stars }. Checks, in order, each
// failing with 400 and its own error code:
//   body   not a JSON object; not exactly those three keys (so a session_id,
//          even null, a client `ts`, a "__proto__" key and the events-style
//          page/video keys are all refused)
//   page   page_id not a page in pages.json
//   video  video_id not one of that page's videos
//   stars  not a JSON number that is an integer from 1 to 5 (4.0 and 1e0
//          are; "4", 4.5 and true are not)
//
// A rating is one row in `ratings`, with `ts` the server's time rounded down
// to the hour (lib/time.js), like every row the API writes (SPEC §14.1).
// There is no session_id and no events row. Changing a rating is a new row
// (§12). The D1 insert is awaited, so a failed write answers 500. Nothing
// from the request is ever logged: a failed write logs a fixed message and
// the error's D1_ code only (lib/d1.js).

import { insertRow } from '../lib/d1.js';
import { apiError, hasExactKeys, isPlainObject } from '../lib/http.js';
import { hourTimestamp } from '../lib/time.js';

/** The body's exact keys (SPEC §12). rating.js sends the same. */
export const RATE_KEYS = Object.freeze(['page_id', 'video_id', 'stars']);

/** The star scale (SPEC §12, §17: the ratings table checks the same range). */
export const MIN_STARS = 1;
export const MAX_STARS = 5;

/**
 * Check a parsed body against the rules above. Pure.
 * @param {unknown} body  the parsed JSON
 * @param {Map} index     pageIndex(pages.json)
 * @returns {{ row: { page: string, video: string, stars: number } } | { error: string }}
 */
export function validateRating(body, index) {
  if (!isPlainObject(body) || !hasExactKeys(body, RATE_KEYS)) return { error: 'body' };
  const { page_id: page, video_id: video, stars } = body;

  const entry = typeof page === 'string' ? index.get(page) : undefined;
  if (!entry) return { error: 'page' };
  if (typeof video !== 'string' || !entry.videos.has(video)) return { error: 'video' };
  if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < MIN_STARS || stars > MAX_STARS) {
    return { error: 'stars' };
  }
  return { row: { page, video, stars } };
}

/**
 * Validate and store one rating.
 * @param {unknown} body  the parsed JSON
 * @param {{ DB: D1Database }} env
 * @param {Map} index     pageIndex(pages.json)
 * @param {Date} [now]    the server's time (tests pass their own)
 * @returns {Promise<Response>} 204, 400 with the failed rule's code, or 500
 */
export async function handleRate(body, env, index, now = new Date()) {
  const result = validateRating(body, index);
  if (result.error) return apiError(400, result.error);
  const { page, video, stars } = result.row;
  return insertRow(env, '/api/rate', 'INSERT INTO ratings (ts, page, video, stars) VALUES (?, ?, ?, ?)', [
    hourTimestamp(now),
    page,
    video,
    stars,
  ]);
}
