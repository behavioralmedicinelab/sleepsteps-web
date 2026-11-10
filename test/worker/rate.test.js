// POST /api/rate (SPEC §11, §12, §14.1, §14.2, §18.2): every rule in
// worker/routes/rate.js, the gates in worker/router.js as this route meets
// them, what is stored, and the shared helpers it writes through
// (lib/http.js, lib/d1.js). Runs in workerd against this file's own D1, with
// the migrations applied (apply-migrations.js). Most tests use a router built
// from the fixture pages below (event.test.js's); the last block uses the
// real pages.json and site.config.json.
import { createExecutionContext } from 'cloudflare:test';
import { env as testEnv } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import site from '../../site.config.json';
import worker from '../../worker/index.js';
import realPages from '../../worker/generated/pages.json';
import { d1Code, insertRow } from '../../worker/lib/d1.js';
import { ERROR_CODES, hasExactKeys, isPlainObject } from '../../worker/lib/http.js';
import { pageIndex } from '../../worker/lib/pages.js';
import { createRouter } from '../../worker/router.js';
import { handleRate, MAX_STARS, MIN_STARS, RATE_KEYS, validateRating } from '../../worker/routes/rate.js';

const PAGES = {
  home: { url: '/', title: 'Home', page_view: false, videos: [] },
  // A page that sends no page view but has a video: it can still be rated.
  about: { url: '/about/', title: 'About us', page_view: false, videos: ['how-sleep-works'] },
  search: { url: '/search/', title: 'Search', page_view: false, videos: [] },
  pain: { url: '/problems/pain/', title: 'Pain', page_view: true, videos: ['pain-about', 'settling-your-body'] },
  start: { url: '/start/', title: 'Start here', page_view: true, videos: ['how-sleep-works'] },
  'urgent-help': { url: '/urgent-help/', title: 'Getting urgent help', page_view: true, videos: [] },
};
const SITE = { features: { ratings: true, feedback: true, events: true } };
const router = createRouter({ pages: PAGES, site: SITE });
const index = pageIndex(PAGES);

const ORIGIN = 'https://example.com';
const RATE_URL = `${ORIGIN}/api/rate`;
const EVENT_URL = `${ORIGIN}/api/event`;
const ENV = () => ({ DB: testEnv.DB, DATA_COLLECTION: 'on', API_HOSTS: 'example.com' });
const SESSION = crypto.randomUUID();
const COLUMNS = ['id', 'page', 'stars', 'ts', 'video'];
// Every stored time is the start of a UTC hour (SPEC §14.1).
const HOUR = /^\d{4}-\d\d-\d\dT\d\d:00:00\.000Z$/;
const floorHour = (ms) => Math.floor(ms / 3_600_000) * 3_600_000;

/** A valid rating body, as rating.js sends it. */
const rating = (stars = 4) => ({ page_id: 'pain', video_id: 'settling-your-body', stars });

// What a test sent that must never reach a log line (SPEC §14.1): every
// string in a body, whole raw bodies, and the extra headers below.
let secrets;
let logged;
const remember = (value) => {
  if (typeof value === 'string') {
    if (value.trim().length >= 6) secrets.push(value);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) remember(item);
  }
};

beforeEach(async () => {
  await testEnv.DB.prepare('DELETE FROM ratings').run();
  await testEnv.DB.prepare('DELETE FROM events').run();
  secrets = [SESSION];
  logged = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    vi.spyOn(console, method).mockImplementation((...args) => logged.push([method, ...args.map(String)]));
  }
});

afterEach(() => {
  // Each argument as logged, so a quote in a raw body can't hide a match.
  const text = logged.flat().join('\n');
  for (const secret of secrets) expect(text.includes(secret), `a log line contains ${JSON.stringify(secret)}`).toBe(false);
  vi.restoreAllMocks();
});

/**
 * A request to /api/rate. `body` is sent as JSON unless it is already a
 * string, bytes or a stream. `headers` are added to a same-origin
 * application/json request (what rating.js sends); a null value removes
 * that header.
 */
function request(body, { url = RATE_URL, method = 'POST', headers = {} } = {}) {
  const h = new Headers({ 'Content-Type': 'application/json', Origin: new URL(url).origin });
  for (const [name, value] of Object.entries(headers)) {
    if (value === null) h.delete(name);
    else h.set(name, value);
  }
  const init = { method, headers: h };
  if (body !== undefined) {
    const raw = typeof body === 'string' || body instanceof Uint8Array || body instanceof ReadableStream;
    if (!(body instanceof Uint8Array || body instanceof ReadableStream)) remember(body);
    init.body = raw ? body : JSON.stringify(body);
  }
  return new Request(url, init);
}

