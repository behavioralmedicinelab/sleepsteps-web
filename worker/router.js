// The Worker's request handling (SPEC §4, §11, §14.1). worker/index.js
// builds the default export from this with the real pages.json and
// site.config.json; tests build their own with fixtures.
//
// /api/* requests go through these checks, in this order; the first that
// fails answers:
//   1. 404  DATA_COLLECTION isn't exactly "on" (SPEC §11)
//   2. 404  the host isn't in API_HOSTS (lib/hosts.js): production answers
//           only on its own host, never on version URLs (SPEC §18.2)
//   3. 404  no such route, or its feature is off in site.config.json
//   4. 405  not POST (with Allow: POST)
//   5. 403  the Origin header isn't this request's own origin
//   6. 415  the media type isn't application/json or text/plain (sendBeacon)
//   7. 413  the body is over 4096 bytes
//   8. 400  the body isn't UTF-8 JSON ("body")
//   9.      the route's own checks and write (routes/*.js)
// So a cross-site request is refused before its body is read. Anything
// unexpected in 7-9 answers 500 and logs a fixed message only. The request's
// address, headers and body are never logged, and CF-Connecting-IP,
// User-Agent and request.cf are never read (SPEC §14.1).
//
// /admin and /admin/* answer 404 until M6. Everything else goes to static
// assets, so unknown paths get the site's 404 page.

import { apiError, apiNotFound, INVALID_JSON, MAX_BODY_BYTES, mediaType, parseJson, readBody } from './lib/http.js';
import { hostAllowed } from './lib/hosts.js';
import { pageIndex } from './lib/pages.js';
import { handleEvent } from './routes/event.js';

// path -> { feature: its site.config.json switch, handle(body, env, index),
// log: the fixed text that names it in a log line }
const ROUTES = new Map([['/api/event', { feature: 'events', handle: handleEvent, log: '/api/event' }]]);

const BODY_TYPES = new Set(['application/json', 'text/plain']);

const notFound = () => new Response('Not found', { status: 404 });

/**
 * @param {{ pages: object, site: object }} config  pages.json and site.config.json
 * @returns {{ fetch(request: Request, env: object, ctx?: ExecutionContext): Promise<Response> }}
 */
export function createRouter({ pages, site }) {
  const index = pageIndex(pages);
  const features = site?.features ?? {};

  async function api(request, env, url) {
    if (env?.DATA_COLLECTION !== 'on') return apiNotFound();
    if (!hostAllowed(url.host, env.API_HOSTS)) return apiNotFound();
    const route = ROUTES.get(url.pathname);
    if (!route || features[route.feature] !== true) return apiNotFound();

    if (request.method !== 'POST') return apiError(405, 'method', { Allow: 'POST' });
    if (request.headers.get('Origin') !== url.origin) return apiError(403, 'origin');
    if (!BODY_TYPES.has(mediaType(request))) return apiError(415, 'content_type');

    try {
      const bytes = await readBody(request, MAX_BODY_BYTES);
      if (bytes === null) return apiError(413, 'too_large');
      const body = parseJson(bytes);
      if (body === INVALID_JSON) return apiError(400, 'body');
      return await route.handle(body, env, index);
    } catch {
      // The error is dropped unread: its message could quote the request.
      console.error(`${route.log}: unexpected error`);
      return apiError(500, 'server');
    }
  }

  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) return api(request, env, url);
      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return notFound();
      return env.ASSETS.fetch(request);
    },
  };
}
