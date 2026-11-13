// /admin and /admin/* (SPEC §14.4, §20 M6): the host and Access gates, the
// method and path routing, the headers on every answer, the summary's data
// (worker/lib/admin-data.js) and the page's states, ids and escaping. Runs in
// workerd against this file's own migrated D1. Most tests pass a stub token
// check; the gate tests use the real one with tokens signed here. The CSV
// export is in admin-export.test.js, the token check in access-jwt.test.js.
import { createExecutionContext } from 'cloudflare:test';
import { env as testEnv, exports } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker/index.js';
import { createAccessVerifier } from '../../worker/lib/access-jwt.js';
import { readSummary, summaryModel, thousands } from '../../worker/lib/admin-data.js';
import { summaryRange } from '../../worker/lib/date-range.js';
import { pageIndex } from '../../worker/lib/pages.js';
import { createRouter } from '../../worker/router.js';
import { ADMIN_HEADERS } from '../../worker/routes/admin.js';
import { AUD, certsBody, certsFetcher, claims, makeKey, signToken, TEAM } from './access-tokens.js';

const PAGES = {
  home: { url: '/', title: 'Home', page_view: false, videos: [] },
  about: { url: '/about/', title: 'About us', page_view: false, videos: ['how-sleep-works'] },
  search: { url: '/search/', title: 'Search', page_view: false, videos: [] },
  pain: { url: '/problems/pain/', title: 'Pain', page_view: true, videos: ['pain-about', 'settling-your-body'] },
  start: { url: '/start/', title: 'Start here', page_view: true, videos: ['how-sleep-works'] },
  'urgent-help': { url: '/urgent-help/', title: 'Getting urgent help', page_view: true, videos: [] },
};
const SITE = { features: { ratings: true, feedback: true, events: true } };
const INDEX = pageIndex(PAGES);

// 2026-11-06 in UTC: the default range is 2026-10-08 to 2026-11-06.
const NOW = Date.parse('2026-11-06T13:30:00.000Z');
const START = '2026-10-08T00:00:00.000Z';
const END = '2026-11-07T00:00:00.000Z';
const PASS = { verify: async () => ({ ok: true }) };
const ORIGIN = 'https://example.com';

const ENV = (extra = {}) => ({
  DB: testEnv.DB,
  API_HOSTS: 'example.com',
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  DATA_COLLECTION: 'off',
  ...extra,
});
const makeRouter = (admin = {}, site = SITE, pages = PAGES) => createRouter({ pages, site, admin: { access: PASS, now: () => NOW, ...admin } });
const router = makeRouter();

function get(path, { method = 'GET', env = ENV(), on = router, headers = {}, host = ORIGIN } = {}) {
  return on.fetch(new Request(`${host}${path}`, { method, headers }), env, createExecutionContext());
}

const A = 'a3c1e0f2-6b4d-4e8a-9f1c-2d3e4f5a6b7c';
const B = 'b4d2f1a3-7c5e-4f9b-8a2d-3e4f5a6b7c8d';
const C = 'c5e3a2b4-8d6f-4a0c-9b3e-4f5a6b7c8d9e';

let logged;
beforeEach(async () => {
  await testEnv.DB.batch(['events', 'ratings', 'feedback'].map((t) => testEnv.DB.prepare(`DELETE FROM ${t}`)));
  logged = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    vi.spyOn(console, method).mockImplementation((...args) => logged.push([method, ...args.map(String)]));
  }
});
afterEach(() => vi.restoreAllMocks());
const errors = () => logged.filter(([m]) => m === 'error').map(([, ...args]) => args);

/** Insert rows into `table`; each row an object of column -> value (ids too, when given). */
async function insert(table, rows) {
  if (rows.length === 0) return;
  await testEnv.DB.batch(
    rows.map((row) => {
      const columns = Object.keys(row);
      return testEnv.DB.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).bind(
        ...Object.values(row),
      );
    }),
  );
}
const ev = (type, ts, page, session, detail = {}, id) => ({
  ...(id === undefined ? {} : { id }),
  ts,
  session_id: session,
  page,
  type,
  detail: JSON.stringify(detail),
});
const search = (q, results, ts = '2026-11-01T10:00:00.000Z', id) => ev('search', ts, 'search', null, { q, results }, id);

// ---------------------------------------------------------------- gates

const PATHS = ['/admin', '/admin/', '/admin/export?table=events', '/admin/nope'];
const METHODS = ['GET', 'HEAD', 'POST'];

