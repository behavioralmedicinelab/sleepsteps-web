// POST /api/feedback (SPEC §11, §13, §14.1-§14.3, §18.2): every rule in
// worker/routes/feedback.js, the gates in worker/router.js as this route
// meets them (its own body limit, and CF-Connecting-IP passed on for
// Siteverify only), the Turnstile check as the route uses it, and what is
// stored. Runs in workerd against this file's own D1, with the migrations
// applied (apply-migrations.js). Siteverify is never reached: the global
// fetch is mocked for every test (the Workers Vitest plugin has no fetchMock),
// and any other fetch fails the test. Most tests use a router built from the
// fixture pages below; the last block uses the real pages.json and
// site.config.json. lib/turnstile.js has its own tests (turnstile.test.js).
import { createExecutionContext } from 'cloudflare:test';
import { env as testEnv } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import site from '../../site.config.json';
import worker from '../../worker/index.js';
import realPages from '../../worker/generated/pages.json';
import { ERROR_CODES, MAX_BODY_BYTES, MAX_FEEDBACK_BODY_BYTES } from '../../worker/lib/http.js';
import { pageIndex } from '../../worker/lib/pages.js';
import { hourTimestamp } from '../../worker/lib/time.js';
import { REQUEST_ERRORS, SITEVERIFY_URL, TOKEN_ERRORS } from '../../worker/lib/turnstile.js';
import { createRouter } from '../../worker/router.js';
import {
  cleanMessage,
  FEEDBACK_KEYS,
  handleFeedback,
  MAX_MESSAGE_LENGTH,
  MAX_TOKEN_LENGTH,
  validateFeedback,
} from '../../worker/routes/feedback.js';

const PAGES = {
  home: { url: '/', title: 'Home', page_view: false, videos: [] },
  search: { url: '/search/', title: 'Search', page_view: false, videos: [] },
  pain: { url: '/problems/pain/', title: 'Pain', page_view: true, videos: ['pain-about', 'settling-your-body'] },
  start: { url: '/start/', title: 'Start here', page_view: true, videos: ['how-sleep-works'] },
  'urgent-help': { url: '/urgent-help/', title: 'Getting urgent help', page_view: true, videos: [] },
  // pages.json always has a title; if one were ever empty, NULL is stored.
  untitled: { url: '/untitled/', title: '', page_view: false, videos: [] },
};
const SITE = { features: { ratings: true, feedback: true, events: true } };
const router = createRouter({ pages: PAGES, site: SITE });
const index = pageIndex(PAGES);

const ORIGIN = 'https://example.com';
const FEEDBACK_URL = `${ORIGIN}/api/feedback`;
// Not a real secret, and not one of Cloudflare's test values either: the
// mocked Siteverify checks it arrives, and no log line may contain it.
const SECRET = 'zq-turnstile-secret-0x4AAAAAAAzq';
const ENV = () => ({ DB: testEnv.DB, DATA_COLLECTION: 'on', API_HOSTS: 'example.com', TURNSTILE_SECRET: SECRET });
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const IP = '203.0.113.77';
// No page_title: feedback stores the page id only (migration 0002, SPEC §17).
const COLUMNS = ['id', 'message', 'page', 'ts'];
const HOUR = /^\d{4}-\d\d-\d\dT\d\d:00:00\.000Z$/;

/** A valid body, as feedback.js sends it. */
const feedback = (message = 'The audio on this page was too quiet zq-message') => ({
  page_id: 'pain',
  message,
  turnstile_token: TOKEN,
});

// What a test sent that must never reach a log line (SPEC §14.1): every
// string in a body, whole raw bodies, the secret and the extra headers.
let secrets;
let logged;
const remember = (value) => {
  if (typeof value === 'string') {
    if (value.trim().length >= 6) secrets.push(value);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) remember(item);
  }
};

// The mocked Siteverify: each call's form fields, and the answer to give.
let siteverify;
let answer;
let otherFetches;

beforeEach(async () => {
  for (const table of ['feedback', 'ratings', 'events']) await testEnv.DB.prepare(`DELETE FROM ${table}`).run();
  secrets = [SECRET, TOKEN, IP];
  logged = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    vi.spyOn(console, method).mockImplementation((...args) => logged.push([method, ...args.map(String)]));
  }
  siteverify = [];
  otherFetches = [];
  answer = () => Response.json({ success: true, 'error-codes': [], hostname: 'example.com' });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const req = new Request(input, init);
    if (req.url !== SITEVERIFY_URL || req.method !== 'POST') {
      otherFetches.push(req.url);
      throw new TypeError('unexpected fetch');
    }
    const form = new URLSearchParams(new TextDecoder().decode(await req.arrayBuffer()));
    siteverify.push(Object.fromEntries(form));
    return answer(form);
  });
});

afterEach(() => {
  expect(otherFetches, 'fetches other than Siteverify').toEqual([]);
  // Each argument as logged, so a quote in a raw body can't hide a match.
  const text = logged.flat().join('\n');
  for (const secret of secrets) expect(text.includes(secret), `a log line contains ${JSON.stringify(secret)}`).toBe(false);
  vi.restoreAllMocks();
});

