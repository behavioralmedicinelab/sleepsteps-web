// Responses, request reading and body-shape checks for the API (SPEC §14.1).
// Imports no JSON, so Node can load this module too.
//
// Every API response carries `Cache-Control: no-store` and
// `X-Content-Type-Options: nosniff`. Success is 204 with no body. Errors are
// `{"error":"<code>"}`, from the closed list in ERROR_CODES; the 404s keep
// the plain "Not found" of every other 404, so a disabled feature, collection
// switched off and a host that isn't allowed all look the same (SPEC §11).

/** The largest request body read, in raw bytes (SPEC §14.1). */
export const MAX_BODY_BYTES = 4096;

export const ERROR_CODES = Object.freeze([
  'body', 'type', 'page', 'session_id', 'detail', 'video', 'stars', 'origin', 'content_type', 'too_large', 'method', 'server',
]);

const API_HEADERS = Object.freeze({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });

export function apiNotFound() {
  return new Response('Not found', { status: 404, headers: API_HEADERS });
}

export function apiNoContent() {
  return new Response(null, { status: 204, headers: API_HEADERS });
}

/** `{"error": code}` with this status; `headers` adds to the usual ones (405's Allow). */
export function apiError(status, code, headers = {}) {
  if (!ERROR_CODES.includes(code)) throw new Error('apiError: unknown error code');
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { ...API_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

/** The request's media type, lowercased, without parameters: "text/plain". */
export function mediaType(request) {
  return (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
}

/**
 * The request body as bytes, or null if it is larger than `max` bytes. A
 * declared Content-Length over the limit is refused without reading; the
 * body is also counted as it streams (a body sent without Content-Length, or
 * longer than declared), and reading stops at the first byte past the limit.
 */
export async function readBody(request, max = MAX_BODY_BYTES) {
  const declared = Number(request.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    size += chunk.byteLength;
    if (size > max) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** What parseJson() returns for a body that isn't UTF-8 JSON. */
export const INVALID_JSON = Symbol('invalid JSON');

/**
 * Bytes -> the parsed JSON value, or INVALID_JSON for invalid UTF-8 or
 * invalid JSON. The parser's error is dropped unread: V8's messages quote
 * the input.
 */
export function parseJson(bytes) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return INVALID_JSON;
  }
}

/**
 * True for a plain object as JSON.parse makes one: not null, not an array,
 * and with Object.prototype as its prototype (so not Object.create(null) or
 * a class instance).
 */
export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * True if `object`'s own enumerable keys are exactly `keys`, in any order.
 * A JSON "__proto__" key is an own key, so it counts as an extra one.
 */
export function hasExactKeys(object, keys) {
  const own = Object.keys(object);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(object, key));
}
