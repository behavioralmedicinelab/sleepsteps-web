// Checking a Turnstile token with Cloudflare's Siteverify API (SPEC §14.3),
// for /api/feedback. Imports no JSON, so Node can load this module too.
//
// One POST, form-encoded: `secret`, `response` (the token) and `remoteip`,
// the last only when the router has a CF-Connecting-IP to give (never
// X-Forwarded-For). The IP is used for this check only: it is never stored or
// logged. One attempt, no retries and so no `idempotency_key`; a token is
// single-use and valid for 300 seconds anyway.
//
// It gives up after SITEVERIFY_TIMEOUT_MS, well inside the 5 seconds the
// browser waits (TIMEOUT_MS in src/js/api.js; a test keeps the gap), so the
// dialog never shows a stored message as failed and invites a second copy.
//
// Fail closed: only an HTTP 2xx answer whose JSON has `success` exactly true
// passes (the string "true" doesn't). Hostname, action and cdata are not
// checked: a test secret always answers hostname "example.com" with no action
// or cdata, which would break local runs and previews; the widget's hostname
// list, the router's Origin check and API_HOSTS already limit where a token
// can come from. The outcomes:
//
//   { ok: true }
//   { ok: false, status: 403 }   the token's fault: invalid, expired, spent
//                                or missing, or no reason given
//   { ok: false, status: 500, log, code }
//                                ours or Cloudflare's: `log` is a fixed text
//                                and `code` comes from a closed list, so the
//                                route can log both (SPEC §14.1)
//
// It never throws, and never logs: an error's message is dropped unread.

/** Cloudflare's Siteverify endpoint (SPEC §14.3). */
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** How long to wait for Siteverify's answer, body included, in milliseconds. */
export const SITEVERIFY_TIMEOUT_MS = 3000;

/** Error codes that mean the token failed: answered 403 "turnstile". */
export const TOKEN_ERRORS = Object.freeze(['invalid-input-response', 'timeout-or-duplicate', 'missing-input-response']);

/** Error codes that mean our request was refused (a missing, wrong or malformed secret): 500. */
export const REQUEST_ERRORS = Object.freeze(['missing-input-secret', 'invalid-input-secret', 'bad-request']);

/** The fixed reasons logged when Siteverify can't give an answer: 500. */
export const UNAVAILABLE_REASONS = Object.freeze(['internal-error', 'timeout', 'network', 'bad-response', 'other']);

const PASSED = Object.freeze({ ok: true });
const REFUSED = Object.freeze({ ok: false, status: 403 });
const unavailable = (code) => ({ ok: false, status: 500, log: 'siteverify unavailable', code });
const refusedRequest = (code) => ({ ok: false, status: 500, log: 'siteverify refused the request', code });

/** True for the error AbortSignal.timeout() rejects with (a DOMException named TimeoutError). */
function isTimeout(error) {
  try {
    return error?.name === 'TimeoutError';
  } catch {
    return false;
  }
}

/**
 * Siteverify's parsed answer, and whether its status was 2xx -> an outcome
 * above. Anything unexpected is a 500: an answer that isn't an object,
 * error-codes that isn't a list, an unknown code, or a non-2xx answer that
 * names no code.
 */
function outcome(ok, result) {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) return unavailable('bad-response');
  if (ok && result.success === true) return PASSED;

  const codes = result['error-codes'] ?? [];
  if (!Array.isArray(codes)) return unavailable('bad-response');
  // Ours first: a wrong secret makes every token fail too.
  const refused = REQUEST_ERRORS.find((code) => codes.includes(code));
  if (refused) return refusedRequest(refused);
  if (codes.includes('internal-error')) return unavailable('internal-error');
  if (codes.every((code) => TOKEN_ERRORS.includes(code))) {
    // A 2xx with no reason, or with only the token's: the token failed. A
    // non-2xx that blames nothing is Siteverify's fault.
    return ok || codes.length > 0 ? REFUSED : unavailable('bad-response');
  }
  return unavailable('other');
}

/**
 * Check one Turnstile token.
 * @param {object} options
 * @param {string} options.token     the widget's token, already checked as a
 *   string of 1-2048 characters
 * @param {string} options.secret    env.TURNSTILE_SECRET, already checked as non-empty
 * @param {string | null} [options.remoteIp]  CF-Connecting-IP, sent only if a
 *   non-empty string
 * @param {(input: string, init: RequestInit) => Promise<Response>} [options.fetcher]
 *   tests pass their own; the default looks up the global fetch when called
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ ok: true } | { ok: false, status: 403 } | { ok: false, status: 500, log: string, code: string }>}
 */
export async function verifyTurnstile({
  token,
  secret,
  remoteIp = null,
  fetcher = (input, init) => fetch(input, init),
  timeoutMs = SITEVERIFY_TIMEOUT_MS,
}) {
  let ok;
  let text;
  try {
    const form = new URLSearchParams({ secret, response: token });
    if (typeof remoteIp === 'string' && remoteIp !== '') form.set('remoteip', remoteIp);
    // The signal aborts the request; the race also bounds reading the body,
    // whatever the fetcher does with the signal.
    const signal = AbortSignal.timeout(timeoutMs);
    const timedOut = new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    timedOut.catch(() => {});
    const response = await Promise.race([fetcher(SITEVERIFY_URL, { method: 'POST', body: form, signal }), timedOut]);
    ok = Number.isInteger(response?.status) && response.status >= 200 && response.status < 300;
    text = await Promise.race([response.text(), timedOut]);
  } catch (error) {
    return unavailable(isTimeout(error) ? 'timeout' : 'network');
  }

  let result;
  try {
    result = JSON.parse(text);
  } catch {
    return unavailable('bad-response');
  }
  return outcome(ok, result);
}
