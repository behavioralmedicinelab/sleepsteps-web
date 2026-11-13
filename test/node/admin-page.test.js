// The admin pages' HTML (SPEC §14.4, §20 M6): worker/lib/admin-page.js
// rendered from fixtures in every state, and the answers of
// worker/routes/admin.js (status, Content-Type, CSP and the admin headers)
// over a stand-in D1. The Worker tests (test/worker/admin*.test.js) run the
// same code against a real D1; these check the markup itself: structure,
// escaping, the absence of ids, the links and the copy for each state.
import { describe, expect, it } from 'vitest';
import { summaryModel, thousands } from '../../worker/lib/admin-data.js';
import { EXPORT_TABLES, SUMMARY_QUERIES, TABLES_PRESENT_SQL } from '../../worker/lib/admin-queries.js';
import { DOWNLOAD_TABLES, renderDownloadPage, renderSummary, ROWS_READ_NOTE, SIGN_OUT_URL } from '../../worker/lib/admin-page.js';
import {
  exportPieces,
  MAX_EXPORT_DAYS,
  MAX_SUMMARY_DAYS,
  previousMonth,
  summaryRange,
} from '../../worker/lib/date-range.js';
import { pageIndex } from '../../worker/lib/pages.js';
import { ADMIN_HEADERS, createAdmin } from '../../worker/routes/admin.js';
import { parseHtml } from './mini-dom.js';

const PAGES = {
  home: { url: '/', title: 'Home', page_view: false, videos: [] },
  search: { url: '/search/', title: 'Search', page_view: false, videos: [] },
  pain: { url: '/problems/pain/', title: 'Pain', page_view: true, videos: ['pain-about', 'settling-your-body'] },
  start: { url: '/start/', title: 'Start here', page_view: true, videos: ['how-sleep-works'] },
  'urgent-help': { url: '/urgent-help/', title: 'Getting urgent help', page_view: true, videos: [] },
};
const INDEX = pageIndex(PAGES);
// 2026-11-06 in UTC: the default range is 2026-10-08 to 2026-11-06, and
// last month is October.
const NOW = Date.parse('2026-11-06T13:30:00.000Z');
const LIMITS = Object.freeze({ maxSummaryDays: MAX_SUMMARY_DAYS, maxExportDays: MAX_EXPORT_DAYS, maxExportRows: 100_000 });
const SESSION = 'a3c1e0f2-6b4d-4e8a-9f1c-2d3e4f5a6b7c';
const q = (text) => new URLSearchParams(text);

/** D1-shaped summary rows, every one carrying ids and a session_id the page must never show. */
function sampleResults() {
  const ids = (i) => ({ id: 987_654_300 + i, session_id: SESSION });
  return {
    views: [{ page: 'pain', views: 1204, visits: 987, ...ids(1) }, { page: 'old-slug', views: 3, visits: 3, ...ids(2) }],
    viewTotals: [{ views: 1207, visits: 989, ...ids(3) }],
    ratings: [
      { page: 'pain', video: 'pain-about', n: 3, total: 11, ...ids(4) },
      { page: 'start', video: 'how-sleep-works', n: 2, total: 9, ...ids(5) },
      { page: 'pain', video: 'settling-your-body', n: 1, total: 2, ...ids(6) },
    ],
    searchTotals: [{ searches: 1234, zero: 56, ...ids(7) }],
    zeroSearches: [{ q: 'insomnia pills', n: 9, ...ids(8) }, { q: 'melatonin', n: 2, ...ids(9) }],
    feedbackCount: [{ n: 3, ...ids(10) }],
    recentFeedback: [
      { ts: '2026-11-01T03:00:00.000Z', page: 'pain', video: null, message: 'a\n\n\tb', ...ids(11) },
      // About a video (migration 0003), sent from that video's "Feedback" button.
      { ts: '2026-10-20T22:00:00.000Z', page: 'start', video: 'how-sleep-works', message: 'Thanks', ...ids(12) },
      // A row as the code before 0003 read it: no video key at all.
      { ts: '2026-10-19T08:00:00.000Z', page: 'old-slug', message: 'Gone', ...ids(16) },
    ],
    plays: [
      { type: 'video_play', media: 'pain-about', plays: 5, f0: 1, f25: 1, f50: 1, f75: 1, f100: 1, ...ids(13) },
      { type: 'audio_play', media: 'how-sleep-works', plays: 1, f0: 0, f25: 0, f50: 0, f75: 0, f100: 1, ...ids(14) },
    ],
    handouts: [{ media: 'pain-about', clicks: 4, visits: 3, ...ids(15) }],
    // Per page and worksheet (SPEC §7.6): one worksheet opened from two
    // pages, one of them no longer on the site, and a tie on clicks.
    worksheets: [
      { page: 'start', worksheet: 'settling-worksheet-2', clicks: 2, visits: 2, ...ids(17) },
      { page: 'pain', worksheet: 'settling-worksheet-1', clicks: 1234, visits: 1001, ...ids(18) },
      { page: 'old-slug', worksheet: 'settling-worksheet-1', clicks: 5, visits: 4, ...ids(19) },
      { page: 'pain', worksheet: 'settling-worksheet-2', clicks: 2, visits: 1, ...ids(20) },
    ],
  };
}

/** The summary view routes/admin.js builds for `query`, with `results` as the batch's rows. */
function summaryView(query = '', { results = sampleResults(), collectionOn = true, rowsRead = 12_345, host = 'example.com', now = NOW } = {}) {
  const range = summaryRange(q(query), now);
  const base = { host, collectionOn, generatedAt: now, today: range.today, form: { from: range.from, to: range.to }, limits: LIMITS, rowsRead: null };
  if (!range.ok) return { ...base, state: 'invalid', errors: range.errors };
  return {
    ...base,
    state: 'ok',
    range,
    summary: summaryModel(results, INDEX),
    downloads: { lastMonth: previousMonth(now), pieces: exportPieces(range.from, range.to, now) },
    rowsRead,
  };
}

const downloadView = (extra = {}) => ({
  host: 'example.com',
  collectionOn: true,
  generatedAt: NOW,
  table: 'events',
  from: '2026-10-01',
  to: '2026-10-31',
  filename: 'sleepsteps-events-2026-10-01-to-2026-10-31.csv',
  rows: 4321,
  pageRows: 2000,
  ...extra,
});

const emptyResults = () => Object.fromEntries(SUMMARY_QUERIES.map(([name]) => [name, []]));