/**
 * A request to /api/feedback. `body` is sent as JSON unless it is already a
 * string, bytes or a stream. `headers` are added to a same-origin
 * application/json request (what feedback.js sends through api.js); a null
 * value removes that header.
 */
function request(body, { url = FEEDBACK_URL, method = 'POST', headers = {} } = {}) {
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

const rows = async () => (await testEnv.DB.prepare('SELECT * FROM feedback ORDER BY id').all()).results;
const messages = async () => (await rows()).map((r) => r.message);
const otherRows = async () => [
  ...(await testEnv.DB.prepare('SELECT * FROM ratings').all()).results,
  ...(await testEnv.DB.prepare('SELECT * FROM events').all()).results,
];

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

const byteLength = (text) => new TextEncoder().encode(text).length;

/** JSON for `body`, padded with spaces to exactly `bytes` bytes. */
const padded = (body, bytes) => {
  const json = JSON.stringify(body);
  return `${json}${' '.repeat(bytes - byteLength(json))}`;
};

const floorHour = (ms) => Math.floor(ms / 3_600_000) * 3_600_000;

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

/** Nothing stored, Siteverify not asked, nothing logged. */
async function expectUntouched() {
  expect(await rows()).toEqual([]);
  expect(await otherRows()).toEqual([]);
  expect(siteverify).toEqual([]);
  expect(logged).toEqual([]);
}

describe('the feedback body (SPEC §13, §14.1)', () => {
  it('is exactly page_id, message and turnstile_token, with a 2000-unit message and a 2048-character token', () => {
    expect(FEEDBACK_KEYS).toEqual(['page_id', 'message', 'turnstile_token']);
    expect(Object.isFrozen(FEEDBACK_KEYS)).toBe(true);
    expect([MAX_MESSAGE_LENGTH, MAX_TOKEN_LENGTH]).toEqual([2000, 2048]);
  });

  it('has its own error codes in the closed list: message and turnstile', () => {
    expect(ERROR_CODES).toContain('message');
    expect(ERROR_CODES).toContain('turnstile');
  });

  it('has its own body limit, 16384 bytes, while the other routes keep 4096', () => {
    expect([MAX_BODY_BYTES, MAX_FEEDBACK_BODY_BYTES]).toEqual([4096, 16384]);
  });
});

describe('storing feedback', () => {
  it('204 with no body, one row with the time rounded down to the hour, and one Siteverify call', async () => {
    const before = Date.now();
    await expectStored(await send(feedback(), { headers: { 'CF-Connecting-IP': IP } }));
    const after = Date.now();

    const stored = await rows();
    expect(stored).toHaveLength(1);
    const [row] = stored;
    expect(Object.keys(row).sort()).toEqual(COLUMNS);
    expect([row.page, row.message]).toEqual(['pain', 'The audio on this page was too quiet zq-message']);
    expect(row.ts).toMatch(HOUR);
    expect([floorHour(before), floorHour(after)]).toContain(Date.parse(row.ts));
    // No events or ratings row, and so no session_id (SPEC §14.1).
    expect(await otherRows()).toEqual([]);
    expect(siteverify).toEqual([{ secret: SECRET, response: TOKEN, remoteip: IP }]);
    expect(logged).toEqual([]);
  });

  it('leaves remoteip out without CF-Connecting-IP, and never takes it from X-Forwarded-For', async () => {
    await expectStored(await send(feedback()));
    await expectStored(await send(feedback(), { headers: { 'X-Forwarded-For': '198.51.100.23' } }));
    await expectStored(await send(feedback(), { headers: { 'CF-Connecting-IP': '' } }));
    expect(siteverify).toEqual([
      { secret: SECRET, response: TOKEN },
      { secret: SECRET, response: TOKEN },
      { secret: SECRET, response: TOKEN },
    ]);
    secrets.push('198.51.100.23');
  });

  it('rounds the time down to the hour, as for every row (SPEC §14.1)', async () => {
    for (const [now, ts] of [
      ['2026-11-06T13:59:59.999Z', '2026-11-06T13:00:00.000Z'],
      ['2026-11-06T13:00:00.000Z', '2026-11-06T13:00:00.000Z'],
      ['2026-12-31T23:30:00.001Z', '2026-12-31T23:00:00.000Z'],
    ]) {
      const when = new Date(now);
      expect((await handleFeedback(feedback(), ENV(), index, { now: when })).status).toBe(204);
      // The `now` passed in is not changed.
      expect(when.toISOString()).toBe(now);
      expect(hourTimestamp(new Date(now))).toBe(ts);
    }
    expect((await rows()).map((r) => r.ts)).toEqual(['2026-11-06T13:00:00.000Z', '2026-11-06T13:00:00.000Z', '2026-12-31T23:00:00.000Z']);
  });

  it('stores the page id only, never a title, whatever the page\'s title in pages.json', async () => {
    await expectStored(await send({ ...feedback(), page_id: 'start' }));
    await expectStored(await send({ ...feedback(), page_id: 'untitled' }));
    expect(await rows()).toEqual([
      expect.objectContaining({ page: 'start' }),
      expect.objectContaining({ page: 'untitled' }),
    ]);
    for (const row of await rows()) expect(Object.keys(row).sort()).toEqual(COLUMNS);
    expect(JSON.stringify(await rows())).not.toContain('Start here');
  });

  it.each(['home', 'search', 'urgent-help', 'start'])('accepts feedback from %s: any page in pages.json', async (page) => {
    await expectStored(await send({ ...feedback(), page_id: page }));
    expect((await rows()).map((r) => r.page)).toEqual([page]);
  });

  it('stores only its own columns: no IP address, user agent or referrer, whatever the request carries', async () => {
    const headers = {
      'CF-Connecting-IP': IP,
      'X-Forwarded-For': '198.51.100.23',
      'User-Agent': 'ProbeBrowser/9.9 zq-agent',
      Referer: 'https://example.com/search/?q=zq-referrer',
    };
    secrets.push(...Object.values(headers));
    await expectStored(await send(feedback(), { headers }));
    const stored = await rows();
    const text = JSON.stringify(stored);
    for (const value of Object.values(headers)) expect(text).not.toContain(value);
    for (const row of stored) expect(Object.keys(row).sort()).toEqual(COLUMNS);
  });

  it('stores each message as a new row, with no dedupe', async () => {
    for (let i = 0; i < 3; i += 1) await expectStored(await send(feedback('Same words zq')));
    expect(await messages()).toEqual(['Same words zq', 'Same words zq', 'Same words zq']);
    expect(siteverify).toHaveLength(3);
  });

  it('accepts the keys in any order', async () => {
    await expectStored(await send(`{"turnstile_token":"${TOKEN}","message":"zq order","page_id":"pain"}`));
    expect(await messages()).toEqual(['zq order']);
  });

  it.each([
    ['application/json (api.js)', 'application/json'],
    ['application/json; charset=utf-8', 'application/json; charset=utf-8'],
    ['text/plain;charset=UTF-8', 'text/plain;charset=UTF-8'],
  ])('accepts %s', async (_, type) => {
    await expectStored(await send(feedback(), { headers: { 'Content-Type': type } }));
  });

  it('stores text that looks like markup, SQL or a spreadsheet formula as it is', async () => {
    const texts = ['<script>alert(1)</script>', "'); DROP TABLE feedback; --", '=HYPERLINK("http://zq")', '{"zq":1}', 'Ünïcödé — “quotes” 😴'];
    for (const text of texts) await expectStored(await send(feedback(text)));
    expect(await messages()).toEqual(texts);
  });
});

describe('cleaning the message (SPEC §14.2)', () => {
  it.each([
    ['CRLF to LF', 'one\r\ntwo\r\nthree', 'one\ntwo\nthree'],
    ['a lone CR to LF', 'one\rtwo', 'one\ntwo'],
    ['CR CR LF to two LFs', 'one\r\r\ntwo', 'one\n\ntwo'],
    ['keeps tabs and LFs inside', 'a\tb\n\nc', 'a\tb\n\nc'],
    ['removes NUL', 'zq\u0000text', 'zqtext'],
    ['removes the other C0 controls', 'a\u0001\u0007\u0008\u000B\u000C\u000E\u001Bb\u001F', 'ab'],
    ['removes DEL and the C1 controls', 'a\u007F\u0080\u0085\u009Fb', 'ab'],
    ['keeps U+00A0 inside', 'a\u00A0b', 'a\u00A0b'],
    ['replaces a lone high surrogate', 'a\uD83Db', 'a\uFFFDb'],
    ['replaces a lone low surrogate', 'a\uDE34b', 'a\uFFFDb'],
    ['keeps a surrogate pair', 'a😴b', 'a😴b'],
    ['trims spaces and line breaks', '  \r\n\t hello \n\n ', 'hello'],
    ['trims after removing controls', '\u0000 hello \u0085', 'hello'],
    ['trims Unicode spaces and a BOM', '\uFEFF\u00A0\u2028hello\u3000', 'hello'],
    ['leaves zero-width characters (not whitespace)', '\u200Bhello', '\u200Bhello'],
  ])('%s', async (_, raw, cleaned) => {
    expect(cleanMessage(raw)).toBe(cleaned);
    await expectStored(await send(feedback(raw)));
    expect(await messages()).toEqual([cleaned]);
  });

  it('removes exactly U+0000-U+0008, U+000B, U+000C, U+000E-U+001F and U+007F-U+009F; keeps tab and LF; turns CR into LF', () => {
    for (let code = 0; code <= 0xa0; code += 1) {
      const char = String.fromCharCode(code);
      const removed = (code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f) || (code >= 0x7f && code <= 0x9f));
      const want = removed ? 'ab' : code === 0x0d ? 'a\nb' : `a${char}b`;
      expect(cleanMessage(`a${char}b`), `U+${code.toString(16).padStart(4, '0')}`).toBe(want);
    }
  });

  it('stores 2000 UTF-16 code units, and refuses 2001', async () => {
    await expectStored(await send(feedback('a'.repeat(2000))));
    await expectError(await send(feedback('a'.repeat(2001))), 400, 'message');
    expect((await rows()).map((r) => r.message.length)).toEqual([2000]);
  });

  it('counts UTF-16 code units, as maxlength does: 1000 emoji fit, 1001 do not', async () => {
    await expectStored(await send(feedback('😴'.repeat(1000))));
    await expectError(await send(feedback('😴'.repeat(1001))), 400, 'message');
    expect(await rows()).toHaveLength(1);
  });

  it('measures after cleaning: CRLFs, controls and outer spaces do not count', async () => {
    const lines = `${'a'.repeat(998)}\r\n${'b'.repeat(1001)}`;
    expect(lines.length).toBe(2001);
    await expectStored(await send(feedback(lines)));
    await expectStored(await send(feedback(`  ${'c'.repeat(2000)}\u0000\n `)));
    expect((await rows()).map((r) => r.message.length)).toEqual([2000, 2000]);
  });

  it('stores the 2000-unit worst case: every character a JSON escape, with a 2048-character token, under 16384 bytes', async () => {
    const message = `${'\u0001'.repeat(1999)}z`;
    const body = { page_id: 'pain', message, turnstile_token: 'T'.repeat(2048) };
    const size = byteLength(JSON.stringify(body));
    expect(size).toBeGreaterThan(14000);
    expect(size).toBeLessThanOrEqual(MAX_FEEDBACK_BODY_BYTES);
    await expectStored(await send(body));
    expect(await messages()).toEqual(['z']);
  });

  it('stores 2000 three-byte characters with a 2048-character token', async () => {
    const body = { page_id: 'pain', message: '—'.repeat(2000), turnstile_token: 'T'.repeat(2048) };
    expect(byteLength(JSON.stringify(body))).toBeGreaterThan(8000);
    await expectStored(await send(body));
    expect(siteverify[0].response).toHaveLength(2048);
  });
});