const send = (body, options, env = ENV(), on = router) => on.fetch(request(body, options), env, createExecutionContext());

const rows = async () => (await testEnv.DB.prepare('SELECT * FROM ratings ORDER BY id').all()).results;
const starTypes = async () => (await testEnv.DB.prepare('SELECT typeof(stars) AS t FROM ratings ORDER BY id').all()).results.map((r) => r.t);
const eventRows = async () => (await testEnv.DB.prepare('SELECT * FROM events').all()).results;

/** A stream of `text`'s bytes in chunks of `size`, sent without a Content-Length. */
function stream(text, size = 1000) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

/** JSON for `body`, padded with spaces to exactly `bytes` bytes. */
const padded = (body, bytes) => {
  const json = JSON.stringify(body);
  return `${json}${' '.repeat(bytes - new TextEncoder().encode(json).length)}`;
};

function expectApiHeaders(res) {
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(res.headers.has('Set-Cookie')).toBe(false);
}

async function expectError(res, status, code) {
  expect(res.status).toBe(status);
  expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
  expectApiHeaders(res);
  expect(await res.json()).toEqual({ error: code });
}

async function expectNotFound(res) {
  expect(res.status).toBe(404);
  expect(await res.text()).toBe('Not found');
  expectApiHeaders(res);
}

async function expectStored(res) {
  expect(res.status).toBe(204);
  expect(await res.text()).toBe('');
  expectApiHeaders(res);
}

describe('the rating body (SPEC §12)', () => {
  it('is exactly page_id, video_id and stars, on a 1-5 scale', () => {
    expect(RATE_KEYS).toEqual(['page_id', 'video_id', 'stars']);
    expect(Object.isFrozen(RATE_KEYS)).toBe(true);
    expect([MIN_STARS, MAX_STARS]).toEqual([1, 5]);
  });

  it('has its own error codes in the closed list: video and stars (SPEC §14.1)', () => {
    // message and turnstile are /api/feedback's (M5, feedback.test.js).
    expect(ERROR_CODES).toEqual([
      'body', 'type', 'page', 'session_id', 'detail', 'video', 'stars', 'message', 'turnstile', 'origin', 'content_type', 'too_large', 'method', 'server',
    ]);
    expect(Object.isFrozen(ERROR_CODES)).toBe(true);
  });
});

