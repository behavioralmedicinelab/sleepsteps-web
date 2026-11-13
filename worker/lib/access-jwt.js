// The Worker's own check of the Cloudflare Access token on /admin requests
// (SPEC §14.4). Imports no JSON, so Node can load this module too.
//
// Access at the edge is the first gate; this is defence in depth. It uses
// WebCrypto, with no JWT library: Cloudflare doesn't pass `ctx.access` to a
// Worker with static assets ("the router does not pass `ctx.access` to the
// user Worker"), and RS256 is one importKey and one verify.
//
// verify(request, env) resolves to { ok: true } or { ok: false, code }, the
// code from ACCESS_FAILURES. It never throws, never returns the token or a
// claim, and reads no claim beyond the ones checked (never the email). The
// first check that fails answers:
//   config         ACCESS_TEAM_DOMAIN isn't <name>.cloudflareaccess.com, or
//                  ACCESS_AUD isn't 64 hex characters: the "<TEAM>" and
//                  "<AUD_TAG>" placeholders refuse every request and fetch
//                  nothing
//   no-token       no Cf-Access-Jwt-Assertion header, or an empty one (the
//                  CF_Authorization cookie is never read: Cloudflare
//                  recommends validating the header)
//   malformed      over MAX_TOKEN_CHARS; not three base64url parts with a
//                  non-empty signature; a header or payload that isn't a
//                  UTF-8 JSON object; a `typ` other than JWT
//   alg            `alg` isn't exactly RS256, or a `crit` member is present
//   kid            `kid` isn't a string of 1-256 characters, or no key has it
//   iss            `iss` isn't exactly https://<ACCESS_TEAM_DOMAIN>
//   aud            `aud` isn't ACCESS_AUD or a list that includes it
//   type           `type` isn't "app" (an "org" token is a global session)
//   expired        `exp` missing, not a number, or more than CLOCK_SKEW_S past
//   not-yet-valid  `nbf` or `iat` present and more than CLOCK_SKEW_S ahead
//   certs          no key for `kid`, and the last certs fetch failed
//   signature      the RSASSA-PKCS1-v1_5 SHA-256 signature doesn't verify
//   error          anything unexpected (the error is dropped unread)
// The claim checks come before the key lookup, so a garbage token never
// causes a certs fetch. `jku`, `x5u` and `jwk` header members are ignored, so
// a key the token names is never fetched or trusted.
//
// Keys come from https://<team>/cdn-cgi/access/certs, from its `keys` list
// (JWKs with their kids), never from `public_cert`. They are cached in the
// verifier's closure: index.js builds one router per isolate, so that is one
// cache per isolate. Only imported CryptoKeys are cached, never a pending
// promise (workerd forbids I/O on behalf of another request), and the Cache
// API isn't available to Workers behind Access. The cache:
//   - a key fetched under KEYS_TTL_MS ago is used as it is;
//   - otherwise (stale, or an unknown kid) the certs are fetched again, at
//     most once per REFETCH_COOLDOWN_MS, so forged tokens with random kids
//     can't turn every request into a fetch. The cooldown applies only once
//     keys are held or a fetch has failed: before the first fetch succeeds,
//     every request fetches, so two requests on a new isolate don't refuse
//     each other;
//   - a fetch that succeeds replaces the whole map (rotated-out keys drop
//     off); one that fails logs one fixed line and keeps the old map, whose
//     keys stay usable for MAX_STALE_MS. Access rotates its key every 6 weeks
//     and keeps the previous one valid for 7 days, so 24 hours is safe.
//   - With no usable key the answer is a refusal (fail closed): during a
//     certs outage a forged token can't be told from a real one.

import { isPlainObject } from './http.js';

/** Where a team publishes its signing keys. */
export const CERTS_PATH = '/cdn-cgi/access/certs';

/** <team>.cloudflareaccess.com, with no scheme: one DNS label before the suffix. */
export const TEAM_DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;

/** An Access application's AUD tag, as Cloudflare's examples show it. */
export const AUD_RE = /^[0-9a-f]{64}$/;

export const MAX_TOKEN_CHARS = 8192;