describe('validation: 400 or 403 with the failed rule, before Siteverify, and nothing stored or logged (SPEC §14.2)', () => {
  const f = feedback();
  const set = (key, value) => ({ ...f, [key]: value });
  const drop = (key) => {
    const copy = { ...f };
    delete copy[key];
    return copy;
  };

  it.each([
    // body
    ['an array', '[]', 400, 'body'],
    ['null', 'null', 400, 'body'],
    ['a string', '"zq message"', 400, 'body'],
    ['a number', '42', 400, 'body'],
    ['an empty object', {}, 400, 'body'],
    ['no page_id', drop('page_id'), 400, 'body'],
    ['no message', drop('message'), 400, 'body'],
    ['no turnstile_token', drop('turnstile_token'), 400, 'body'],
    ['a page_title from the client', set('page_title', 'Pain zq-title'), 400, 'body'],
    ['a client timestamp', set('ts', '2020-01-01T00:00:00.000Z'), 400, 'body'],
    ['a session_id', set('session_id', crypto.randomUUID()), 400, 'body'],
    ['a null session_id', set('session_id', null), 400, 'body'],
    ['a __proto__ key', `{"page_id":"pain","message":"zq proto","turnstile_token":"${TOKEN}","__proto__":{}}`, 400, 'body'],
    ['an extra key', set('extra', 1), 400, 'body'],
    ['a page key instead of page_id', { page: 'pain', message: 'zq message', turnstile_token: TOKEN }, 400, 'body'],
    ['Turnstile\'s own field name', { page_id: 'pain', message: 'zq message', 'cf-turnstile-response': TOKEN }, 400, 'body'],
    ['a key in another case', { Page_id: 'pain', message: 'zq message', turnstile_token: TOKEN }, 400, 'body'],
    ['the body wrapped in an array', [f], 400, 'body'],
    // page
    ['an unknown page', set('page_id', 'no-such-page'), 400, 'page'],
    ['a path instead of a page_id', set('page_id', '/problems/pain/'), 400, 'page'],
    ['the 404 page\'s path', set('page_id', '/404.html'), 400, 'page'],
    ['an uppercase page_id', set('page_id', 'PAIN'), 400, 'page'],
    ['an empty page_id', set('page_id', ''), 400, 'page'],
    ['page_id "__proto__"', set('page_id', '__proto__'), 400, 'page'],
    ['page_id "constructor"', set('page_id', 'constructor'), 400, 'page'],
    ['a null page_id', set('page_id', null), 400, 'page'],
    ['a numeric page_id', set('page_id', 1), 400, 'page'],
    ['a page_id in an array', set('page_id', ['pain']), 400, 'page'],
    // message
    ['an empty message', set('message', ''), 400, 'message'],
    ['a message of spaces', set('message', '     '), 400, 'message'],
    ['a message of line breaks and tabs', set('message', '\r\n\n\t\r'), 400, 'message'],
    ['a message of control characters', set('message', '\u0000\u0001\u0085\u007F'), 400, 'message'],
    ['a message of Unicode spaces', set('message', '\u00A0\u2003\u3000\uFEFF'), 400, 'message'],
    ['2001 characters', set('message', 'x'.repeat(2001)), 400, 'message'],
    ['a null message', set('message', null), 400, 'message'],
    ['a numeric message', set('message', 42), 400, 'message'],
    ['true', set('message', true), 400, 'message'],
    ['a message in an array', set('message', ['zq message']), 400, 'message'],
    ['a message object', set('message', { text: 'zq message' }), 400, 'message'],
    // turnstile
    ['an empty token', set('turnstile_token', ''), 403, 'turnstile'],
    ['a 2049-character token', set('turnstile_token', 'T'.repeat(2049)), 403, 'turnstile'],
    ['a null token', set('turnstile_token', null), 403, 'turnstile'],
    ['a numeric token', set('turnstile_token', 1), 403, 'turnstile'],
    ['true as the token', set('turnstile_token', true), 403, 'turnstile'],
    ['a token in an array', set('turnstile_token', [TOKEN]), 403, 'turnstile'],
    ['a token object', set('turnstile_token', { token: TOKEN }), 403, 'turnstile'],
  ])('refuses %s', async (_, body, status, code) => {
    await expectError(await send(body), status, code);
    await expectUntouched();
  });

  it.each([
    ['body before page: an extra key on an unknown page', { page_id: 'zq', message: '', turnstile_token: '', ts: 'x' }, 400, 'body'],
    ['page before message: an unknown page with an empty message', { page_id: 'zq', message: '', turnstile_token: '' }, 400, 'page'],
    ['message before token: an empty message with no token', { page_id: 'pain', message: ' ', turnstile_token: '' }, 400, 'message'],
    ['token last: a good message with an empty token', { page_id: 'pain', message: 'zq ok', turnstile_token: '' }, 403, 'turnstile'],
  ])('checks in order: %s', async (_, body, status, code) => {
    await expectError(await send(body), status, code);
    expect(validateFeedback(body, index)).toEqual({ status, error: code });
    await expectUntouched();
  });

  it('checks without changing the body it was given, and returns only the checked values', () => {
    const body = feedback('  zq\r\nchecked\u0000  ');
    const copy = structuredClone(body);
    expect(validateFeedback(body, index)).toEqual({ row: { page: 'pain', message: 'zq\nchecked' }, token: TOKEN });
    expect(body).toEqual(copy);
  });

  it('never reads a key from the prototype chain', () => {
    const inherited = Object.assign(Object.create({ page_id: 'pain' }), { message: 'zq', turnstile_token: TOKEN });
    expect(validateFeedback(inherited, index)).toEqual({ status: 400, error: 'body' });
    expect(validateFeedback(Object.assign(Object.create(null), feedback()), index)).toEqual({ status: 400, error: 'body' });
  });
});

