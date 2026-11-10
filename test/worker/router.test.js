// The Worker's routing and its first gates (SPEC §4, §11, §14.1, §18.2), and
// the headers on every API response (§16.1). The /api/event rules are in
// event.test.js, the /api/rate rules in rate.test.js, and the /api/feedback
// rules in feedback.test.js.
import { createExecutionContext } from 'cloudflare:test';
import { env as testEnv, exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker/index.js';
import { API_HEADERS } from '../../worker/lib/http.js';
import { createRouter } from '../../worker/router.js';

const API_PATHS = ['/api/event', '/api/rate', '/api/feedback', '/api/'];

const post = (url, headers = {}) =>
  new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: new URL(url).origin, ...headers },
    body: '{}',
  });

describe('Worker router', () => {
  it.each(['/api/event', '/api/rate'])('returns 404 for %s with the settings in wrangler.jsonc (example.com isn\'t in API_HOSTS)', async (path) => {
    const res = await exports.default.fetch(`https://example.com${path}`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  // The admin pages answer 403 before anything else, on every host
  // API_HOSTS doesn't list, such as example.com here (SPEC §14.4); admin.test.js has the rest.
  it.each(['/admin/', '/admin', '/admin/export', '/admin/x'])(
    'returns 403 for %s with the settings in wrangler.jsonc, whatever the method',
    async (path) => {
      for (const method of ['GET', 'HEAD', 'POST']) {
        const res = await exports.default.fetch(`https://example.com${path}`, { method });
        expect(res.status, method).toBe(403);
      }
    },
  );

  it('does not treat lookalike paths as API or admin routes', async () => {
    const seen = [];
    const env = {
      DATA_COLLECTION: 'on',
      API_HOSTS: 'example.com',
      ASSETS: {
        fetch: (req) => {
          seen.push(new URL(req.url).pathname);
          return new Response('asset');
        },
      },
    };
    const paths = ['/apix', '/api', '/administrator/', '/videos/api/', '/Admin/', '/adminx', '/%61dmin/', '//admin/', '/admin%2Fexport', '/x/admin/'];
    for (const path of paths) {
      await worker.fetch(new Request(`https://example.com${path}`), env, createExecutionContext());
    }
    expect(seen).toEqual(paths);
  });

  // Keep this test while the API exists: with collection off, no API route
  // may answer, whatever the request (SPEC §11).
  it.each([
    ['off', { DATA_COLLECTION: 'off' }],
    ['missing', {}],
    ['"On"', { DATA_COLLECTION: 'On' }],
    ['"true"', { DATA_COLLECTION: 'true' }],
    ['" on"', { DATA_COLLECTION: ' on' }],
  ])('answers no API route while DATA_COLLECTION is %s', async (_, vars) => {
    const env = { ...vars, API_HOSTS: 'example.com', DB: testEnv.DB, ASSETS: { fetch: () => new Response('asset') } };
    for (const path of API_PATHS) {
      const res = await worker.fetch(post(`https://example.com${path}`), env, createExecutionContext());
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toBe('Not found');
    }
  });

  it.each([
    ['missing', undefined],
    ['the placeholder', '<DOMAIN>'],
    ['another host', 'example.org'],
    ['the previews pattern', '*-sleepsteps.*.workers.dev'],
  ])('answers no API route, with collection on, when API_HOSTS is %s', async (_, hosts) => {
    const env = { DATA_COLLECTION: 'on', API_HOSTS: hosts, DB: testEnv.DB, ASSETS: { fetch: () => new Response('asset') } };
    for (const path of API_PATHS) {
      const res = await worker.fetch(post(`https://example.com${path}`), env, createExecutionContext());
      expect(res.status, path).toBe(404);
    }
  });

  it('answers 404 for API paths that have no route, even with collection on and the host allowed', async () => {
    const env = { DATA_COLLECTION: 'on', API_HOSTS: 'example.com', DB: testEnv.DB };
    const paths = [
      '/api/', '/api/event/', '/api/Event', '/api/rate/', '/api/Rate', '/api/rate/x', '/api/feedback/', '/api/Feedback', '/api/feedback/x',
      '/api/__proto__', '/api/constructor',
    ];
    for (const path of paths) {
      const res = await worker.fetch(post(`https://example.com${path}`), env, createExecutionContext());
      expect(res.status, path).toBe(404);
      expect(res.headers.get('Cache-Control'), path).toBe('no-store');
    }
  });

  it('passes non-API requests through to static assets', async () => {
    const env = { ASSETS: { fetch: () => new Response('from assets', { status: 200 }) } };
    const res = await worker.fetch(new Request('https://example.com/some/page/'), env, createExecutionContext());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('from assets');
  });
});

// The headers on every API response, whatever the status (SPEC §14.1,
// §16.1). A router built from fixture pages with every feature on, so each
// status can be reached; this file's D1 has the migrations applied.
describe('API response headers', () => {
  const PAGES = { pain: { url: '/problems/pain/', title: 'Pain', page_view: true, videos: [] } };
  const ALL_ON = createRouter({ pages: PAGES, site: { features: { ratings: true, feedback: true, events: true } } });
  const EVENTS_OFF = createRouter({ pages: PAGES, site: { features: { ratings: true, feedback: true, events: false } } });
  const ENV = { DB: testEnv.DB, DATA_COLLECTION: 'on', API_HOSTS: 'example.com', TURNSTILE_SECRET: '' };
  const API_CSP = "default-src 'none'; frame-ancestors 'none'";
  const pageView = JSON.stringify({ type: 'page_view', page: 'pain', session_id: crypto.randomUUID(), detail: {} });
  const feedback = JSON.stringify({ page_id: 'pain', message: 'zq header check', turnstile_token: 'XXXX.DUMMY.TOKEN.XXXX' });

  const send = (path, { router = ALL_ON, env = ENV, method = 'POST', body = pageView, headers = {} } = {}) => {
    const init = { method, headers: { 'Content-Type': 'text/plain;charset=UTF-8', Origin: 'https://example.com', ...headers } };
    if (method === 'POST') init.body = body;
    return router.fetch(new Request(`https://example.com${path}`, init), env);
  };

  afterEach(() => vi.restoreAllMocks());

  it('gives every API response no-store, nosniff and the API CSP, on every status', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const answers = [
      [204, await send('/api/event')],
      [400, await send('/api/event', { body: 'not json' })],
      [403, await send('/api/event', { headers: { Origin: 'https://example.org' } })],
      [404, await send('/api/event', { env: { ...ENV, DATA_COLLECTION: 'off' } })],
      [404, await send('/api/event', { env: { ...ENV, API_HOSTS: 'example.org' } })],
      [404, await send('/api/nothing')],
      [404, await send('/api/event', { router: EVENTS_OFF })],
      [405, await send('/api/event', { method: 'GET' })],
      [413, await send('/api/event', { body: 'x'.repeat(4097) })],
      [415, await send('/api/event', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })],
      // No TURNSTILE_SECRET: its one fixed log line, then 500.
      [500, await send('/api/feedback', { body: feedback })],
    ];
    expect(error.mock.calls).toEqual([['/api/feedback: TURNSTILE_SECRET missing']]);
    for (const [status, res] of answers) {
      expect(res.status).toBe(status);
      for (const [name, value] of Object.entries(API_HEADERS)) expect(res.headers.get(name), `${status} ${name}`).toBe(value);
      expect(res.headers.get('Content-Security-Policy'), `${status}`).toBe(API_CSP);
      expect(res.headers.get('Cache-Control'), `${status}`).toBe('no-store');
      expect(res.headers.get('X-Content-Type-Options'), `${status}`).toBe('nosniff');
      // The API answers JSON or nothing: the page headers in src/_headers do nothing here.
      for (const name of ['Strict-Transport-Security', 'Referrer-Policy', 'Permissions-Policy', 'Set-Cookie']) {
        expect(res.headers.get(name), `${status} ${name}`).toBeNull();
      }
    }
  });

  it('gives the deployed Worker\'s API 404 the same headers (example.com isn\'t in wrangler.jsonc\'s API_HOSTS)', async () => {
    const res = await exports.default.fetch('https://example.com/api/event', { method: 'POST' });
    expect(res.status).toBe(404);
    for (const [name, value] of Object.entries(API_HEADERS)) expect(res.headers.get(name), name).toBe(value);
  });
});