describe('the gates: host, then the Access token (SPEC §14.4)', () => {
  let k1;
  beforeAll(async () => {
    k1 = await makeKey('kid-one');
  });

  it('answers 403 Forbidden on every path and method with the settings in wrangler.jsonc, and fetches nothing', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    for (const path of PATHS) {
      for (const method of METHODS) {
        const res = await exports.default.fetch(`${ORIGIN}${path}`, { method });
        expect(res.status, `${method} ${path}`).toBe(403);
        if (method !== 'HEAD') expect(await res.text()).toBe('Forbidden');
        expect(res.headers.get('Cache-Control')).toBe('no-store');
      }
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('answers 403 with the placeholder ACCESS_* vars even on an allowed host, and fetches nothing (config)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const env = ENV({ ACCESS_TEAM_DOMAIN: '<TEAM>.cloudflareaccess.com', ACCESS_AUD: '<AUD_TAG>' });
    for (const path of PATHS) {
      const res = await worker.fetch(new Request(`${ORIGIN}${path}`), env, createExecutionContext());
      expect(res.status, path).toBe(403);
    }
    expect(spy).not.toHaveBeenCalled();
    expect(errors()).toEqual(PATHS.map(() => ['/admin: access denied', 'config']));
  });

  it('answers 403 for every path and method with the real check and no token or a bad one', async () => {
    const { calls, fetcher } = certsFetcher(() => Response.json(certsBody([k1])));
    const on = makeRouter({ access: createAccessVerifier({ fetcher, now: () => NOW }) });
    for (const path of PATHS) {
      for (const method of [...METHODS, 'PUT', 'OPTIONS']) {
        for (const headers of [{}, { 'Cf-Access-Jwt-Assertion': 'not.a.token' }, { Cookie: 'CF_Authorization=x.y.z' }]) {
          const res = await get(path, { method, on, headers });
          expect(res.status, `${method} ${path}`).toBe(403);
        }
      }
    }
    expect(calls).toEqual([]);
  });

  it('lets a valid token through on an allowed host', async () => {
    const { fetcher } = certsFetcher(() => Response.json(certsBody([k1])));
    const on = makeRouter({ access: createAccessVerifier({ fetcher, now: () => NOW }) });
    const token = await signToken(k1, claims(NOW));
    const res = await get('/admin/', { on, headers: { 'Cf-Access-Jwt-Assertion': token } });
    expect(res.status).toBe(200);
    expect(JSON.stringify(logged)).not.toContain(token.split('.')[1]);
  });

  it('answers 403 to a valid token on a host not in API_HOSTS: version URLs and production workers.dev', async () => {
    const { calls, fetcher } = certsFetcher(() => Response.json(certsBody([k1])));
    const on = makeRouter({ access: createAccessVerifier({ fetcher, now: () => NOW }) });
    const headers = { 'Cf-Access-Jwt-Assertion': await signToken(k1, claims(NOW)) };
    const cases = [
      ['https://abc12345-sleepsteps.team-sub.workers.dev', '<DOMAIN>', 403],
      ['https://sleepsteps.team-sub.workers.dev', '<DOMAIN>', 403],
      ['https://abc12345-sleepsteps.team-sub.workers.dev', 'example.org', 403],
      ['https://example.com', undefined, 403],
      ['https://my-branch-sleepsteps.team-sub.workers.dev', '*-sleepsteps.*.workers.dev', 200],
    ];
    for (const [host, hosts, status] of cases) {
      const res = await get('/admin/', { on, headers, host, env: ENV({ API_HOSTS: hosts }) });
      expect(res.status, host).toBe(status);
    }
    expect(errors()).toEqual([1, 2, 3, 4].map(() => ['/admin: access denied', 'host']));
    // The host is checked first: the refused hosts never reached the token check.
    expect(calls).toHaveLength(1);
  });

  it('never touches env.DB before both gates pass', async () => {
    const reads = [];
    const env = new Proxy(ENV(), {
      get(target, name) {
        reads.push(name);
        return target[name];
      },
    });
    const refuse = makeRouter({ access: { verify: async () => ({ ok: false, code: 'no-token' }) } });
    for (const path of PATHS) {
      for (const method of METHODS) expect((await get(path, { method, env, on: refuse })).status).toBe(403);
      expect((await get(path, { env: new Proxy(ENV({ API_HOSTS: 'example.org' }), { get: (t, n) => (reads.push(n), t[n]) }) })).status).toBe(403);
    }
    expect(reads).not.toContain('DB');
  });

  it('answers 403, with no D1 read, when the token check or the host check throws (fail closed)', async () => {
    const reads = [];
    const base = ENV();
    const env = new Proxy(base, { get: (t, n) => (reads.push(n), t[n]) });
    const throwing = makeRouter({
      access: {
        verify: () => {
          throw new Error('zq-verify');
        },
      },
    });
    expect((await get('/admin/', { env, on: throwing })).status).toBe(403);
    const rejecting = makeRouter({ access: { verify: () => Promise.reject(new Error('zq-verify')) } });
    expect((await get('/admin/', { env, on: rejecting })).status).toBe(403);
    const badHosts = new Proxy(base, {
      get(t, n) {
        reads.push(n);
        if (n === 'API_HOSTS') throw new Error('zq-hosts');
        return t[n];
      },
    });
    expect((await get('/admin/', { env: badHosts })).status).toBe(403);
    const odd = makeRouter({ access: { verify: async () => ({ ok: 'yes', code: 'zq-code' }) } });
    expect((await get('/admin/', { env, on: odd })).status).toBe(403);
    expect(reads).not.toContain('DB');
    expect(errors()).toEqual([1, 2, 3, 4].map(() => ['/admin: access denied', 'error']));
    expect(JSON.stringify(logged)).not.toMatch(/zq-/);
  });

  it('answers whatever DATA_COLLECTION and the features say (admin only reads)', async () => {
    const off = makeRouter({}, { features: { ratings: false, feedback: false, events: false } });
    for (const extra of [{ DATA_COLLECTION: 'off' }, { DATA_COLLECTION: undefined }, { DATA_COLLECTION: 'on' }]) {
      expect((await get('/admin/', { env: ENV(extra), on: off })).status).toBe(200);
    }
  });
});

describe('paths the URL parser turns into /admin/ reach the admin handler', () => {
  it.each(['/x/%2e%2e/admin/', '/x/../admin/', '/admin/./', '/admin/%2e', '/admin/x/../', '/./admin'])('%s', async (path) => {
    const seen = [];
    const env = { ...ENV(), ASSETS: { fetch: (req) => (seen.push(req.url), new Response('asset')) } };
    const res = await worker.fetch(new Request(`${ORIGIN}${path}`), env, createExecutionContext());
    expect(res.status).toBe(403);
    expect(seen).toEqual([]);
    expect(errors()).toEqual([['/admin: access denied', 'no-token']]);
  });

  it('while lookalikes go to static assets', async () => {
    const seen = [];
    const env = { ...ENV(), ASSETS: { fetch: (req) => (seen.push(new URL(req.url).pathname), new Response('asset')) } };
    const paths = ['/Admin/', '/adminx', '/%61dmin/', '//admin/', '/admin%2Fexport', '/administrator/', '/x/admin/'];
    for (const path of paths) await router.fetch(new Request(`${ORIGIN}${path}`), env, createExecutionContext());
    expect(seen).toEqual(paths);
  });
});

// ---------------------------------------------------------------- routing

describe('routing after the gates', () => {
  it('redirects /admin to /admin/ with 308, keeping the query', async () => {
    const res = await get('/admin?from=2026-11-01&to=2026-11-05');
    expect(res.status).toBe(308);
    expect(res.headers.get('Location')).toBe('/admin/?from=2026-11-01&to=2026-11-05');
    const bare = await get('/admin');
    expect(bare.headers.get('Location')).toBe('/admin/');
    const head = await get('/admin', { method: 'HEAD' });
    expect(head.status).toBe(308);
    expect(await head.text()).toBe('');
  });

  it.each(['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])('answers %s with 405 and Allow: GET, HEAD on every path', async (method) => {
    for (const path of PATHS) {
      const res = await get(path, { method });
      expect(res.status, path).toBe(405);
      expect(res.headers.get('Allow')).toBe('GET, HEAD');
    }
  });

  it('answers 404 for any other /admin path', async () => {
    for (const path of ['/admin/x', '/admin/export/', '/admin/index.html', '/admin//', '/admin/Export', '/admin/export/x', '/admin/%2e%2f']) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(await res.text()).toBe('Not found');
    }
  });

  it('answers HEAD /admin/ with the GET status and headers and no body', async () => {
    const [getRes, headRes] = [await get('/admin/'), await get('/admin/', { method: 'HEAD' })];
    expect(headRes.status).toBe(getRes.status);
    expect([...headRes.headers]).toEqual([...getRes.headers]);
    expect(await headRes.text()).toBe('');
    const bad = await get('/admin/?from=nope', { method: 'HEAD' });
    expect(bad.status).toBe(400);
  });

  it('answers HEAD /admin/export with 405 (Allow: GET) without reading D1', async () => {
    const reads = [];
    const env = new Proxy(ENV(), { get: (t, n) => (reads.push(n), t[n]) });
    const res = await get('/admin/export?table=events', { method: 'HEAD', env });
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET');
    expect(reads).not.toContain('DB');
  });

  it('answers 400 for an invalid range', async () => {
    for (const query of ['from=2026-02-30', 'to=2026-11-07', 'from=2026-11-05&to=2026-11-01', 'from=2026-08-01&to=2026-11-01', 'from=%22%3E%3Cb%3E']) {
      expect((await get(`/admin/?${query}`)).status, query).toBe(400);
    }
  });
});

