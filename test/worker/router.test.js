// The Worker's routing and its first gates (SPEC §4, §11, §14.1, §18.2).
// The /api/event rules are in event.test.js.
import { createExecutionContext } from 'cloudflare:test';
import { env as testEnv, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../../worker/index.js';

const API_PATHS = ['/api/event', '/api/rate', '/api/feedback', '/api/'];

const post = (url, headers = {}) =>
  new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: new URL(url).origin, ...headers },
    body: '{}',
  });

describe('Worker router', () => {
  it.each(['/api/event', '/api/rate', '/admin/', '/admin'])(
    'returns 404 for %s with the settings in wrangler.jsonc (collection off)',
    async (path) => {
      const res = await exports.default.fetch(`https://example.com${path}`, { method: 'POST' });
      expect(res.status).toBe(404);
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
    for (const path of ['/apix', '/api', '/administrator/', '/videos/api/']) {
      await worker.fetch(new Request(`https://example.com${path}`), env, createExecutionContext());
    }
    expect(seen).toEqual(['/apix', '/api', '/administrator/', '/videos/api/']);
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
    ['the production placeholder', '<DOMAIN>'],
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
    for (const path of ['/api/', '/api/rate', '/api/feedback', '/api/event/', '/api/Event', '/api/__proto__', '/api/constructor']) {
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