describe('storing a rating', () => {
  it.each([1, 2, 3, 4, 5])('%i star(s): 204 with no body, and one row with the server time rounded down to the hour and nothing else', async (stars) => {
    const before = Date.now();
    const res = await send(rating(stars));
    const after = Date.now();
    await expectStored(res);

    const stored = await rows();
    expect(stored).toHaveLength(1);
    const [row] = stored;
    expect(Object.keys(row).sort()).toEqual(COLUMNS);
    expect([row.page, row.video, row.stars]).toEqual(['pain', 'settling-your-body', stars]);
    expect(await starTypes()).toEqual(['integer']);
    // No exact time is stored (SPEC §14.1, project lead, 2026-11-07).
    expect(row.ts).toMatch(HOUR);
    expect(Date.parse(row.ts)).toBeGreaterThanOrEqual(floorHour(before));
    expect(Date.parse(row.ts)).toBeLessThanOrEqual(floorHour(after));
    // No events row and no session_id (SPEC §12, §14.1).
    expect(await eventRows()).toEqual([]);
    expect(logged).toEqual([]);
  });

  it('rounds the server time down to the hour, as for every row, never into the next hour or day', async () => {
    const cases = [
      ['2026-11-06T13:59:59.999Z', '2026-11-06T13:00:00.000Z'],
      ['2026-11-06T13:00:00.000Z', '2026-11-06T13:00:00.000Z'],
      ['2026-12-31T23:59:59.999Z', '2026-12-31T23:00:00.000Z'],
    ];
    for (const [at] of cases) {
      const now = new Date(at);
      expect((await handleRate(rating(3), ENV(), index, now)).status).toBe(204);
      // The `now` passed in is not changed.
      expect(now.toISOString()).toBe(at);
    }
    expect((await rows()).map((r) => r.ts)).toEqual(cases.map(([, hour]) => hour));
  });

  it('stores only its own columns: no IP address, user agent or referrer, whatever the request carries', async () => {
    const headers = {
      'CF-Connecting-IP': '203.0.113.77',
      'X-Forwarded-For': '198.51.100.23',
      'User-Agent': 'ProbeBrowser/9.9 zq-agent',
      Referer: 'https://example.com/problems/pain/?zq-referrer',
    };
    secrets.push(...Object.values(headers));
    await expectStored(await send(rating(5), { headers }));
    await expectStored(await send({ page_id: 'start', video_id: 'how-sleep-works', stars: 2 }, { headers }));
    const stored = await rows();
    expect(stored).toHaveLength(2);
    const text = JSON.stringify(stored);
    for (const value of Object.values(headers)) expect(text).not.toContain(value);
    for (const row of stored) expect(Object.keys(row).sort()).toEqual(COLUMNS);
    expect(await eventRows()).toEqual([]);
  });

  it('accepts the same video on two pages, and keeps the page each came from', async () => {
    await expectStored(await send({ page_id: 'start', video_id: 'how-sleep-works', stars: 5 }));
    await expectStored(await send({ page_id: 'about', video_id: 'how-sleep-works', stars: 1 }));
    expect((await rows()).map((r) => [r.page, r.video, r.stars])).toEqual([
      ['start', 'how-sleep-works', 5],
      ['about', 'how-sleep-works', 1],
    ]);
  });

  it('stores each change as a new row, with no dedupe (SPEC §12)', async () => {
    for (const stars of [4, 2, 2]) await expectStored(await send(rating(stars)));
    expect((await rows()).map((r) => r.stars)).toEqual([4, 2, 2]);
  });

  it.each([
    ['4.0', 4],
    ['1e0', 1],
    ['5.000', 5],
    ['2E0', 2],
  ])('accepts stars written as JSON %s, and stores the integer %i', async (text, stars) => {
    await expectStored(await send(`{"page_id":"pain","video_id":"pain-about","stars":${text}}`));
    expect((await rows()).map((r) => r.stars)).toEqual([stars]);
    expect(await starTypes()).toEqual(['integer']);
  });

  it('accepts the keys in any order', async () => {
    await expectStored(await send('{"stars":3,"video_id":"pain-about","page_id":"pain"}'));
    expect(await rows()).toHaveLength(1);
  });

  it.each([
    ['application/json (rating.js)', 'application/json'],
    ['application/json; charset=utf-8', 'application/json; charset=utf-8'],
    ['text/plain;charset=UTF-8', 'text/plain;charset=UTF-8'],
  ])('accepts %s', async (_, type) => {
    await expectStored(await send(rating(), { headers: { 'Content-Type': type } }));
  });

  it('accepts a body of exactly 4096 bytes, sent whole or streamed', async () => {
    const text = padded(rating(), 4096);
    expect(new TextEncoder().encode(text).length).toBe(4096);
    await expectStored(await send(text));
    await expectStored(await send(stream(text)));
    expect(await rows()).toHaveLength(2);
  });
});

