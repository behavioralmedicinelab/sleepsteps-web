// The parts of `npm run test:a11y` (scripts/a11y/, SPEC §20 M7) that need no
// browser: the local server that stands in for the Worker and its assets,
// the D1 stand-in, and finding Chrome. The browser run itself is on the
// project lead's Mac only; these keep it from drifting from the code it
// serves (dist/_headers, the router, the schema) between runs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { findChrome, MAC_CHROME } from '../../scripts/a11y/chrome.js';
import { createD1, seedD1 } from '../../scripts/a11y/d1-sqlite.js';
import { headersFor, parseHeadersFile, parseRedirectsFile, startServer, withPlaceholderKey } from '../../scripts/a11y/server.js';
import { SUMMARY_QUERIES } from '../../worker/lib/admin-queries.js';
import { ADMIN_HEADERS } from '../../worker/routes/admin.js';

// Every switch on, whatever site.config.json says, so these checks don't
// depend on it (SPEC §11): the server's routing is under test, not the switches.
const site = { ...JSON.parse(readFileSync('site.config.json', 'utf8')), features: { ratings: true, feedback: true, events: true } };

describe('the _headers port (scripts/a11y/server.js)', () => {
  it('applies matching rules in file order, joins a header set twice, and honours "! Name"', () => {
    const rules = parseHeadersFile(
      ['# a comment', '/*', '  A: 1', '  B: x', '/docs/*', '  A: 2', '/docs/raw/*', '  ! B', 'https://:v.:s.workers.dev/*', '  C: never'].join('\n'),
    );
    const of = (pathname) => Object.fromEntries([...headersFor(rules, pathname).values()]);
    expect(of('/')).toEqual({ A: '1', B: 'x' });
    expect(of('/docs/a')).toEqual({ A: '1, 2', B: 'x' });
    expect(of('/docs/raw/a')).toEqual({ A: '1, 2' });
  });

  it("gives the built site's pages its security headers once each, and /404 its noindex", () => {
    const rules = parseHeadersFile(readFileSync(path.join(inject('builtSite'), '_headers'), 'utf8'));
    const home = headersFor(rules, '/');
    expect(home.get('content-security-policy')[1]).toMatch(/^default-src 'self'; script-src 'self' /);
    expect(home.get('content-security-policy')[1]).not.toContain(', ');
    expect(home.has('x-robots-tag')).toBe(false);
    expect(headersFor(rules, '/404').get('x-robots-tag')[1]).toBe('noindex');
  });
});

describe('the _redirects port (scripts/a11y/server.js)', () => {
  it('reads the rules for one exact path, and leaves out what it does not follow', () => {
    const rules = parseRedirectsFile(['# a comment', '/old /new 301', '/temp /there   # why', '/blog/* /news/:splat 301', '/u/:id /users/:id', 'bad', '/a /b 404', '/old /other 301'].join('\n'));
    expect([...rules]).toEqual([
      ['/old', { to: '/new', status: 301 }],
      ['/temp', { to: '/there', status: 302 }],
    ]);
  });

  it("reads the built site's rules: the old Sleep problems address goes to Home (SPEC §7.2)", () => {
    const rules = parseRedirectsFile(readFileSync(path.join(inject('builtSite'), '_redirects'), 'utf8'));
    expect([...rules]).toEqual([
      ['/problems', { to: '/', status: 301 }],
      ['/problems/', { to: '/', status: 301 }],
    ]);
  });
});

