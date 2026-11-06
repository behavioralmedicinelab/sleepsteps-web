// D1 writes for the API routes, and the one log line a failed write gets
// (SPEC §14.1, §17). Imports no JSON, so Node can load this module too.
//
// Queries are parameterised only (prepare().bind()), and the write is
// awaited, so a failed write answers 500. A failure logs a fixed label and
// the error's D1_ code, never its message: D1 messages can echo the bound
// values, which come from the request.

import { apiError, apiNoContent } from './http.js';

/** "D1_ERROR" from "D1_ERROR: no such table: ..."; the rest may echo bound values. */
export function d1Code(error) {
  try {
    return /^D1_[A-Z_]+/.exec(String(error?.message ?? ''))?.[0] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Run one INSERT and answer for it.
 * @param {{ DB: D1Database }} env
 * @param {string} label  the route's fixed name for the log line ("/api/rate"),
 *   a constant, never text from the request
 * @param {string} sql    the statement, with a `?` per value
 * @param {Array<string | number | null>} values  bound in order; pass null, never undefined
 * @returns {Promise<Response>} 204, or 500 "server" with one fixed log line
 */
export async function insertRow(env, label, sql, values) {
  try {
    // prepare() is inside the try, so a missing DB binding is caught too.
    await env.DB.prepare(sql).bind(...values).run();
  } catch (error) {
    console.error(`${label}: database write failed`, d1Code(error));
    return apiError(500, 'server');
  }
  return apiNoContent();
}