const STATES = {
  ok: renderSummary(summaryView()),
  'ok, empty': renderSummary(summaryView('', { results: emptyResults() })),
  invalid: renderSummary(summaryView('from=2026-11-05&to=2026-11-01')),
  'no-tables': renderSummary({ ...summaryView(), state: 'no-tables' }),
  error: renderSummary({ ...summaryView(), state: 'error' }),
  download: renderDownloadPage(downloadView()),
};

const all = (doc, selector) => doc.querySelectorAll(selector);
const textOf = (el) => el.textContent.replace(/\s+/g, ' ').trim();

const MONTH = /\b(Jan(uary)?|Feb(ruary)?|Mar(ch)?|Apr(il)?|May|June?|July?|Aug(ust)?|Sep(tember)?|Oct(ober)?|Nov(ember)?|Dec(ember)?)\b/;

/**
 * Decision B2: every title, heading and link that names a month (so shows
 * a date) says UTC, in the downloads section above all, where a UTC month
 * differs from a Melbourne one.
 */
function expectUtcDates(doc) {
  const named = [doc.querySelector('title'), ...all(doc, 'h1, h2, h3, h4, a')].filter((el) => MONTH.test(textOf(el)));
  for (const el of named) expect(textOf(el), el.localName).toContain('UTC');
  return named.length;
}

// ---------------------------------------------------------------- structure

