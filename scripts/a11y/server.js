// The local site for `npm run test:a11y` (SPEC §20 M7): a small Node server,
// built-ins only, that stands in for the Worker and its static assets.
//
// - Static files come from dist/ as Wrangler's asset server sends them, near
//   enough for a browser check: /about → /about/ (307), /x/ → x/index.html,
//   /404 → 404.html with 200, and a missing file → 404.html with 404. The
//   headers come from dist/_headers (applied in file order; a header set
//   again is joined with a comma and "! Name" detaches it, as Cloudflare
//   does), so pages load under the real Content-Security-Policy. Rules for a
//   host (the workers.dev noindex rule) never match a local address.
//   _headers itself is never served.
// - /api/*, /admin and /admin/* go to the repo's real router
//   (worker/router.js), as run_worker_first sends them (SPEC §18.2), with
//   the D1 stand-in (d1-sqlite.js). Each /admin request gets a freshly
//   signed throwaway Access token, and the verifier's certs fetch is
//   answered here (createAccessVerifier's fetcher), so nothing reaches
//   Cloudflare. Siteverify is answered as Cloudflare's always-pass test
//   secret answers (success: true) for the same reason.
// - `control` lets the runner bend the run per state: apiOff (collection off,
//   so every /api/* answers 404, as production does before the go-ahead),
//   noDb (no D1 binding, so the admin pages show their database error) and
//   fail (paths that answer 500, a test's deliberate failure).
import { readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRouter } from '../../worker/router.js';
import { createAccessVerifier } from '../../worker/lib/access-jwt.js';
import { SITEVERIFY_URL } from '../../worker/lib/turnstile.js';
import { AUD, TEAM, certsBody, claims, makeKey, signToken } from '../../test/worker/access-tokens.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/vnd.microsoft.icon',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
};

/** dist/_headers -> [{ pattern: RegExp | null, set: [[name, value]], detach: [name] }] (host rules: pattern null). */
export function parseHeadersFile(text) {
  const rules = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      const source = line.trim();
      const pattern = source.startsWith('/')
        ? new RegExp(`^${source.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/:[a-z]\w*/gi, '[^/]+')}$`)
        : null;
      rules.push({ source, pattern, set: [], detach: [] });
      continue;
    }
    const rule = rules.at(-1);
    const entry = line.trim();
    if (entry.startsWith('!')) rule.detach.push(entry.slice(1).trim().toLowerCase());
    else {
      const colon = entry.indexOf(':');
      rule.set.push([entry.slice(0, colon).trim(), entry.slice(colon + 1).trim()]);
    }
  }
  return rules;
}

/** The headers `rules` give `pathname`, as { lower-case name: [name, value] }. */
export function headersFor(rules, pathname) {
  const out = new Map();
  for (const rule of rules) {
    if (!rule.pattern?.test(pathname)) continue;
    for (const name of rule.detach) out.delete(name);
    for (const [name, value] of rule.set) {
      const key = name.toLowerCase();
      out.set(key, out.has(key) ? [name, `${out.get(key)[1]}, ${value}`] : [name, value]);
    }
  }
  return out;
}

/**
 * Starts the server, on 127.0.0.1 and an ephemeral port unless told otherwise.
 * @param {object} options
 * @param {string} options.dist   the built site
 * @param {object} options.pages  worker/generated/pages.json
 * @param {object} options.site   site.config.json
 * @param {object} options.db     the D1 stand-in
 * @param {number} [options.pageRows]  rows per admin export part, so a
 *   small sample needs a download in parts
 * @param {number} [options.port]  0 (the default) for any free port
 * @param {string} [options.host]  the address to listen on (default
 *   127.0.0.1); the API and admin pages answer on it too (API_HOSTS)
 * @returns {Promise<{ origin: string, port: number, control: { apiOff: boolean, noDb: boolean, fail: string[] }, close(): Promise<void> }>}
 */
