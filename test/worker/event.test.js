// POST /api/event (SPEC §10, §11, §14.1, §14.2, §18.2): the order of the
// checks in worker/router.js, every rule in worker/routes/event.js, and what
// is stored. Runs in workerd against this file's own D1, with the migrations
// applied (apply-migrations.js). Most tests use a router built from the
// fixture pages below; the last block uses the real pages.json.
import { createExecutionContext } from 'cloudflare:test';
import { env as testEnv } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import site from '../../site.config.json';
import worker from '../../worker/index.js';
import realPages from '../../worker/generated/pages.json';
import { pageIndex } from '../../worker/lib/pages.js';
import { createRouter } from '../../worker/router.js';
import { handleEvent, SHAPES, validateEvent } from '../../worker/routes/event.js';

const PAGES = {
  home: { url: '/', title: 'Home', page_view: false, videos: [] },
  // A page that sends no page view but has a video: plays are still logged.
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
const EVENT_URL = `${ORIGIN}/api/event`;
const ENV = () => ({ DB: testEnv.DB, DATA_COLLECTION: 'on', API_HOSTS: 'example.com' });
const SESSION = crypto.randomUUID();

const valid = {
  page_view: () => ({ type: 'page_view', page: 'pain', session_id: SESSION, detail: {} }),
  search: () => ({ type: 'search', page: 'search', detail: { q: 'restless legs zq', results: 3 } }),
  video_play: () => ({ type: 'video_play', page: 'pain', session_id: SESSION, detail: { media: 'settling-your-body', furthest: 50 } }),
  audio_play: () => ({ type: 'audio_play', page: 'pain', session_id: SESSION, detail: { media: 'pain-about', furthest: 100 } }),
  handout_open: () => ({ type: 'handout_open', page: 'pain', session_id: SESSION, detail: { media: 'pain-about' } }),
};

// What a test sent that must never reach a log line (SPEC §14.1): every
// session_id and search text, and the extra headers below.
let secrets;
let logged;
const remember = (value) => {
  if (typeof value === 'string' && value.trim().length >= 6) secrets.push(value);
};

beforeEach(async () => {
  await testEnv.DB.prepare('DELETE FROM events').run();
  secrets = [SESSION];
  logged = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    vi.spyOn(console, method).mockImplementation((...args) => logged.push([method, ...args.map(String)]));
  }
});

afterEach(() => {
  const text = JSON.stringify(logged);
  for (const secret of secrets) expect(text, 'a log line').not.toContain(secret);
  vi.restoreAllMocks();
});

/**
 * A request to /api/event. `body` is sent as JSON unless it is already a
 * string, bytes or a stream. `headers` are added to a same-origin text/plain
 * request; a null value removes that header.
 */
function request(body, { url = EVENT_URL, method = 'POST', headers = {} } = {}) {
  const h = new Headers({ 'Content-Type': 'text/plain;charset=UTF-8', Origin: new URL(url).origin });
  for (const [name, value] of Object.entries(headers)) {
    if (value === null) h.delete(name);
    else h.set(name, value);
  }
  const init = { method, headers: h };
  if (body !== undefined) {
    const raw = typeof body === 'string' || body instanceof Uint8Array || body instanceof ReadableStream;
    if (!raw) {
      remember(body.session_id);
      remember(body.detail?.q);
    }
    init.body = raw ? body : JSON.stringify(body);
  }
  return new Request(url, init);
}

const send = (body, options, env = ENV(), on = router) => on.fetch(request(body, options), env, createExecutionContext());

const rows = async () => (await testEnv.DB.prepare('SELECT * FROM events ORDER BY id').all()).results;

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

const floorHour = (ms) => Math.floor(ms / 3_600_000) * 3_600_000;

async function expectError(res, status, code) {
  expect(res.status).toBe(status);
  expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(await res.json()).toEqual({ error: code });
}

async function expectNotFound(res) {
  expect(res.status).toBe(404);
  expect(await res.text()).toBe('Not found');
}

describe('the closed list of events (SPEC §10.2)', () => {
  it('has exactly the five types, each with its detail keys (no transcript_open: the site shows no transcripts, SPEC §9.3)', () => {
    expect([...SHAPES]).toEqual([
      ['page_view', []],
      ['search', ['q', 'results']],
      ['video_play', ['media', 'furthest']],
      ['audio_play', ['media', 'furthest']],
      ['handout_open', ['media']],
    ]);
    expect(Object.keys(valid)).toEqual([...SHAPES.keys()]);
  });
});