describe('validation: 400 with the failed rule, and nothing stored or logged (SPEC §14.2)', () => {
  const r = rating();
  const set = (key, value) => ({ ...r, [key]: value });
  const drop = (key) => {
    const copy = { ...r };
    delete copy[key];
    return copy;
  };
  const raw = (stars) => `{"page_id":"pain","video_id":"settling-your-body","stars":${stars}}`;

  it.each([
    // body
    ['an array', '[]', 'body'],
    ['null', 'null', 'body'],
    ['a string', '"x"', 'body'],
    ['a number', '42', 'body'],
    ['true', 'true', 'body'],
    ['an empty object', {}, 'body'],
    ['no page_id', drop('page_id'), 'body'],
    ['no video_id', drop('video_id'), 'body'],
    ['no stars', drop('stars'), 'body'],
    ['a session_id', set('session_id', SESSION), 'body'],
    ['a null session_id', set('session_id', null), 'body'],
    ['a client timestamp', set('ts', '2020-01-01T00:00:00.000Z'), 'body'],
    ['a __proto__ key', '{"page_id":"pain","video_id":"settling-your-body","stars":4,"__proto__":{}}', 'body'],
    ['an extra key', set('extra', 1), 'body'],
    ['the events-style keys page, video and stars', { page: 'pain', video: 'settling-your-body', stars: 4 }, 'body'],
    ['an events-style page key as well', set('page', 'pain'), 'body'],
    ['a key in another case', { Page_id: 'pain', video_id: 'settling-your-body', stars: 4 }, 'body'],
    ['the body wrapped in an array', [r], 'body'],
    // page
    ['an unknown page', set('page_id', 'no-such-page'), 'page'],
    ['a page URL instead of its page_id', set('page_id', '/problems/pain/'), 'page'],
    ['an uppercase page_id', set('page_id', 'PAIN'), 'page'],
    ['a page_id with a space', set('page_id', ' pain'), 'page'],
    ['an empty page_id', set('page_id', ''), 'page'],
    ['a page_id in an array', set('page_id', ['pain']), 'page'],
    ['page_id "__proto__"', set('page_id', '__proto__'), 'page'],
    ['page_id "constructor"', set('page_id', 'constructor'), 'page'],
    ['page_id "toString"', set('page_id', 'toString'), 'page'],
    ['a null page_id', set('page_id', null), 'page'],
    ['a numeric page_id', set('page_id', 1), 'page'],
    // video
    ['a video from another page', set('video_id', 'how-sleep-works'), 'video'],
    ['a video on Home', { page_id: 'home', video_id: 'how-sleep-works', stars: 4 }, 'video'],
    ['a video on the search page', { page_id: 'search', video_id: 'pain-about', stars: 4 }, 'video'],
    ['a video on Getting urgent help', { page_id: 'urgent-help', video_id: 'how-sleep-works', stars: 4 }, 'video'],
    ['an unknown video', set('video_id', 'no-such-video'), 'video'],
    ['an uppercase video_id', set('video_id', 'SETTLING-YOUR-BODY'), 'video'],
    ['an audio file name', set('video_id', 'settling-your-body.mp3'), 'video'],
    ['an empty video_id', set('video_id', ''), 'video'],
    ['video_id "__proto__"', set('video_id', '__proto__'), 'video'],
    ['video_id "constructor"', set('video_id', 'constructor'), 'video'],
    ['a video_id in an array', set('video_id', ['settling-your-body']), 'video'],
    ['a numeric video_id', set('video_id', 1), 'video'],
    ['a null video_id', set('video_id', null), 'video'],
    // stars
    ['stars 0', set('stars', 0), 'stars'],
    ['stars 6', set('stars', 6), 'stars'],
    ['stars -1', set('stars', -1), 'stars'],
    ['stars -0', raw('-0'), 'stars'],
    ['stars 4.5', set('stars', 4.5), 'stars'],
    ['stars 4.000001', set('stars', 4.000001), 'stars'],
    ['stars "4"', set('stars', '4'), 'stars'],
    ['stars ""', set('stars', ''), 'stars'],
    ['stars null', set('stars', null), 'stars'],
    ['stars true', set('stars', true), 'stars'],
    ['stars false', set('stars', false), 'stars'],
    ['stars [4]', set('stars', [4]), 'stars'],
    ['stars {}', set('stars', {}), 'stars'],
    ['stars 1e1', raw('1e1'), 'stars'],
    ['stars 1e400 (Infinity)', raw('1e400'), 'stars'],
    ['stars -1e400 (-Infinity)', raw('-1e400'), 'stars'],
  ])('refuses %s', async (_, body, code) => {
    await expectError(await send(body), 400, code);
    expect(await rows()).toEqual([]);
    expect(await eventRows()).toEqual([]);
    expect(logged).toEqual([]);
  });

  it.each([
    ['body before page: an extra key on an unknown page', { page_id: 'no-such-page', video_id: 'x', stars: 0, ts: 'x' }, 'body'],
    ['page before video: an unknown page with an unknown video and bad stars', { page_id: 'no-such-page', video_id: 'x', stars: 0 }, 'page'],
    ['video before stars: a video from another page with stars 0', { page_id: 'pain', video_id: 'how-sleep-works', stars: 0 }, 'video'],
  ])('checks in order: %s', async (_, body, code) => {
    await expectError(await send(body), 400, code);
    expect(validateRating(body, index)).toEqual({ error: code });
    expect(await rows()).toEqual([]);
  });

  it('checks without changing the body it was given, and returns only the checked values', () => {
    const body = rating(2);
    const copy = structuredClone(body);
    expect(validateRating(body, index)).toEqual({ row: { page: 'pain', video: 'settling-your-body', stars: 2 } });
    expect(body).toEqual(copy);
  });

  it('never reads a key from the prototype chain', () => {
    // An inherited page_id must not stand in for a missing own one.
    const inherited = Object.assign(Object.create({ page_id: 'pain' }), { video_id: 'pain-about', stars: 4 });
    expect(validateRating(inherited, index)).toEqual({ error: 'body' });
    expect(validateRating(Object.assign(Object.create(null), rating()), index)).toEqual({ error: 'body' });
  });
});