/** Leeway for exp, nbf and iat, in seconds (Cloudflare's docs name none). */
export const CLOCK_SKEW_S = 60;

export const KEYS_TTL_MS = 3_600_000;
export const MAX_STALE_MS = 86_400_000;
export const REFETCH_COOLDOWN_MS = 30_000;

/** How long to wait for the certs, body included, in milliseconds. */
export const CERTS_TIMEOUT_MS = 3000;

/** Why a request was refused: `host` is the router's, the rest the verifier's. */
export const ACCESS_FAILURES = Object.freeze([
  'host', 'config', 'no-token', 'malformed', 'alg', 'kid', 'iss', 'aud', 'type', 'expired', 'not-yet-valid', 'certs', 'signature', 'error',
]);

/** Why a certs fetch failed, logged with "/admin: access certs unavailable". */
export const CERTS_FAILURES = Object.freeze(['status', 'timeout', 'network', 'bad-response', 'no-keys']);

/** The largest certs body read: Cloudflare's holds two keys and two certificates. */
const MAX_CERTS_CHARS = 65_536;

const PASSED = Object.freeze({ ok: true });
const fail = (code) => ({ ok: false, code });

const B64URL = /^[A-Za-z0-9_-]+$/;

/** One base64url part -> its bytes. The caller has checked the alphabet and length. */
function bytesOf(part) {
  const base64 = part.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A base64url part -> the plain object its UTF-8 JSON holds, or undefined. */
function objectOf(part) {
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytesOf(part)));
    return isPlainObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** True for the error AbortSignal.timeout() rejects with (a DOMException named TimeoutError). */
function isTimeout(error) {
  try {
    return error?.name === 'TimeoutError';
  } catch {
    return false;
  }
}

/** The header and claim checks, which need no key and no I/O; undefined if all pass. */
function claimFailure(header, payload, env, nowS) {
  if (header.alg !== 'RS256' || Object.hasOwn(header, 'crit')) return 'alg';
  if (Object.hasOwn(header, 'typ') && (typeof header.typ !== 'string' || header.typ.toUpperCase() !== 'JWT')) return 'malformed';
  if (typeof header.kid !== 'string' || header.kid.length < 1 || header.kid.length > 256) return 'kid';

  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return 'iss';
  const { aud } = payload;
  if (!(aud === env.ACCESS_AUD || (Array.isArray(aud) && aud.includes(env.ACCESS_AUD)))) return 'aud';
  if (payload.type !== 'app') return 'type';
  const { exp } = payload;
  if (typeof exp !== 'number' || !Number.isFinite(exp) || nowS >= exp + CLOCK_SKEW_S) return 'expired';
  for (const name of ['nbf', 'iat']) {
    if (!Object.hasOwn(payload, name)) continue;
    const value = payload[name];
    if (typeof value !== 'number' || !Number.isFinite(value) || value - CLOCK_SKEW_S > nowS) return 'not-yet-valid';
  }
  return undefined;
}

/** A certs body's `keys` -> Map(kid -> CryptoKey), keeping only RS256 signing keys. */
async function importKeys(list) {
  const keys = new Map();
  for (const jwk of list) {
    try {
      if (!isPlainObject(jwk) || jwk.kty !== 'RSA') continue;
      if (Object.hasOwn(jwk, 'alg') && jwk.alg !== 'RS256') continue;
      if (Object.hasOwn(jwk, 'use') && jwk.use !== 'sig') continue;
      const { kid, n, e } = jwk;
      if (typeof kid !== 'string' || kid.length < 1 || kid.length > 256 || keys.has(kid)) continue;
      if (typeof n !== 'string' || typeof e !== 'string') continue;
      const key = await crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n, e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      keys.set(kid, key);
    } catch {
      // A key that won't import is skipped; the error is dropped unread.
    }
  }
  return keys;
}

/**
 * @param {object} [options]
 * @param {(input: string, init: RequestInit) => Promise<Response>} [options.fetcher]
 *   tests pass their own; the default looks up the global fetch when called
 * @param {() => number} [options.now]  the clock, in ms
 * @param {number} [options.certsTimeoutMs]
 * @returns {{ verify(request: Request, env: object): Promise<{ ok: true } | { ok: false, code: string }> }}
 */