describe('storing each type', () => {
  it.each([
    ['page_view', valid.page_view(), {}],
    ['video_play', valid.video_play(), { media: 'settling-your-body', furthest: 50 }],
    ['audio_play', valid.audio_play(), { media: 'pain-about', furthest: 100 }],
    ['handout_open', valid.handout_open(), { media: 'pain-about' }],
  ])('%s: 204, and one row with the server time rounded down to the hour, the visit code and the detail', async (type, body, detail) => {
    const before = Date.now();
    const res = await send(body);
    const after = Date.now();
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');

    const stored = await rows();
    expect(stored).toHaveLength(1);
    const [row] = stored;
    expect(Object.keys(row).sort()).toEqual(['detail', 'id', 'page', 'session_id', 'ts', 'type']);
    expect([row.type, row.page, row.session_id]).toEqual([type, 'pain', SESSION]);
    expect(row.detail).toBe(JSON.stringify(detail));
    // No exact time is stored (SPEC §14.1, project lead, 2026-11-07).
    expect(row.ts).toMatch(/^\d{4}-\d\d-\d\dT\d\d:00:00\.000Z$/);
    expect(Date.parse(row.ts)).toBeGreaterThanOrEqual(floorHour(before));
    expect(Date.parse(row.ts)).toBeLessThanOrEqual(floorHour(after));
    expect(logged).toEqual([]);
  });

  it('search: 204, stored without a visit code and with the time rounded down to the hour', async () => {
    const before = Date.now();
    const res = await send(valid.search());
    const after = Date.now();
    expect(res.status).toBe(204);
    const [row, ...rest] = await rows();
    expect(rest).toEqual([]);
    expect([row.type, row.page, row.session_id]).toEqual(['search', 'search', null]);
    expect(row.detail).toBe('{"q":"restless legs zq","results":3}');
    expect(row.ts).toMatch(/^\d{4}-\d\d-\d\dT\d\d:00:00\.000Z$/);
    expect(Date.parse(row.ts)).toBeGreaterThanOrEqual(floorHour(before));
    expect(Date.parse(row.ts)).toBeLessThanOrEqual(floorHour(after));
  });

  it('takes the time from the server and rounds it down to the hour for every type, never into the next hour or day', async () => {
    const env = ENV();
    const cases = [
      ['2026-11-06T13:59:59.999Z', '2026-11-06T13:00:00.000Z'],
      ['2026-11-06T13:00:00.000Z', '2026-11-06T13:00:00.000Z'],
      ['2026-12-31T23:59:59.999Z', '2026-12-31T23:00:00.000Z'],
    ];
    for (const [at] of cases) {
      const now = new Date(at);
      for (const type of SHAPES.keys()) expect((await handleEvent(valid[type](), env, index, now)).status, type).toBe(204);
      // The `now` passed in is not changed.
      expect(now.toISOString()).toBe(at);
    }
    const want = cases.flatMap(([, hour]) => [...SHAPES.keys()].map((type) => [type, hour]));
    expect((await rows()).map((r) => [r.type, r.ts])).toEqual(want);
  });

  it('stores only its own columns: no IP address, user agent or referrer, whatever the request carries', async () => {
    const headers = {
      'CF-Connecting-IP': '203.0.113.77',
      'X-Forwarded-For': '198.51.100.23',
      'User-Agent': 'ProbeBrowser/9.9 zq-agent',
      Referer: 'https://example.com/search/?q=zq-referrer',
    };
    secrets.push(...Object.values(headers));
    for (const body of [valid.page_view(), valid.search(), valid.video_play()]) {
      expect((await send(body, { headers })).status).toBe(204);
    }
    const stored = await rows();
    expect(stored).toHaveLength(3);
    const text = JSON.stringify(stored);
    for (const value of Object.values(headers)) expect(text).not.toContain(value);
    for (const row of stored) expect(Object.keys(row).sort()).toEqual(['detail', 'id', 'page', 'session_id', 'ts', 'type']);
  });

  it('rebuilds the detail from the checked values, in its own key order', async () => {
    const body = { ...valid.video_play(), detail: { furthest: 25, media: 'pain-about' } };
    expect((await send(body)).status).toBe(204);
    const search = { ...valid.search(), detail: { results: 0, q: '  hot flushes zq  ' } };
    expect((await send(search)).status).toBe(204);
    expect((await rows()).map((r) => r.detail)).toEqual(['{"media":"pain-about","furthest":25}', '{"q":"hot flushes zq","results":0}']);
  });

  it('replaces a lone surrogate (an emoji split by search.js) in the search text', async () => {
    const q = `sleep zq ${'\u{1F634}'.slice(0, 1)}`;
    const res = await send({ ...valid.search(), detail: { q, results: 1 } });
    expect(res.status).toBe(204);
    const [row] = await rows();
    // Compared as booleans: a lone surrogate in a failure message would break
    // the test runner's connection to workerd.
    expect(row.detail.isWellFormed(), 'well-formed').toBe(true);
    expect(JSON.parse(row.detail).q === 'sleep zq \uFFFD', 'replaced with U+FFFD').toBe(true);
  });

  it.each([
    ['a page view from Start here', { ...valid.page_view(), page: 'start' }],
    ['a page view from Getting urgent help', { ...valid.page_view(), page: 'urgent-help' }],
    ['a handout opened on Start here', { ...valid.handout_open(), page: 'start', detail: { media: 'how-sleep-works' } }],
    ['a play from a page that sends no page views', { ...valid.video_play(), page: 'about', detail: { media: 'how-sleep-works', furthest: 0 } }],
    ['furthest 0', { ...valid.audio_play(), detail: { media: 'pain-about', furthest: 0 } }],
    ['furthest 25', { ...valid.audio_play(), detail: { media: 'pain-about', furthest: 25 } }],
    ['furthest 75', { ...valid.video_play(), detail: { media: 'pain-about', furthest: 75 } }],
    ['q of exactly 100 UTF-16 code units', { ...valid.search(), detail: { q: `zq${'a'.repeat(98)}`, results: 2 } }],
    ['q of 50 emoji (100 code units)', { ...valid.search(), detail: { q: '\u{1F634}'.repeat(50), results: 2 } }],
    ['results 0', { ...valid.search(), detail: { q: 'zq nothing', results: 0 } }],
    ['results 1000', { ...valid.search(), detail: { q: 'zq everything', results: 1000 } }],
  ])('accepts %s', async (_, body) => {
    const res = await send(body);
    expect(res.status).toBe(204);
    expect(await rows()).toHaveLength(1);
  });
});

