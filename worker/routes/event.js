// POST /api/event (SPEC §10, §14.1, §14.2). Imports no JSON, so Node can
// load this module too.
//
// The body is { type, page, session_id, detail } in a §10.2 shape. Checks, in
// order, each failing with 400 and its own error code:
//   body        not a JSON object; a key other than type, page, session_id
//               and detail (a client `ts` included); type, page or detail
//               missing
//   type        not one of SHAPES
//   page        not a page in pages.json; page_view from a page that doesn't
//               send one (only problem pages, start and urgent-help do);
//               search from any page but "search"
//   session_id  search: the key is present at all (null too); any other
//               type: not a lowercase v4 UUID
//   detail      not an object with exactly the type's keys; a value that
//               fails its rule (media must be a video on that page, and
//               worksheet one of that page's worksheets)
//
// The server sets `ts`: its own time rounded down to the hour for every type
// (lib/time.js), so no event carries an exact time. It stores a detail
// rebuilt from the checked values, never the client's own text. A search is
// stored without a session_id. The D1 insert is awaited, so a failed write
// answers 500. Nothing from the request is ever logged: a failed write logs
// a fixed message and the error's D1_ code only (D1 messages can echo bound
// values; lib/d1.js, shared with /api/rate).

import { insertRow } from '../lib/d1.js';
import { apiError, hasExactKeys, isPlainObject } from '../lib/http.js';
import { hourTimestamp } from '../lib/time.js';

/** type -> the exact keys of its detail (SPEC §10.2). events.js keeps the same list. */
export const SHAPES = new Map([
  ['page_view', []],
  ['search', ['q', 'results']],
  ['video_play', ['media', 'furthest']],
  ['audio_play', ['media', 'furthest']],
  ['handout_open', ['media']],
  ['worksheet_open', ['worksheet']],
]);

/** A v4 UUID as crypto.randomUUID() writes it: lowercase, version 4, RFC 4122 variant. */
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The furthest points a play can report (SPEC §9.4). */
export const FURTHEST = Object.freeze([0, 25, 50, 75, 100]);

/** The longest search text kept, in UTF-16 code units (search.js sends at most this). */
export const MAX_QUERY_LENGTH = 100;
export const MAX_SEARCH_RESULTS = 1000;

const BODY_KEYS = ['type', 'page', 'session_id', 'detail'];
const REQUIRED_KEYS = ['type', 'page', 'detail'];

/** The detail to store, rebuilt from checked values, or undefined if a value fails. */
function checkedDetail(type, detail, page) {
  const isMedia = (media) => typeof media === 'string' && page.videos.has(media);
  switch (type) {
    case 'page_view':
      return {};
    case 'search': {
      const { q, results } = detail;
      if (typeof q !== 'string' || q.trim() === '' || q.length > MAX_QUERY_LENGTH) return undefined;
      if (!Number.isInteger(results) || results < 0 || results > MAX_SEARCH_RESULTS) return undefined;
      return { q: q.trim().toWellFormed(), results };
    }
    case 'video_play':
    case 'audio_play': {
      const { media, furthest } = detail;
      if (!isMedia(media) || typeof furthest !== 'number' || !FURTHEST.includes(furthest)) return undefined;
      return { media, furthest };
    }
    case 'handout_open':
      return isMedia(detail.media) ? { media: detail.media } : undefined;
    case 'worksheet_open': {
      // One of the worksheets this page's open solution cards link (SPEC §7.6).
      const { worksheet } = detail;
      return typeof worksheet === 'string' && page.worksheets.has(worksheet) ? { worksheet } : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Check a parsed body against the rules above. Pure.
 * @param {unknown} body  the parsed JSON
 * @param {Map} index     pageIndex(pages.json)
 * @returns {{ row: { session_id, page, type, detail } } | { error: string }}
 *   row.detail is the JSON text to store.
 */
export function validateEvent(body, index) {
  if (!isPlainObject(body)) return { error: 'body' };
  if (!Object.keys(body).every((key) => BODY_KEYS.includes(key))) return { error: 'body' };
  if (!REQUIRED_KEYS.every((key) => Object.hasOwn(body, key))) return { error: 'body' };

  const { type, page, detail } = body;
  if (typeof type !== 'string' || !SHAPES.has(type)) return { error: 'type' };

  const entry = typeof page === 'string' ? index.get(page) : undefined;
  if (type === 'search' ? page !== 'search' : !entry) return { error: 'page' };
  if (type === 'page_view' && !entry.pageView) return { error: 'page' };

  if (type === 'search') {
    if (Object.hasOwn(body, 'session_id')) return { error: 'session_id' };
  } else if (typeof body.session_id !== 'string' || !UUID_V4.test(body.session_id)) {
    return { error: 'session_id' };
  }

  if (!isPlainObject(detail) || !hasExactKeys(detail, SHAPES.get(type))) return { error: 'detail' };
  const stored = checkedDetail(type, detail, entry);
  if (stored === undefined) return { error: 'detail' };

  return {
    row: {
      session_id: type === 'search' ? null : body.session_id,
      page,
      type,
      detail: JSON.stringify(stored),
    },
  };
}

/**
 * Validate and store one event.
 * @param {unknown} body  the parsed JSON
 * @param {{ DB: D1Database }} env
 * @param {Map} index     pageIndex(pages.json)
 * @param {Date} [now]    the server's time (tests pass their own)
 * @returns {Promise<Response>} 204, 400 with the failed rule's code, or 500
 */
export async function handleEvent(body, env, index, now = new Date()) {
  const result = validateEvent(body, index);
  if (result.error) return apiError(400, result.error);
  const { row } = result;

  // Every type is stored with the hour only (SPEC §14.1); a search is also
  // kept apart from the rest of its visit by having no session_id (§10.1).
  return insertRow(env, '/api/event', 'INSERT INTO events (ts, session_id, page, type, detail) VALUES (?, ?, ?, ?, ?)', [
    hourTimestamp(now),
    row.session_id,
    row.page,
    row.type,
    row.detail,
  ]);
}