describe('the Turnstile check (SPEC §14.3)', () => {
  it('accepts a 2048-character token, and sends it whole', async () => {
    const token = `0.${'a'.repeat(2046)}`;
    await expectStored(await send({ ...feedback(), turnstile_token: token }));
    expect(siteverify.map((call) => call.response)).toEqual([token]);
  });

  it.each([
    ...TOKEN_ERRORS.map((code) => [code, { success: false, 'error-codes': [code] }]),
    ['no reason given', { success: false }],
    ['success "true" (a string)', { success: 'true' }],
  ])('answers 403 "turnstile" and stores nothing when Siteverify says %s, and logs nothing', async (_, body) => {
    answer = () => Response.json(body);
    await expectError(await send(feedback(), { headers: { 'CF-Connecting-IP': IP } }), 403, 'turnstile');
    expect(siteverify).toEqual([{ secret: SECRET, response: TOKEN, remoteip: IP }]);
    expect(await rows()).toEqual([]);
    expect(logged).toEqual([]);
  });

  it.each(REQUEST_ERRORS)('answers 500 when Siteverify refuses our request (%s), and logs the code', async (code) => {
    answer = () => Response.json({ success: false, 'error-codes': [code] });
    await expectError(await send(feedback()), 500, 'server');
    expect(logged).toEqual([['error', '/api/feedback: siteverify refused the request', code]]);
    expect(await rows()).toEqual([]);
  });

  it.each([
    ['internal-error', () => Response.json({ success: false, 'error-codes': ['internal-error'] }), 'internal-error'],
    ['an unknown code', () => Response.json({ success: false, 'error-codes': ['zq-code'] }), 'other'],
    ['text that is not JSON', () => new Response('zq <html>'), 'bad-response'],
    ['HTTP 500', () => new Response('zq error', { status: 500 }), 'bad-response'],
    ['HTTP 503 with success true', () => Response.json({ success: true }, { status: 503 }), 'bad-response'],
    ['a rejected fetch', () => Promise.reject(new TypeError(`zq network ${TOKEN}`)), 'network'],
  ])('answers 500 when Siteverify gives no usable answer (%s), and logs a fixed reason', async (_, give, reason) => {
    answer = give;
    await expectError(await send(feedback()), 500, 'server');
    expect(logged).toEqual([['error', '/api/feedback: siteverify unavailable', reason]]);
    expect(await rows()).toEqual([]);
  });

  it('answers 500 when Siteverify takes too long, and logs "timeout"', async () => {
    const fetcher = (_, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    const res = await handleFeedback(feedback(), ENV(), index, { fetcher, timeoutMs: 20 });
    await expectError(res, 500, 'server');
    expect(logged).toEqual([['error', '/api/feedback: siteverify unavailable', 'timeout']]);
    expect(await rows()).toEqual([]);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not a string', 42],
  ])('answers 500 without asking Siteverify when TURNSTILE_SECRET is %s, and logs that', async (_, value) => {
    const env = { ...ENV(), TURNSTILE_SECRET: value };
    await expectError(await send(feedback(), {}, env), 500, 'server');
    expect(siteverify).toEqual([]);
    expect(logged).toEqual([['error', '/api/feedback: TURNSTILE_SECRET missing']]);
    expect(await rows()).toEqual([]);
  });

  it('still refuses a bad body with 400 when the secret is missing: the body is checked first', async () => {
    const env = { ...ENV(), TURNSTILE_SECRET: undefined };
    await expectError(await send({ ...feedback(), page_id: 'zq' }, {}, env), 400, 'page');
    await expectUntouched();
  });
});

describe('request format and origin (SPEC §14.1)', () => {
  it.each([
    ['text/html', 'text/html'],
    ['form-urlencoded (an HTML form)', 'application/x-www-form-urlencoded'],
    ['multipart', 'multipart/form-data; boundary=zq'],
  ])('refuses %s with 415', async (_, type) => {
    await expectError(await send(feedback(), { headers: { 'Content-Type': type } }), 415, 'content_type');
    await expectUntouched();
  });

  it.each(['GET', 'HEAD', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])('answers %s with 405 and Allow: POST', async (method) => {
    const res = await router.fetch(request(undefined, { method }), ENV(), createExecutionContext());
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST');
    expectApiHeaders(res);
    await expectUntouched();
  });

  it.each([
    ['missing', null],
    ['"null"', 'null'],
    ['another site', 'https://zq-elsewhere.example'],
    ['http where the request is https', 'http://example.com'],
  ])('refuses an Origin that is %s with 403, before reading the body', async (_, origin) => {
    const req = request(JSON.stringify(feedback()), { headers: { Origin: origin } });
    await expectError(await router.fetch(req, ENV(), createExecutionContext()), 403, 'origin');
    expect(req.bodyUsed).toBe(false);
    await expectUntouched();
  });

  it('accepts a body of exactly 16384 bytes, sent whole or streamed', async () => {
    const text = padded(feedback(), 16384);
    expect(byteLength(text)).toBe(16384);
    await expectStored(await send(text));
    await expectStored(await send(stream(text)));
    expect(await rows()).toHaveLength(2);
  });

  it('refuses 16385 bytes with 413, by Content-Length and counted while streaming, without asking Siteverify', async () => {
    const text = padded(feedback(), 16385);
    const declared = request(text, { headers: { 'Content-Length': '16385' } });
    await expectError(await router.fetch(declared, ENV(), createExecutionContext()), 413, 'too_large');
    expect(declared.bodyUsed).toBe(false);
    const streamed = request(stream(text));
    expect(streamed.headers.has('Content-Length')).toBe(false);
    await expectError(await router.fetch(streamed, ENV(), createExecutionContext()), 413, 'too_large');
    await expectUntouched();
  });

  it('leaves /api/event and /api/rate at 4096 bytes', async () => {
    const event = { type: 'page_view', page: 'pain', session_id: crypto.randomUUID(), detail: {} };
    const rating = { page_id: 'pain', video_id: 'pain-about', stars: 4 };
    for (const [path, body] of [
      ['/api/event', event],
      ['/api/rate', rating],
    ]) {
      const url = `${ORIGIN}${path}`;
      await expectError(await send(padded(body, 4097), { url }), 413, 'too_large');
      await expectError(await send(stream(padded(body, 4097)), { url }), 413, 'too_large');
      expect((await send(padded(body, 4096), { url })).status, path).toBe(204);
    }
    expect(await otherRows()).toHaveLength(2);
    expect(siteverify).toEqual([]);
  });

  it.each([
    ['invalid JSON', '{"page_id":'],
    ['JSON followed by more text', `${JSON.stringify(feedback())} zq`],
    ['an empty body', ''],
  ])('refuses %s with 400 "body"', async (_, text) => {
    await expectError(await send(text), 400, 'body');
    await expectUntouched();
  });

  it('refuses invalid UTF-8 with 400 "body"', async () => {
    const json = new TextEncoder().encode(JSON.stringify(feedback()));
    const bytes = new Uint8Array([...json.slice(0, 30), 0xff, 0xfe, ...json.slice(30)]);
    await expectError(await router.fetch(request(bytes), ENV(), createExecutionContext()), 400, 'body');
    await expectUntouched();
  });
});

describe('host check (SPEC §18.2, §20 M3)', () => {
  it('with production settings ("<DOMAIN>"), answers 404 on a version URL, even with a matching Origin', async () => {
    const env = { ...ENV(), API_HOSTS: '<DOMAIN>' };
    await expectNotFound(await send(feedback(), { url: 'https://abc12345-sleepsteps.zq-sub.workers.dev/api/feedback' }, env));
    await expectNotFound(await send(feedback(), {}, env));
    await expectUntouched();
  });

  it('accepts a preview URL with the previews pattern', async () => {
    const env = { ...ENV(), API_HOSTS: '*-sleepsteps.*.workers.dev' };
    await expectStored(await send(feedback(), { url: 'https://my-branch-sleepsteps.zq-sub.workers.dev/api/feedback' }, env));
  });

  it('accepts each local host, with its port (npm run dev:collect)', async () => {
    const env = { ...ENV(), API_HOSTS: 'localhost:8787,127.0.0.1:8787' };
    await expectStored(await send(feedback(), { url: 'http://localhost:8787/api/feedback' }, env));
    await expectStored(await send(feedback(), { url: 'http://127.0.0.1:8787/api/feedback' }, env));
    await expectNotFound(await send(feedback(), { url: 'http://localhost:8788/api/feedback' }, env));
    expect(await rows()).toHaveLength(2);
  });
});

describe('order of the checks (worker/router.js)', () => {
  const bad = { method: 'PUT', headers: { Origin: 'https://zq-elsewhere.example', 'Content-Type': 'text/html' } };

  it('collection off comes first: 404 whatever else is wrong, and Siteverify is never asked', async () => {
    for (const value of ['off', undefined, 'On', ' on']) {
      await expectNotFound(await send(feedback(), bad, { ...ENV(), DATA_COLLECTION: value }));
      await expectNotFound(await send(feedback(), {}, { ...ENV(), DATA_COLLECTION: value }));
    }
    await expectUntouched();
  });

  it('then the host: 404 before the method is looked at', async () => {
    await expectNotFound(await send(feedback(), bad, { ...ENV(), API_HOSTS: 'example.org' }));
    await expectNotFound(await send(feedback(), {}, { ...ENV(), API_HOSTS: 'example.org' }));
    await expectUntouched();
  });

  it.each([
    ['off', { features: { ratings: true, feedback: false, events: true } }],
    ['"true" (a string)', { features: { feedback: 'true' } }],
    ['1', { features: { feedback: 1 } }],
    ['missing', { features: { ratings: true, events: true } }],
    ['in a config with no features', {}],
  ])('then the feature switch: 404, nothing stored and Siteverify never asked when feedback is %s', async (_, siteConfig) => {
    const off = createRouter({ pages: PAGES, site: siteConfig });
    await expectNotFound(await send(feedback(), {}, ENV(), off));
    await expectNotFound(await send(feedback(), bad, ENV(), off));
    await expectUntouched();
  });

  it('then the method (405), the Origin (403), the media type (415), the size (413) and the JSON (400)', async () => {
    const big = `{"zq":"${'x'.repeat(17000)}`;
    await expectError(await send(big, bad), 405, 'method');
    await expectError(await send(big, { headers: bad.headers }), 403, 'origin');
    await expectError(await send(big, { headers: { 'Content-Type': 'text/html' } }), 415, 'content_type');
    await expectError(await send(big), 413, 'too_large');
    await expectError(await send(big.slice(0, 5000)), 400, 'body');
    await expectUntouched();
  });

  it('then the route: body, page, message, token, the secret, Siteverify, and last the write', async () => {
    await expectError(await send({ ...feedback(''), page_id: 'zq', ts: 'x' }), 400, 'body');
    await expectError(await send({ ...feedback(''), page_id: 'zq' }), 400, 'page');
    await expectError(await send({ ...feedback(''), turnstile_token: '' }), 400, 'message');
    await expectError(await send({ ...feedback(), turnstile_token: '' }), 403, 'turnstile');
    expect(siteverify).toEqual([]);
    await expectError(await send(feedback(), {}, { ...ENV(), TURNSTILE_SECRET: '' }), 500, 'server');
    expect(siteverify).toEqual([]);
    answer = () => Response.json({ success: false, 'error-codes': ['invalid-input-response'] });
    await expectError(await send(feedback()), 403, 'turnstile');
    expect(siteverify).toHaveLength(1);
    expect(await rows()).toEqual([]);
    answer = () => Response.json({ success: true });
    await expectStored(await send(feedback()));
    expect(siteverify).toHaveLength(2);
    expect(await rows()).toHaveLength(1);
    expect(logged).toEqual([['error', '/api/feedback: TURNSTILE_SECRET missing']]);
  });
});

describe('the feedback switch is separate from the others (site.config.json features)', () => {
  const sendRating = (on) =>
    on.fetch(
      new Request(`${ORIGIN}/api/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: JSON.stringify({ page_id: 'pain', video_id: 'pain-about', stars: 4 }),
      }),
      ENV(),
      createExecutionContext(),
    );

  it('with feedback off and ratings on: /api/feedback answers 404 and /api/rate still stores', async () => {
    const on = createRouter({ pages: PAGES, site: { features: { ratings: true, feedback: false, events: true } } });
    await expectNotFound(await send(feedback(), {}, ENV(), on));
    expect((await sendRating(on)).status).toBe(204);
    expect(await rows()).toEqual([]);
    expect(await otherRows()).toHaveLength(1);
    expect(siteverify).toEqual([]);
  });

  it('with feedback on and ratings off: /api/feedback stores and /api/rate answers 404', async () => {
    const on = createRouter({ pages: PAGES, site: { features: { ratings: false, feedback: true, events: false } } });
    await expectStored(await send(feedback(), {}, ENV(), on));
    expect((await sendRating(on)).status).toBe(404);
    expect(await rows()).toHaveLength(1);
    expect(await otherRows()).toEqual([]);
  });
});

describe('failures and logs (SPEC §11, §14.1)', () => {
  const SENTINEL = 'zq-sentinel-feedback-text';
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

  it('answers 500 when the database write fails, after Siteverify, and logs only a fixed message and the D1 code', async () => {
    // D1 messages can echo the bound values: here, the message itself.
    const error = new Error(`D1_ERROR: string or blob too big: ${SENTINEL}`);
    await expectError(await send(feedback(`Message ${SENTINEL}`), {}, { ...ENV(), DB: failingDb(error) }), 500, 'server');
    expect(siteverify).toHaveLength(1);
    expect(logged).toEqual([['error', '/api/feedback: database write failed', 'D1_ERROR']]);
  });

  it('answers 500 without a database binding, and logs "unknown"', async () => {
    const { DB, ...env } = ENV();
    await expectError(await send(feedback(), {}, env), 500, 'server');
    expect(logged).toEqual([['error', '/api/feedback: database write failed', 'unknown']]);
  });

  it('answers 500 when the body cannot be read, and logs a fixed message only', async () => {
    const broken = new ReadableStream({
      pull(controller) {
        controller.error(new Error(`zq broken body ${SENTINEL}`));
      },
    });
    await expectError(await send(broken), 500, 'server');
    expect(logged).toEqual([['error', '/api/feedback: unexpected error']]);
    expect(siteverify).toEqual([]);
  });

  it('never logs a refused body, a refused token or a Siteverify answer', async () => {
    for (const body of [
      { page_id: SENTINEL, message: 'zq', turnstile_token: TOKEN },
      { page_id: 'pain', message: SENTINEL.repeat(200), turnstile_token: TOKEN },
      { page_id: 'pain', message: SENTINEL, turnstile_token: SENTINEL.repeat(100) },
      { page_id: 'pain', message: SENTINEL, turnstile_token: TOKEN, [SENTINEL]: 1 },
      `{"page_id":"${SENTINEL}"`,
    ]) {
      expect([400, 403]).toContain((await send(body)).status);
    }
    answer = () => Response.json({ success: false, 'error-codes': ['bad-request', SENTINEL], messages: [SENTINEL] });
    expect((await send(feedback(SENTINEL))).status).toBe(500);
    expect(logged).toEqual([['error', '/api/feedback: siteverify refused the request', 'bad-request']]);
  });
});

describe('the Worker as deployed: the real pages.json and site.config.json', () => {
  const env = () => ({ DB: testEnv.DB, ASSETS: testEnv.ASSETS, DATA_COLLECTION: 'on', API_HOSTS: 'example.com', TURNSTILE_SECRET: SECRET });
  const deployed = (body) => worker.fetch(request(body), env(), createExecutionContext());
  const expected = site.features.feedback === true ? 204 : 404;

  it('accepts feedback from every page in pages.json', () => {
    const real = pageIndex(realPages);
    expect(real.size).toBeGreaterThan(0);
    for (const page of real.keys()) {
      const result = validateFeedback({ page_id: page, message: 'zq', turnstile_token: TOKEN }, real);
      expect(result, page).toEqual({ row: { page, message: 'zq' }, token: TOKEN });
    }
  });

  it.each(['tired-but-wired', 'home', 'search', 'start', 'contact'])('stores feedback from %s with its page id only', async (page) => {
    expect(realPages[page]).toBeTruthy();
    const res = await deployed({ page_id: page, message: 'Real page zq', turnstile_token: TOKEN });
    expect(res.status).toBe(expected);
    const want = expected === 204 ? [{ page, message: 'Real page zq' }] : [];
    expect((await rows()).map((r) => ({ page: r.page, message: r.message }))).toEqual(want);
    for (const row of await rows()) expect(Object.keys(row).sort()).toEqual(COLUMNS);
  });

  it('refuses a path, as the 404 page would have sent (SPEC §13)', async () => {
    const res = await deployed({ page_id: '/no-such-page/', message: 'zq', turnstile_token: TOKEN });
    if (expected === 204) await expectError(res, 400, 'page');
    else await expectNotFound(res);
    await expectUntouched();
  });

  it('answers 404 with the vars in wrangler.jsonc (collection off, no host, no secret)', async () => {
    const res = await worker.fetch(request(feedback()), testEnv, createExecutionContext());
    await expectNotFound(res);
    await expectUntouched();
  });
});
