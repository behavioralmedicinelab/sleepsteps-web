// src/js/admin-export.js (SPEC §14.4, decision B5): the admin download page's
// script, run in the small DOM (mini-dom.js) on the page renderDownloadPage
// renders, with fetch stubbed. It shows the button, fetches the parts,
// follows X-Export-Next, joins the parts as Blobs (keeping the byte-order
// mark) and saves one file, or saves nothing and says so.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderDownloadPage } from '../../worker/lib/admin-page.js';
import { installDom } from './mini-dom.js';

const FILENAME = 'sleepsteps-events-2026-10-01-to-2026-10-31.csv';
const PAGE = renderDownloadPage({
  host: 'example.com',
  collectionOn: true,
  generatedAt: Date.parse('2026-11-06T13:30:00.000Z'),
  table: 'events',
  from: '2026-10-01',
  to: '2026-10-31',
  filename: FILENAME,
  rows: 5,
  pageRows: 2,
});
const BOM = '\uFEFF';
const HEADER = '"ts","session_id","page","type","media","furthest"\r\n';
const row = (i) => `"2026-10-0${i}T10:00:00.000Z","a3c1e0f2-6b4d-4e8a-9f1c-2d3e4f5a6b7c","pain","page_view",,\r\n`;
// The Worker's parts for 5 rows, 2 at a time.
const PARTS = [
  { body: `${BOM}${HEADER}${row(1)}${row(2)}`, rows: 2, next: 'type=page_view&ts=2026-10-02T10%3A00%3A00.000Z&skip=1' },
  { body: `${row(3)}${row(4)}`, rows: 2, next: 'type=page_view&ts=2026-10-04T10%3A00%3A00.000Z&skip=1' },
  { body: row(5), rows: 1, next: null },
];

function csv({ body, rows, next }, extra = {}) {
  const headers = { 'Content-Type': 'text/csv; charset=utf-8; header=present', 'X-Export-Rows': String(rows), ...extra };
  if (next) headers['X-Export-Next'] = next;
  return new Response(body, { headers });
}

let dom;
let saved;
let logged;

/** Install the page with `fetch`, run the module, and record what it saves and logs. */
async function load(fetch, { html = PAGE } = {}) {
  // Blocked storage throws on any access, so a working download proves the
  // module never touches it.
  dom = installDom(html, { fetch, localStorage: 'blocked', sessionStorage: 'blocked' });
  saved = [];
  dom.document.addEventListener('click', (event) => {
    const link = event.target;
    if (link.localName === 'a' && link.hasAttribute('download')) {
      saved.push({ href: link.getAttribute('href'), download: link.getAttribute('download'), connected: link.isConnected });
    }
  });
  logged = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
    vi.spyOn(console, method).mockImplementation((...args) => logged.push([method, ...args]));
  }
  vi.resetModules();
  return import('../../src/js/admin-export.js');
}

/** Press the button and wait until the module has finished. */
async function press() {
  const button = dom.document.querySelector('[data-export]');
  button.click();
  await vi.waitFor(() => expect(button.hasAttribute('aria-disabled')).toBe(false));
  await new Promise((resolve) => setImmediate(resolve));
}

const status = () => dom.document.querySelector('[data-export-status]').textContent;

