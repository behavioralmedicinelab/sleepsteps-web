// The search page (SPEC §8.1, §8.4): its built HTML, src/js/search.js run on
// that HTML in the small test DOM against the real built index and MiniSearch,
// the header's search warm-up in menu.js, and what the modules never do.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, inject, it, vi } from 'vitest';
import { attr, pageAt, tags } from './helpers.js';
import { installDom } from './mini-dom.js';
import { MAX_RESULTS, TYPE_LABELS } from '../../src/js/search-config.js';

const site = inject('builtSite');
const html = pageAt(site, '/search/');
const indexJson = readFileSync(path.join(site, 'search-index.json'), 'utf8');
const index = JSON.parse(indexJson);

const opening = (name, className) => tags(html, name).find((t) => (attr(t, 'class') ?? '').split(/\s+/).includes(className));

describe('the built search page', () => {
  it('has a GET form to /search/ with a labelled q field', () => {
    const form = tags(html, 'form').find((t) => attr(t, 'class') === 'search-form');
    expect([attr(form, 'action'), attr(form, 'method'), attr(form, 'role')]).toEqual(['/search/', 'get', 'search']);
    const input = tags(html, 'input').find((t) => attr(t, 'id') === 'search-q');
    expect([attr(input, 'name'), attr(input, 'type'), attr(input, 'autocomplete')]).toEqual(['q', 'search', 'off']);
  });

  it('has a status region, and hides the results and messages until the script fills them', () => {
    expect(attr(opening('p', 'search-status'), 'role')).toBe('status');
    expect(attr(opening('ol', 'search-results'), 'hidden')).toBe('');
    for (const hook of ['data-search-empty', 'data-search-error']) {
      expect(tags(html, 'div').find((t) => attr(t, hook) !== undefined)).toMatch(/\shidden\b/);
    }
  });

  it('sends pages it leads to only the site address, never the query (strict-origin)', () => {
    expect(html).toMatch(/<meta name="referrer" content="strict-origin">/);
    // The other pages keep the site-wide policy.
    expect(pageAt(site, '/about/')).not.toMatch(/<meta name="referrer"/);
  });

  it('names its search landmark, so it differs from the header one', () => {
    const form = tags(html, 'form').find((t) => attr(t, 'class') === 'search-form');
    expect(attr(form, 'aria-labelledby')).toBe('search-q-label');
    expect(html).toMatch(/<label class="search-form__label" id="search-q-label" for="search-q">Search this website<\/label>/);
  });

  it('always shows the urgent-help line under the form, also without JavaScript', () => {
    expect(html).toMatch(/<\/form>\s*<p class="notice--urgent search-urgent">If you feel unsafe or need help right now, go to <a href="\/urgent-help\/">Getting urgent help<\/a>\.<\/p>/);
  });

  it('shows the no-JavaScript route to Sleep problems by default', () => {
    const fallback = opening('div', 'search-fallback');
    expect(attr(fallback, 'hidden')).toBeUndefined();
    expect(html).toMatch(/Search results need JavaScript\. Without it, you can find every topic on the <a href="\/problems\/">Sleep problems<\/a> page\./);
  });

  it('loads only menu.js and search.js, and points at files that are built', () => {
    const scripts = tags(html, 'script').map((t) => attr(t, 'src'));
    expect(scripts).toEqual(['/js/menu.js', '/js/search.js']);
    const root = tags(html, 'div').find((t) => attr(t, 'data-search') !== undefined);
    for (const url of [attr(root, 'data-minisearch'), attr(root, 'data-index')]) {
      expect(url).toMatch(/^\/[\w/.-]+$/);
      expect(existsSync(path.join(site, url)), url).toBe(true);
    }
    expect(existsSync(path.join(site, 'js/search-config.js'))).toBe(true);
    expect(existsSync(path.join(site, 'js/vendor/minisearch/LICENSE.txt'))).toBe(true);
  });
});

// ---- search.js on the built page ------------------------------------------

