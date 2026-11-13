// POST /api/feedback (SPEC §13, §14.1-§14.3). Imports no JSON, so Node can
// load this module too.
//
// The body is exactly { page_id, message, turnstile_token }, or those three
// and video_id: feedback.js adds it only when the dialog was opened from a
// video's "Feedback" button (project lead, 2026-11-13). Checks, in order;
// the first that fails answers:
//   400 body       not a JSON object; not exactly those three keys, with or
//                  without video_id (so a page_title, a client `ts`, a
//                  session_id and a "__proto__" key are all refused)
//   400 page       page_id not a page in pages.json (the 404 page has none,
//                  and a path is never accepted)
//   400 video      video_id is there and isn't one of that page's videos in
//                  pages.json (so null, a number and a video of another page
//                  are refused, and a page without videos accepts none)
//   400 message    not a string, or 0 or over 2000 UTF-16 code units (what
//                  the textarea's maxlength counts) once cleaned (below)
//   403 turnstile  turnstile_token not a string of 1-2048 characters
//   500 server     no TURNSTILE_SECRET (logged)
//   403 / 500      Siteverify's answer (lib/turnstile.js); called only once
//                  the body has passed every check above
// and then the D1 write: 204, or 500 (lib/d1.js).
//
// The message is cleaned before it is measured and stored, so a visitor is
// never refused for characters they can't see: CRLF and lone CR become LF;
// C0 and C1 control characters other than tab and LF are removed (NUL would
// cut SQLite text short); lone surrogates become U+FFFD (toWellFormed());
// then it is trimmed.
//
// A message is one `feedback` row: `ts` the server's time rounded down to the
// hour (lib/time.js, as for every row the API writes); `page` the checked
// page_id, and no title (the admin page shows the page's current title from
// pages.json, SPEC §14.4); `video` the checked video_id, or NULL when the
// body has none (migration 0003); `message` the cleaned text. No events row
// and no session_id. Nothing from the request is ever logged: not the
// message, the token, the IP address passed to Siteverify or the secret. The
// log lines are fixed texts plus a code from a closed list.

import { insertRow } from '../lib/d1.js';
import { apiError, hasExactKeys, isPlainObject } from '../lib/http.js';
import { hourTimestamp } from '../lib/time.js';
import { verifyTurnstile } from '../lib/turnstile.js';

/** The body's exact keys (SPEC §13). feedback.js sends the same. */
export const FEEDBACK_KEYS = Object.freeze(['page_id', 'message', 'turnstile_token']);

/** The one optional key: the video a message is about (SPEC §13). The body's keys are FEEDBACK_KEYS, or those and this. */
export const FEEDBACK_VIDEO_KEY = 'video_id';
const FEEDBACK_KEYS_WITH_VIDEO = Object.freeze([...FEEDBACK_KEYS, FEEDBACK_VIDEO_KEY]);

/** The longest message stored, in UTF-16 code units: the textarea's maxlength (SPEC §13). */
export const MAX_MESSAGE_LENGTH = 2000;

/** The longest Turnstile token accepted: Cloudflare's documented maximum. */
export const MAX_TOKEN_LENGTH = 2048;

const LOG = '/api/feedback';

// C0 controls but tab (U+0009) and LF (U+000A), DEL and the C1 controls. CR
// (U+000D) is gone by then, turned into LF.
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * The message as stored: line breaks made LF, control characters other than
 * tab and LF removed, lone surrogates replaced, then trimmed. Pure.
 * @param {string} message
 * @returns {string}
 */
export function cleanMessage(message) {
  return message.replace(/\r\n?/g, '\n').replace(CONTROLS, '').toWellFormed().trim();
}

/**
 * Check a parsed body against the rules above, up to Siteverify. Pure.
 * @param {unknown} body  the parsed JSON
 * @param {Map} index     pageIndex(pages.json)
 * @returns {{ row: { page: string, video: string | null, message: string }, token: string }
 *   | { status: 400 | 403, error: string }}  `video` is null when the body has no video_id
 */
export function validateFeedback(body, index) {
  if (!isPlainObject(body)) return { status: 400, error: 'body' };
  const hasVideo = Object.hasOwn(body, FEEDBACK_VIDEO_KEY);
  if (!hasExactKeys(body, hasVideo ? FEEDBACK_KEYS_WITH_VIDEO : FEEDBACK_KEYS)) return { status: 400, error: 'body' };
  const { page_id: page, message, turnstile_token: token } = body;

  const entry = typeof page === 'string' ? index.get(page) : undefined;
  if (!entry) return { status: 400, error: 'page' };

  // No key: no video (stored as NULL). A key, even with null, must name one.
  const video = hasVideo ? body[FEEDBACK_VIDEO_KEY] : null;
  if (hasVideo && (typeof video !== 'string' || !entry.videos.has(video))) return { status: 400, error: 'video' };

  if (typeof message !== 'string') return { status: 400, error: 'message' };
  const cleaned = cleanMessage(message);
  if (cleaned.length === 0 || cleaned.length > MAX_MESSAGE_LENGTH) return { status: 400, error: 'message' };

  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { status: 403, error: 'turnstile' };
  }

  return { row: { page, video, message: cleaned }, token };
}

/**
 * Validate, verify and store one message.
 * @param {unknown} body  the parsed JSON
 * @param {{ DB: D1Database, TURNSTILE_SECRET?: string }} env
 * @param {Map} index     pageIndex(pages.json)
 * @param {object} [context]  from the router, and tests
 * @param {string | null} [context.remoteIp]  CF-Connecting-IP, for Siteverify only
 * @param {Date} [context.now]  the server's time
 * @param {Function} [context.fetcher]  and
 * @param {number} [context.timeoutMs]  passed to verifyTurnstile (tests)
 * @returns {Promise<Response>} 204; 400 or 403 with the failed rule's code; or 500
 */
export async function handleFeedback(body, env, index, { remoteIp = null, now = new Date(), fetcher, timeoutMs } = {}) {
  const result = validateFeedback(body, index);
  if (result.error) return apiError(result.status, result.error);

  const secret = env?.TURNSTILE_SECRET;
  if (typeof secret !== 'string' || secret === '') {
    console.error(`${LOG}: TURNSTILE_SECRET missing`);
    return apiError(500, 'server');
  }

  const check = await verifyTurnstile({ token: result.token, secret, remoteIp, fetcher, timeoutMs });
  if (!check.ok) {
    if (check.status === 403) return apiError(403, 'turnstile');
    console.error(`${LOG}: ${check.log}`, check.code);
    return apiError(500, 'server');
  }

  // `video` is the checked id or null, never undefined (lib/d1.js).
  const { page, video, message } = result.row;
  return insertRow(env, LOG, 'INSERT INTO feedback (ts, page, video, message) VALUES (?, ?, ?, ?)', [hourTimestamp(now), page, video, message]);
}
