// worker/generated/pages.json (SPEC §8.3, §14.1): pagesIndex() and
// writeIfChanged() in scripts/build-data.js, the file the tests' build wrote
// (test/global-setup.js), and the HTML it is read from: the <body>
// data-page-view marker and the attributes that name a page's videos.
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { pagesIndex, writeIfChanged } from '../../scripts/build-data.js';
import { parseFrontMatter, validateContent } from '../../scripts/validate-content.js';
import { attr, readHtmlPages, tags } from './helpers.js';

const site = inject('builtSite');
const { model } = validateContent(process.cwd());
const pages = JSON.parse(readFileSync('worker/generated/pages.json', 'utf8'));
const built = readHtmlPages(site);
// With every feature on, whatever site.config.json says, so the ratings
// widget's data-rating and a video's "Feedback" button's data-feedback-video
// are always there to check (SPEC §11).
const builtOn = readHtmlPages(inject('builtSiteOn'));
const problemIds = [...model.problems.keys()];
const TRACKED = [...problemIds, 'start', 'urgent-help'].sort();
// No `problems`: the Sleep problems page is part of Home since 2026-11-13
// (SPEC §7, §22), so that page_id no longer exists.
const UNTRACKED = ['about', 'contact', 'help', 'home', 'privacy', 'search'];

/** A rendered page as Eleventy passes it to eleventy.after. */
const result = (url, body, head = '<title>T</title>', extra = '') => ({
  url,
  outputPath: `./dist${url}index.html`,
  content: `<!doctype html><html><head>${head}</head>${body}${extra}</body></html>`,
});

describe('pagesIndex()', () => {
  it('lists each page with a data-page-id: url, title, page_view and its videos', () => {
    const json = pagesIndex([
      result(
        '/problems/pain/',
        '<body class="page--wide" data-page-id="pain" data-page-view>',
        '<title>Can&#39;t sleep &amp; pain</title>',
        '<div data-video="b-video" data-title="B"></div><div data-rating="d-video"></div>' +
          '<a data-handout="a-video" href="/media/pdf/a.pdf"></a><audio data-media="c-video"></audio>' +
          // Not an attribute that names a video any more (no transcripts, SPEC §9.3).
          '<details data-transcript="e-video"></details>',
      ),
      result('/about/', '<body data-page-id="about">', '<title>About us</title>'),
    ]);
    expect(json).toEqual({
      about: { url: '/about/', title: 'About us', page_view: false, videos: [] },
      pain: { url: '/problems/pain/', title: "Can't sleep & pain", page_view: true, videos: ['a-video', 'b-video', 'c-video', 'd-video'] },
    });
    expect(Object.keys(json)).toEqual(['about', 'pain']);
  });

  it('skips pages without a data-page-id (the 404 page) and files that are not HTML', () => {
    const json = pagesIndex([
      result('/', '<body data-page-id="home">'),
      { url: '/404.html', outputPath: './dist/404.html', content: '<html><body><div data-video="x"></div></body></html>' },
      { url: '/search-index.json', outputPath: './dist/search-index.json', content: '<body data-page-id="json">' },
      undefined,
    ]);
    expect(Object.keys(json)).toEqual(['home']);
  });

  it('reads the marker and the ids from <body> only, and only whole attribute names', () => {
    const json = pagesIndex([
      result('/a/', '<body data-page-id="a" data-page-viewed>', '<title>A</title>', '<p data-page-view></p><div data-videos="x" data-video-id="y"></div>'),
    ]);
    expect(json.a).toEqual({ url: '/a/', title: 'A', page_view: false, videos: [] });
  });

  it('reads the ratings widget\'s data-rating (SPEC §12), not its other data-rating-* hooks', () => {
    const json = pagesIndex([
      result(
        '/a/',
        '<body data-page-id="a">',
        '<title>A</title>',
        '<div class="rating" data-rating="rated-video" hidden><p data-rating-status></p></div>' +
          '<div data-rating-reveal hidden></div><p data-rating-summary="summary-only" hidden></p>',
      ),
    ]);
    expect(json.a.videos).toEqual(['rated-video']);
    expect(() => pagesIndex([result('/a/', '<body data-page-id="a">', '', '<div data-rating="Not A Slug"></div>')])).toThrow(/"Not A Slug" is not a video_id/);
  });

  it('reads a video\'s "Feedback" button\'s data-feedback-video (SPEC §13), not the dialog\'s or the footer\'s other data-feedback-* hooks', () => {
    const json = pagesIndex([
      result(
        '/a/',
        '<body data-page-id="a">',
        '<title>A</title>',
        '<button type="button" class="format-button" data-feedback-trigger data-feedback-video="feedback-video" hidden></button>' +
          '<a href="/contact/" data-feedback-trigger></a><dialog data-feedback-dialog data-sitekey="0xkey"><p data-feedback-about hidden></p>' +
          '<div data-feedback-videos="no" data-feedback-video-id="no" data-feedback-status></div></dialog>',
      ),
    ]);
    expect(json.a.videos).toEqual(['feedback-video']);
    expect(() => pagesIndex([result('/a/', '<body data-page-id="a">', '', '<button data-feedback-video="Not A Slug"></button>')])).toThrow(/"Not A Slug" is not a video_id/);
    expect(() => pagesIndex([result('/a/', '<body data-page-id="a">', '', '<button data-feedback-video=""></button>')])).toThrow(/"" is not a video_id/);
  });

  it('fails the build on a duplicate page_id, a page_id or video_id that is not a slug, or no page at all', () => {
    expect(() => pagesIndex([result('/a/', '<body data-page-id="a">'), result('/b/', '<body data-page-id="a">')])).toThrow(/page_id "a" is on two pages/);
    expect(() => pagesIndex([result('/a/', '<body data-page-id="A_page">')])).toThrow(/data-page-id "A_page"/);
    expect(() => pagesIndex([result('/a/', '<body data-page-id="a">', '', '<audio data-media="talk.mp3"></audio>')])).toThrow(/"talk.mp3" is not a video_id/);
    expect(() => pagesIndex([result('/a/', '<body>')])).toThrow(/no page has a data-page-id/);
    expect(() => pagesIndex([])).toThrow(/no page has a data-page-id/);
  });
});

