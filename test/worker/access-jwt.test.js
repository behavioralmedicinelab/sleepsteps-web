// The Worker's own check of the Cloudflare Access token (SPEC §14.4,
// worker/lib/access-jwt.js): config, token shape, header, claims, keys and
// their cache, the certs fetch, and that it never throws or logs a token or
// claim. Runs in workerd with WebCrypto; the certs fetcher and the clock are
// passed in, so nothing reaches Cloudflare.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCESS_FAILURES,
  AUD_RE,
  CERTS_FAILURES,
  CERTS_PATH,
  CERTS_TIMEOUT_MS,
  CLOCK_SKEW_S,
  createAccessVerifier,
  KEYS_TTL_MS,
  MAX_STALE_MS,
  MAX_TOKEN_CHARS,
  REFETCH_COOLDOWN_MS,
  TEAM_DOMAIN_RE,
} from '../../worker/lib/access-jwt.js';
import { AUD, b64url, CERTS_URL, certsBody, certsFetcher, claims, EMAIL, makeKey, signToken, SUB, TEAM } from './access-tokens.js';

const T0 = Date.parse('2026-11-06T13:30:00.000Z');
const ENV = Object.freeze({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD });

let k1;
let k2;
let attacker;
beforeAll(async () => {
  [k1, k2, attacker] = await Promise.all([makeKey('kid-one'), makeKey('kid-two'), makeKey('kid-one')]);
});

let logged;
let tokens;
beforeEach(() => {
  logged = [];
  tokens = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    vi.spyOn(console, method).mockImplementation((...args) => logged.push([method, ...args.map(String)]));
  }
});
afterEach(() => {
  // No log line holds a token, a part of one, a claim, the kid, the URL or the team.
  const text = JSON.stringify(logged);
  for (const token of tokens) {
    for (const part of token.split('.')) if (part.length >= 8) expect(text).not.toContain(part);
  }
  for (const secret of [EMAIL, SUB, 'kid-one', 'kid-two', TEAM, CERTS_URL, 'zq-nonce']) expect(text).not.toContain(secret);
  vi.restoreAllMocks();
});

/** A request carrying `token` in Cf-Access-Jwt-Assertion (none if undefined). */
function request(token, headers = {}) {
  const h = new Headers(headers);
  if (token !== undefined) {
    h.set('Cf-Access-Jwt-Assertion', token);
    tokens.push(token);
  }
  return new Request('https://example.com/admin/', { headers: h });
}

/** A verifier on a fake clock whose fetcher answers with `answer` (default: certs of [k1]). */
function setup(answer = () => Response.json(certsBody([k1])), options = {}) {
  const clock = { now: T0 };
  const { calls, fetcher } = certsFetcher(answer);
  const verifier = createAccessVerifier({ fetcher, now: () => clock.now, ...options });
  return { clock, calls, verifier, verify: (req, env = ENV) => verifier.verify(req, env) };
}

const token = (key = k1, extra = {}, header = {}) => signToken(key, claims(T0, extra), header);
const logs = () => logged.filter(([method]) => method === 'error').map(([, ...args]) => args);

describe('constants (SPEC §14.4)', () => {
  it('match Cloudflare Access', () => {
    expect(CERTS_PATH).toBe('/cdn-cgi/access/certs');
    expect(CLOCK_SKEW_S).toBe(60);
    expect(KEYS_TTL_MS).toBe(3_600_000);
    expect(MAX_STALE_MS).toBe(86_400_000);
    expect(REFETCH_COOLDOWN_MS).toBe(30_000);
    expect(CERTS_TIMEOUT_MS).toBe(3000);
    expect(MAX_TOKEN_CHARS).toBe(8192);
    expect(ACCESS_FAILURES).toContain('host');
    expect(ACCESS_FAILURES).toContain('error');
    expect(CERTS_FAILURES).toEqual(['status', 'timeout', 'network', 'bad-response', 'no-keys']);
  });

  it('accept a team domain without a scheme and a 64-hex AUD, and refuse the placeholders', () => {
    expect(TEAM_DOMAIN_RE.test(TEAM)).toBe(true);
    for (const bad of ['<TEAM>.cloudflareaccess.com', 'https://test-team.cloudflareaccess.com', 'test-team.cloudflareaccess.com.evil.org', 'a.b.cloudflareaccess.com', '-x.cloudflareaccess.com', 'Test.cloudflareaccess.com', '']) {
      expect(TEAM_DOMAIN_RE.test(bad), bad).toBe(false);
    }
    expect(AUD_RE.test(AUD)).toBe(true);
    for (const bad of ['<AUD_TAG>', AUD.toUpperCase(), `${AUD}0`, AUD.slice(1)]) expect(AUD_RE.test(bad), bad).toBe(false);
  });
});