describe('request format and origin (SPEC §14.1)', () => {
  it.each([
    ['text/html', 'text/html'],
    ['form-urlencoded (an HTML form)', 'application/x-www-form-urlencoded'],
    ['multipart', 'multipart/form-data; boundary=zq'],
  ])('refuses %s with 415', async (_, type) => {
    await expectError(await send(rating(), { headers: { 'Content-Type': type } }), 415, 'content_type');
    expect(await rows()).toEqual([]);
  });

  it('refuses a body with no Content-Type with 415', async () => {
    const req = request(new TextEncoder().encode(JSON.stringify(rating())), { headers: { 'Content-Type': null } });
    expect(req.headers.has('Content-Type')).toBe(false);
    await expectError(await router.fetch(req, ENV(), createExecutionContext()), 415, 'content_type');
  });

  it.each(['GET', 'HEAD', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])('answers %s with 405 and Allow: POST', async (method) => {
    const res = await router.fetch(request(undefined, { method }), ENV(), createExecutionContext());
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST');
    expectApiHeaders(res);
    if (method !== 'HEAD') expect(await res.json()).toEqual({ error: 'method' });
  });

  it.each([
    ['missing', null],
    ['"null"', 'null'],
    ['another site', 'https://zq-elsewhere.example'],
    ['http where the request is https', 'http://example.com'],
  ])('refuses an Origin that is %s with 403, before reading the body', async (_, origin) => {
    const req = request(JSON.stringify(rating()), { headers: { Origin: origin } });
    await expectError(await router.fetch(req, ENV(), createExecutionContext()), 403, 'origin');
    expect(req.bodyUsed).toBe(false);
    expect(await rows()).toEqual([]);
  });

  it('refuses 4097 bytes with 413: by Content-Length, and counted while streaming without one', async () => {
    const text = padded(rating(), 4097);
    const declared = request(text, { headers: { 'Content-Length': '4097' } });
    await expectError(await router.fetch(declared, ENV(), createExecutionContext()), 413, 'too_large');
    expect(declared.bodyUsed).toBe(false);
    const streamed = request(stream(text));
    expect(streamed.headers.has('Content-Length')).toBe(false);
    await expectError(await router.fetch(streamed, ENV(), createExecutionContext()), 413, 'too_large');
    expect(await rows()).toEqual([]);
  });

  it.each([
    ['invalid JSON', '{"page_id":'],
    ['JSON followed by more text', `${JSON.stringify(rating())} zq`],
    ['an empty body', ''],
    ['single-quoted JSON', "{'page_id':'pain'}"],
  ])('refuses %s with 400 "body"', async (_, text) => {
    await expectError(await send(text), 400, 'body');
    expect(await rows()).toEqual([]);
  });

  it('refuses a POST with no body, and invalid UTF-8, with 400 "body"', async () => {
    await expectError(await router.fetch(request(undefined), ENV(), createExecutionContext()), 400, 'body');
    const json = new TextEncoder().encode(JSON.stringify(rating()));
    const bytes = new Uint8Array([...json.slice(0, 20), 0xff, 0xfe, ...json.slice(20)]);
    await expectError(await router.fetch(request(bytes), ENV(), createExecutionContext()), 400, 'body');
    expect(await rows()).toEqual([]);
  });
});