export function createAccessVerifier({
  fetcher = (input, init) => globalThis.fetch(input, init),
  now = () => Date.now(),
  certsTimeoutMs = CERTS_TIMEOUT_MS,
} = {}) {
  let cache = { team: null, keys: new Map(), fetchedAt: -Infinity, attemptedAt: -Infinity, failed: false };

  /** The team's certs -> { keys } or { failure } (one of CERTS_FAILURES). */
  async function fetchKeys(team) {
    let text;
    try {
      // The signal aborts the request; the race also bounds reading the body,
      // whatever the fetcher does with the signal.
      const signal = AbortSignal.timeout(certsTimeoutMs);
      const timedOut = new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      timedOut.catch(() => {});
      const init = { headers: { Accept: 'application/json' }, redirect: 'manual', signal };
      const response = await Promise.race([fetcher(`https://${team}${CERTS_PATH}`, init), timedOut]);
      if (!(Number.isInteger(response?.status) && response.status >= 200 && response.status < 300)) {
        // Free the unread body; not awaited, and its error is dropped.
        response?.body?.cancel?.()?.catch?.(() => {});
        return { failure: 'status' };
      }
      text = await Promise.race([response.text(), timedOut]);
    } catch (error) {
      return { failure: isTimeout(error) ? 'timeout' : 'network' };
    }
    let body;
    try {
      if (typeof text !== 'string' || text.length > MAX_CERTS_CHARS) return { failure: 'bad-response' };
      body = JSON.parse(text);
    } catch {
      return { failure: 'bad-response' };
    }
    if (!isPlainObject(body) || !Array.isArray(body.keys)) return { failure: 'bad-response' };
    const keys = await importKeys(body.keys);
    return keys.size > 0 ? { keys } : { failure: 'no-keys' };
  }

  /** The key for `kid`, or null (see the cache rules above). */
  async function keyFor(team, kid) {
    if (cache.team !== team) {
      cache = { team, keys: new Map(), fetchedAt: -Infinity, attemptedAt: -Infinity, failed: false };
    }
    const current = cache;
    if (now() - current.fetchedAt < KEYS_TTL_MS && current.keys.has(kid)) return current.keys.get(kid);

    const started = current.keys.size > 0 || current.failed;
    if (!started || now() - current.attemptedAt >= REFETCH_COOLDOWN_MS) {
      current.attemptedAt = now();
      const result = await fetchKeys(team);
      if (result.keys) {
        current.keys = result.keys;
        current.fetchedAt = now();
        current.failed = false;
      } else {
        current.failed = true;
        const failure = CERTS_FAILURES.includes(result.failure) ? result.failure : 'network';
        console.error('/admin: access certs unavailable', failure);
      }
    }
    if (current.keys.has(kid) && now() - current.fetchedAt < MAX_STALE_MS) return current.keys.get(kid);
    return null;
  }

  return {
    async verify(request, env) {
      try {
        const team = env?.ACCESS_TEAM_DOMAIN;
        const aud = env?.ACCESS_AUD;
        if (typeof team !== 'string' || !TEAM_DOMAIN_RE.test(team) || typeof aud !== 'string' || !AUD_RE.test(aud)) {
          return fail('config');
        }

        const token = request.headers.get('Cf-Access-Jwt-Assertion');
        if (token === null || token === '') return fail('no-token');
        if (typeof token !== 'string' || token.length > MAX_TOKEN_CHARS) return fail('malformed');

        const parts = token.split('.');
        if (parts.length !== 3 || !parts.every((p) => B64URL.test(p) && p.length % 4 !== 1)) return fail('malformed');
        const header = objectOf(parts[0]);
        const payload = objectOf(parts[1]);
        if (!header || !payload) return fail('malformed');

        const failure = claimFailure(header, payload, env, Math.floor(now() / 1000));
        if (failure) return fail(failure);

        const key = await keyFor(team, header.kid);
        if (!key) return fail(cache.team === team && cache.failed ? 'certs' : 'kid');

        const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
        const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytesOf(parts[2]), signed);
        return valid === true ? PASSED : fail('signature');
      } catch {
        return fail('error');
      }
    },
  };
}