describe('a valid token', () => {
  it('passes, with exactly one certs fetch: the certs URL, Accept JSON, no redirects, a signal', async () => {
    const { calls, verify } = setup();
    expect(await verify(request(await token()))).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    expect(url).toBe(CERTS_URL);
    expect(init.redirect).toBe('manual');
    expect(new Headers(init.headers).get('Accept')).toBe('application/json');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('passes with aud as a string or as a list that includes the AUD', async () => {
    const { verify } = setup();
    expect(await verify(request(await token(k1, { aud: AUD })))).toEqual({ ok: true });
    expect(await verify(request(await token(k1, { aud: ['other', AUD] })))).toEqual({ ok: true });
  });

  it('passes with exp 30 s ago (within the leeway), and with no nbf or iat', async () => {
    const { verify } = setup();
    const nowS = Math.floor(T0 / 1000);
    expect(await verify(request(await token(k1, { exp: nowS - 30 })))).toEqual({ ok: true });
    expect(await verify(request(await token(k1, { nbf: undefined, iat: undefined })))).toEqual({ ok: true });
    expect(await verify(request(await token(k1, { nbf: nowS + 30, iat: nowS + 30 })))).toEqual({ ok: true });
  });

  it('passes without a typ, and with typ "jwt"', async () => {
    const { verify } = setup();
    expect(await verify(request(await token(k1, {}, { typ: undefined })))).toEqual({ ok: true });
    expect(await verify(request(await token(k1, {}, { typ: 'jwt' })))).toEqual({ ok: true });
  });

  it('uses the default fetcher, looked up when called: globalThis.fetch with the certs URL', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(certsBody([k1])));
    const verifier = createAccessVerifier({ now: () => T0 });
    expect(await verifier.verify(request(await token()), ENV)).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(1);
    const [input, init] = spy.mock.calls[0];
    expect(String(input)).toBe(CERTS_URL);
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('refused with no certs fetch', () => {
  it.each([
    ['the placeholders', { ACCESS_TEAM_DOMAIN: '<TEAM>.cloudflareaccess.com', ACCESS_AUD: '<AUD_TAG>' }],
    ['a placeholder team', { ACCESS_TEAM_DOMAIN: '<TEAM>.cloudflareaccess.com', ACCESS_AUD: AUD }],
    ['a placeholder AUD', { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: '<AUD_TAG>' }],
    ['a team with a scheme', { ACCESS_TEAM_DOMAIN: `https://${TEAM}`, ACCESS_AUD: AUD }],
    ['an uppercase AUD', { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD.toUpperCase() }],
    ['no vars', {}],
    ['no env', undefined],
  ])('config: %s', async (_, env) => {
    const { calls, verifier } = setup();
    expect(await verifier.verify(request(await token()), env)).toEqual({ ok: false, code: 'config' });
    expect(calls).toEqual([]);
  });

  it('no-token: no header, or a valid token only in the CF_Authorization cookie', async () => {
    const { calls, verify } = setup();
    expect(await verify(request(undefined))).toEqual({ ok: false, code: 'no-token' });
    const t = await token();
    tokens.push(t);
    expect(await verify(request(undefined, { Cookie: `CF_Authorization=${t}` }))).toEqual({ ok: false, code: 'no-token' });
    expect(calls).toEqual([]);
  });

  it('malformed: the shape of the token', async () => {
    const { calls, verify } = setup();
    const good = await token();
    const [h, p, s] = good.split('.');
    const cases = [
      '',
      'x'.repeat(MAX_TOKEN_CHARS + 1),
      `${h}.${p}`,
      `${h}.${p}.${s}.${s}`,
      `${h}.${p}.`,
      `${h}=.${p}.${s}`,
      `${h}.${p}.${s.slice(0, 10)}+${s.slice(11)}`,
      `${h}.${p}.${s.slice(0, 10)}/${s.slice(11)}`,
      `${b64url('not json')}.${p}.${s}`,
      `${h}.${b64url('[1,2]')}.${s}`,
      `${h}.${b64url('null')}.${s}`,
      `${h}.${b64url('"text"')}.${s}`,
      `${b64url(new Uint8Array([0xff, 0xfe, 0x7b, 0x7d]))}.${p}.${s}`,
      // A part whose length leaves 1 over 4 can't be base64url.
      `a.${p}.${s}`,
      `${h}.${p}.aaaaa`,
    ];
    for (const value of cases) {
      const res = await verify(request(value));
      expect(res, JSON.stringify(value.slice(0, 40))).toEqual({ ok: false, code: value === '' ? 'no-token' : 'malformed' });
    }
    expect(await verify(request(await token(k1, {}, { typ: 'JWS' })))).toEqual({ ok: false, code: 'malformed' });
    expect(calls).toEqual([]);
  });

  it('alg: none (with or without a signature), HS256 signed with the public key, RS512, crit', async () => {
    const { calls, verify } = setup();
    const payload = b64url(JSON.stringify(claims(T0)));
    const none = b64url(JSON.stringify({ alg: 'none', kid: 'kid-one', typ: 'JWT' }));
    expect(await verify(request(`${none}.${payload}.`))).toEqual({ ok: false, code: 'malformed' });
    expect(await verify(request(`${none}.${payload}.${b64url('sig')}`))).toEqual({ ok: false, code: 'alg' });

    const hsHeader = b64url(JSON.stringify({ alg: 'HS256', kid: 'kid-one', typ: 'JWT' }));
    const secret = await crypto.subtle.importKey('raw', new TextEncoder().encode(k1.jwk.n), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = await crypto.subtle.sign('HMAC', secret, new TextEncoder().encode(`${hsHeader}.${payload}`));
    expect(await verify(request(`${hsHeader}.${payload}.${b64url(mac)}`))).toEqual({ ok: false, code: 'alg' });

    expect(await verify(request(await token(k1, {}, { alg: 'RS512' })))).toEqual({ ok: false, code: 'alg' });
    expect(await verify(request(await token(k1, {}, { crit: ['exp'] })))).toEqual({ ok: false, code: 'alg' });
    expect(calls).toEqual([]);
  });

  it('kid: missing, empty, not a string or over 256 characters', async () => {
    const { calls, verify } = setup();
    for (const kid of [undefined, '', 7, 'k'.repeat(257)]) {
      expect(await verify(request(await signToken({ ...k1, kid }, claims(T0)))), String(kid)).toEqual({ ok: false, code: 'kid' });
    }
    expect(calls).toEqual([]);
  });

  it('iss: another team, http, or a trailing slash', async () => {
    const { calls, verify } = setup();
    for (const iss of ['https://other-team.cloudflareaccess.com', `http://${TEAM}`, `https://${TEAM}/`, TEAM, undefined]) {
      expect(await verify(request(await token(k1, { iss }))), String(iss)).toEqual({ ok: false, code: 'iss' });
    }
    expect(calls).toEqual([]);
  });

  it('aud: a string or list without the AUD', async () => {
    const { calls, verify } = setup();
    for (const aud of ['b'.repeat(64), ['b'.repeat(64)], [], undefined, AUD.toUpperCase(), [[AUD]]]) {
      expect(await verify(request(await token(k1, { aud }))), JSON.stringify(aud)).toEqual({ ok: false, code: 'aud' });
    }
    expect(calls).toEqual([]);
  });

  it("type: 'org' or missing", async () => {
    const { calls, verify } = setup();
    for (const type of ['org', undefined, 'APP']) {
      expect(await verify(request(await token(k1, { type }))), String(type)).toEqual({ ok: false, code: 'type' });
    }
    expect(calls).toEqual([]);
  });

  it('expired: exp more than 60 s past, missing or not a number', async () => {
    const { calls, verify } = setup();
    const nowS = Math.floor(T0 / 1000);
    for (const exp of [nowS - 60, nowS - 61, nowS - 3600, undefined, String(nowS + 600), null]) {
      expect(await verify(request(await token(k1, { exp }))), String(exp)).toEqual({ ok: false, code: 'expired' });
    }
    expect(calls).toEqual([]);
  });

  it('not-yet-valid: nbf or iat more than 60 s ahead, or not a number', async () => {
    const { calls, verify } = setup();
    const nowS = Math.floor(T0 / 1000);
    for (const extra of [{ nbf: nowS + 61 }, { iat: nowS + 61 }, { nbf: 'soon' }, { iat: null }]) {
      expect(await verify(request(await token(k1, extra))), JSON.stringify(extra)).toEqual({ ok: false, code: 'not-yet-valid' });
    }
    expect(calls).toEqual([]);
  });
});

describe('signature and keys', () => {
  it('signature: a payload changed after signing, or the right kid signed by another key', async () => {
    const { verify } = setup();
    const [h, , s] = (await token()).split('.');
    const changed = `${h}.${b64url(JSON.stringify(claims(T0, { email: 'zq-other@example.org' })))}.${s}`;
    expect(await verify(request(changed))).toEqual({ ok: false, code: 'signature' });
    expect(await verify(request(await token(attacker)))).toEqual({ ok: false, code: 'signature' });
  });

  it('never fetches or trusts a key the token names (jku, x5u, jwk)', async () => {
    const { calls, verify } = setup();
    const header = { jku: 'https://evil.example/jwks', x5u: 'https://evil.example/x5u', jwk: attacker.jwk };
    expect(await verify(request(await token(attacker, {}, header)))).toEqual({ ok: false, code: 'signature' });
    expect(calls.map((c) => c.url)).toEqual([CERTS_URL]);
  });

  it.each([
    ['use enc', { use: 'enc' }],
    ['alg RS512', { alg: 'RS512' }],
    ['kty EC', { kty: 'EC' }],
    ['no n', { n: undefined }],
    ['a broken n', { n: '!!' }],
  ])('certs whose only key has %s: no-keys, then certs', async (_, change) => {
    const { verify } = setup(() => Response.json({ keys: [{ ...k1.jwk, ...change }] }));
    expect(await verify(request(await token()))).toEqual({ ok: false, code: 'certs' });
    expect(logs()).toEqual([['/admin: access certs unavailable', 'no-keys']]);
  });

  it('imports only from keys, never public_cert', async () => {
    const { verify } = setup(() => Response.json({ public_cert: { kid: 'kid-one', cert: 'x' }, public_certs: [{ kid: 'kid-one', cert: 'x' }] }));
    expect(await verify(request(await token()))).toEqual({ ok: false, code: 'certs' });
    expect(logs()).toEqual([['/admin: access certs unavailable', 'bad-response']]);
  });
});

describe('the key cache', () => {
  it('makes no second fetch within the hour, and refetches once after it', async () => {
    const { calls, clock, verify } = setup();
    expect(await verify(request(await token()))).toEqual({ ok: true });
    clock.now += KEYS_TTL_MS - 1000;
    expect(await verify(request(await signToken(k1, claims(clock.now))))).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    clock.now += 2000;
    expect(await verify(request(await signToken(k1, claims(clock.now))))).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it('refetches once for an unknown kid, then not again within 30 s (kid)', async () => {
    const { calls, clock, verify } = setup();
    expect(await verify(request(await token()))).toEqual({ ok: true });
    // Within 30 s of the last fetch, an unknown kid makes no fetch.
    clock.now += 1000;
    expect(await verify(request(await signToken(k2, claims(clock.now))))).toEqual({ ok: false, code: 'kid' });
    expect(calls).toHaveLength(1);
    clock.now += REFETCH_COOLDOWN_MS;
    expect(await verify(request(await signToken(k2, claims(clock.now))))).toEqual({ ok: false, code: 'kid' });
    expect(calls).toHaveLength(2);
    clock.now += 1000;
    const stranger = { ...k2, kid: 'kid-three' };
    expect(await verify(request(await signToken(stranger, claims(clock.now))))).toEqual({ ok: false, code: 'kid' });
    expect(calls).toHaveLength(2);
    clock.now += REFETCH_COOLDOWN_MS;
    expect(await verify(request(await signToken(stranger, claims(clock.now))))).toEqual({ ok: false, code: 'kid' });
    expect(calls).toHaveLength(3);
  });

  it('accepts a newly rotated-in key without waiting for the hour (an unknown kid refetches)', async () => {
    let keys = [k1];
    const { calls, clock, verify } = setup(() => Response.json(certsBody(keys)));
    expect(await verify(request(await token()))).toEqual({ ok: true });
    keys = [k1, k2];
    clock.now += REFETCH_COOLDOWN_MS;
    expect(await verify(request(await signToken(k2, claims(clock.now))))).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(await verify(request(await signToken(k1, claims(clock.now))))).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it('after the hour, certs of [k2] alone refuse k1 (rotated-out keys drop off)', async () => {
    let keys = [k1, k2];
    const { clock, verify } = setup(() => Response.json(certsBody(keys)));
    expect(await verify(request(await token()))).toEqual({ ok: true });
    keys = [k2];
    clock.now += KEYS_TTL_MS + 1;
    expect(await verify(request(await signToken(k1, claims(clock.now))))).toEqual({ ok: false, code: 'kid' });
    expect(await verify(request(await signToken(k2, claims(clock.now))))).toEqual({ ok: true });
  });

  it.each([
    ['a 500', () => new Response('no', { status: 500 }), 'status'],
    ['a redirect', () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/' } }), 'status'],
    ['a rejected fetch', () => Promise.reject(new TypeError('zq-network-detail')), 'network'],
    ['non-JSON', () => new Response('<html>'), 'bad-response'],
    ['keys not a list', () => Response.json({ keys: { kid: 'kid-one' } }), 'bad-response'],
    ['an array body', () => Response.json([k1.jwk]), 'bad-response'],
    ['a fetcher that never answers', () => new Promise(() => {}), 'timeout'],
  ])('after %s, keeps a cached key for 24 hours, then refuses (certs)', async (_, failure, reason) => {
    let fail = false;
    const { calls, clock, verify } = setup(() => (fail ? failure() : Response.json(certsBody([k1]))), { certsTimeoutMs: 50 });
    expect(await verify(request(await token()))).toEqual({ ok: true });
    fail = true;
    clock.now += KEYS_TTL_MS + 1;
    expect(await verify(request(await signToken(k1, claims(clock.now))))).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(logs()).toEqual([['/admin: access certs unavailable', reason]]);
    clock.now = T0 + MAX_STALE_MS + 1;
    expect(await verify(request(await signToken(k1, claims(clock.now))))).toEqual({ ok: false, code: 'certs' });
    expect(JSON.stringify(logged)).not.toContain('zq-network-detail');
  });

  it('with no cache, a failed fetch refuses (certs), and is retried only after 30 s', async () => {
    let status = 503;
    const { calls, clock, verify } = setup(() => (status === 200 ? Response.json(certsBody([k1])) : new Response('', { status })));
    expect(await verify(request(await token()))).toEqual({ ok: false, code: 'certs' });
    clock.now += 1000;
    expect(await verify(request(await signToken(k1, claims(clock.now))))).toEqual({ ok: false, code: 'certs' });
    expect(calls).toHaveLength(1);
    status = 200;
    clock.now += REFETCH_COOLDOWN_MS;
    expect(await verify(request(await signToken(k1, claims(clock.now))))).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(logs()).toEqual([['/admin: access certs unavailable', 'status']]);
  });

  it('lets two concurrent first requests on a new verifier both pass (no cooldown before the first keys)', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const { calls, verify } = setup(async () => {
      await gate;
      return Response.json(certsBody([k1]));
    });
    const [a, b] = [verify(request(await token())), verify(request(await token()))];
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    expect(await a).toEqual({ ok: true });
    expect(await b).toEqual({ ok: true });
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('starts again for a different team domain', async () => {
    const other = 'other-team.cloudflareaccess.com';
    const { calls, verify } = setup((url) => (url.startsWith(`https://${other}/`) ? Response.json(certsBody([k2])) : Response.json(certsBody([k1]))));
    expect(await verify(request(await token()))).toEqual({ ok: true });
    const env = { ACCESS_TEAM_DOMAIN: other, ACCESS_AUD: AUD };
    expect(await verify(request(await token(k1, { iss: `https://${other}` })), env)).toEqual({ ok: false, code: 'kid' });
    expect(await verify(request(await token(k2, { iss: `https://${other}` })), env)).toEqual({ ok: true });
    expect(calls.map((c) => c.url)).toEqual([CERTS_URL, `https://${other}${CERTS_PATH}`]);
  });
});

describe('never throws', () => {
  it('answers a failure code for odd inputs', async () => {
    const { verifier } = setup();
    expect(await verifier.verify(request(await token()), undefined)).toEqual({ ok: false, code: 'config' });
    expect(await verifier.verify({}, ENV)).toEqual({ ok: false, code: 'error' });
    expect(await verifier.verify(undefined, ENV)).toEqual({ ok: false, code: 'error' });
    expect(await verifier.verify({ headers: { get: () => 42 } }, ENV)).toEqual({ ok: false, code: 'malformed' });
  });

  it('answers error when the fetcher throws synchronously or the clock throws', async () => {
    const throwing = createAccessVerifier({
      fetcher: () => {
        throw new Error('zq-sync');
      },
      now: () => T0,
    });
    expect(await throwing.verify(request(await token()), ENV)).toEqual({ ok: false, code: 'certs' });
    const badClock = createAccessVerifier({
      fetcher: async () => Response.json(certsBody([k1])),
      now: () => {
        throw new Error('zq-clock');
      },
    });
    expect(await badClock.verify(request(await token()), ENV)).toEqual({ ok: false, code: 'error' });
    expect(JSON.stringify(logged)).not.toMatch(/zq-sync|zq-clock/);
  });
});