describe('validation: 400 with the failed rule, and nothing stored (SPEC §14.2)', () => {
  const pv = valid.page_view();
  const se = valid.search();
  const vp = valid.video_play();
  const ap = valid.audio_play();
  const ho = valid.handout_open();
  // A transcript_open as events.js sent it before transcripts were removed (2026-11-06), with
  // a detail that was valid then.
  const to = { type: 'transcript_open', page: 'pain', session_id: SESSION, detail: { media: 'settling-your-body' } };
  const set = (body, key, value) => ({ ...structuredClone(body), [key]: value });
  const drop = (body, key) => {
    const copy = structuredClone(body);
    delete copy[key];
    return copy;
  };
  const detail = (body, value) => set(body, 'detail', value);
  const q = (value) => detail(se, { q: value, results: 1 });
  const results = (value) => detail(se, { q: 'zq query', results: value });
  const furthest = (value) => detail(vp, { media: 'settling-your-body', furthest: value });

  it.each([
    // body
    ['an array', '[]', 'body'],
    ['null', 'null', 'body'],
    ['a string', '"page_view"', 'body'],
    ['a number', '42', 'body'],
    ['an extra top-level key', set(pv, 'extra', 1), 'body'],
    ['a client timestamp', set(pv, 'ts', '2020-01-01T00:00:00.000Z'), 'body'],
    ['a __proto__ key', `{"type":"page_view","page":"pain","session_id":"${SESSION}","detail":{},"__proto__":{}}`, 'body'],
    ['no type', drop(pv, 'type'), 'body'],
    ['no page', drop(pv, 'page'), 'body'],
    ['no detail', drop(pv, 'detail'), 'body'],
    // type
    ['an unknown type', set(pv, 'type', 'click'), 'type'],
    ['an uppercase type', set(pv, 'type', 'PAGE_VIEW'), 'type'],
    ['the old pdf_download type', set(ho, 'type', 'pdf_download'), 'type'],
    ['the removed transcript_open type', to, 'type'],
    ['a type in an array', set(pv, 'type', ['page_view']), 'type'],
    ['a null type', set(pv, 'type', null), 'type'],
    ['type "constructor"', set(pv, 'type', 'constructor'), 'type'],
    ['type "__proto__"', set(pv, 'type', '__proto__'), 'type'],
    // page
    ['an unknown page', set(pv, 'page', 'no-such-page'), 'page'],
    ['a page URL instead of its page_id', set(pv, 'page', '/problems/pain/'), 'page'],
    ['a page in an array', set(vp, 'page', ['pain']), 'page'],
    ['page "__proto__"', set(vp, 'page', '__proto__'), 'page'],
    ['page "constructor"', set(vp, 'page', 'constructor'), 'page'],
    ['a page view from Home', set(pv, 'page', 'home'), 'page'],
    ['a page view from the search page', set(pv, 'page', 'search'), 'page'],
    ['a page view from an information page', set(pv, 'page', 'about'), 'page'],
    ['a search from Home', set(se, 'page', 'home'), 'page'],
    ['a search from a problem page', set(se, 'page', 'pain'), 'page'],
    ['a play from an unknown page', set(vp, 'page', 'no-such-page'), 'page'],
    // session_id
    ['a page view without a session_id', drop(pv, 'session_id'), 'session_id'],
    ['a play without a session_id', drop(vp, 'session_id'), 'session_id'],
    ['an uppercase UUID', set(pv, 'session_id', SESSION.toUpperCase()), 'session_id'],
    ['the nil UUID', set(pv, 'session_id', '00000000-0000-0000-0000-000000000000'), 'session_id'],
    ['a version 1 UUID', set(pv, 'session_id', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'), 'session_id'],
    ['a UUID in braces', set(pv, 'session_id', `{${SESSION}}`), 'session_id'],
    ['a UUID with a trailing newline', set(pv, 'session_id', `${SESSION}\n`), 'session_id'],
    ['a null session_id', set(pv, 'session_id', null), 'session_id'],
    ['a numeric session_id', set(pv, 'session_id', 123), 'session_id'],
    ['a session_id on a search', set(se, 'session_id', SESSION), 'session_id'],
    ['a null session_id on a search', set(se, 'session_id', null), 'session_id'],
    ['an empty session_id on a search', set(se, 'session_id', ''), 'session_id'],
    // detail
    ['a detail that is an array', detail(pv, []), 'detail'],
    ['a null detail', detail(pv, null), 'detail'],
    ['a detail that is JSON text', detail(pv, '{}'), 'detail'],
    ['a key on a page view detail', detail(pv, { x: 1 }), 'detail'],
    ['an extra detail key', detail(vp, { ...vp.detail, extra: 1 }), 'detail'],
    ['a missing detail key', detail(vp, { media: 'settling-your-body' }), 'detail'],
    ['a __proto__ detail key', `{"type":"page_view","page":"pain","session_id":"${SESSION}","detail":{"__proto__":{}}}`, 'detail'],
    ['media from another page', detail(vp, { media: 'how-sleep-works', furthest: 50 }), 'detail'],
    ['an unknown media', detail(vp, { media: 'no-such-video', furthest: 50 }), 'detail'],
    ['an audio file name as media', detail(ap, { media: 'placeholder-audio.mp3', furthest: 0 }), 'detail'],
    ['a number as media', detail(ho, { media: 1 }), 'detail'],
    ['a handout from another page', detail(ho, { media: 'how-sleep-works' }), 'detail'],
    ['furthest 30', furthest(30), 'detail'],
    ['furthest "25"', furthest('25'), 'detail'],
    ['furthest null', furthest(null), 'detail'],
    ['furthest -25', furthest(-25), 'detail'],
    ['furthest 100.5', furthest(100.5), 'detail'],
    ['q of 101 UTF-16 code units', q(`zq${'a'.repeat(99)}`), 'detail'],
    ['q of 51 emoji (102 code units)', q('\u{1F634}'.repeat(51)), 'detail'],
    ['an empty q', q(''), 'detail'],
    ['a blank q', q(' \t\n '), 'detail'],
    ['q a number', q(42), 'detail'],
    ['q in an array', q(['zq query']), 'detail'],
    ['results -1', results(-1), 'detail'],
    ['results 1.5', results(1.5), 'detail'],
    ['results "3"', results('3'), 'detail'],
    ['results 1001', results(1001), 'detail'],
    ['results null', results(null), 'detail'],
    ['results true', results(true), 'detail'],
  ])('refuses %s', async (_, body, code) => {
    await expectError(await send(body), 400, code);
    expect(await rows()).toEqual([]);
    expect(logged).toEqual([]);
  });

  it('checks without changing the body it was given', () => {
    const body = { ...valid.search(), detail: { q: '  zq trimmed  ', results: 4 } };
    const copy = structuredClone(body);
    expect(validateEvent(body, index)).toEqual({
      row: { session_id: null, page: 'search', type: 'search', detail: '{"q":"zq trimmed","results":4}' },
    });
    expect(body).toEqual(copy);
  });
});

describe('request format (SPEC §14.1)', () => {
  it.each([
    ['text/plain;charset=UTF-8 (sendBeacon and fetch with a string)', 'text/plain;charset=UTF-8'],
    ['text/plain', 'text/plain'],
    ['application/json', 'application/json'],
    ['" Application/JSON ; charset=utf-8"', ' Application/JSON ; charset=utf-8'],
  ])('accepts %s', async (_, type) => {
    expect((await send(valid.page_view(), { headers: { 'Content-Type': type } })).status).toBe(204);
  });

  it.each([
    ['form-urlencoded', 'application/x-www-form-urlencoded'],
    ['multipart', 'multipart/form-data; boundary=zq'],
    ['text/html', 'text/html'],
    ['a JSON lookalike', 'application/json-patch+json'],
    ['text/plain-ish', 'text/plainx'],
  ])('refuses %s with 415', async (_, type) => {
    await expectError(await send(valid.page_view(), { headers: { 'Content-Type': type } }), 415, 'content_type');
    expect(await rows()).toEqual([]);
  });

  it('refuses a body with no Content-Type with 415', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(valid.page_view()));
    const req = request(bytes, { headers: { 'Content-Type': null } });
    expect(req.headers.has('Content-Type')).toBe(false);
    await expectError(await router.fetch(req, ENV(), createExecutionContext()), 415, 'content_type');
  });

  it.each(['GET', 'HEAD', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])('answers %s with 405 and Allow: POST', async (method) => {
    const res = await router.fetch(request(undefined, { method }), ENV(), createExecutionContext());
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    if (method !== 'HEAD') expect(await res.json()).toEqual({ error: 'method' });
  });

  it('accepts a body of exactly 4096 bytes, sent whole or streamed', async () => {
    const text = padded(valid.page_view(), 4096);
    expect(new TextEncoder().encode(text).length).toBe(4096);
    expect((await send(text)).status).toBe(204);
    expect((await send(stream(text))).status).toBe(204);
    expect(await rows()).toHaveLength(2);
  });

  it('refuses 4097 bytes with 413: by Content-Length, and counted while streaming without one', async () => {
    const text = padded(valid.page_view(), 4097);
    const declared = request(text, { headers: { 'Content-Length': '4097' } });
    await expectError(await router.fetch(declared, ENV(), createExecutionContext()), 413, 'too_large');
    const streamed = request(stream(text));
    expect(streamed.headers.has('Content-Length')).toBe(false);
    await expectError(await router.fetch(streamed, ENV(), createExecutionContext()), 413, 'too_large');
    expect(await rows()).toEqual([]);
  });

  it('refuses a declared Content-Length over the limit without reading the body', async () => {
    const req = request(JSON.stringify(valid.page_view()), { headers: { 'Content-Length': '5000' } });
    await expectError(await router.fetch(req, ENV(), createExecutionContext()), 413, 'too_large');
    expect(req.bodyUsed).toBe(false);
  });

  it('counts the bytes of a body longer than its Content-Length says', async () => {
    const req = request(stream(padded(valid.page_view(), 6000)), { headers: { 'Content-Length': '100' } });
    await expectError(await router.fetch(req, ENV(), createExecutionContext()), 413, 'too_large');
  });

  it.each([
    ['invalid JSON', '{"type":'],
    ['JSON followed by more text', `${JSON.stringify(valid.page_view())} zq`],
    ['an empty body', ''],
    ['single-quoted JSON', "{'type':'page_view'}"],
  ])('refuses %s with 400 "body"', async (_, text) => {
    await expectError(await send(text), 400, 'body');
    expect(await rows()).toEqual([]);
  });

  it('refuses a POST with no body with 400 "body"', async () => {
    await expectError(await router.fetch(request(undefined), ENV(), createExecutionContext()), 400, 'body');
  });

  it('refuses invalid UTF-8 with 400 "body"', async () => {
    const json = new TextEncoder().encode(JSON.stringify(valid.search()));
    const bytes = new Uint8Array([...json.slice(0, 20), 0xff, 0xfe, ...json.slice(20)]);
    const req = request(bytes, { headers: { 'Content-Type': 'text/plain;charset=UTF-8' } });
    await expectError(await router.fetch(req, ENV(), createExecutionContext()), 400, 'body');
  });
});