export async function startServer({ dist, pages, site, db, pageRows, port: wanted = 0, host = '127.0.0.1' }) {
  const rules = parseHeadersFile(readFileSync(path.join(dist, '_headers'), 'utf8'));
  const key = await makeKey('a11y-key-1');
  const access = createAccessVerifier({
    fetcher: async () => new Response(JSON.stringify(certsBody([key])), { headers: { 'Content-Type': 'application/json' } }),
  });
  const router = createRouter({ pages, site, admin: { access, pageRows } });
  const control = { apiOff: false, noDb: false, fail: [] };
  let port = 0;

  // Siteverify, answered as Cloudflare's always-pass test secret does, so a
  // feedback send never leaves this machine. Every other fetch is untouched.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) =>
    String(input instanceof Request ? input.url : input) === SITEVERIFY_URL
      ? new Response(JSON.stringify({ success: true, 'error-codes': [], hostname: 'example.com' }), { headers: { 'Content-Type': 'application/json' } })
      : realFetch(input, init);

  const env = () => ({
    DB: control.noDb ? undefined : db,
    DATA_COLLECTION: control.apiOff ? 'off' : 'on',
    API_HOSTS: [...new Set(['127.0.0.1', 'localhost', 'a1.localhost', host])].map((name) => `${name}:${port}`).join(','),
    TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
  });

  function sendFile(res, method, status, file, pathname) {
    const body = readFileSync(file);
    res.statusCode = status;
    for (const [name, value] of headersFor(rules, pathname).values()) res.setHeader(name, value);
    res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('Content-Length', body.length);
    res.end(method === 'HEAD' ? undefined : body);
  }

  function isFile(file) {
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  }

  function serveStatic(req, res, url) {
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      pathname = '/';
    }
    const file = path.join(dist, path.normalize(pathname));
    const inside = file.startsWith(dist + path.sep) || file === dist;
    const fallback = () => sendFile(res, req.method, 404, path.join(dist, '404.html'), url.pathname);
    if (!inside || path.basename(file) === '_headers') return fallback();
    if (pathname.endsWith('/') && isFile(path.join(file, 'index.html'))) return sendFile(res, req.method, 200, path.join(file, 'index.html'), url.pathname);
    if (!pathname.endsWith('/') && isFile(path.join(file, 'index.html'))) {
      res.writeHead(307, { Location: `${url.pathname}/${url.search}` });
      return res.end();
    }
    if (isFile(`${file}.html`) && !pathname.endsWith('/')) return sendFile(res, req.method, 200, `${file}.html`, url.pathname);
    if (isFile(file)) return sendFile(res, req.method, 200, file, url.pathname);
    return fallback();
  }

  async function serveWorker(req, res, url) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (['connection', 'keep-alive', 'transfer-encoding'].includes(name)) continue;
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      headers.set('Cf-Access-Jwt-Assertion', await signToken(key, claims(Date.now())));
    }
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks);
    const response = await router.fetch(new Request(url, { method: req.method, headers, body }), env());
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? `${host}:${port}`}`);
    if (control.fail.some((prefix) => url.pathname.startsWith(prefix))) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('A deliberate failure (npm run test:a11y)');
    }
    const worker = url.pathname.startsWith('/api/') || url.pathname === '/admin' || url.pathname.startsWith('/admin/');
    (worker ? serveWorker(req, res, url) : Promise.resolve(serveStatic(req, res, url))).catch((error) => {
      res.statusCode = 500;
      res.end(`a11y server: ${error.message}`);
    });
  });
  await new Promise((resolve, reject) => {
    const failed = (error) => {
      globalThis.fetch = realFetch;
      reject(error);
    };
    server.once('error', failed);
    server.listen(wanted, host, () => {
      server.off('error', failed);
      resolve();
    });
  });
  port = server.address().port;
  return {
    origin: `http://${host}:${port}`,
    port,
    control,
    close: () =>
      new Promise((resolve) => {
        globalThis.fetch = realFetch;
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
