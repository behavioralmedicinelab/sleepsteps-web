// Usage statistics in the browser (SPEC §10.1, §10.2, §11): src/js/events.js
// and the usage-prefs.js it shares with stats-switch.js, run on the built
// pages in the small test DOM (mini-dom.js), alone or with players.js and
// search.js. Every request body is also run through the Worker's own check
// (worker/routes/event.js) against the built pages.json, so the browser sends
// exactly what the Worker accepts. Last, which built pages load events.js.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import configure from '../../eleventy.config.js';
import { MAX_QUERY_LOGGED } from '../../src/js/search-config.js';
import { pageIndex } from '../../worker/lib/pages.js';
import {
  MAX_QUERY_LENGTH,
  MAX_SEARCH_RESULTS,
  SHAPES as WORKER_SHAPES,
  UUID_V4 as WORKER_UUID_V4,
  validateEvent,
} from '../../worker/routes/event.js';
import { attr, listFiles, pageAt, readHtmlPages, tags } from './helpers.js';
import { MemoryStorage, installDom } from './mini-dom.js';

const site = inject('builtSite');
const pagesJson = JSON.parse(readFileSync('worker/generated/pages.json', 'utf8'));
const index = pageIndex(pagesJson);
const config = JSON.parse(readFileSync('site.config.json', 'utf8'));

const VISIT_KEY = 'sleepsteps-visit';
const OFF_KEY = 'sleepsteps-stats-off';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROBLEM = '/problems/tired-but-wired/';

const CONSOLE = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
let dom;
let calls; // every attempt to send: { via: 'beacon' | 'fetch', url, body, init }
let sent; // the bodies that went out (beacons accepted, and fetches), parsed

beforeEach(() => {
  for (const method of CONSOLE) vi.spyOn(console, method);
});

afterEach(() => {
  for (const method of CONSOLE) expect(console[method], `console.${method}`).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  dom?.restore();
  dom = undefined;
});

/**
 * Open a built page with storage and transport stand-ins, then run
 * `modules` on it, freshly imported. `beacon`: 'ok' (sendBeacon accepts),
 * 'refuse' (returns false), 'throw' or 'missing'. `fetch`: 'ok', 'reject',
 * 'throw' or 'missing'. `before(dom)` runs after the page is installed and
 * before the modules.
 */
async function open(
  url,
  { modules = ['events'], local, session, beacon = 'ok', fetch = 'ok', crypto, html, search = '', before } = {},
) {
  calls = [];
  sent = [];
  const navigator = {};
  if (beacon !== 'missing') {
    navigator.sendBeacon = (to, body) => {
      calls.push({ via: 'beacon', url: to, body });
      if (beacon === 'throw') throw new TypeError('Illegal invocation');
      if (beacon === 'refuse') return false;
      sent.push(JSON.parse(body));
      return true;
    };
  }
  const fetchImpl =
    fetch === 'missing'
      ? undefined
      : (to, init) => {
          calls.push({ via: 'fetch', url: to, body: init?.body, init });
          if (fetch === 'throw') throw new TypeError('Failed to fetch');
          sent.push(JSON.parse(init.body));
          return fetch === 'reject' ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(new Response(null, { status: 204 }));
        };
  dom = installDom(html ?? pageAt(site, url), {
    search,
    localStorage: local,
    sessionStorage: session,
    navigator,
    fetch: fetchImpl,
    ...(crypto ? { crypto } : {}),
  });
  before?.(dom);
  vi.resetModules();
  for (const name of modules) await import(`../../src/js/${name}.js`);
  return dom;
}

/** Report as players.js and search.js do. */
const report = (type, detail) =>
  dom.document.dispatchEvent(new CustomEvent('sleepsteps:event', { detail: { type, detail } }));

/** The Worker's verdict on a body: its row, or its error code. */
const verdict = (body) => validateEvent(body, index);