afterEach(() => {
  dom?.restore();
  dom = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('src/js/admin-export.js', () => {
  it('shows the button and hides the no-JavaScript line', async () => {
    await load(vi.fn());
    expect(dom.document.querySelector('[data-export]').hidden).toBe(false);
    expect(dom.document.querySelector('[data-export-nojs]').hidden).toBe(true);
    expect(status()).toBe('');
  });

  it('fetches every part in order, following X-Export-Next, and saves them as one file with the BOM kept', async () => {
    const fetch = vi.fn(async () => csv(PARTS[fetch.mock.calls.length - 1]));
    const blobs = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob);
      return 'blob:https://example.com/abc';
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    await load(fetch);
    await press();

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/admin/export?table=events&from=2026-10-01&to=2026-10-31&paged=1',
      `/admin/export?table=events&from=2026-10-01&to=2026-10-31&paged=1&${PARTS[0].next}`,
      `/admin/export?table=events&from=2026-10-01&to=2026-10-31&paged=1&${PARTS[1].next}`,
    ]);
    for (const [, options] of fetch.mock.calls) {
      expect(options).toMatchObject({ credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe('text/csv;charset=utf-8');
    const bytes = Buffer.from(await blobs[0].arrayBuffer());
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(bytes.toString('utf8')).toBe(PARTS.map((p) => p.body).join(''));
    // Saved through a temporary link, which is gone afterwards.
    expect(saved).toEqual([{ href: 'blob:https://example.com/abc', download: FILENAME, connected: true }]);
    expect(dom.document.querySelectorAll('a[download]')).toEqual([]);
    expect(status()).toBe(`Done: 5 rows. Your browser is saving ${FILENAME}.`);
    expect(dom.document.querySelector('progress').value).toBe('5');
    // The object URL is let go after a minute.
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith('blob:https://example.com/abc');
    expect(logged).toEqual([]);
  });

  it('announces progress at the start and then at most every 5 seconds, not after every part', async () => {
    let clock = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const heard = [];
    const fetch = vi.fn(async () => {
      heard.push(status());
      clock += 2000;
      return csv(PARTS[fetch.mock.calls.length - 1]);
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    await load(fetch);
    await press();
    expect(heard).toEqual([
      'Downloading: 0 of 5 rows so far. Keep this page open.',
      'Downloading: 0 of 5 rows so far. Keep this page open.',
      'Downloading: 0 of 5 rows so far. Keep this page open.',
    ]);
    dom.restore();
    clock = 0;
    heard.length = 0;
    const slow = vi.fn(async () => {
      heard.push(status());
      clock += 6000;
      return csv(PARTS[slow.mock.calls.length - 1]);
    });
    await load(slow);
    await press();
    expect(heard).toEqual([
      'Downloading: 0 of 5 rows so far. Keep this page open.',
      'Downloading: 2 of 5 rows so far. Keep this page open.',
      'Downloading: 4 of 5 rows so far. Keep this page open.',
    ]);
  });

  it('ignores a second press while it runs', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const fetch = vi.fn(async () => {
      await gate;
      return csv(PARTS[2], { 'X-Export-Rows': '5' });
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    await load(fetch);
    const button = dom.document.querySelector('[data-export]');
    button.click();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    button.click();
    release();
    await vi.waitFor(() => expect(button.hasAttribute('aria-disabled')).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(1);
  });

  it.each([
    ['a 500', async () => new Response('Server error', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })],
    ['a 400', async () => new Response('Choose fewer days.', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })],
    ['a network error', async () => {
      throw new TypeError('Failed to fetch');
    }],
    ['a redirect to sign-in (redirect: "error" rejects)', async () => {
      throw new TypeError('Failed to fetch: redirect');
    }],
    ['an HTML answer', async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Export-Rows': '0' } })],
    ['no row count', async () => new Response('x', { headers: { 'Content-Type': 'text/csv; charset=utf-8' } })],
    ['a malformed next cursor', async () => csv({ body: 'x', rows: 1, next: 'ts=x&skip=1&evil=1' })],
    ['a later part failing', (() => {
      let n = 0;
      return async () => (n++ === 0 ? csv(PARTS[0]) : new Response('Server error', { status: 500 }));
    })()],
  ])('saves nothing and says so after %s', async (_, respond) => {
    const create = vi.spyOn(URL, 'createObjectURL');
    await load(vi.fn(respond));
    await press();
    expect(create).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
    expect(status()).toBe(
      "Couldn't download the data, so nothing was saved. If you've been signed out, reload this page to sign in again, then try again.",
    );
    expect(dom.document.querySelector('[data-export-progress]').hidden).toBe(true);
    expect(dom.document.querySelector('[data-export]').hasAttribute('aria-disabled')).toBe(false);
    expect(logged).toEqual([]);
  });

  it('stops after MAX_PARTS parts', async () => {
    const { MAX_PARTS } = await import('../../src/js/admin-export.js');
    // 100,000 rows in 500-row feedback parts is 200 parts.
    expect(MAX_PARTS).toBeGreaterThanOrEqual(201);
    const fetch = vi.fn(async () => csv({ body: row(1), rows: 1, next: 'ts=2026-10-01T10%3A00%3A00.000Z&skip=1' }));
    const create = vi.spyOn(URL, 'createObjectURL');
    await load(fetch);
    await press();
    expect(fetch).toHaveBeenCalledTimes(MAX_PARTS);
    expect(create).not.toHaveBeenCalled();
    expect(status()).toMatch(/^Couldn't download the data/);
  });

  it('accepts exactly the cursors the Worker writes', async () => {
    const { NEXT_RE } = await import('../../src/js/admin-export.js');
    for (const next of ['type=page_view&ts=2026-10-20T07%3A00%3A00.000Z&skip=5', 'ts=2026-10-20T07%3A00%3A00.123Z&skip=0', 'type=search&ts=2026-10-20T07%3A00%3A00.000Z&skip=1234567']) {
      expect(NEXT_RE.test(next), next).toBe(true);
    }
    for (const next of ['', 'skip=1', 'type=page_view&ts=x&skip=-1', 'ts=x&skip=1&table=feedback', 'type=Page&ts=x&skip=1', 'ts=x y&skip=1', 'ts=x&skip=12345678']) {
      expect(NEXT_RE.test(next), next).toBe(false);
    }
  });

  it('leaves the page as it shipped when the button\'s data is not what the Worker writes', async () => {
    await load(vi.fn(), { html: PAGE.replace('data-filename="sleepsteps-events', 'data-filename="../evil') });
    expect(dom.document.querySelector('[data-export]').hidden).toBe(true);
    expect(dom.document.querySelector('[data-export-nojs]').hidden).toBe(false);
  });

  describe('its source', () => {
    const source = readFileSync('src/js/admin-export.js', 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    it('makes no console calls, uses no storage and writes no HTML', () => {
      expect(code).not.toMatch(/console\.|localStorage|sessionStorage|indexedDB|document\.cookie|innerHTML|outerHTML|insertAdjacentHTML/);
    });

    it('fetches only /admin/export, and keeps each part as a Blob, never text()', () => {
      expect(code.match(/fetch\(/g)).toHaveLength(1);
      expect(code).toContain('`/admin/export?${base}');
      expect(code).not.toMatch(/https?:\/\//);
      expect(code).toContain('response.blob()');
      expect(code).not.toMatch(/\.text\(\)/);
    });
  });
});