describe('headers on every admin answer', () => {
  const CSP = (team) => `default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'${team}; base-uri 'none'; frame-ancestors 'none'`;

  it('carries the admin headers, HSTS included, and the script-free CSP on 200, 308, 400, 403, 404, 405 and 500', async () => {
    const failing = { ...ENV(), DB: undefined };
    const refuse = makeRouter({ access: { verify: async () => ({ ok: false, code: 'no-token' }) } });
    const answers = [
      [200, await get('/admin/')],
      [308, await get('/admin')],
      [400, await get('/admin/?from=x')],
      [400, await get('/admin/export?table=nope')],
      [403, await get('/admin/', { on: refuse })],
      [403, await get('/admin/export?table=events', { headers: { 'Sec-Fetch-Site': 'cross-site' } })],
      [404, await get('/admin/x')],
      [405, await get('/admin/', { method: 'POST' })],
      [500, await get('/admin/', { env: failing })],
      [500, await get('/admin/export?table=events', { env: failing })],
      [200, await get('/admin/', { method: 'HEAD' })],
    ];
    for (const [status, res] of answers) {
      expect(res.status).toBe(status);
      for (const [name, value] of Object.entries(ADMIN_HEADERS)) expect(res.headers.get(name), `${status} ${name}`).toBe(value);
      // As on the static pages (src/_headers, SPEC §16.1): no includeSubDomains, no preload.
      expect(res.headers.get('Strict-Transport-Security'), `${status} HSTS`).toBe('max-age=31536000');
      expect(res.headers.get('Content-Security-Policy')).toBe(CSP(` https://${TEAM}`));
      expect(res.headers.get('Set-Cookie')).toBeNull();
    }
  });

  it('names only self in form-action while the team domain is the placeholder', async () => {
    const env = ENV({ ACCESS_TEAM_DOMAIN: '<TEAM>.cloudflareaccess.com' });
    const res = await get('/admin/', { env });
    expect(res.headers.get('Content-Security-Policy')).toBe(CSP(''));
    expect(res.headers.get('Content-Security-Policy')).not.toMatch(/script-src/);
  });

  it('gives the summary page HTML with no script', async () => {
    const res = await get('/admin/');
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    const body = await res.text();
    expect(body).not.toMatch(/<script/i);
    expect(body).not.toMatch(/\son[a-z]+\s*=/i);
  });
});