let dom;
afterEach(() => {
  dom?.restore();
  dom = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * Run search.js on the built page with ?q=`query`. MiniSearch is the built
 * copy (as a file URL); fetch serves the built index unless `fetchImpl` is
 * given. Returns the page's parts once the status settles.
 */
async function search(query, { fetchImpl, minisearch } = {}) {
  const page = html.replace(
    /data-minisearch="[^"]*"/,
    `data-minisearch="${minisearch ?? pathToFileURL(path.join(site, 'js/vendor/minisearch/index.js')).href}"`,
  );
  const fetched = [];
  vi.stubGlobal(
    'fetch',
    fetchImpl ??
      (async (url) => {
        fetched.push(url);
        return new Response(indexJson, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
  );
  dom = installDom(page, { search: query === undefined ? '' : `?q=${encodeURIComponent(query)}` });
  const events = [];
  dom.document.addEventListener('sleepsteps:event', (e) => events.push(e.detail));
  vi.resetModules();
  await import('../../src/js/search.js');
  const $ = (selector) => dom.document.querySelector(selector);
  const status = $('[data-search-status]');
  await vi.waitFor(() => expect(status.textContent).not.toBe('Searching…'));
  const results = $('[data-search-results]');
  return {
    $,
    status: status.textContent,
    results: results.hidden ? [] : [...results.querySelectorAll('li')],
    events,
    fetched,
  };
}

const linkOf = (li) => li.querySelector('a').getAttribute('href');

describe('src/js/search.js', () => {
  it('without a query, hides the no-JavaScript text and shows just the form', async () => {
    const page = await search(undefined);
    expect(page.$('[data-search-fallback]').hidden).toBe(true);
    expect([page.status, page.results, page.events, page.fetched]).toEqual(['', [], [], []]);
    expect(page.$('[data-search-input]').value).toBe('');
  });

  it('lists results: title linked, type and summary, with the count in the status region', async () => {
    const page = await search('hot flushes');
    expect(page.$('[data-search-input]').value).toBe('hot flushes');
    expect(page.fetched).toEqual(['/search-index.json']);
    expect(page.results.length).toBeGreaterThan(0);
    expect(page.results.length).toBeLessThanOrEqual(MAX_RESULTS);
    const [top] = page.results;
    const entry = index.find((e) => e.url === linkOf(top));
    expect(entry.id).toBe('hot-flushes-and-night-sweats');
    expect(top.querySelector('h2 a').textContent).toBe(entry.title);
    expect(top.querySelector('.search-result__type').textContent).toBe(TYPE_LABELS.problem);
    expect(top.querySelector('.search-result__summary').textContent).toBe(entry.summary);
    expect(page.status).toMatch(/^(\d+ results?|The top 10 of \d+ results) for “hot flushes”$/);
    expect(page.$('[data-search-fallback]').hidden).toBe(true);
  });

  it('shows at most the top 10, and says how many there were', async () => {
    const page = await search('sleep');
    expect(page.results).toHaveLength(MAX_RESULTS);
    expect(page.status).toMatch(/^The top 10 of \d+ results for “sleep”$/);
  });

  it('dispatches one search event with the query cut to 100 characters and the result count', async () => {
    const long = `pain ${'x'.repeat(200)}`;
    const page = await search(long);
    expect(page.events).toHaveLength(1);
    expect(page.events[0].type).toBe('search');
    expect(page.events[0].detail.q).toBe(long.slice(0, 100));
    expect(page.events[0].detail.results).toBeGreaterThan(0);
  });

  it('with no results, says so and links to Sleep problems', async () => {
    const page = await search('zzqxv');
    expect(page.status).toBe('No results for “zzqxv”.');
    expect(page.results).toEqual([]);
    expect(page.$('[data-search-empty]').hidden).toBe(false);
    expect(page.$('[data-search-empty] a').getAttribute('href')).toBe('/problems/');
    expect(page.events).toEqual([{ type: 'search', detail: { q: 'zzqxv', results: 0 } }]);
  });

  it('if the index fails to load, says so, links to Sleep problems, and sends no event', async () => {
    for (const fetchImpl of [async () => new Response('', { status: 404 }), async () => Promise.reject(new TypeError('offline'))]) {
      const page = await search('pain', { fetchImpl });
      expect(page.status).toBe("Search isn't working right now.");
      expect(page.$('[data-search-error]').hidden).toBe(false);
      expect(page.results).toEqual([]);
      expect(page.events).toEqual([]);
      dom.restore();
    }
  });

  it('if MiniSearch fails to load, says so', async () => {
    const page = await search('pain', { minisearch: pathToFileURL(path.join(site, 'js/vendor/missing.js')).href });
    expect(page.status).toBe("Search isn't working right now.");
  });

  it('shows typed text as text, never as markup', async () => {
    const page = await search('<img src=x onerror=alert(1)>');
    expect(page.status).toContain('“<img src=x onerror=alert(1)>”');
    expect(page.$('[data-search] img')).toBeNull();
  });
});

// ---- The header's search warm-up (menu.js) ----------------------------------

describe('menu.js warms the site search when a header search box gets focus', () => {
  it('prefetches MiniSearch and the index once, on first focus', async () => {
    dom = installDom(pageAt(site, '/about/'));
    vi.resetModules();
    const { SEARCH_FILES } = await import('../../src/js/menu.js');
    const prefetches = () => dom.document.querySelectorAll('link[data-search-warm]').map((l) => [l.getAttribute('rel'), l.getAttribute('href')]);
    expect(prefetches()).toEqual([]);
    for (const id of ['site-q', 'ph-q', 'site-q']) dom.document.getElementById(id).dispatchEvent(new Event('focus'));
    expect(prefetches()).toEqual(SEARCH_FILES.map((href) => ['prefetch', href]));
  });

  it('prefetches exactly the files the search page loads', async () => {
    const { SEARCH_FILES } = await import('../../src/js/menu.js');
    const root = tags(html, 'div').find((t) => attr(t, 'data-search') !== undefined);
    expect(SEARCH_FILES).toEqual([attr(root, 'data-minisearch'), attr(root, 'data-index')]);
  });
});

describe('search.js and menu.js stay private (SPEC §8.1, CLAUDE.md)', () => {
  it('search.js never logs, stores or sends the query, and builds results without markup strings', () => {
    const source = readFileSync('src/js/search.js', 'utf8');
    expect(source).not.toMatch(/console\.|sendBeacon|XMLHttpRequest|localStorage|sessionStorage|indexedDB|document\.cookie/);
    expect(source).not.toMatch(/\binnerHTML\b|outerHTML|insertAdjacentHTML|document\.write/);
    // Its only request is the index.
    expect(source.match(/fetch\(/g)).toHaveLength(1);
    expect(source).toMatch(/fetch\(url\)/);
  });

  it('menu.js makes no requests of its own beyond the prefetch links', () => {
    const source = readFileSync('src/js/menu.js', 'utf8');
    expect(source).not.toMatch(/fetch\(|sendBeacon|XMLHttpRequest|localStorage|sessionStorage|indexedDB|document\.cookie|console\./);
  });
});