describe.each(Object.entries(STATES))('the %s page', (name, page) => {
  const doc = parseHtml(page);

  it('is an en-AU document with one H1, the skip link first and one <main id="main">', () => {
    expect(page.startsWith('<!doctype html>\n<html lang="en-AU">')).toBe(true);
    expect(all(doc, 'h1')).toHaveLength(1);
    const body = doc.querySelector('body');
    expect(body.children[0].getAttribute('class')).toBe('skip-link');
    expect(body.children[0].getAttribute('href')).toBe('#main');
    expect(textOf(body.children[0])).toBe('Skip to content');
    expect(all(doc, 'main').map((m) => m.id)).toEqual(['main']);
    expect(doc.querySelector('meta[name="robots"]').getAttribute('content')).toBe('noindex, nofollow');
  });

  it('never skips a heading level', () => {
    const levels = [...page.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    levels.forEach((level, i) => {
      if (i > 0) expect(level, `heading ${i}`).toBeLessThanOrEqual(levels[i - 1] + 1);
    });
  });

  it('has unique ids, and every aria reference and in-page link points at one', () => {
    const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const attr of ['aria-labelledby', 'aria-describedby']) {
      for (const el of all(doc, `[${attr}]`)) {
        for (const ref of el.getAttribute(attr).split(' ')) expect(ids, `${attr} ${ref}`).toContain(ref);
      }
    }
    for (const a of all(doc, 'a')) {
      const href = a.getAttribute('href');
      if (href.startsWith('#')) expect(ids, href).toContain(href.slice(1));
    }
  });

  it('names only landmarks and regions: no aria-labelledby on a plain <div>', () => {
    for (const el of all(doc, '[aria-labelledby]')) {
      const named = ['section', 'nav'].includes(el.localName) || el.hasAttribute('role');
      expect(named, el.localName).toBe(true);
    }
    for (const nav of all(doc, 'nav')) expect(nav.hasAttribute('aria-label') || nav.hasAttribute('aria-labelledby')).toBe(true);
  });

  it('labels every input, and describes the date fields by the hint', () => {
    for (const input of all(doc, 'input')) {
      expect(all(doc, `label[for="${input.id}"]`), input.id).toHaveLength(1);
      expect(input.getAttribute('aria-describedby').split(' ')).toContain('range-hint');
    }
  });

  it('gives every table a caption first, every th a scope, and every count cell class="num"', () => {
    for (const table of all(doc, 'table')) {
      expect(table.children[0].localName).toBe('caption');
      expect(textOf(table.children[0])).not.toBe('');
      const region = table.parentElement;
      expect([region.getAttribute('role'), region.getAttribute('tabindex'), region.getAttribute('aria-labelledby')]).toEqual([
        'region',
        '0',
        table.children[0].id,
      ]);
    }
    for (const th of all(doc, 'th')) expect(['col', 'row']).toContain(th.getAttribute('scope'));
    for (const td of all(doc, 'td')) {
      if (/^[\d,.]+$/.test(textOf(td))) expect(td.classList.contains('num'), textOf(td)).toBe(true);
    }
  });

  it('has no inline style, inline script or event-handler attribute', () => {
    expect(page).not.toMatch(/\sstyle\s*=|<style[\s>]/i);
    expect(page).not.toMatch(/<[^>]+\son[a-z]+\s*=/i);
    for (const script of all(doc, 'script')) expect(script.getAttribute('src')).toBeTruthy();
  });

  it('links the site icons, tokens.css and admin.css only, and a script only on the download page', () => {
    // The icons are the public pages' (SPEC §7.5); the admin CSP's img-src 'self' allows them.
    expect(all(doc, 'link').map((l) => [l.getAttribute('rel'), l.getAttribute('href'), l.getAttribute('type') ?? l.getAttribute('sizes')])).toEqual([
      ['icon', '/favicon.svg', 'image/svg+xml'],
      ['icon', '/favicon.ico', '32x32'],
      ['apple-touch-icon', '/apple-touch-icon.png', null],
      ['stylesheet', '/css/tokens.css', null],
      ['stylesheet', '/css/admin.css', null],
    ]);
    const scripts = all(doc, 'script').map((s) => [s.getAttribute('type'), s.getAttribute('src')]);
    expect(scripts).toEqual(name === 'download' ? [['module', '/js/admin-export.js']] : []);
  });

  it('links only within the staff area: no public page (whose events.js would count a staff page view)', () => {
    for (const a of all(doc, 'a')) {
      expect(a.getAttribute('href'), textOf(a)).toMatch(/^(#[a-z-]+|\/admin\/|\/admin\/export\?table=[a-z]+&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}|\/cdn-cgi\/access\/logout)$/);
    }
    expect(all(doc, 'a.admin-header__signout').map((a) => a.getAttribute('href'))).toEqual([SIGN_OUT_URL]);
  });

  it('shows the host, and says UTC wherever it shows a time', () => {
    expect(textOf(doc.querySelector('.admin-header__title'))).toBe('Staff area on example.com');
    expect(textOf(doc.querySelector('.admin-footer'))).toMatch(/^Page made 6 Nov 2026 at 13:30 UTC\./);
    expectUtcDates(doc);
  });

  it('never shows an events, ratings or feedback id, or a session_id', () => {
    expect(page).not.toMatch(/98765\d{4}/);
    expect(page).not.toContain(SESSION);
  });
});

// ---------------------------------------------------------------- the ok page

describe('the summary page with data', () => {
  const page = STATES.ok;
  const doc = parseHtml(page);
  const sectionIds = all(doc, 'section').map((s) => s.getAttribute('aria-labelledby'));

  it('titles the page with its range, and lists the sections it has, in order', () => {
    expect(doc.querySelector('title').textContent).toBe('Site data, 8 Oct to 6 Nov 2026 (UTC)');
    expect(sectionIds).toEqual(['downloads', 'views', 'ratings', 'searches', 'feedback', 'plays', 'handouts', 'worksheets']);
    expect(all(doc, 'section > h2').map(textOf).slice(-2)).toEqual(['Handouts opened', 'Worksheets opened']);
    expect(all(doc, '.admin-toc a').map((a) => a.getAttribute('href'))).toEqual(sectionIds.map((id) => `#${id}`));
    expect(doc.querySelector('.admin-toc').getAttribute('aria-label')).toBe('On this page');
  });

  it('fills the form with the range shown, between 2026-01-01 and today, and says it is the default', () => {
    const [from, to] = all(doc, 'input');
    expect([from.getAttribute('type'), from.getAttribute('value'), from.getAttribute('min'), from.getAttribute('max')]).toEqual(['date', '2026-10-08', '2026-01-01', '2026-11-06']);
    expect(to.getAttribute('value')).toBe('2026-11-06');
    const form = doc.querySelector('form');
    expect([form.getAttribute('method'), form.getAttribute('action'), form.hasAttribute('novalidate')]).toEqual(['get', '/admin/', true]);
    expect(textOf(doc.querySelector('legend'))).toBe('Date range');
    expect(textOf(doc.querySelector('#range-hint'))).toBe('UTC days, both included. Leave both empty for the last 30 days. Up to 92 days.');
    expect(textOf(doc.querySelector('.range-current'))).toBe(
      'Showing the last 30 days: 8 October 2026 to 6 November 2026 (UTC days, both included). Today is still under way, so its numbers can still grow.',
    );
    expect(doc.querySelector('.range-current a')).toBeNull();
  });

  it('offers a way back to the default range from any other', () => {
    const other = parseHtml(renderSummary(summaryView('from=2026-10-01&to=2026-10-31')));
    expect(textOf(other.querySelector('.range-current'))).toBe(
      'Showing 1 October 2026 to 31 October 2026 (UTC days, both included). Show the last 30 days',
    );
    expect(other.querySelector('.range-current a').getAttribute('href')).toBe('/admin/');
    expect(textOf(parseHtml(renderSummary(summaryView('from=2026-11-01&to=2026-11-01'))).querySelector('.range-current'))).toMatch(
      /^Showing 1 November 2026 \(UTC days/,
    );
  });

  it("links last month's four files, then this range's, ending yesterday, every one named as UTC", () => {
    const lists = all(doc, '.admin-section--downloads .admin-links');
    const links = (list) => list.querySelectorAll('a').map((a) => [textOf(a), a.getAttribute('href')]);
    expect(lists).toHaveLength(2);
    expect(all(doc, '.admin-section--downloads h3').map(textOf)).toEqual(['Last month: October 2026 (UTC)', 'This range']);
    expect(links(lists[0])).toEqual(
      DOWNLOAD_TABLES.map(({ table, name }) => [`${name}, October 2026 UTC (CSV)`, `/admin/export?table=${table}&from=2026-10-01&to=2026-10-31`]),
    );
    expect(links(lists[1])).toEqual(
      DOWNLOAD_TABLES.map(({ table, name }) => [`${name}, 8 Oct to 5 Nov 2026 UTC (CSV)`, `/admin/export?table=${table}&from=2026-10-08&to=2026-11-05`]),
    );
    expect(page).toContain('href="/admin/export?table=ratings&amp;from=2026-10-01&amp;to=2026-10-31"');
    expect(all(doc, '.admin-section--downloads .hint').map(textOf)).toEqual([
      "A UTC month starts at 10 am on the 1st in Melbourne (11 am during daylight saving), so each month's files are ready from that time on the 1st of the next month. Until then, these links show the month before.",
      'Downloads cover complete UTC days only, so these end yesterday, 5 November 2026.',
    ]);
  });

  it('offers every table the export serves, and no other', () => {
    expect(DOWNLOAD_TABLES.map(({ table }) => table).sort()).toEqual([...EXPORT_TABLES.keys()].sort());
  });

  it('describes the files: UTF-8, UTC, the formula guard with tab, line breaks and the full-width forms, and no event row numbers', () => {
    const text = textOf(doc.querySelector('.admin-section--downloads'));
    expect(text).toContain('Times in the files are UTC and rounded down to the hour.');
    expect(text).toContain("A text cell that starts with =, +, -, @, ', a tab or a line break (or the full-width ＝, ＋, －, ＠) gets an extra ' in front");
    expect(text).toContain('Usage events have no row number, on purpose.');
    expect(text).toContain('Each download covers at most 31 days and 100,000 rows.');
    expect(text).toContain('which needs JavaScript');
  });

  it('lists every tracked page, by views, with the untracked left out and a page no longer on the site marked', () => {
    const rows = all(doc, '[aria-labelledby="views-caption"] tbody tr').map((tr) => tr.querySelectorAll('th, td').map(textOf));
    expect(rows).toEqual([
      ['Pain pain', '1,204', '987'],
      ['old-slug No longer on the site', '3', '3'],
      ['Getting urgent help urgent-help', '0', '0'],
      ['Start here start', '0', '0'],
    ]);
    expect(all(doc, '[aria-labelledby="views-caption"] tfoot th, [aria-labelledby="views-caption"] tfoot td').map(textOf)).toEqual([
      'All tracked pages',
      '1,207',
      '989',
    ]);
  });

  it('gives ratings per video, per page and per page and video, with 1-dp means', () => {
    const table = (id) => all(doc, `[aria-labelledby="${id}"] tbody tr`).map((tr) => tr.querySelectorAll('th, td').map(textOf));
    expect(table('ratings-video-caption')).toEqual([
      ['pain-about', '3', '3.7'],
      ['how-sleep-works', '2', '4.5'],
      ['settling-your-body', '1', '2.0'],
    ]);
    expect(table('ratings-page-caption')).toEqual([
      ['Pain pain', '4', '3.3'],
      ['Start here start', '2', '4.5'],
    ]);
    expect(table('ratings-page-video-caption')).toEqual([
      ['Pain pain', 'pain-about', '3', '3.7'],
      ['Pain pain', 'settling-your-body', '1', '2.0'],
      ['Start here start', 'how-sleep-works', '2', '4.5'],
    ]);
    expect(textOf(all(doc, 'section[aria-labelledby="ratings"] p')[1])).toBe(
      '6 ratings in this range. Means are to one decimal place.',
    );
  });

  it('counts searches, and lists the zero-result ones as row headers in dir="auto"', () => {
    const section = doc.querySelector('section[aria-labelledby="searches"]');
    expect(textOf(section.querySelectorAll('p')[0])).toBe('1,234 searches in this range, 56 of which found nothing.');
    expect(section.querySelectorAll('tbody th').map((th) => [textOf(th), th.getAttribute('dir'), th.getAttribute('scope')])).toEqual([
      ['insomnia pills', 'auto', 'row'],
      ['melatonin', 'auto', 'row'],
    ]);
    expect(textOf(section.querySelector('caption'))).toBe('Searches with no results');
  });

  it('shows feedback newest first, by the page\'s current title and its id (the id alone for a page no longer on the site), then its video\'s id if it has one, with the hour in UTC', () => {
    const items = all(doc, '.feedback-item');
    expect(items.map((li) => textOf(li.querySelector('h3')))).toEqual([
      'Pain (pain), 1 Nov 2026, 03:00 to 04:00 UTC',
      'Start here (start), video how-sleep-works, 20 Oct 2026, 22:00 to 23:00 UTC',
      'old-slug (no longer on the site), 19 Oct 2026, 08:00 to 09:00 UTC',
    ]);
    // The video by its id, as every video on this page is; none for a message without one.
    expect(items.map((li) => li.querySelector('.feedback-item__video') && textOf(li.querySelector('.feedback-item__video')))).toEqual([null, 'how-sleep-works', null]);
    expect(items[1].querySelector('.feedback-item__video').className).toBe('feedback-item__video video-id');
    expect(summaryModel(sampleResults(), INDEX).feedback.recent.map((r) => r.video)).toEqual([null, 'how-sleep-works', null]);
    expect(items.map((li) => textOf(li.querySelector('.feedback-item__page')))).toEqual(['Pain', 'Start here', 'old-slug']);
    expect(items.map((li) => li.querySelector('.feedback-item__page-id') && textOf(li.querySelector('.feedback-item__page-id')))).toEqual(['(pain)', '(start)', null]);
    expect(items[0].querySelector('time').getAttribute('datetime')).toBe('2026-11-01T03:00:00.000Z');
    expect(textOf(doc.querySelector('section[aria-labelledby="feedback"] p'))).toMatch(
      /^All 3 messages in this range, newest first\. Times are UTC, rounded down to the hour\. Messages are shown as stored: /,
    );
  });

  it('shows a page whose title in pages.json is empty by its id once', () => {
    const untitled = pageIndex({ ...PAGES, blank: { url: '/blank/', title: '', page_view: false, videos: [] } });
    const results = { ...emptyResults(), feedbackCount: [{ n: 1 }], recentFeedback: [{ ts: '2026-11-01T03:00:00.000Z', page: 'blank', message: 'x' }] };
    const view = summaryView('', { results });
    const page = parseHtml(renderSummary({ ...view, summary: summaryModel(results, untitled) }));
    expect(textOf(page.querySelector('.feedback-item h3'))).toBe('blank, 1 Nov 2026, 03:00 to 04:00 UTC');
  });

  it('keeps a message byte for byte inside its blockquote, with no added whitespace', () => {
    expect(page).toContain('<blockquote class="feedback-item__message" dir="auto">a\n\n\tb</blockquote>');
  });

  it('gives video and audio-only plays their own tables, whose buckets add up', () => {
    for (const [id, expected] of [
      ['plays-video-caption', [['pain-about', '5', '1', '1', '1', '1', '1']]],
      ['plays-audio-caption', [['how-sleep-works', '1', '0', '0', '0', '0', '1']]],
    ]) {
      const rows = all(doc, `[aria-labelledby="${id}"] tbody tr`).map((tr) => tr.querySelectorAll('th, td').map(textOf));
      expect(rows).toEqual(expected);
      for (const [, plays, ...buckets] of rows) expect(buckets.reduce((sum, n) => sum + Number(n), 0)).toBe(Number(plays));
    }
    expect(all(doc, '[aria-labelledby="plays-video-caption"] thead th').map(textOf)).toEqual(['Video', 'Plays', 'Under 25%', '25%', '50%', '75%', '100%']);
  });

  it('gives handout clicks and visits', () => {
    expect(all(doc, '[aria-labelledby="handouts-caption"] tbody tr').map((tr) => tr.querySelectorAll('th, td').map(textOf))).toEqual([
      ['pain-about', '4', '3'],
    ]);
  });

  // "Worksheets opened" (SPEC §14.4), in the handouts table's style: the
  // page as the row header, then the worksheet by its id, clicks and visits.
  it('gives worksheet clicks and visits per page and worksheet, by clicks, then page and worksheet id, in the handouts table\'s style', () => {
    const region = doc.querySelector('[aria-labelledby="worksheets-caption"]');
    expect([region.getAttribute('class'), region.getAttribute('role'), region.getAttribute('tabindex')]).toEqual(['table-scroll', 'region', '0']);
    expect(textOf(region.querySelector('caption'))).toBe('Worksheet clicks per page and worksheet');
    expect(region.querySelectorAll('thead th').map((th) => [textOf(th), th.getAttribute('scope'), th.getAttribute('class')])).toEqual([
      ['Page', 'col', null],
      ['Worksheet', 'col', null],
      ['Clicks', 'col', 'num'],
      ['Visits', 'col', 'num'],
    ]);
    expect(region.querySelectorAll('tbody tr').map((tr) => tr.querySelectorAll('th, td').map(textOf))).toEqual([
      ['Pain pain', 'settling-worksheet-1', '1,234', '1,001'],
      ['old-slug No longer on the site', 'settling-worksheet-1', '5', '4'],
      ['Pain pain', 'settling-worksheet-2', '2', '1'],
      ['Start here start', 'settling-worksheet-2', '2', '2'],
    ]);
    // Each row: the page as its header, the id in its own cell, two numbers.
    for (const tr of region.querySelectorAll('tbody tr')) {
      expect(tr.children.map((cell) => [cell.localName, cell.getAttribute('class'), cell.getAttribute('scope')])).toEqual([
        ['th', null, 'row'],
        ['td', 'worksheet-id', null],
        ['td', 'num', null],
        ['td', 'num', null],
      ]);
    }
    expect(region.querySelector('tfoot')).toBeNull();
    const section = doc.querySelector('section[aria-labelledby="worksheets"]');
    expect(textOf(section.querySelector('h2'))).toBe('Worksheets opened');
    expect(textOf(section.querySelector('p'))).toBe(
      'Each click on a worksheet link in an open solution card, whether the browser opened the worksheet or saved it, and the number of visits that clicked, for each page and worksheet. A worksheet goes with its video, so it can be opened from every page where that video is a solution. Worksheets are shown by their worksheet_id.',
    );
    // The handouts table has the same shape: a caption, a scroll region, clicks and visits.
    expect(all(doc, '[aria-labelledby="handouts-caption"] thead th').map(textOf).slice(-2)).toEqual(['Clicks', 'Visits']);
    expect(summaryModel(sampleResults(), INDEX).worksheets).toEqual([
      { page: 'pain', title: 'Pain', known: true, worksheet: 'settling-worksheet-1', clicks: 1234, visits: 1001 },
      { page: 'old-slug', title: 'old-slug', known: false, worksheet: 'settling-worksheet-1', clicks: 5, visits: 4 },
      { page: 'pain', title: 'Pain', known: true, worksheet: 'settling-worksheet-2', clicks: 2, visits: 1 },
      { page: 'start', title: 'Start here', known: true, worksheet: 'settling-worksheet-2', clicks: 2, visits: 2 },
    ]);
  });

  it('reads odd worksheet rows as text and numbers: a missing count is 0, and results without the statement give no rows', () => {
    const { worksheets: none } = summaryModel({ ...emptyResults(), worksheets: undefined }, INDEX);
    expect(none).toEqual([]);
    const { worksheets: odd } = summaryModel({ ...emptyResults(), worksheets: [{ page: 7, worksheet: 12, clicks: '3', visits: null }] }, INDEX);
    expect(odd).toEqual([{ page: '7', title: '7', known: false, worksheet: '12', clicks: 3, visits: 0 }]);
  });

  it('shows the rows read, and a note once a load reads more than a tenth of the daily allowance', () => {
    expect(textOf(doc.querySelector('.admin-footer'))).toContain(
      'This page read 12,345 rows from the database. The free plan allows 5 million rows read a day for the whole account',
    );
    expect(page).not.toContain('admin-footer__note');
    expect(ROWS_READ_NOTE).toBe(500_000);
    const heavy = parseHtml(renderSummary(summaryView('', { rowsRead: ROWS_READ_NOTE + 1 })));
    expect(textOf(heavy.querySelector('.admin-footer__note'))).toMatch(/^That is more than a tenth of a day's allowance\./);
    const unknown = renderSummary(summaryView('', { rowsRead: null }));
    expect(unknown).not.toMatch(/rows from the database/);
  });
});

describe('the summary page, more ranges and lists', () => {
  it('splits a range over 31 days at each month end, and says why', () => {
    const doc = parseHtml(renderSummary(summaryView('from=2026-08-10&to=2026-10-20')));
    expect(all(doc, '.admin-section--downloads h4').map(textOf)).toEqual([
      '10 Aug to 31 Aug 2026 (UTC days)',
      '1 Sep to 30 Sep 2026 (UTC days)',
      '1 Oct to 20 Oct 2026 (UTC days)',
    ]);
    expect(all(doc, '.admin-section--downloads .admin-links')).toHaveLength(4);
    expect(all(doc, '.admin-section--downloads .admin-links')[1].querySelectorAll('a').map(textOf)).toEqual(
      DOWNLOAD_TABLES.map(({ name }) => `${name}, 10 Aug to 31 Aug 2026 UTC (CSV)`),
    );
    expect(textOf(doc.querySelector('.admin-section--downloads'))).toContain('A download covers at most 31 days, so this range comes a month at a time.');
    // Only last month's note: the range ends before today, so no "end yesterday" hint.
    expect(all(doc, '.admin-section--downloads .hint').map(textOf)).toEqual([expect.stringMatching(/^A UTC month starts at 10 am/)]);
  });

  it('says UTC on every title, heading and link that names a month, in a range split into months too', () => {
    const split = parseHtml(renderSummary(summaryView('from=2026-08-01&to=2026-10-31')));
    expect(all(split, '.admin-section--downloads h4').map(textOf)).toEqual(['1 Aug to 31 Aug 2026 (UTC days)', '1 Sep to 30 Sep 2026 (UTC days)', '1 Oct to 31 Oct 2026 (UTC days)']);
    // The title; last month's heading and 4 links; 3 month headings with 4 links each; 3 feedback headings.
    expect(expectUtcDates(split)).toBe(1 + 5 + 3 * 5 + 3);
    // The title; last month's heading and 4 links; this range's 4 links; 3 feedback headings.
    expect(expectUtcDates(parseHtml(STATES.ok))).toBe(1 + 5 + 4 + 3);
  });

  it('offers no download of a range that starts today, and doesn\'t repeat last month', () => {
    const today = parseHtml(renderSummary(summaryView('from=2026-11-06&to=2026-11-06')));
    expect(all(today, '.admin-section--downloads .admin-links')).toHaveLength(1);
    expect(textOf(today.querySelector('.admin-section--downloads'))).toContain(
      'Downloads cover complete UTC days only, so there is nothing to download for a range that starts today.',
    );
    const october = parseHtml(renderSummary(summaryView('from=2026-10-01&to=2026-10-31')));
    expect(all(october, '.admin-section--downloads .admin-links')).toHaveLength(1);
    expect(textOf(october.querySelector('.admin-section--downloads'))).toContain('This range is last month: use the links above.');
  });

  it('says how many of how many messages it shows, and points to the downloads only when some are left out', () => {
    const message = (i) => ({ ts: '2026-11-01T03:00:00.000Z', page: 'pain', message: `m${i}` });
    const lead = (recent, total) => {
      const results = { ...emptyResults(), feedbackCount: [{ n: total }], recentFeedback: Array.from({ length: recent }, (_, i) => message(i)) };
      const doc = parseHtml(renderSummary(summaryView('', { results })));
      const section = doc.querySelector('section[aria-labelledby="feedback"]');
      return [textOf(section.querySelector('p')).replace(/ Times are UTC.*$/, ''), section.querySelector('a[href="#downloads"]') !== null];
    };
    expect(lead(20, 57)).toEqual(['The 20 most recent of 57 messages in this range, newest first.', true]);
    expect(lead(20, 20)).toEqual(['All 20 messages in this range, newest first.', false]);
    expect(lead(1, 1)).toEqual(['The one message in this range.', false]);
  });

  it('names a full top-20 list of searches as such', () => {
    const top = Array.from({ length: 20 }, (_, i) => ({ q: `q${String(i).padStart(2, '0')}`, n: 1 }));
    const results = { ...emptyResults(), searchTotals: [{ searches: 40, zero: 30 }], zeroSearches: top };
    const doc = parseHtml(renderSummary(summaryView('', { results })));
    expect(textOf(doc.querySelector('#searches-caption'))).toBe('The 20 most frequent searches with no results');
    expect(all(doc, '[aria-labelledby="searches-caption"] tbody tr')).toHaveLength(20);
  });

  it('shows each empty state in place of its table', () => {
    const doc = parseHtml(STATES['ok, empty']);
    expect(all(doc, 'table')).toEqual([]);
    expect(all(doc, '.empty').map(textOf)).toEqual([
      'No page views in this range.',
      'No ratings in this range.',
      'No searches in this range.',
      'No feedback in this range.',
      'No video plays in this range.',
      'No audio-only plays in this range.',
      'No handouts opened in this range.',
      'No worksheets opened in this range.',
    ]);
    // The section keeps its heading and its line of explanation.
    const worksheets = doc.querySelector('section[aria-labelledby="worksheets"]');
    expect(textOf(worksheets.querySelector('h2'))).toBe('Worksheets opened');
    expect(textOf(worksheets.querySelector('p'))).toMatch(/^Each click on a worksheet link in an open solution card, /);
    const searched = { ...emptyResults(), searchTotals: [{ searches: 3, zero: 0 }] };
    expect(textOf(parseHtml(renderSummary(summaryView('', { results: searched }))).querySelector('section[aria-labelledby="searches"]'))).toBe(
      'Searches that found nothing 3 searches in this range, 0 of which found nothing. Every search in this range found something.',
    );
  });
});

// ---------------------------------------------------------------- escaping

describe('escaping', () => {
  const PAYLOADS = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "' onfocus='x", '</blockquote><b>x', '&lt;b&gt; & AT&T'];

  function seeded(texts) {
    const results = {
      ...emptyResults(),
      views: texts.map((text, i) => ({ page: `${text}${i}`, views: 1, visits: 1 })),
      viewTotals: [{ views: texts.length, visits: texts.length }],
      ratings: texts.map((text, i) => ({ page: 'pain', video: `${text}${i}`, n: 1, total: 4 })),
      searchTotals: [{ searches: texts.length, zero: texts.length }],
      zeroSearches: texts.map((text) => ({ q: text, n: 1 })),
      feedbackCount: [{ n: texts.length }],
      // A page no longer on the site shows by its stored id, so the id is
      // hostile too, and so is a stored video, shown as it is.
      recentFeedback: texts.map((text) => ({ ts: '2026-11-01T03:00:00.000Z', page: text, video: text, message: text })),
      plays: texts.map((text) => ({ type: 'video_play', media: text, plays: 1, f0: 1, f25: 0, f50: 0, f75: 0, f100: 0 })),
      handouts: texts.map((text) => ({ media: text, clicks: 1, visits: 1 })),
      // A hostile page id and worksheet id, as rows written straight to the database could hold.
      worksheets: texts.map((text) => ({ page: text, worksheet: text, clicks: 1, visits: 1 })),
    };
    return renderSummary(summaryView('', { results, host: texts[0] }));
  }

  const dirty = seeded(PAYLOADS);
  const clean = seeded(PAYLOADS.map((_, i) => `plain text ${i}`));

  it('renders feedback, page ids, search text, video ids, worksheet ids and the host as text, never as markup', () => {
    expect(dirty).not.toMatch(/<script|<img|<b>/i);
    for (const tag of dirty.match(/<[^>]*>/g)) expect(tag).not.toMatch(/\son\w+\s*=/i);
    expect(dirty).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(dirty).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
    expect(dirty).toContain('&#39; onfocus=&#39;x');
    expect(dirty).toContain('&amp;lt;b&amp;gt; &amp; AT&amp;T');
    const tags = (html) => (html.match(/<[a-z!/]/gi) ?? []).length;
    expect(tags(dirty)).toBe(tags(clean));
  });

  it('gives the stored text back exactly when the HTML is read', () => {
    const doc = parseHtml(dirty);
    expect(all(doc, '.feedback-item__message').map((b) => b.textContent)).toEqual(PAYLOADS);
    expect(all(doc, '.feedback-item__video').map((span) => span.textContent)).toEqual(PAYLOADS);
    expect(all(doc, '.search-text').map((th) => th.textContent)).toEqual(PAYLOADS);
    // By clicks (all 1), then the page's title, which here is the payload itself.
    expect(all(doc, '.worksheet-id').map((td) => td.textContent).sort()).toEqual([...PAYLOADS].sort());
    expect(all(doc, '[aria-labelledby="worksheets-caption"] .page-name').map((span) => span.textContent).sort()).toEqual([...PAYLOADS].sort());
  });

  it('shows a stored time that isn\'t toISOString() output as text, with no <time>', () => {
    const results = { ...emptyResults(), feedbackCount: [{ n: 1 }], recentFeedback: [{ ts: '2026-11-01 03:00"><b>', page: 'pain', message: 'x' }] };
    const page = renderSummary(summaryView('', { results }));
    expect(page).not.toContain('<time');
    expect(page).toContain('2026-11-01 03:00&quot;&gt;&lt;b&gt;');
  });

  it('shows a stored time with the right digits that names no real time as text too, and still renders the page', () => {
    // A hand-written row: TS_RE checks only where the digits are. Month 13
    // made the whole summary a 500; 31 November would have shown as 1 December.
    for (const ts of ['2026-13-45T99:99:99.000Z', '2026-11-07T23:60:00.000Z', '2026-11-31T10:00:00.000Z', '2026-11-07T24:00:00.000Z']) {
      const results = { ...emptyResults(), feedbackCount: [{ n: 1 }], recentFeedback: [{ ts, page: 'pain', message: 'x' }] };
      const page = renderSummary(summaryView('', { results }));
      expect(page, ts).not.toContain('<time');
      expect(page, ts).toContain(`, ${ts}</h3>`);
    }
  });

  it('shows control characters other than tab and line breaks as U+FFFD', () => {
    const results = { ...emptyResults(), searchTotals: [{ searches: 1, zero: 1 }], zeroSearches: [{ q: 'a\u0000b\u001bc\u0085d', n: 1 }] };
    expect(renderSummary(summaryView('', { results }))).toContain('>a\uFFFDb\uFFFDc\uFFFDd</th>');
  });
});

// ---------------------------------------------------------------- errors

describe('the invalid-range page', () => {
  const page = STATES.invalid;
  const doc = parseHtml(page);

  it('says Error in the title, puts the error summary under the H1, and shows no data, contents or downloads', () => {
    expect(doc.querySelector('title').textContent).toBe('Error: Site data');
    expect(page.indexOf('class="error-summary"')).toBeGreaterThan(page.indexOf('<h1>'));
    expect(page.indexOf('class="error-summary"')).toBeLessThan(page.indexOf('<form'));
    const summary = doc.querySelector('.error-summary');
    expect(summary.localName).toBe('section');
    expect(textOf(summary.querySelector('h2'))).toBe('There is a problem');
    expect(all(doc, 'table, .admin-toc, .admin-section, .range-current')).toEqual([]);
    expect(page).not.toMatch(/rows from the database/);
  });

  it('links each error to its field, which is marked invalid and described by the error', () => {
    expect(all(doc, '.error-summary a').map((a) => [a.getAttribute('href'), textOf(a)])).toEqual([
      ['#from', 'The start date must be on or before the end date'],
    ]);
    const from = doc.getElementById('from');
    expect([from.getAttribute('aria-invalid'), from.getAttribute('aria-describedby')]).toEqual(['true', 'from-error range-hint']);
    expect(textOf(doc.getElementById('from-error'))).toBe('Error: The start date must be on or before the end date');
    expect(doc.querySelector('#from-error .visually-hidden').textContent).toBe('Error: ');
    const to = doc.getElementById('to');
    expect([to.hasAttribute('aria-invalid'), to.getAttribute('aria-describedby')]).toEqual([false, 'range-hint']);
    // The dates that passed are kept in the form.
    expect([from.getAttribute('value'), to.getAttribute('value')]).toEqual(['2026-11-05', '2026-11-01']);
  });

  it.each([
    ['from=2026-02-30', [['from', 'Enter the start date as a real date from 1 January 2026 on, for example 2026-10-01']]],
    ['from=x&to=2025-12-31', [
      ['from', 'Enter the start date as a real date from 1 January 2026 on, for example 2026-10-01'],
      ['to', 'Enter the end date as a real date from 1 January 2026 on, for example 2026-10-31'],
    ]],
    ['to=2026-11-07', [['to', "The end date can't be after today, 6 November 2026 (UTC)"]]],
    ['from=2026-08-01&to=2026-11-01', [['from', 'Choose a range of 92 days or fewer. For longer periods, download the data a month at a time']]],
  ])('%s: puts each error on its field, with its own copy', (query, expected) => {
    const errorDoc = parseHtml(renderSummary(summaryView(query)));
    expect(all(errorDoc, '.error-summary a').map((a) => [a.getAttribute('href').slice(1), textOf(a)])).toEqual(expected);
    for (const [field, text] of expected) {
      expect(textOf(errorDoc.getElementById(`${field}-error`))).toBe(`Error: ${text}`);
      expect(errorDoc.getElementById(field).getAttribute('aria-invalid')).toBe('true');
    }
  });

  it('wraps each summary link\'s message in one element, so the inline-flex link lays it out as one line of text', () => {
    // A link is inline-flex (a 44px target): bare text before the example
    // date's <span class="nowrap"> would be a second flex item beside it.
    const errorDoc = parseHtml(renderSummary(summaryView('from=x&to=2025-12-31')));
    const links = all(errorDoc, '.error-summary li > a');
    expect(links).toHaveLength(2);
    for (const a of links) {
      expect(a.childNodes).toHaveLength(1);
      const [wrapper] = a.childNodes;
      expect(wrapper.localName).toBe('span');
      expect(textOf(wrapper)).toBe(textOf(a));
      expect(wrapper.querySelector('.nowrap')).not.toBeNull();
    }
  });

  it('never echoes a raw date parameter', () => {
    const raw = renderSummary(summaryView('from=%22%3E%3Cb%3Ezq&to=2026-11-01'));
    expect(raw).not.toContain('zq');
    expect(raw).not.toContain('<b>');
    expect(parseHtml(raw).getElementById('from').getAttribute('value')).toBe('');
  });
});

describe('the database states', () => {
  it.each([
    ['no-tables', "The database isn't set up here yet", 'migrations'],
    ['error', "Couldn't read the database", 'until 00:00 UTC'],
  ])('%s: its message in a labelled section under the H1, then the form, and no data', (state, heading, words) => {
    const page = STATES[state];
    const doc = parseHtml(page);
    expect(doc.querySelector('title').textContent).toBe('Error: Site data');
    const alert = doc.querySelector('.admin-alert');
    expect([alert.localName, alert.getAttribute('aria-labelledby')]).toEqual(['section', 'alert-title']);
    expect(textOf(alert.querySelector('h2'))).toBe(heading);
    expect(textOf(alert)).toContain(words);
    expect(page.indexOf('admin-alert')).toBeLessThan(page.indexOf('<form'));
    expect(all(doc, 'form')).toHaveLength(1);
    expect(all(doc, 'table, .admin-toc, .admin-section, .error-summary')).toEqual([]);
  });
});

describe('the collection-off notice', () => {
  it('shows on every page while collection is off, and only then', () => {
    const off = (view) => renderSummary({ ...view, collectionOn: false });
    for (const view of [summaryView(), summaryView('from=x'), { ...summaryView(), state: 'error' }]) {
      expect(off(view)).toContain('Data collection is off at this address.');
      expect(renderSummary(view)).not.toContain('Data collection is off');
    }
    expect(renderDownloadPage(downloadView({ collectionOn: false }))).toContain('Data collection is off at this address.');
    expect(STATES.download).not.toContain('Data collection is off');
  });
});

// ---------------------------------------------------------------- the download page

describe('the download page', () => {
  const doc = parseHtml(STATES.download);

  it('says what it will fetch, in how many parts, and the file it saves', () => {
    expect(doc.querySelector('title').textContent).toBe('Download usage events, 1 Oct to 31 Oct 2026 (UTC)');
    expect(textOf(doc.querySelector('h1'))).toBe('Download usage events');
    expect(textOf(all(doc, 'main > p')[0])).toBe(
      "1 October 2026 to 31 October 2026 (UTC days) holds 4,321 rows of usage events. One request on Cloudflare's free plan can send 2,000, so the button below fetches them in 3 parts and saves them as one CSV file, sleepsteps-events-2026-10-01-to-2026-10-31.csv.",
    );
  });

  it('says plainly, without JavaScript, that this download needs it, and ships the button hidden', () => {
    const nojs = doc.querySelector('[data-export-nojs]');
    expect(nojs.hidden).toBe(false);
    expect(textOf(nojs)).toMatch(/^This download needs JavaScript\./);
    expect(textOf(nojs)).not.toMatch(/shorter range/);
    const button = doc.querySelector('button[data-export]');
    expect([button.hidden, button.getAttribute('type'), textOf(button)]).toEqual([true, 'button', 'Download usage events (CSV)']);
    expect(['table', 'from', 'to', 'filename'].map((k) => button.dataset[k])).toEqual([
      'events',
      '2026-10-01',
      '2026-10-31',
      'sleepsteps-events-2026-10-01-to-2026-10-31.csv',
    ]);
  });

  it('has a status line and a labelled progress bar for the script', () => {
    expect(doc.querySelector('[data-export-status]').getAttribute('role')).toBe('status');
    expect(doc.querySelector('[data-export-progress]').hidden).toBe(true);
    const bar = doc.querySelector('progress');
    expect([bar.id, bar.getAttribute('max'), bar.getAttribute('value')]).toEqual(['export-progress-bar', '4321', '0']);
    expect(all(doc, 'label[for="export-progress-bar"]')).toHaveLength(1);
    expect(all(doc, 'form')).toEqual([]);
  });

  it('names each table in its own words', () => {
    for (const [table, words] of [['ratings', 'ratings'], ['feedback', 'feedback'], ['searches', 'searches']]) {
      const page = parseHtml(renderDownloadPage(downloadView({ table, filename: `sleepsteps-${table}-2026-10-01-to-2026-10-31.csv`, rows: 1, pageRows: 1 })));
      expect(textOf(page.querySelector('h1'))).toBe(`Download ${words}`);
      expect(textOf(all(page, 'main > p')[0])).toContain('holds 1 row of');
      expect(textOf(all(page, 'main > p')[0])).toContain('in 1 part and');
    }
  });
});

// ---------------------------------------------------------------- the answers

/**
 * A stand-in D1: the summary batch answers `results` (by statement), the
 * sqlite_master check `tables`, an export count `count`, and a part `rows`.
 */
function fakeDb({ results = sampleResults(), rowsRead = 7, failBatch = false, tables = 3, count = 1, rows = [] } = {}) {
  const bound = (sql) => ({
    sql,
    first: async () => (sql === TABLES_PRESENT_SQL ? { n: tables } : { n: count }),
    raw: async () => rows,
  });
  return {
    prepare: (sql) => ({ ...bound(sql), bind: () => bound(sql) }),
    batch: async (statements) => {
      if (failBatch) throw new Error('D1_ERROR: x');
      return statements.map(({ sql }) => ({ results: results[SUMMARY_QUERIES.find(([, s]) => s === sql)[0]], meta: { rows_read: rowsRead } }));
    },
  };
}

describe('the answers (worker/routes/admin.js)', () => {
  const TEAM = 'test-team.cloudflareaccess.com';
  const PASS = { verify: async () => ({ ok: true }) };
  const admin = createAdmin({ index: INDEX, access: PASS, now: () => NOW });
  const env = (db = fakeDb()) => ({ DB: db, API_HOSTS: 'example.com', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: 'a'.repeat(64), DATA_COLLECTION: 'on' });
  const answer = (path, db, method = 'GET') => {
    const url = new URL(`https://example.com${path}`);
    return admin.handle(new Request(url, { method }), env(db), url);
  };
  const CSP = `default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self' https://${TEAM}; base-uri 'none'; frame-ancestors 'none'`;
  const SCRIPT_CSP = `default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self'; form-action 'self' https://${TEAM}; base-uri 'none'; frame-ancestors 'none'`;

  it.each([
    ['the summary', '/admin/', undefined, 200, 'text/html; charset=utf-8', CSP, 'Site data, 8 Oct to 6 Nov 2026 (UTC)'],
    ['an invalid range', '/admin/?from=x', undefined, 400, 'text/html; charset=utf-8', CSP, 'Error: Site data'],
    ["a database that can't be read", '/admin/', fakeDb({ failBatch: true }), 500, 'text/html; charset=utf-8', CSP, 'Error: Site data'],
    ['a database with no tables', '/admin/', fakeDb({ failBatch: true, tables: 0 }), 500, 'text/html; charset=utf-8', CSP, 'Error: Site data'],
    ['the download page', '/admin/export?table=events&from=2026-10-01&to=2026-10-31', fakeDb({ count: 4321 }), 200, 'text/html; charset=utf-8', SCRIPT_CSP, 'Download usage events, 1 Oct to 31 Oct 2026 (UTC)'],
  ])('%s: status, type, CSP and the admin headers', async (_, path, db, status, type, csp, title) => {
    const res = await answer(path, db);
    expect(res.status).toBe(status);
    expect(res.headers.get('Content-Type')).toBe(type);
    expect(res.headers.get('Content-Security-Policy')).toBe(csp);
    for (const [name, value] of Object.entries(ADMIN_HEADERS)) expect(res.headers.get(name), name).toBe(value);
    expect(res.headers.get('Set-Cookie')).toBeNull();
    const body = await res.text();
    expect(body.match(/<title>([^<]*)<\/title>/)[1]).toBe(title);
    expect(/<script/.test(body)).toBe(csp === SCRIPT_CSP);
  });

  it('sends a range that fits in one part as one CSV file, under the script-free CSP', async () => {
    const res = await answer('/admin/export?table=ratings&from=2026-10-01&to=2026-10-31', fakeDb({ count: 1, rows: [[7, '2026-10-05T10:00:00.123Z', 'pain', 'pain-about', 4]] }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8; header=present');
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="sleepsteps-ratings-2026-10-01-to-2026-10-31.csv"');
    expect(res.headers.get('Content-Security-Policy')).toBe(CSP);
  });

  it('answers HEAD on the summary with the GET headers and no body', async () => {
    const res = await answer('/admin/', undefined, 'HEAD');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(await res.text()).toBe('');
  });

  it('shows the rows the batch read', async () => {
    const body = await (await answer('/admin/', fakeDb({ rowsRead: 1500 }))).text();
    // Ten statements at 1,500 rows each: the worksheets one is in the same batch.
    expect(SUMMARY_QUERIES.map(([name]) => name)).toEqual(['views', 'viewTotals', 'ratings', 'searchTotals', 'zeroSearches', 'feedbackCount', 'recentFeedback', 'plays', 'handouts', 'worksheets']);
    expect(body).toContain(`This page read ${thousands(10 * 1500)} rows from the database.`);
  });
});