// ---------------------------------------------------------------- data

/** The summary model for the default range, read straight from D1. */
async function model(range = summaryRange(new URLSearchParams(), NOW)) {
  const { results, rowsRead } = await readSummary(testEnv.DB, range);
  return { ...summaryModel(results, INDEX), rowsRead };
}

describe('the summary data (SPEC §14.4)', () => {
  it('reads the default range: the 30 UTC days ending today', () => {
    const range = summaryRange(new URLSearchParams(), NOW);
    expect([range.from, range.to, range.start, range.end]).toEqual(['2026-10-08', '2026-11-06', START, END]);
  });

  it('counts views and visits per tracked page, lists every tracked page, and keeps pages no longer on the site', async () => {
    await insert('events', [
      ev('page_view', '2026-11-01T10:00:00.000Z', 'pain', A),
      ev('page_view', '2026-11-01T10:05:00.000Z', 'pain', A),
      ev('page_view', '2026-11-02T10:00:00.000Z', 'pain', B),
      ev('page_view', '2026-11-01T10:10:00.000Z', 'start', A),
      ev('page_view', '2026-11-03T10:00:00.000Z', 'old-page', C),
      // A play is not a view.
      ev('video_play', '2026-11-01T10:01:00.000Z', 'pain', A, { media: 'settling-your-body', furthest: 25 }),
    ]);
    const { views } = await model();
    expect(views.rows).toEqual([
      { page: 'pain', title: 'Pain', known: true, views: 3, visits: 2 },
      { page: 'old-page', title: 'old-page', known: false, views: 1, visits: 1 },
      { page: 'start', title: 'Start here', known: true, views: 1, visits: 1 },
      { page: 'urgent-help', title: 'Getting urgent help', known: true, views: 0, visits: 0 },
    ]);
    expect([views.views, views.visits]).toEqual([5, 3]);
  });

  it('includes the start and leaves out the end: a row at start − 1 ms is out, end − 1 ms is in', async () => {
    await insert('events', [
      ev('page_view', '2026-10-07T23:59:59.999Z', 'pain', A),
      ev('page_view', START, 'pain', A),
      ev('page_view', '2026-11-06T23:59:59.999Z', 'pain', B),
      ev('page_view', END, 'pain', C),
      ev('worksheet_open', '2026-10-07T23:59:59.999Z', 'pain', A, { worksheet: 'sheet-before' }),
      ev('worksheet_open', START, 'pain', A, { worksheet: 'sheet-first' }),
      ev('worksheet_open', '2026-11-06T23:59:59.999Z', 'pain', B, { worksheet: 'sheet-last' }),
      ev('worksheet_open', END, 'pain', C, { worksheet: 'sheet-after' }),
    ]);
    await insert('ratings', [
      { ts: '2026-10-07T23:59:59.999Z', page: 'pain', video: 'pain-about', stars: 1 },
      { ts: START, page: 'pain', video: 'pain-about', stars: 5 },
      { ts: END, page: 'pain', video: 'pain-about', stars: 1 },
    ]);
    await insert('feedback', [
      { ts: '2026-10-07T23:00:00.000Z', page: 'pain', message: 'before' },
      { ts: START, page: 'pain', message: 'first' },
      { ts: END, page: 'pain', message: 'after' },
    ]);
    const m = await model();
    expect([m.views.views, m.views.visits]).toEqual([2, 2]);
    expect(m.ratings.byVideo).toEqual([{ video: 'pain-about', n: 1, total: 5, mean: 5 }]);
    expect(m.feedback.total).toBe(1);
    expect(m.feedback.recent.map((r) => r.message)).toEqual(['first']);
    expect(m.worksheets.map((r) => r.worksheet)).toEqual(['sheet-first', 'sheet-last']);
  });

  it('counts ratings and means per video, per page, and per page and video (a changed rating counts twice)', async () => {
    await insert('ratings', [
      { ts: '2026-11-01T10:00:00.000Z', page: 'pain', video: 'settling-your-body', stars: 4 },
      { ts: '2026-11-01T10:00:05.000Z', page: 'pain', video: 'settling-your-body', stars: 5 },
      { ts: '2026-11-01T10:01:00.000Z', page: 'pain', video: 'pain-about', stars: 2 },
      { ts: '2026-11-02T10:00:00.000Z', page: 'start', video: 'how-sleep-works', stars: 3 },
      { ts: '2026-11-02T11:00:00.000Z', page: 'about', video: 'how-sleep-works', stars: 2 },
    ]);
    const { ratings } = await model();
    expect(ratings.total).toBe(5);
    expect(ratings.byVideo).toEqual([
      { video: 'how-sleep-works', n: 2, total: 5, mean: 2.5 },
      { video: 'settling-your-body', n: 2, total: 9, mean: 4.5 },
      { video: 'pain-about', n: 1, total: 2, mean: 2 },
    ]);
    expect(ratings.byPage).toEqual([
      { page: 'pain', title: 'Pain', known: true, n: 3, total: 11, mean: 11 / 3 },
      { page: 'about', title: 'About us', known: true, n: 1, total: 2, mean: 2 },
      { page: 'start', title: 'Start here', known: true, n: 1, total: 3, mean: 3 },
    ]);
    expect(ratings.byPageVideo.map((r) => [r.page, r.video, r.n, r.mean])).toEqual([
      ['about', 'how-sleep-works', 1, 2],
      ['pain', 'settling-your-body', 2, 4.5],
      ['pain', 'pain-about', 1, 2],
      ['start', 'how-sleep-works', 1, 3],
    ]);
  });

  it('counts searches and zero-result searches, grouping capitals, leaving out searches that found something', async () => {
    await insert('events', [
      search('Pain', 0),
      search('pain', 0),
      search('PAIN', 0, '2026-11-02T10:00:00.000Z'),
      search('zzz', 0),
      search('sleep', 3),
      search('Pain', 2),
    ]);
    const { searches } = await model();
    expect([searches.total, searches.zero]).toEqual([6, 4]);
    expect(searches.top).toEqual([
      { q: 'pain', n: 3 },
      { q: 'zzz', n: 1 },
    ]);
  });

  it('keeps the top 20 zero-result searches, ties by text, whatever order the ids are in', async () => {
    const words = Array.from({ length: 25 }, (_, i) => `term-${String.fromCharCode(97 + i)}`);
    await insert('events', words.map((q, i) => search(q, 0, '2026-11-01T10:00:00.000Z', 900_000_100 - i)));
    const first = await model();
    await testEnv.DB.prepare('DELETE FROM events').run();
    await insert('events', words.map((q, i) => search(q, 0, '2026-11-01T10:00:00.000Z', 900_000_100 + i)));
    const second = await model();
    expect(first.searches.top.map((r) => r.q)).toEqual(words.slice(0, 20));
    expect(second.searches).toEqual(first.searches);
  });

  it('lists the 20 newest messages by ts and then id, newest first, with the total', async () => {
    const rows = Array.from({ length: 23 }, (_, i) => ({
      id: 500 + i,
      ts: new Date(Date.UTC(2026, 9, 10 + i, 8)).toISOString(),
      page: 'pain',
      message: `message ${i}`,
    }));
    // Two in one hour: the higher id is newer. One is about a video
    // (migration 0003); the rest have none.
    rows.push({ id: 900, ts: '2026-11-05T08:00:00.000Z', page: 'start', video: 'how-sleep-works', message: 'same hour, lower id' });
    rows.push({ id: 901, ts: '2026-11-05T08:00:00.000Z', page: 'gone', message: 'same hour, higher id' });
    await insert('feedback', rows);
    const { feedback } = await model();
    expect(feedback.total).toBe(25);
    expect(feedback.recent).toHaveLength(20);
    expect(feedback.recent.slice(0, 3).map((r) => r.message)).toEqual(['same hour, higher id', 'same hour, lower id', 'message 22']);
    // Feedback stores no title (migration 0002): a page shows by its current
    // title in pages.json, and one no longer there by its id.
    // Each has the video it is about, by id, or null.
    expect(feedback.recent[0]).toEqual({ ts: '2026-11-05T08:00:00.000Z', page: 'gone', title: 'gone', known: false, video: null, message: 'same hour, higher id' });
    expect(feedback.recent[1]).toEqual({ ts: '2026-11-05T08:00:00.000Z', page: 'start', title: 'Start here', known: true, video: 'how-sleep-works', message: 'same hour, lower id' });
    expect(feedback.recent.at(-1)).toEqual({ ts: '2026-10-15T08:00:00.000Z', page: 'pain', title: 'Pain', known: true, video: null, message: 'message 5' });
    expect(feedback.recent.filter((r) => r.video !== null)).toHaveLength(1);
  });

  it('shows the video a message is about by its id, after its page, and nothing for a message without one', async () => {
    await insert('feedback', [
      { ts: '2026-11-01T10:00:00.000Z', page: 'pain', video: 'settling-your-body', message: 'about a video' },
      { ts: '2026-11-02T10:00:00.000Z', page: 'pain', video: null, message: 'from the footer' },
      // A video that has left the page, or the site, still shows: it is what was stored.
      { ts: '2026-11-03T10:00:00.000Z', page: 'gone', video: 'old-video', message: 'both gone' },
    ]);
    const body = await (await get('/admin/')).text();
    expect(body).toContain(
      '<h3 class="feedback-item__heading"><span class="feedback-item__page">Pain</span> <span class="feedback-item__page-id">(pain)</span>, video <span class="feedback-item__video video-id">settling-your-body</span>, <time datetime="2026-11-01T10:00:00.000Z">',
    );
    expect(body).toContain(
      '<h3 class="feedback-item__heading"><span class="feedback-item__page">Pain</span> <span class="feedback-item__page-id">(pain)</span>, <time datetime="2026-11-02T10:00:00.000Z">',
    );
    expect(body).toContain(
      '<h3 class="feedback-item__heading"><span class="feedback-item__page">gone</span> (no longer on the site), video <span class="feedback-item__video video-id">old-video</span>, <time datetime="2026-11-03T10:00:00.000Z">',
    );
    expect(body.match(/class="feedback-item__video video-id"/g)).toHaveLength(2);
  });

  it('shows a message\'s page by the title pages.json has now, with its id', async () => {
    await insert('feedback', [
      { ts: '2026-11-01T10:00:00.000Z', page: 'pain', message: 'renamed' },
      { ts: '2026-11-02T10:00:00.000Z', page: 'gone', message: 'removed' },
    ]);
    const renamed = makeRouter({}, SITE, { ...PAGES, pain: { ...PAGES.pain, title: 'Pain and sleep' } });
    const body = await (await get('/admin/', { on: renamed })).text();
    expect(body).toContain('<span class="feedback-item__page">Pain and sleep</span> <span class="feedback-item__page-id">(pain)</span>, ');
    expect(body).toContain('<span class="feedback-item__page">gone</span> (no longer on the site), ');
  });

  it('counts a play once per visit, page and item at its furthest point, video and audio apart', async () => {
    await insert('events', [
      ev('video_play', '2026-11-01T10:00:00.000Z', 'pain', A, { media: 'settling-your-body', furthest: 25 }),
      ev('video_play', '2026-11-01T10:05:00.000Z', 'pain', A, { media: 'settling-your-body', furthest: 75 }),
      ev('video_play', '2026-11-01T11:00:00.000Z', 'pain', B, { media: 'settling-your-body', furthest: 0 }),
      ev('video_play', '2026-11-01T10:10:00.000Z', 'start', A, { media: 'how-sleep-works', furthest: 100 }),
      ev('video_play', '2026-11-01T10:20:00.000Z', 'about', A, { media: 'how-sleep-works', furthest: 50 }),
      ev('audio_play', '2026-11-01T10:30:00.000Z', 'pain', A, { media: 'settling-your-body', furthest: 50 }),
      ev('audio_play', '2026-11-01T10:31:00.000Z', 'pain', C, { media: 'pain-about', furthest: 100 }),
    ]);
    const { plays } = await model();
    expect(plays.video).toEqual([
      { media: 'how-sleep-works', plays: 2, f0: 0, f25: 0, f50: 1, f75: 0, f100: 1 },
      { media: 'settling-your-body', plays: 2, f0: 1, f25: 0, f50: 0, f75: 1, f100: 0 },
    ]);
    expect(plays.audio).toEqual([
      { media: 'pain-about', plays: 1, f0: 0, f25: 0, f50: 0, f75: 0, f100: 1 },
      { media: 'settling-your-body', plays: 1, f0: 0, f25: 0, f50: 1, f75: 0, f100: 0 },
    ]);
    for (const row of [...plays.video, ...plays.audio]) expect(row.f0 + row.f25 + row.f50 + row.f75 + row.f100).toBe(row.plays);
  });

  it('counts handout clicks and the visits that clicked', async () => {
    await insert('events', [
      ev('handout_open', '2026-11-01T10:00:00.000Z', 'pain', A, { media: 'pain-about' }),
      ev('handout_open', '2026-11-01T10:01:00.000Z', 'pain', A, { media: 'pain-about' }),
      ev('handout_open', '2026-11-01T10:02:00.000Z', 'pain', B, { media: 'pain-about' }),
      ev('handout_open', '2026-11-01T10:03:00.000Z', 'start', B, { media: 'how-sleep-works' }),
    ]);
    const { handouts } = await model();
    expect(handouts).toEqual([
      { media: 'pain-about', clicks: 3, visits: 2 },
      { media: 'how-sleep-works', clicks: 1, visits: 1 },
    ]);
  });

  // Worksheets (SPEC §7.6, §14.4): a worksheet shows on every page where its
  // video is a solution, so the count is per page and worksheet.
  it('counts worksheet clicks and the visits that clicked, per page and worksheet', async () => {
    await insert('events', [
      ev('worksheet_open', '2026-11-01T10:00:00.000Z', 'pain', A, { worksheet: 'settling-worksheet-1' }),
      ev('worksheet_open', '2026-11-01T10:00:00.000Z', 'pain', A, { worksheet: 'settling-worksheet-1' }),
      ev('worksheet_open', '2026-11-02T10:00:00.000Z', 'pain', B, { worksheet: 'settling-worksheet-1' }),
      ev('worksheet_open', '2026-11-01T10:00:00.000Z', 'pain', B, { worksheet: 'settling-worksheet-2' }),
      // The same worksheet opened from another page: its own row.
      ev('worksheet_open', '2026-11-01T11:00:00.000Z', 'start', C, { worksheet: 'settling-worksheet-1' }),
      ev('worksheet_open', '2026-11-01T11:00:00.000Z', 'start', C, { worksheet: 'settling-worksheet-1' }),
      // A page no longer on the site keeps its rows, by its id.
      ev('worksheet_open', '2026-11-03T10:00:00.000Z', 'old-page', C, { worksheet: 'old-worksheet' }),
      // Other types are not worksheets opened, whatever their detail.
      ev('handout_open', '2026-11-01T10:00:00.000Z', 'pain', A, { media: 'pain-about' }),
      ev('page_view', '2026-11-01T10:00:00.000Z', 'pain', A),
      ev('video_play', '2026-11-01T10:00:00.000Z', 'pain', A, { media: 'settling-your-body', furthest: 25 }),
      search('settling-worksheet-1', 0),
    ]);
    const { worksheets, handouts } = await model();
    // By clicks, then the page's title and id, then the worksheet's id.
    expect(worksheets).toEqual([
      { page: 'pain', title: 'Pain', known: true, worksheet: 'settling-worksheet-1', clicks: 3, visits: 2 },
      { page: 'start', title: 'Start here', known: true, worksheet: 'settling-worksheet-1', clicks: 2, visits: 1 },
      { page: 'old-page', title: 'old-page', known: false, worksheet: 'old-worksheet', clicks: 1, visits: 1 },
      { page: 'pain', title: 'Pain', known: true, worksheet: 'settling-worksheet-2', clicks: 1, visits: 1 },
    ]);
    // A worksheet opened is not a handout opened, and the other way round.
    expect(handouts).toEqual([{ media: 'pain-about', clicks: 1, visits: 1 }]);
  });

  it('has no worksheets without worksheet_open rows, and leaves the handouts as they were', async () => {
    await insert('events', [ev('handout_open', '2026-11-01T10:00:00.000Z', 'pain', A, { media: 'pain-about' })]);
    const { worksheets, handouts } = await model();
    expect(worksheets).toEqual([]);
    expect(handouts).toEqual([{ media: 'pain-about', clicks: 1, visits: 1 }]);
  });

  it('shows worksheets opened as a table of page, worksheet id, clicks and visits, and its empty state without any', async () => {
    const empty = await (await get('/admin/')).text();
    expect(empty).toContain('<h2 id="worksheets">Worksheets opened</h2>');
    expect(empty).toContain('<p class="empty">No worksheets opened in this range.</p>');
    expect(empty).not.toContain('worksheets-caption');
    await insert('events', [
      ev('worksheet_open', '2026-11-01T10:00:00.000Z', 'pain', A, { worksheet: 'settling-worksheet-1' }),
      ev('worksheet_open', '2026-11-01T10:00:00.000Z', 'pain', B, { worksheet: 'settling-worksheet-1' }),
      ev('worksheet_open', '2026-11-01T10:00:00.000Z', 'gone', B, { worksheet: 'old-worksheet' }),
    ]);
    const body = await (await get('/admin/')).text();
    expect(body).not.toContain('No worksheets opened in this range.');
    expect(body).toContain('<caption id="worksheets-caption">Worksheet clicks per page and worksheet</caption>');
    expect(body).toContain(
      '<tr><th scope="row"><span class="page-name">Pain</span> <span class="page-id">pain</span></th><td class="worksheet-id">settling-worksheet-1</td><td class="num">2</td><td class="num">2</td></tr>',
    );
    expect(body).toContain(
      '<tr><th scope="row"><span class="page-name">gone</span> <span class="page-id">No longer on the site</span></th><td class="worksheet-id">old-worksheet</td><td class="num">1</td><td class="num">1</td></tr>',
    );
    expect(body.match(/<td class="worksheet-id">/g)).toHaveLength(2);
  });

  it('gives the same data whatever order D1 returns the grouped rows in', () => {
    const results = {
      views: [{ page: 'start', views: 2, visits: 2 }, { page: 'pain', views: 2, visits: 1 }],
      ratings: [
        { page: 'start', video: 'how-sleep-works', n: 1, total: 4 },
        { page: 'pain', video: 'pain-about', n: 1, total: 4 },
        { page: 'pain', video: 'settling-your-body', n: 1, total: 4 },
      ],
      plays: [
        { type: 'video_play', media: 'b', plays: 1, f0: 1, f25: 0, f50: 0, f75: 0, f100: 0 },
        { type: 'video_play', media: 'a', plays: 1, f0: 1, f25: 0, f50: 0, f75: 0, f100: 0 },
      ],
      handouts: [{ media: 'b', clicks: 1, visits: 1 }, { media: 'a', clicks: 1, visits: 1 }],
      // Ties on clicks: by page title, then page id, then worksheet id.
      worksheets: [
        { page: 'start', worksheet: 'b', clicks: 1, visits: 1 },
        { page: 'pain', worksheet: 'b', clicks: 1, visits: 1 },
        { page: 'pain', worksheet: 'a', clicks: 1, visits: 1 },
        { page: 'gone', worksheet: 'a', clicks: 1, visits: 1 },
        { page: 'start', worksheet: 'c', clicks: 2, visits: 1 },
      ],
    };
    expect(summaryModel(results, INDEX).worksheets.map((r) => [r.page, r.worksheet, r.clicks])).toEqual([
      ['start', 'c', 2],
      ['gone', 'a', 1],
      ['pain', 'a', 1],
      ['pain', 'b', 1],
      ['start', 'b', 1],
    ]);
    const reversed = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, [...v].reverse()]));
    expect(summaryModel(reversed, INDEX)).toEqual(summaryModel(results, INDEX));
  });

  it('sums the rows read over the batch', async () => {
    await insert('events', [ev('page_view', '2026-11-01T10:00:00.000Z', 'pain', A)]);
    const { rowsRead } = await model();
    expect(Number.isInteger(rowsRead)).toBe(true);
    expect(rowsRead).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- the page

describe('the summary page', () => {
  it('shows no events, ratings or feedback id, and no session_id', async () => {
    await insert('events', [
      ev('page_view', '2026-11-01T10:00:00.000Z', 'pain', A, {}, 987_654_321),
      ev('video_play', '2026-11-01T10:01:00.000Z', 'pain', A, { media: 'pain-about', furthest: 50 }, 987_654_322),
      search('nothing here', 0, '2026-11-01T10:00:00.000Z', 987_654_323),
      ev('handout_open', '2026-11-01T10:02:00.000Z', 'pain', B, { media: 'pain-about' }, 987_654_324),
      ev('worksheet_open', '2026-11-01T10:02:00.000Z', 'pain', B, { worksheet: 'settling-worksheet-1' }, 987_654_325),
    ]);
    await insert('ratings', [{ id: 987_654_331, ts: '2026-11-01T10:00:00.000Z', page: 'pain', video: 'pain-about', stars: 4 }]);
    await insert('feedback', [{ id: 987_654_341, ts: '2026-11-01T10:00:00.000Z', page: 'pain', message: 'hello' }]);
    const body = await (await get('/admin/')).text();
    expect(body).toContain('hello');
    expect(body).toContain('nothing here');
    expect(body).toContain('<td class="worksheet-id">settling-worksheet-1</td>');
    expect(body).not.toMatch(/98765\d{4}/);
    for (const session of [A, B]) expect(body).not.toContain(session);
  });

  it('shows the rows read', async () => {
    await insert('events', [ev('page_view', '2026-11-01T10:00:00.000Z', 'pain', A)]);
    const body = await (await get('/admin/')).text();
    const { rowsRead } = await model();
    expect(body).toContain(`read ${thousands(rowsRead)} rows`);
  });

  it('works with collection off (as in previews): empty tables, 200 with the notice', async () => {
    const res = await get('/admin/', { env: ENV({ DATA_COLLECTION: 'off' }) });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Data collection is off');
    const on = await (await get('/admin/', { env: ENV({ DATA_COLLECTION: 'on' }) })).text();
    expect(on).not.toContain('Data collection is off');
  });

  it('escapes feedback, page ids, a message\'s video, a worksheet\'s id and search text: they render as text, never as markup', async () => {
    const payloads = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "' onfocus='x", '</blockquote><b>x', '&lt;b&gt;'];
    const seed = async (texts) => {
      await testEnv.DB.batch(['events', 'feedback'].map((t) => testEnv.DB.prepare(`DELETE FROM ${t}`)));
      // A page no longer on the site shows by its stored id, so the id is
      // hostile too, and so is a stored video, shown as it is.
      await insert('feedback', texts.map((text, i) => ({ ts: `2026-11-0${i + 1}T10:00:00.000Z`, page: text, video: text, message: text })));
      await insert('events', texts.map((text) => search(text, 0)));
      // Rows written straight to the database: the API stores only a
      // worksheet_id from pages.json, but the page shows what is stored.
      await insert('events', texts.map((text) => ev('worksheet_open', '2026-11-01T10:00:00.000Z', text, A, { worksheet: text })));
      return (await get('/admin/')).text();
    };
    const dirty = await seed(payloads);
    const clean = await seed(payloads.map((_, i) => `plain text ${i}`));
    expect(dirty).not.toMatch(/<script|<img|<b>/i);
    // The payloads' "onerror=" and "onfocus=" may show as text, but never inside a tag.
    for (const tag of dirty.match(/<[^>]*>/g)) expect(tag).not.toMatch(/\son\w+\s*=/i);
    expect(dirty).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(dirty).toContain('&amp;lt;b&amp;gt;');
    const tagCount = (text) => (text.match(/<[a-z!/]/gi) ?? []).length;
    expect(tagCount(dirty)).toBe(tagCount(clean));
    // Each hostile worksheet id is a cell's whole text.
    expect(dirty).toContain('<td class="worksheet-id">&lt;script&gt;alert(1)&lt;/script&gt;</td>');
    expect(dirty).toContain('<td class="worksheet-id">&quot;&gt;&lt;img src=x onerror=alert(1)&gt;</td>');
    expect(dirty.match(/<td class="worksheet-id">/g)).toHaveLength(payloads.length);
  });

  it('never echoes a raw date parameter', async () => {
    const res = await get('/admin/?from=%22%3E%3Cb%3Ezq&to=2026-11-01');
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).not.toContain('zq');
    expect(body).not.toContain('<b>');
    expect(body).toMatch(/<title>Error: /);
  });
});