describe('the local server (scripts/a11y/server.js)', () => {
  let server;
  let db;
  const get = (pathname, init) => fetch(server.origin + pathname, { redirect: 'manual', ...init });

  beforeAll(async () => {
    const dist = inject('builtSiteOn');
    const pages = JSON.parse(readFileSync('worker/generated/pages.json', 'utf8'));
    db = createD1('migrations');
    await seedD1(db, pages, Date.now());
    server = await startServer({ dist, pages, site, db, pageRows: 50 });
  });

  afterAll(async () => {
    await server?.close();
    db?.close();
  });

  it('serves pages under the real CSP, the 404 page for a missing one, and never _headers or _redirects', async () => {
    const home = await get('/');
    expect([home.status, home.headers.get('content-type')]).toEqual([200, 'text/html; charset=utf-8']);
    expect(home.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'$/);
    expect((await get('/about')).headers.get('location')).toBe('/about/');
    for (const missing of ['/does-not-exist/', '/_headers', '/_redirects', '/../site.config.json']) {
      const res = await get(missing);
      expect(res.status, missing).toBe(404);
      expect(await res.text(), missing).toContain('<title>Page not found</title>');
    }
    expect((await get('/404')).status).toBe(200);
    expect((await get('/favicon.ico')).headers.get('content-type')).toBe('image/vnd.microsoft.icon');
  });

  it('follows dist/_redirects: the old Sleep problems address goes to Home with a 301, and problem pages are served (SPEC §7.2)', async () => {
    for (const [address, location] of [['/problems/', '/'], ['/problems', '/'], ['/problems/?x=1', '/?x=1']]) {
      const res = await get(address);
      expect([res.status, res.headers.get('location')], address).toEqual([301, location]);
    }
    expect((await get('/problems/pain/')).status).toBe(200);
    expect((await get('/problems/pain')).headers.get('location')).toBe('/problems/pain/');
    // Followed, the old address is Home, with its list of sleep problems.
    const followed = await fetch(`${server.origin}/problems/`);
    expect([followed.status, new URL(followed.url).pathname]).toEqual([200, '/']);
    expect(await followed.text()).toContain('id="sleep-problems"');
  });

  it("serves pages with the placeholder site key, so the real key never loads off production's domain (decision A1 on other hosts)", async () => {
    const built = readFileSync(path.join(inject('builtSiteOn'), 'problems/pain/index.html'), 'utf8');
    expect(built).toContain(`data-sitekey="${site.turnstileSiteKey.replace(/</g, '&lt;').replace(/>/g, '&gt;')}"`);
    const res = await get('/problems/pain/');
    const html = await res.text();
    expect(html.match(/data-sitekey="[^"]*"/g)).toEqual(['data-sitekey="&lt;PUBLIC_SITE_KEY&gt;"']);
    expect(Number(res.headers.get('content-length'))).toBe(Buffer.byteLength(html));
    expect(withPlaceholderKey('<dialog data-sitekey="0xabc"></dialog>')).toBe('<dialog data-sitekey="&lt;PUBLIC_SITE_KEY&gt;"></dialog>');
  });

  it("answers /admin through the real router and Access verifier with a throwaway token", async () => {
    const summary = await get('/admin/');
    expect(summary.status).toBe(200);
    for (const [name, value] of Object.entries(ADMIN_HEADERS)) expect(summary.headers.get(name), name).toBe(value);
    expect(await summary.text()).toMatch(/<title>Site data, /);
    expect((await get('/admin/?from=x')).status).toBe(400);
    server.control.noDb = true;
    expect((await get('/admin/')).status).toBe(500);
    server.control.noDb = false;
  });

  it("refuses a port in use (npm run a11y:serve's --port) and leaves fetch as it was", async () => {
    const before = globalThis.fetch;
    await expect(startServer({ dist: inject('builtSiteOn'), pages: {}, site, db, port: server.port })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(globalThis.fetch).toBe(before);
  });

  it('answers /api/* with collection on, 404 with it off, and 500 for a deliberate failure', async () => {
    const rate = () =>
      get('/api/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: server.origin },
        body: JSON.stringify({ page_id: 'tired-but-wired', video_id: 'conditioning', stars: 4 }),
      });
    expect((await rate()).status).toBe(204);
    server.control.apiOff = true;
    expect((await rate()).status).toBe(404);
    server.control.apiOff = false;
    server.control.fail = ['/search-index.json'];
    expect((await get('/search-index.json')).status).toBe(500);
    server.control.fail = [];
    expect((await get('/search-index.json')).status).toBe(200);
  });
});

describe('the D1 stand-in (scripts/a11y/d1-sqlite.js)', () => {
  it("applies every migration and seeds rows the admin summary's queries read", async () => {
    const db = createD1('migrations');
    const pages = JSON.parse(readFileSync('worker/generated/pages.json', 'utf8'));
    const now = Date.now();
    expect(await seedD1(db, pages, now)).toBeGreaterThan(300);
    const start = new Date(now - 31 * 86400000).toISOString();
    const end = new Date(now).toISOString();
    const answers = await db.batch(SUMMARY_QUERIES.map(([, sql]) => db.prepare(sql).bind(start, end)));
    const byName = Object.fromEntries(SUMMARY_QUERIES.map(([name], i) => [name, answers[i].results]));
    for (const name of ['views', 'ratings', 'zeroSearches', 'recentFeedback', 'plays']) expect(byName[name].length, name).toBeGreaterThan(0);
    // Every time is an hour, as the Worker stores it (SPEC §14.1).
    const { results } = await db.prepare('SELECT ts FROM ratings UNION SELECT ts FROM events UNION SELECT ts FROM feedback').all();
    expect(results.every(({ ts }) => /T\d\d:00:00\.000Z$/.test(ts))).toBe(true);
    // Some messages are about a video, always one of their page's, as the
    // Worker stores them (SPEC §14.2); the newest 20 show both kinds.
    const about = (await db.prepare('SELECT page, video FROM feedback WHERE video IS NOT NULL').all()).results;
    expect(about.length).toBeGreaterThan(10);
    for (const { page, video } of about) expect(pages[page].videos, `${page} ${video}`).toContain(video);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM feedback WHERE video IS NULL').first()).n).toBeGreaterThan(about.length);
    expect(new Set(byName.recentFeedback.map((row) => row.video === null)).size).toBe(2);
    db.close();
  });
});

describe('finding Chrome (scripts/a11y/chrome.js)', () => {
  it("uses CHROME_PATH when set, and says there is none when it doesn't exist or isn't an executable file", () => {
    expect(findChrome({ CHROME_PATH: process.execPath })).toBe(process.execPath);
    expect(findChrome({ CHROME_PATH: '/nowhere/chrome' })).toBeNull();
    // A folder (the mistake of pointing at Google Chrome.app) or a file
    // that can't run.
    expect(findChrome({ CHROME_PATH: path.dirname(process.execPath) })).toBeNull();
    expect(findChrome({ CHROME_PATH: path.resolve('package.json') })).toBeNull();
    expect(MAC_CHROME).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  });
});