describe('host check (SPEC §18.2, §20 M3)', () => {
  it('with production\'s setting ("sleepsteps.org"), answers 404 on a version URL, even with a matching Origin', async () => {
    const env = { ...ENV(), API_HOSTS: 'sleepsteps.org' };
    await expectNotFound(await send(rating(), { url: 'https://abc12345-sleepsteps.zq-sub.workers.dev/api/rate' }, env));
    await expectNotFound(await send(rating(), {}, env));
    expect(await rows()).toEqual([]);
  });

  it('accepts a preview URL with the previews pattern', async () => {
    const env = { ...ENV(), API_HOSTS: '*-sleepsteps.*.workers.dev' };
    await expectStored(await send(rating(), { url: 'https://my-branch-sleepsteps.zq-sub.workers.dev/api/rate' }, env));
  });

  it('accepts each local host, with its port (npm run dev:collect)', async () => {
    const env = { ...ENV(), API_HOSTS: 'localhost:8787,127.0.0.1:8787' };
    await expectStored(await send(rating(), { url: 'http://localhost:8787/api/rate' }, env));
    await expectStored(await send(rating(), { url: 'http://127.0.0.1:8787/api/rate' }, env));
    await expectNotFound(await send(rating(), { url: 'http://localhost:8788/api/rate' }, env));
    expect(await rows()).toHaveLength(2);
  });
});

describe('order of the checks (worker/router.js)', () => {
  const bad = { method: 'PUT', headers: { Origin: 'https://zq-elsewhere.example', 'Content-Type': 'text/html' } };

  it('collection off comes first: 404 whatever else is wrong', async () => {
    for (const value of ['off', undefined, 'On', ' on']) {
      await expectNotFound(await send(rating(), bad, { ...ENV(), DATA_COLLECTION: value }));
      await expectNotFound(await send(rating(), {}, { ...ENV(), DATA_COLLECTION: value }));
    }
    expect(await rows()).toEqual([]);
  });

  it('then the host: 404 before the method is looked at', async () => {
    await expectNotFound(await send(rating(), bad, { ...ENV(), API_HOSTS: 'example.org' }));
  });

  it.each([
    ['off', { features: { ratings: false, feedback: true, events: true } }],
    ['"true" (a string)', { features: { ratings: 'true', events: true } }],
    ['1', { features: { ratings: 1, events: true } }],
    ['missing', { features: { events: true } }],
    ['in a config with no features', {}],
  ])('then the feature switch: 404 and nothing stored when ratings is %s', async (_, siteConfig) => {
    const off = createRouter({ pages: PAGES, site: siteConfig });
    await expectNotFound(await send(rating(), {}, ENV(), off));
    await expectNotFound(await send(rating(), bad, ENV(), off));
    expect(await rows()).toEqual([]);
  });

  it('then the method (405), the Origin (403), the media type (415), the size (413) and the JSON (400)', async () => {
    const big = `{"zq":"${'x'.repeat(5000)}`;
    await expectError(await send(big, bad), 405, 'method');
    await expectError(await send(big, { headers: bad.headers }), 403, 'origin');
    await expectError(await send(big, { headers: { 'Content-Type': 'text/html' } }), 415, 'content_type');
    await expectError(await send(big), 413, 'too_large');
    await expectError(await send(big.slice(0, 100)), 400, 'body');
  });

  it('then the route: body, page, video, stars, and last the write', async () => {
    await expectError(await send({ ...rating(0), page_id: 'no-such-page', ts: 'x' }), 400, 'body');
    await expectError(await send({ ...rating(0), page_id: 'no-such-page', video_id: 'x' }), 400, 'page');
    await expectError(await send({ ...rating(0), video_id: 'x' }), 400, 'video');
    await expectError(await send(rating(0)), 400, 'stars');
    expect(await rows()).toEqual([]);
    await expectStored(await send(rating(1)));
    expect(await rows()).toHaveLength(1);
  });
});

