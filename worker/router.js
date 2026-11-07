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
//   7. 413  the body is over the route's limit: 4096 bytes, or 16384 for
//           /api/feedback (a Turnstile token and a 2000-character message)
//   8. 400  the body isn't UTF-8 JSON ("body")
//   9.      the route's own checks and write (routes/*.js)
// So a cross-site request is refused before its body is read. Anything
// unexpected in 7-9 answers 500 and logs a fixed message only. The request's
// address, headers and body are never logged, and User-Agent and request.cf
// are never read (SPEC §14.1). CF-Connecting-IP is read for /api/feedback
// alone (`remoteIp`), which passes it to Turnstile's Siteverify as
// `remoteip` and never stores or logs it; the other routes' handlers are
// called with no context, so they can't see it.
//
// /admin and /admin/* go to routes/admin.js (SPEC §14.4), which checks, in
// this order: the host is in API_HOSTS and the request carries a valid
// Access token (403 for either, whatever the path or method, before any D1
// read); then the method (GET or HEAD, else 405); then the exact path (308
// from /admin to /admin/, 404 for any other). Admin doesn't depend on
// DATA_COLLECTION or `features`. Everything else goes to static assets, so
// unknown paths get the site's 404 page.

import {
  apiError,
  apiNotFound,
  INVALID_JSON,
  MAX_BODY_BYTES,
  MAX_FEEDBACK_BODY_BYTES,
  mediaType,
  parseJson,
  readBody,
} from './lib/http.js';
import { hostAllowed } from './lib/hosts.js';
import { pageIndex } from './lib/pages.js';
import { createAdmin } from './routes/admin.js';
import { handleEvent } from './routes/event.js';
import { handleFeedback } from './routes/feedback.js';
import { handleRate } from './routes/rate.js';

// path -> {
//   feature   its site.config.json switch
//   handle    (body, env, index), or (body, env, index, { remoteIp }) with remoteIp
//   log       the fixed text that names it in a log line
//   maxBytes  its body limit, if not MAX_BODY_BYTES
//   remoteIp  true to pass CF-Connecting-IP (or null) in a fourth argument
// }
// /api/event (usage statistics, SPEC §10), /api/rate (ratings, SPEC §12) and
// /api/feedback (SPEC §13); the path must match exactly ("/api/rate/" and
// "/api/Rate" are not routes). handleEvent and handleRate take an optional
// `now` as their fourth argument, so they are never given that context.
const ROUTES = new Map([
  ['/api/event', { feature: 'events', handle: handleEvent, log: '/api/event' }],
  ['/api/rate', { feature: 'ratings', handle: handleRate, log: '/api/rate' }],
  [
    '/api/feedback',
    { feature: 'feedback', handle: handleFeedback, log: '/api/feedback', maxBytes: MAX_FEEDBACK_BODY_BYTES, remoteIp: true },
  ],
]);

const BODY_TYPES = new Set(['application/json', 'text/plain']);

/**
 * @param {object} config
 * @param {object} config.pages  pages.json
 * @param {object} config.site   site.config.json
 * @param {object} [config.admin]  options for createAdmin (routes/admin.js):
 *   `access`, `now`, `pageRows`, `maxExportRows`. Only tests pass these;
 *   index.js passes none, so the real Access check always runs.
 * @returns {{ fetch(request: Request, env: object, ctx?: ExecutionContext): Promise<Response> }}
 */
export function createRouter({ pages, site, admin: adminOptions = {} }) {
  const index = pageIndex(pages);
  const features = site?.features ?? {};
  const admin = createAdmin({ ...adminOptions, index });

  async function api(request, env, url) {
    if (env?.DATA_COLLECTION !== 'on') return apiNotFound();
    if (!hostAllowed(url.host, env.API_HOSTS)) return apiNotFound();
    const route = ROUTES.get(url.pathname);
    if (!route || features[route.feature] !== true) return apiNotFound();

    if (request.method !== 'POST') return apiError(405, 'method', { Allow: 'POST' });
    if (request.headers.get('Origin') !== url.origin) return apiError(403, 'origin');
    if (!BODY_TYPES.has(mediaType(request))) return apiError(415, 'content_type');

    try {
      const bytes = await readBody(request, route.maxBytes ?? MAX_BODY_BYTES);
      if (bytes === null) return apiError(413, 'too_large');
      const body = parseJson(bytes);
      if (body === INVALID_JSON) return apiError(400, 'body');
      if (route.remoteIp === true) {
        return await route.handle(body, env, index, { remoteIp: request.headers.get('CF-Connecting-IP') || null });
      }
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
      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return admin.handle(request, env, url);
      return env.ASSETS.fetch(request);
    },
  };
}
