import { SELF, createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index.js';

describe('Worker router (M0 scaffold)', () => {
  it.each(['/api/event', '/api/rate', '/admin/', '/admin'])(
    'returns 404 for %s until the route is implemented',
    async (path) => {
      const res = await SELF.fetch(`https://example.com${path}`, { method: 'POST' });
      expect(res.status).toBe(404);
    },
  );

  it('does not treat lookalike paths as API or admin routes', async () => {
    const seen = [];
    const env = {
      ASSETS: {
        fetch: (req) => {
          seen.push(new URL(req.url).pathname);
          return new Response('asset');
        },
      },
    };
    for (const path of ['/apix', '/administrator/', '/videos/api/']) {
      await worker.fetch(new Request(`https://example.com${path}`), env, createExecutionContext());
    }
    expect(seen).toEqual(['/apix', '/administrator/', '/videos/api/']);
  });

  it('passes non-API requests through to static assets', async () => {
    const env = { ASSETS: { fetch: () => new Response('from assets', { status: 200 }) } };
    const res = await worker.fetch(
      new Request('https://example.com/some/page/'),
      env,
      createExecutionContext(),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('from assets');
  });
});