describe('writeIfChanged()', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sleepsteps-pages-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('creates the directory, writes, and leaves an unchanged file alone', () => {
    const file = path.join(dir, 'generated', 'pages.json');
    expect(writeIfChanged(file, '{}\n')).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('{}\n');
    const { mtimeMs } = statSync(file);
    expect(writeIfChanged(file, '{}\n')).toBe(false);
    expect(statSync(file).mtimeMs).toBe(mtimeMs);
    expect(writeIfChanged(file, '{"a":1}\n')).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('{"a":1}\n');
  });
});

describe('worker/generated/pages.json, as the build wrote it', () => {
  it('matches the built pages', () => {
    const fromBuild = pagesIndex(
      built.map(({ file, html }) => ({
        url: `/${file.replace(/(^|\/)index\.html$/, '$1')}`,
        outputPath: file,
        content: html,
      })),
    );
    expect(pages).toEqual(fromBuild);
  });

  it('lists every page with a page_id, and no 404 page or Sleep problems page', () => {
    expect(Object.keys(pages).sort()).toEqual([...TRACKED, ...UNTRACKED].sort());
    expect(Object.values(pages).some((p) => p.url.includes('404'))).toBe(false);
    expect(pages.problems).toBeUndefined();
    expect(Object.values(pages).map((p) => p.url)).not.toContain('/problems/');
  });

  it('marks problem pages, Start here and Getting urgent help, and no other page, as sending page views (SPEC §10.2)', () => {
    for (const id of TRACKED) expect(pages[id].page_view, id).toBe(true);
    for (const id of UNTRACKED) expect(pages[id].page_view, id).toBe(false);
    for (const id of problemIds) expect(pages[id].url, id).toBe(`/problems/${id}/`);
    expect([pages.start.url, pages['urgent-help'].url, pages.home.url, pages.search.url]).toEqual(['/start/', '/urgent-help/', '/', '/search/']);
  });

  it("lists a problem's own video and its solutions' videos, and Start here's chapters", () => {
    for (const [id, { data }] of model.problems) {
      const expected = [...new Set([data.problem_video, ...(data.solutions ?? []).map((s) => s.video)])].sort();
      expect(pages[id].videos, id).toEqual(expected);
    }
    expect(pages.start.videos).toEqual(model.start.data.chapters.map((c) => c.video).sort());
    for (const id of UNTRACKED) expect(pages[id].videos, id).toEqual([]);
  });

  it('takes each title from the page’s front matter', () => {
    const source = (id) =>
      ({ home: 'content/index.njk', search: 'content/search.njk', start: 'content/start.md' })[id] ??
      (model.problems.has(id) ? `content/problems/${id}.md` : `content/pages/${id}.md`);
    for (const id of Object.keys(pages)) {
      expect(pages[id].title, id).toBe(parseFrontMatter(readFileSync(source(id), 'utf8')).data.title);
    }
  });
});

describe('the HTML pages.json is read from', () => {
  it('puts data-page-view on <body> exactly on the pages that send a page view', () => {
    const marked = built
      .filter(({ html }) => attr(tags(html, 'body')[0], 'data-page-view') !== undefined)
      .map(({ html }) => attr(tags(html, 'body')[0], 'data-page-id'))
      .sort();
    expect(marked).toEqual(TRACKED);
  });

  it('names videos only by video_id: data-video, data-handout, the audio’s data-media, the ratings widget’s data-rating and the "Feedback" button’s data-feedback-video', () => {
    const seen = new Set();
    for (const { file, html } of builtOn) {
      for (const [, name, value] of html.matchAll(/\sdata-(video|handout|media|rating|feedback-video)="([^"]*)"/g)) {
        expect(model.videos.has(value), `${file}: data-${name}="${value}"`).toBe(true);
        seen.add(name);
      }
      expect(html, file).not.toMatch(/\sdata-transcript=/);
    }
    expect([...seen].sort()).toEqual(['feedback-video', 'handout', 'media', 'rating', 'video']);
  });

  it('gives a page the same videos by each attribute, so a "Feedback" button never adds one the page couldn\'t already send', () => {
    for (const { file, html } of builtOn) {
      const named = (name) => [...new Set([...html.matchAll(new RegExp(`\\sdata-${name}="([^"]*)"`, 'g'))].map((m) => m[1]))].sort();
      for (const name of ['handout', 'media', 'rating', 'feedback-video']) expect(named(name), `${file}: data-${name}`).toEqual(named('video'));
      const id = attr(tags(html, 'body')[0], 'data-page-id');
      if (id !== undefined) expect(pages[id].videos, file).toEqual(named('video'));
    }
  });

  it('gives each audio player the video_id of its own "Audio only" disclosure (audio_play, SPEC §10.2)', () => {
    let count = 0;
    for (const { file, html } of built) {
      for (const [, id, audio] of html.matchAll(/<details[^>]*\sid="audio-([^"]+)"[^>]*>[\s\S]*?(<audio\b[^>]*>)/g)) {
        expect(attr(audio, 'data-media'), file).toBe(id);
        count += 1;
      }
    }
    expect(count).toBeGreaterThan(0);
  });
});