describe('origin check (SPEC §14.1)', () => {
  it.each([
    ['missing', null],
    ['"null"', 'null'],
    ['another site', 'https://zq-elsewhere.example'],
    ['a subdomain', 'https://www.example.com'],
    ['http where the request is https', 'http://example.com'],
    ['another port', 'https://example.com:8443'],
    ['with a trailing slash', 'https://example.com/'],
  ])('refuses an Origin that is %s with 403, before reading the body', async (_, origin) => {
    const req = request(JSON.stringify(valid.page_view()), { headers: { Origin: origin } });
    await expectError(await router.fetch(req, ENV(), createExecutionContext()), 403, 'origin');
    expect(req.bodyUsed).toBe(false);
    expect(await rows()).toEqual([]);
  });
});

describe('host check (SPEC §18.2, §20 M3)', () => {
  const VERSION_URL = 'https://abc12345-sleepsteps.zq-sub.workers.dev/api/event';
  const PROD_WORKERS_DEV = 'https://sleepsteps.zq-sub.workers.dev/api/event';
  const PREVIEWS = '*-sleepsteps.*.workers.dev';

  it('with production settings ("<DOMAIN>"), answers 404 on a version URL and on workers.dev, even with a matching or forged Origin', async () => {
    const env = { ...ENV(), API_HOSTS: '<DOMAIN>' };
    for (const url of [VERSION_URL, PROD_WORKERS_DEV]) {
      await expectNotFound(await send(valid.page_view(), { url }, env));
      await expectNotFound(await send(valid.page_view(), { url, headers: { Origin: 'https://<DOMAIN>' } }, env));
    }
    await expectNotFound(await send(valid.page_view(), {}, env));
    expect(await rows()).toEqual([]);
  });

  it('with the previews pattern, accepts a preview URL', async () => {
    const env = { ...ENV(), API_HOSTS: PREVIEWS };
    expect((await send(valid.page_view(), { url: 'https://my-branch-sleepsteps.zq-sub.workers.dev/api/event' }, env)).status).toBe(204);
    expect(await rows()).toHaveLength(1);
  });

  it.each([
    ['production on workers.dev', 'https://sleepsteps.zq-sub.workers.dev/api/event'],
    ['a dot inside the wildcard', 'https://a.b-sleepsteps.zq-sub.workers.dev/api/event'],
    ['a missing subdomain', 'https://my-branch-sleepsteps.workers.dev/api/event'],
    ['a lookalike ending', 'https://my-branch-sleepsteps.zq-sub.workers.dev.zq-elsewhere.example/api/event'],
    ['another Worker', 'https://my-branch-other.zq-sub.workers.dev/api/event'],
  ])('with the previews pattern, answers 404 on %s', async (_, url) => {
    await expectNotFound(await send(valid.page_view(), { url }, { ...ENV(), API_HOSTS: PREVIEWS }));
    expect(await rows()).toEqual([]);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not a string', ['example.com']],
  ])('answers 404 when API_HOSTS is %s', async (_, hosts) => {
    await expectNotFound(await send(valid.page_view(), {}, { ...ENV(), API_HOSTS: hosts }));
  });

  it('accepts each host in a list, with its port (npm run dev:collect)', async () => {
    const env = { ...ENV(), API_HOSTS: 'localhost:8787, 127.0.0.1:8787' };
    expect((await send(valid.page_view(), { url: 'http://localhost:8787/api/event' }, env)).status).toBe(204);
    expect((await send(valid.page_view(), { url: 'http://127.0.0.1:8787/api/event' }, env)).status).toBe(204);
    await expectNotFound(await send(valid.page_view(), { url: 'http://localhost:8788/api/event' }, env));
    await expectNotFound(await send(valid.page_view(), { url: 'http://localhost/api/event' }, env));
    expect(await rows()).toHaveLength(2);
  });
});

