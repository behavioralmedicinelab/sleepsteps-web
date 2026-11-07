// Test helper (not a test file): RS256 key pairs, a certs body shaped like
// Cloudflare Access's, and signed tokens, for the admin tests. Runs in
// workerd with WebCrypto; nothing is fetched from Cloudflare.

export const TEAM = 'test-team.cloudflareaccess.com';
export const AUD = 'a'.repeat(8) + '0123456789abcdef'.repeat(3) + 'b'.repeat(8);
export const CERTS_URL = `https://${TEAM}/cdn-cgi/access/certs`;
/** An email the token carries; it must never reach a log line. */
export const EMAIL = 'zq-admin@example.org';
export const SUB = 'zq-sub-7d1f0c5e-4a8b-4d1e-9c2a-123456789abc';

const encoder = new TextEncoder();

/** Bytes or text -> base64url without padding. */
export function b64url(input) {
  const bytes = typeof input === 'string' ? encoder.encode(input) : new Uint8Array(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** A new RS256 key pair, and its public JWK as Cloudflare's certs list it. */
export async function makeKey(kid) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const { n, e } = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { kid, privateKey: pair.privateKey, jwk: { kid, kty: 'RSA', alg: 'RS256', use: 'sig', e, n } };
}

/** A certs body like https://<team>/cdn-cgi/access/certs: `keys`, plus certificates that must never be used. */
export function certsBody(keys) {
  return {
    keys: keys.map((key) => key.jwk ?? key),
    public_cert: { kid: 'not-a-key', cert: '-----BEGIN CERTIFICATE-----\nnot used\n-----END CERTIFICATE-----\n' },
    public_certs: keys.map((key) => ({ kid: (key.jwk ?? key).kid, cert: '-----BEGIN CERTIFICATE-----\nnot used\n-----END CERTIFICATE-----\n' })),
  };
}

/** The claims of a valid application token at `nowMs`. */
export function claims(nowMs, extra = {}) {
  const nowS = Math.floor(nowMs / 1000);
  return {
    aud: [AUD],
    email: EMAIL,
    exp: nowS + 600,
    iat: nowS - 5,
    nbf: nowS - 5,
    iss: `https://${TEAM}`,
    type: 'app',
    identity_nonce: 'zq-nonce',
    sub: SUB,
    country: 'AU',
    ...extra,
  };
}

/** A token signed with `key`'s private key: header {alg, kid, typ} plus `header`. */
export async function signToken(key, payload, header = {}) {
  const head = b64url(JSON.stringify({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header }));
  const body = b64url(JSON.stringify(payload));
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, encoder.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(signature)}`;
}

/** A fetcher that records every call and answers the certs URL with `answer()` (a Response or a promise of one). */
export function certsFetcher(answer) {
  const calls = [];
  const fetcher = async (input, init) => {
    calls.push({ url: String(input), init });
    return answer(String(input), init);
  };
  return { calls, fetcher };
}