/** Let promise callbacks run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('events.js on a page that sends a page view', () => {
  it('sends one page_view on load to /api/event, as a JSON string, with a new visit code it keeps in sessionStorage', async () => {
    const session = new MemoryStorage();
    await open(PROBLEM, { session });
    expect(calls).toHaveLength(1);
    const [{ via, url, body }] = calls;
    // A string body: sendBeacon sends it as text/plain;charset=UTF-8 (SPEC §14.1).
    expect([via, url, typeof body]).toEqual(['beacon', '/api/event', 'string']);
    const [event] = sent;
    expect(Object.keys(event)).toEqual(['type', 'page', 'session_id', 'detail']);
    expect(event).toMatchObject({ type: 'page_view', page: 'tired-but-wired', detail: {} });
    expect(event.session_id).toMatch(UUID);
    expect(session.getItem(VISIT_KEY)).toBe(event.session_id);
    expect(verdict(event).row).toBeTruthy();
  });

  it.each(['/start/', '/urgent-help/', '/problems/pain/'])('sends a page_view the Worker accepts from %s', async (url) => {
    await open(url);
    expect(sent.map((e) => [e.type, e.page])).toEqual([['page_view', url === '/start/' ? 'start' : url.split('/').at(-2)]]);
    expect(verdict(sent[0])).toEqual({ row: expect.objectContaining({ type: 'page_view' }) });
  });

  it('reuses the visit code on the next page in the same tab, and sends no page view when a page is restored from the back/forward cache', async () => {
    const session = new MemoryStorage();
    await open(PROBLEM, { session });
    const first = sent[0].session_id;
    dom.restore();
    await open('/start/', { session });
    expect(sent.map((e) => [e.type, e.session_id])).toEqual([['page_view', first]]);
    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    dom.window.dispatchEvent(restored);
    expect(sent).toHaveLength(1);
  });

  it('replaces a stored code that is not a lowercase v4 UUID', async () => {
    for (const bad of ['not-a-uuid', '00000000-0000-0000-0000-000000000000', 'F47AC10B-58CC-4372-A567-0E02B2C3D479']) {
      const session = new MemoryStorage({ [VISIT_KEY]: bad });
      await open(PROBLEM, { session });
      expect(sent[0].session_id).toMatch(UUID);
      expect(session.getItem(VISIT_KEY)).toBe(sent[0].session_id);
      dom.restore();
    }
  });
});

describe('events.js sends what players.js reports', () => {
  it('sends transcript, handout and audio reports from a real problem page in shapes the Worker accepts, with the visit code', async () => {
    const session = new MemoryStorage();
    await open(PROBLEM, { modules: ['events', 'players'], session });
    const { document, window } = dom;
    const code = session.getItem(VISIT_KEY);

    const transcript = document.querySelector('details[data-transcript]');
    transcript.open = true;
    const handout = document.querySelector('a[data-handout]');
    handout.click();
    const audio = document.querySelector('audio[data-media]');
    Object.assign(audio, { duration: 200, currentTime: 0, paused: false });
    audio.dispatchEvent(new Event('play'));
    audio.currentTime = 120;
    audio.dispatchEvent(new Event('timeupdate'));
    window.dispatchEvent(new Event('pagehide'));

    expect(sent.map((e) => e.type)).toEqual(['page_view', 'transcript_open', 'handout_open', 'audio_play']);
    expect(sent.slice(1).map((e) => e.detail)).toEqual([
      { media: transcript.dataset.transcript },
      { media: handout.dataset.handout },
      { media: audio.dataset.media, furthest: 50 },
    ]);
    for (const event of sent) {
      expect(event.page).toBe('tired-but-wired');
      expect(event.session_id).toBe(code);
      expect(verdict(event).error, JSON.stringify(event)).toBeUndefined();
    }
  });

  it('sends a video_play for each furthest point players.js can report, for each video on the page', async () => {
    await open(PROBLEM, { modules: ['events', 'players'] });
    const videos = dom.document.querySelectorAll('[data-video]').map((el) => el.dataset.video);
    expect(videos.length).toBeGreaterThan(1);
    for (const media of videos) for (const furthest of [0, 25, 50, 75, 100]) report('video_play', { media, furthest });
    expect(sent).toHaveLength(1 + videos.length * 5);
    for (const event of sent) expect(verdict(event).error, JSON.stringify(event)).toBeUndefined();
  });

  it('copies only the SPEC §10.2 keys of a detail', async () => {
    await open(PROBLEM);
    report('handout_open', { media: 'wind-down-hour', file: 'wind-down-hour.pdf', page: 'x', ts: 1 });
    expect(sent[1]).toEqual({ type: 'handout_open', page: 'tired-but-wired', session_id: sent[0].session_id, detail: { media: 'wind-down-hour' } });
  });

  it('sends nothing for an unknown type, a detail without its keys, or a report that is not an object', async () => {
    await open(PROBLEM);
    report('rating', { stars: 5 });
    report('__proto__', {});
    report('video_play', { media: 'wind-down-hour' });
    report('search', { q: 'pain' });
    report('handout_open', null);
    report('transcript_open', 'wind-down-hour');
    dom.document.dispatchEvent(new CustomEvent('sleepsteps:event', { detail: 'page_view' }));
    dom.document.dispatchEvent(new CustomEvent('sleepsteps:event'));
    expect(sent.map((e) => e.type)).toEqual(['page_view']);
  });

  it('sends nothing on a page without a data-page-id', async () => {
    const html = pageAt(site, PROBLEM).replace(' data-page-id="tired-but-wired"', '');
    await open(PROBLEM, { html });
    report('handout_open', { media: 'wind-down-hour' });
    expect(calls).toEqual([]);
  });
});

describe('events.js on the search page', () => {
  const indexJson = readFileSync(path.join(site, 'search-index.json'), 'utf8');
  const searchPage = pageAt(site, '/search/').replace(
    /data-minisearch="[^"]*"/,
    `data-minisearch="${pathToFileURL(path.join(site, 'js/vendor/minisearch/index.js')).href}"`,
  );

  async function searchFor(query, options = {}) {
    vi.stubGlobal('fetch', async () => new Response(indexJson, { status: 200 }));
    await open('/search/', { html: searchPage, modules: ['events', 'search'], search: `?q=${encodeURIComponent(query)}`, ...options });
    const status = dom.document.querySelector('[data-search-status]');
    await vi.waitFor(() => expect(status.textContent).not.toBe('Searching…'));
  }

  it('sends one search event without a visit code, and creates none', async () => {
    const session = new MemoryStorage();
    await searchFor('pain', { session });
    expect(sent).toHaveLength(1);
    const [event] = sent;
    expect(Object.keys(event)).toEqual(['type', 'page', 'detail']);
    expect(event).toEqual({ type: 'search', page: 'search', detail: { q: 'pain', results: expect.any(Number) } });
    expect(event.detail.results).toBeGreaterThan(0);
    expect(session.length).toBe(0);
    expect(verdict(event)).toEqual({ row: expect.objectContaining({ type: 'search', session_id: null }) });
  });

  it('sends a long query cut to the length the Worker accepts, even when the cut splits an emoji', async () => {
    for (const query of [`sleep ${'x'.repeat(300)}`, `a${'😴'.repeat(80)}`]) {
      await searchFor(query);
      expect(sent).toHaveLength(1);
      expect(sent[0].detail.q).toBe(query.slice(0, MAX_QUERY_LOGGED));
      expect(verdict(sent[0]).error).toBeUndefined();
      dom.restore();
      vi.unstubAllGlobals();
    }
  });

  it('sends a search with no results, which the Worker accepts too', async () => {
    await searchFor('zzqxv');
    expect(sent.map((e) => e.detail)).toEqual([{ q: 'zzqxv', results: 0 }]);
    expect(verdict(sent[0]).error).toBeUndefined();
  });

  it('keeps search.js and the Worker in step: the query length, and an index that can never give more results than the Worker accepts', () => {
    expect(MAX_QUERY_LOGGED).toBe(MAX_QUERY_LENGTH);
    expect(JSON.parse(indexJson).length).toBeLessThanOrEqual(MAX_SEARCH_RESULTS);
  });
});

describe('events.js with usage statistics turned off', () => {
  it('sends nothing at all, and deletes the visit code left in the tab, when they are off at load', async () => {
    const local = new MemoryStorage({ [OFF_KEY]: '1' });
    const session = new MemoryStorage({ [VISIT_KEY]: '2f1c4e1e-9a51-4b0e-8a39-2f0d1c7a6b5e' });
    await open(PROBLEM, { modules: ['events', 'players'], local, session });
    report('handout_open', { media: 'wind-down-hour' });
    dom.document.querySelector('a[data-handout]').click();
    dom.window.dispatchEvent(new Event('pagehide'));
    expect(calls).toEqual([]);
    expect(session.length).toBe(0);
  });

  it('sends nothing once they are turned off in another tab, and uses a new code if they are turned back on', async () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    await open(PROBLEM, { local, session });
    const before = sent[0].session_id;

    local.setItem(OFF_KEY, '1');
    report('handout_open', { media: 'wind-down-hour' });
    expect(sent).toHaveLength(1);
    expect(session.getItem(VISIT_KEY)).toBeNull();

    local.removeItem(OFF_KEY);
    report('handout_open', { media: 'wind-down-hour' });
    expect(sent).toHaveLength(2);
    expect(sent[1].session_id).toMatch(UUID);
    expect(sent[1].session_id).not.toBe(before);
    expect(session.getItem(VISIT_KEY)).toBe(sent[1].session_id);
  });

  it('deletes the visit code on load even on a page that sends nothing then (the search page without a query)', async () => {
    const local = new MemoryStorage({ [OFF_KEY]: '1' });
    const session = new MemoryStorage({ [VISIT_KEY]: '2f1c4e1e-9a51-4b0e-8a39-2f0d1c7a6b5e' });
    await open('/search/', { local, session });
    expect(calls).toEqual([]);
    expect(session.length).toBe(0);
  });

  it('counts any stored value as off', async () => {
    await open(PROBLEM, { local: new MemoryStorage({ [OFF_KEY]: '' }) });
    expect(calls).toEqual([]);
  });
});

describe('events.js when storage fails', () => {
  it('still sends when the browser blocks storage, with one code kept in memory for the page', async () => {
    await open(PROBLEM, { local: 'blocked', session: 'blocked' });
    report('handout_open', { media: 'wind-down-hour' });
    expect(sent.map((e) => e.type)).toEqual(['page_view', 'handout_open']);
    expect(sent[0].session_id).toMatch(UUID);
    expect(sent[1].session_id).toBe(sent[0].session_id);
    const first = sent[0].session_id;
    dom.restore();
    // The next page can't know it, so it starts its own.
    await open('/start/', { local: 'blocked', session: 'blocked' });
    expect(sent[0].session_id).not.toBe(first);
  });

  it('keeps the code in memory for the page when sessionStorage is full', async () => {
    const session = new MemoryStorage({}, { full: true });
    await open(PROBLEM, { session });
    report('transcript_open', { media: 'wind-down-hour' });
    expect(sent).toHaveLength(2);
    expect(sent[1].session_id).toBe(sent[0].session_id);
    expect(session.length).toBe(0);
  });
});

describe('events.js transport', () => {
  it.each(['refuse', 'throw', 'missing'])(
    'falls back to one keepalive fetch, with no headers or credentials changed, when sendBeacon is %s',
    async (beacon) => {
      await open(PROBLEM, { beacon });
      const fetches = calls.filter((c) => c.via === 'fetch');
      expect(fetches).toHaveLength(1);
      const [{ url, init }] = fetches;
      // The browser's own text/plain;charset=UTF-8 and same-origin
      // credentials (an Access cookie on previews) stay as they are.
      expect(url).toBe('/api/event');
      expect(init).toEqual({ method: 'POST', body: expect.any(String), keepalive: true });
      expect(JSON.parse(init.body).type).toBe('page_view');
    },
  );

  it('sends nothing more when sendBeacon accepts', async () => {
    await open(PROBLEM);
    expect(calls.map((c) => c.via)).toEqual(['beacon']);
  });

  it('fails silently when fetch rejects, throws or is missing: no unhandled rejection, nothing logged', async () => {
    for (const fetch of ['reject', 'throw', 'missing']) {
      await open(PROBLEM, { beacon: 'missing', fetch });
      report('handout_open', { media: 'wind-down-hour' });
      await settle();
      expect(calls.filter((c) => c.via === 'fetch')).toHaveLength(fetch === 'missing' ? 0 : 2);
      dom.restore();
    }
  });
});

describe('events.js visit codes', () => {
  it('builds a v4 UUID from getRandomValues where crypto.randomUUID is missing (an insecure context or an older browser)', async () => {
    const fill = (byte) => ({ getRandomValues: (bytes) => bytes.fill(byte) });
    await open(PROBLEM, { crypto: fill(0xff) });
    expect(sent[0].session_id).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    dom.restore();
    await open(PROBLEM, { crypto: fill(0x00) });
    expect(sent[0].session_id).toBe('00000000-0000-4000-8000-000000000000');
    dom.restore();
    for (let i = 0; i < 20; i += 1) {
      await open(PROBLEM, { crypto: { getRandomValues: (bytes) => globalThis.crypto.getRandomValues(bytes) } });
      expect(sent[0].session_id).toMatch(UUID);
      expect(verdict(sent[0]).error).toBeUndefined();
      dom.restore();
    }
  });

  it('sends nothing, and fails silently, when the browser has no crypto at all', async () => {
    await open(PROBLEM, { crypto: {} });
    expect(calls).toEqual([]);
  });

  it('uses the same event types and code pattern as the Worker', async () => {
    const { SHAPES, UUID_V4 } = await import('../../src/js/events.js');
    expect(SHAPES).toEqual(WORKER_SHAPES);
    expect(UUID_V4.source).toBe(WORKER_UUID_V4.source);
    expect(UUID_V4.flags).toBe(WORKER_UUID_V4.flags);
  });
});

describe('events.js stays private (SPEC §10.1, CLAUDE.md)', () => {
  it('never reads the user agent, screen, referrer or the address query', async () => {
    const touched = [];
    const watch = (object, name) =>
      Object.defineProperty(object, name, {
        configurable: true,
        get() {
          touched.push(name);
          return 'secret';
        },
      });
    await open(PROBLEM, {
      before: ({ document, window }) => {
        for (const name of ['userAgent', 'userAgentData', 'platform', 'language', 'languages']) watch(window.navigator, name);
        watch(document, 'referrer');
        watch(window.location, 'search');
        watch(window, 'screen');
      },
    });
    report('transcript_open', { media: 'wind-down-hour' });
    expect(sent).toHaveLength(2);
    expect(touched).toEqual([]);
  });

  const code = (file) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it.each(['src/js/events.js', 'src/js/usage-prefs.js', 'src/js/stats-switch.js'])(
    '%s has no console calls, markup strings, cookies or other storage, and reads nothing about the device or the address',
    (file) => {
      const source = code(file);
      expect(source).not.toMatch(/console\.|innerHTML|outerHTML|insertAdjacentHTML|document\.write|document\.cookie|indexedDB|caches\./);
      expect(source).not.toMatch(/userAgent|navigator\.(?:platform|language)|screen\.|document\.referrer|location\.(?:search|href)|URLSearchParams/);
    },
  );

  it('events.js sends only to /api/event, never a time, and leaves the request headers and credentials alone', () => {
    const source = code('src/js/events.js');
    expect(source.match(/['"`]\/api\/[^'"`]*['"`]/g)).toEqual(["'/api/event'"]);
    expect(source).not.toMatch(/\bDate\b|performance\.|timeStamp|\bts\b/);
    expect(source).not.toMatch(/headers|credentials|referrerPolicy|mode:|XMLHttpRequest/);
    expect(source).not.toMatch(/import\s.*api\.js/);
  });
});

// ---- The built site --------------------------------------------------------

describe('built pages and the usage statistics modules (SPEC §10.1, §11)', () => {
  const pages = readHtmlPages(site);
  const scriptsOf = (html) => tags(html, 'script').map((t) => attr(t, 'src'));
  const pageIdOf = (html) => attr(tags(html, 'body')[0], 'data-page-id');
  const tracked = Object.entries(pagesJson)
    .filter(([, page]) => page.page_view)
    .map(([id]) => id);

  it('the tracked pages are the problem pages, Start here and Getting urgent help', () => {
    expect(tracked.filter((id) => !pagesJson[id].url.startsWith('/problems/')).sort()).toEqual(['start', 'urgent-help']);
    expect(tracked.length).toBe(36 + 2);
  });

  it.each(pages.map((p) => [p.file, p.html]))(
    '%s loads events.js only if it sends a page view or loads players.js or search.js, first after menu.js',
    (file, html) => {
      const scripts = scriptsOf(html);
      const expected =
        config.features.events &&
        (tracked.includes(pageIdOf(html)) || scripts.includes('/js/players.js') || scripts.includes('/js/search.js'));
      expect(scripts.includes('/js/events.js'), file).toBe(Boolean(expected));
      if (expected) {
        expect(scripts.indexOf('/js/events.js'), file).toBe(scripts[0] === '/js/menu.js' ? 1 : 0);
        expect(scripts.filter((s) => s === '/js/events.js')).toHaveLength(1);
      }
    },
  );

  it('loads events.js on exactly the problem pages, Start here, Getting urgent help and Search', () => {
    const loading = pages.filter((p) => scriptsOf(p.html).includes('/js/events.js')).map((p) => pageIdOf(p.html));
    expect(loading.sort()).toEqual(config.features.events ? [...tracked, 'search'].sort() : []);
  });

  it('loads stats-switch.js only on the privacy page', () => {
    const loading = pages.filter((p) => scriptsOf(p.html).includes('/js/stats-switch.js')).map((p) => p.file);
    expect(loading).toEqual(config.features.events ? ['privacy/index.html'] : []);
    expect(existsSync(path.join(site, 'js/usage-prefs.js'))).toBe(true);
  });

  it('marks <body data-page-view> on exactly the pages pages.json lets send one', () => {
    const marked = pages.filter((p) => /<body\b[^>]*\sdata-page-view[\s>]/.test(p.html)).map((p) => pageIdOf(p.html));
    expect(marked.sort()).toEqual([...tracked].sort());
  });

  it('names only real videos in the attributes players.js reports from', () => {
    const library = new Set(listFiles('content/videos', (f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')));
    for (const { file, html } of pages) {
      for (const [, name, id] of html.matchAll(/\sdata-(video|media|handout|transcript)="([^"]*)"/g)) {
        expect(library.has(id), `${file}: data-${name}="${id}"`).toBe(true);
      }
    }
  });

  it('sets a referrer policy only on the search page, and never no-referrer (sendBeacon would then send Origin: null)', () => {
    const withPolicy = pages.filter((p) => /<meta name="referrer"/.test(p.html)).map((p) => p.file);
    expect(withPolicy).toEqual(['search/index.html']);
    for (const { file, html } of pages) expect(html, file).not.toMatch(/no-referrer"/);
    expect(readFileSync('src/_headers', 'utf8')).not.toMatch(/no-referrer\b(?!-)/i);
  });
});

// The same layout with the switch off, as the built site can't show it
// (site.config.json is fixed for the test build): base.njk passes the
// features and the page's track_page_view to the moduleScripts filter.
describe('base.njk and features.events', () => {
  const require = createRequire(import.meta.url);
  const nunjucks = createRequire(require.resolve('@11ty/eleventy'))('nunjucks');
  const filters = {};
  configure({
    on: () => {},
    addGlobalData: () => {},
    addDataExtension: () => {},
    addPassthroughCopy: () => {},
    addCollection: () => {},
    addFilter: (name, fn) => (filters[name] = fn),
  });
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader('src/_includes'), { autoescape: true });
  for (const [name, fn] of Object.entries(filters)) env.addFilter(name, fn);
  // The minimal header and no footer, so no collections are needed.
  const render = (events, data) =>
    env.render('layouts/base.njk', {
      site: { siteName: 'SleepSteps', features: { ratings: true, feedback: true, events } },
      title: 'A page',
      page_id: 'a-page',
      header: 'minimal',
      footer: false,
      content: '<main id="main"></main>',
      ...data,
    });
  const scriptsOf = (html) => tags(html, 'script').map((t) => attr(t, 'src'));

  it.each([
    [{ track_page_view: true }, ['/js/events.js'], []],
    [{ track_page_view: true, scripts: ['players.js'] }, ['/js/events.js', '/js/players.js'], ['/js/players.js']],
    [{ scripts: ['search.js'] }, ['/js/events.js', '/js/search.js'], ['/js/search.js']],
    [{ scripts: ['stats-switch.js'] }, ['/js/stats-switch.js'], []],
    [{ scripts: ['problems.js'] }, ['/js/problems.js'], ['/js/problems.js']],
  ])('%j loads %j with features.events on and %j with it off', (data, on, off) => {
    expect(scriptsOf(render(true, data))).toEqual(on);
    expect(scriptsOf(render(false, data))).toEqual(off);
  });

  it('marks data-page-view on <body> whatever features.events says (pages.json reads it)', () => {
    for (const events of [true, false]) {
      expect(render(events, { track_page_view: true })).toMatch(/<body data-page-id="a-page" data-page-view>/);
      expect(render(events, {})).toMatch(/<body data-page-id="a-page">/);
    }
  });
});