describe('when the database fails', () => {
  /** A stand-in D1 whose batch throws `error`, and whose sqlite_master check answers `tables`. */
  const failingDb = (error, tables = 3) => ({
    prepare: (sql) => ({
      bind: () => ({ sql }),
      first: async () => {
        if (tables instanceof Error) throw tables;
        return { n: tables };
      },
    }),
    batch: async () => {
      throw error;
    },
  });

  it("shows 'couldn't read' with 500, logging only the D1 code", async () => {
    const res = await get('/admin/?from=2026-11-01', { env: ENV({ DB: failingDb(new Error('D1_ERROR: no such column: SECRET-Q')) }) });
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toContain("Couldn't read the database");
    expect(body).toMatch(/<title>Error: /);
    expect(errors()).toEqual([['/admin: database read failed', 'D1_ERROR']]);
    expect(JSON.stringify(logged)).not.toMatch(/SECRET-Q|2026-11-01/);
  });

  it("shows 'isn't set up here yet' when the tables are missing", async () => {
    const res = await get('/admin/', { env: ENV({ DB: failingDb(new Error('D1_ERROR: no such table: events'), 0) }) });
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("The database isn't set up here yet");
  });

  it("shows 'couldn't read' when the sqlite_master check fails too, or there is no DB binding", async () => {
    const both = await get('/admin/', { env: ENV({ DB: failingDb(new Error('D1_ERROR: x'), new Error('D1_ERROR: y')) }) });
    expect(both.status).toBe(500);
    expect(await both.text()).toContain("Couldn't read the database");
    const none = await get('/admin/', { env: ENV({ DB: undefined }) });
    expect(none.status).toBe(500);
    expect(await none.text()).toContain("Couldn't read the database");
    expect(errors()).toEqual([
      ['/admin: database read failed', 'D1_ERROR'],
      ['/admin: database read failed', 'unknown'],
    ]);
  });

  it('answers a plain 500 and one fixed line when rendering fails', async () => {
    const bad = createRouter({ pages: { pain: { url: '/p/', title: 'Pain', page_view: true, videos: [] } }, site: SITE, admin: { access: PASS, now: () => Number.NaN } });
    const res = await get('/admin/', { on: bad });
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('Server error');
    expect(errors()).toEqual([['/admin: unexpected error']]);
  });
});