describe('order of the checks (worker/router.js)', () => {
  const bad = { method: 'PUT', headers: { Origin: 'https://zq-elsewhere.example', 'Content-Type': 'text/html' } };

  it('collection off comes first: 404 whatever else is wrong', async () => {
    await expectNotFound(await send(valid.page_view(), bad, { ...ENV(), DATA_COLLECTION: 'off' }));
  });

  it('then the host: 404 before the method is looked at', async () => {
    await expectNotFound(await send(valid.page_view(), bad, { ...ENV(), API_HOSTS: 'example.org' }));
  });

  it.each([
    ['off', { features: { events: false } }],
    ['"true" (a string)', { features: { events: 'true' } }],
    ['missing', { features: {} }],
    ['in a config with no features', {}],
  ])('then the feature switch: 404 and nothing stored when events is %s', async (_, siteConfig) => {
    const off = createRouter({ pages: PAGES, site: siteConfig });
    await expectNotFound(await send(valid.page_view(), {}, ENV(), off));
    await expectNotFound(await send(valid.page_view(), bad, ENV(), off));
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
});

describe('failures (SPEC §11, §14.1)', () => {
  const failingDb = (error) => ({
    prepare: () => ({
      bind: () => ({
        run: async () => {
          throw error;
        },
      }),
    }),
  });

  it('answers 500 when the database write fails, and logs only a fixed message and the D1 code', async () => {
    // D1 messages can echo the bound values, the visit code included.
    const error = new Error(`D1_TYPE_ERROR: Type 'object' not supported for value '${SESSION}'`);
    const env = { ...ENV(), DB: failingDb(error) };
    await expectError(await send(valid.page_view(), {}, env), 500, 'server');
    await expectError(await send(valid.search(), {}, env), 500, 'server');
    expect(logged).toEqual([
      ['error', '/api/event: database write failed', 'D1_TYPE_ERROR'],
      ['error', '/api/event: database write failed', 'D1_TYPE_ERROR'],
    ]);
  });

  it('logs "unknown" for an error that has no D1 code', async () => {
    const env = { ...ENV(), DB: failingDb(new Error(`restless legs zq ${SESSION}`)) };
    await expectError(await send(valid.page_view(), {}, env), 500, 'server');
    expect(logged).toEqual([['error', '/api/event: database write failed', 'unknown']]);
  });

  it('answers 500 without a database binding', async () => {
    const { DB, ...env } = ENV();
    await expectError(await send(valid.page_view(), {}, env), 500, 'server');
    expect(logged).toEqual([['error', '/api/event: database write failed', 'unknown']]);
  });

  it('answers 500 when the body cannot be read, and logs a fixed message only', async () => {
    const broken = new ReadableStream({
      pull(controller) {
        controller.error(new Error(`zq broken body ${SESSION}`));
      },
    });
    await expectError(await send(broken), 500, 'server');
    expect(logged).toEqual([['error', '/api/event: unexpected error']]);
    expect(await rows()).toEqual([]);
  });
});

describe('the Worker as deployed: the real pages.json and site.config.json', () => {
  const env = () => ({ DB: testEnv.DB, ASSETS: testEnv.ASSETS, DATA_COLLECTION: 'on', API_HOSTS: 'example.com' });
  const [pageId, page] = Object.entries(realPages).find(([, p]) => p.page_view && p.videos.length > 0);
  const deployed = (body) => worker.fetch(request(body), env(), createExecutionContext());
  const expected = site.features.events === true ? 204 : 404;

  it('accepts a page view and a play of one of the page’s videos from a tracked page', async () => {
    expect((await deployed({ ...valid.page_view(), page: pageId })).status).toBe(expected);
    const play = { ...valid.video_play(), page: pageId, detail: { media: page.videos[0], furthest: 25 } };
    expect((await deployed(play)).status).toBe(expected);
    expect(await rows()).toHaveLength(expected === 204 ? 2 : 0);
  });

  it('accepts a search, and refuses a page view from Home', async () => {
    expect((await deployed(valid.search())).status).toBe(expected);
    const res = await deployed({ ...valid.page_view(), page: 'home' });
    if (expected === 204) await expectError(res, 400, 'page');
    else expect(res.status).toBe(404);
  });

  it('answers 404 with the vars in wrangler.jsonc (collection off, no host)', async () => {
    const res = await worker.fetch(request(valid.page_view()), testEnv, createExecutionContext());
    await expectNotFound(res);
    expect(await rows()).toEqual([]);
  });
});