describe('the ratings switch is separate from the others (site.config.json features)', () => {
  const pageView = () => ({ type: 'page_view', page: 'pain', session_id: SESSION, detail: {} });
  const sendEvent = (body, on) =>
    on.fetch(
      new Request(EVENT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8', Origin: ORIGIN }, body: JSON.stringify(body) }),
      ENV(),
      createExecutionContext(),
    );

  it('with ratings off and events on: /api/rate answers 404 and /api/event still stores', async () => {
    const on = createRouter({ pages: PAGES, site: { features: { ratings: false, feedback: true, events: true } } });
    await expectNotFound(await send(rating(), {}, ENV(), on));
    expect((await sendEvent(pageView(), on)).status).toBe(204);
    expect(await rows()).toEqual([]);
    expect(await eventRows()).toHaveLength(1);
  });

  it('with ratings on and events off: /api/rate stores and /api/event answers 404', async () => {
    const on = createRouter({ pages: PAGES, site: { features: { ratings: true, feedback: false, events: false } } });
    await expectStored(await send(rating(), {}, ENV(), on));
    await expectNotFound(await sendEvent(pageView(), on));
    expect(await rows()).toHaveLength(1);
    expect(await eventRows()).toEqual([]);
  });
});

describe('failures (SPEC §11, §14.1)', () => {
  const SENTINEL = 'zq-sentinel-rating-text';
  const failingDb = (error) => ({
    prepare: () => ({
      bind: () => ({
        run: async () => {
          throw error;
        },
      }),
    }),
  });

  beforeEach(() => secrets.push(SENTINEL));

  it('answers 500 when the database write fails, and logs only a fixed message and the D1 code', async () => {
    // D1 messages can echo the bound values.
    const error = new Error(`D1_TYPE_ERROR: Type 'object' not supported for value 'settling-your-body' ${SENTINEL}`);
    await expectError(await send(rating(), {}, { ...ENV(), DB: failingDb(error) }), 500, 'server');
    expect(logged).toEqual([['error', '/api/rate: database write failed', 'D1_TYPE_ERROR']]);
  });

  it('logs "unknown" for an error that has no D1 code', async () => {
    const env = { ...ENV(), DB: failingDb(new Error(`pain-about ${SENTINEL}`)) };
    await expectError(await send(rating(), {}, env), 500, 'server');
    expect(logged).toEqual([['error', '/api/rate: database write failed', 'unknown']]);
  });

  it('answers 500 without a database binding, and logs "unknown"', async () => {
    const { DB, ...env } = ENV();
    await expectError(await send(rating(), {}, env), 500, 'server');
    expect(logged).toEqual([['error', '/api/rate: database write failed', 'unknown']]);
  });

  it('answers 500 when the body cannot be read, and logs a fixed message only', async () => {
    const broken = new ReadableStream({
      pull(controller) {
        controller.error(new Error(`zq broken body ${SENTINEL}`));
      },
    });
    await expectError(await send(broken), 500, 'server');
    expect(logged).toEqual([['error', '/api/rate: unexpected error']]);
    expect(await rows()).toEqual([]);
  });

  it('never logs a refused body', async () => {
    for (const body of [
      { page_id: SENTINEL, video_id: 'pain-about', stars: 4 },
      { page_id: 'pain', video_id: SENTINEL, stars: 4 },
      { page_id: 'pain', video_id: 'pain-about', stars: SENTINEL },
      { page_id: 'pain', video_id: 'pain-about', stars: 4, [SENTINEL]: 1 },
      `{"page_id":"${SENTINEL}"`,
    ]) {
      expect((await send(body)).status).toBe(400);
    }
    expect(logged).toEqual([]);
  });
});

describe('shared helpers (lib/http.js, lib/d1.js)', () => {
  it('isPlainObject accepts only a plain object, as JSON.parse makes one', () => {
    for (const value of [{}, { a: 1 }, JSON.parse('{"__proto__":1}')]) expect(isPlainObject(value)).toBe(true);
    class Thing {}
    for (const value of [null, undefined, [], 'x', 1, true, Object.create(null), new Date(), new Map(), new Thing()]) {
      expect(isPlainObject(value)).toBe(false);
    }
  });

  it('hasExactKeys wants exactly the keys, in any order, own only', () => {
    expect(hasExactKeys({ a: 1, b: 2 }, ['b', 'a'])).toBe(true);
    expect(hasExactKeys({}, [])).toBe(true);
    expect(hasExactKeys({ a: 1 }, ['a', 'b'])).toBe(false);
    expect(hasExactKeys({ a: 1, b: 2, c: 3 }, ['a', 'b'])).toBe(false);
    expect(hasExactKeys({ a: 1, c: 3 }, ['a', 'b'])).toBe(false);
    expect(hasExactKeys(JSON.parse('{"a":1,"__proto__":{"b":2}}'), ['a', 'b'])).toBe(false);
    expect(hasExactKeys(Object.assign(Object.create({ b: 2 }), { a: 1 }), ['a', 'b'])).toBe(false);
  });

  it('d1Code keeps only a leading D1_ code, and never throws', () => {
    expect(d1Code(new Error('D1_ERROR: no such table: zq'))).toBe('D1_ERROR');
    expect(d1Code(new Error("D1_TYPE_ERROR: Type 'undefined' not supported"))).toBe('D1_TYPE_ERROR');
    expect(d1Code(new Error('something D1_ERROR later'))).toBe('unknown');
    expect(d1Code(new Error('d1_error: lowercase'))).toBe('unknown');
    for (const value of [undefined, null, 'D1_ERROR: a string, not an error', {}, { message: 42 }]) expect(d1Code(value)).toBe('unknown');
    const hostile = {
      get message() {
        throw new Error('D1_ERROR');
      },
    };
    expect(d1Code(hostile)).toBe('unknown');
  });

  it('insertRow binds the values in order and answers 204', async () => {
    const res = await insertRow(ENV(), '/api/zq', 'INSERT INTO ratings (ts, page, video, stars) VALUES (?, ?, ?, ?)', [
      '2026-11-06T00:00:00.000Z',
      'pain',
      'pain-about',
      3,
    ]);
    await expectStored(res);
    expect((await rows()).map((r) => [r.ts, r.page, r.video, r.stars])).toEqual([['2026-11-06T00:00:00.000Z', 'pain', 'pain-about', 3]]);
  });

  it('insertRow answers 500 for a real D1 error, and logs its label and code only', async () => {
    // The ratings table's CHECK refuses 9; D1's message names the constraint.
    const res = await insertRow(ENV(), '/api/zq', 'INSERT INTO ratings (ts, page, video, stars) VALUES (?, ?, ?, ?)', [
      '2026-11-06T00:00:00.000Z',
      'pain',
      SESSION,
      9,
    ]);
    await expectError(res, 500, 'server');
    expect(logged).toHaveLength(1);
    const [[level, message, code]] = logged;
    expect([level, message]).toEqual(['error', '/api/zq: database write failed']);
    expect(code).toMatch(/^D1_[A-Z_]+$/);
    expect(logged.flat().join(' ')).not.toMatch(/CHECK|constraint|stars/i);
    expect(await rows()).toEqual([]);
  });
});

describe('the Worker as deployed: the real pages.json and site.config.json', () => {
  const env = () => ({ DB: testEnv.DB, ASSETS: testEnv.ASSETS, DATA_COLLECTION: 'on', API_HOSTS: 'example.com' });
  const deployed = (body) => worker.fetch(request(body), env(), createExecutionContext());
  const expected = site.features.ratings === true ? 204 : 404;

  it('lets every video listed on a page be rated from that page, and no other video', () => {
    const real = pageIndex(realPages);
    const allVideos = new Set([...real.values()].flatMap((entry) => [...entry.videos]));
    expect(allVideos.size).toBeGreaterThan(0);
    for (const [page, entry] of real) {
      for (const video of allVideos) {
        const result = validateRating({ page_id: page, video_id: video, stars: 3 }, real);
        const want = entry.videos.has(video) ? { row: { page, video, stars: 3 } } : { error: 'video' };
        expect(result, `${page} / ${video}`).toEqual(want);
      }
    }
  });

  it.each([
    ['tired-but-wired', 'tired-but-wired-about'],
    ['tired-but-wired', 'conditioning'],
    ['tired-but-wired', 'treatment-symptoms-and-sleep'],
    ['start', 'how-to-use-this-program'],
  ])('accepts a rating of %s / %s', async (page, video) => {
    expect(realPages[page]?.videos).toContain(video);
    const res = await deployed({ page_id: page, video_id: video, stars: 4 });
    expect(res.status).toBe(expected);
    expect(await rows()).toHaveLength(expected === 204 ? 1 : 0);
  });

  it.each(['home', 'search', 'urgent-help'])('refuses a rating from %s, which has no videos', async (page) => {
    expect(realPages[page]?.videos).toEqual([]);
    const res = await deployed({ page_id: page, video_id: 'how-to-use-this-program', stars: 4 });
    if (expected === 204) await expectError(res, 400, 'video');
    else await expectNotFound(res);
    expect(await rows()).toEqual([]);
  });

  it('refuses a video from another page', async () => {
    expect(realPages['tired-but-wired'].videos).not.toContain('how-to-use-this-program');
    const res = await deployed({ page_id: 'tired-but-wired', video_id: 'how-to-use-this-program', stars: 4 });
    if (expected === 204) await expectError(res, 400, 'video');
    else await expectNotFound(res);
  });

  it('answers 404 with the vars in wrangler.jsonc (example.com isn\'t in API_HOSTS)', async () => {
    const res = await worker.fetch(request({ page_id: 'start', video_id: 'how-to-use-this-program', stars: 4 }), testEnv, createExecutionContext());
    await expectNotFound(res);
    expect(await rows()).toEqual([]);
  });
});
