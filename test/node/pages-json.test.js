// worker/generated/pages.json (SPEC §8.3, §14.1): pagesIndex() and
// writeIfChanged() in scripts/build-data.js, the file the tests' build wrote
// (test/global-setup.js), and the HTML it is read from: the <body>
// data-page-view marker, the attributes that name a page's videos, and the
// one that names its worksheets (data-worksheet, SPEC §7.6).
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
  it('lists each page with a data-page-id: url, title, page_view, its videos and its worksheets', () => {
    const json = pagesIndex([
      result(
        '/problems/pain/',
        '<body class="page--wide" data-page-id="pain" data-page-view>',
        '<title>Can&#39;t sleep &amp; pain</title>',
        '<div data-video="b-video" data-title="B"></div><div data-rating="d-video"></div>' +
          '<a data-handout="a-video" href="/media/pdf/a.pdf"></a><audio data-media="c-video"></audio>' +
          // Not an attribute that names a video any more (no transcripts, SPEC §9.3).
          '<details data-transcript="e-video"></details>' +
          // A worksheet names no video, and a video's attribute no worksheet.
          '<a class="format-button" href="/media/worksheets/z.pdf" type="application/pdf" data-worksheet="z-sheet"></a>' +
          '<a class="format-button" href="/media/worksheets/y.pdf" type="application/pdf" data-worksheet="y-sheet"></a>',
      ),
      result('/about/', '<body data-page-id="about">', '<title>About us</title>'),
    ]);
    expect(json).toEqual({
      about: { url: '/about/', title: 'About us', page_view: false, videos: [], worksheets: [] },
      pain: {
        url: '/problems/pain/',
        title: "Can't sleep & pain",
        page_view: true,
        videos: ['a-video', 'b-video', 'c-video', 'd-video'],
        worksheets: ['y-sheet', 'z-sheet'],
      },
    });
    expect(Object.keys(json)).toEqual(['about', 'pain']);
    // The keys' order is part of the file's text (SPEC §8.3).
    expect(Object.keys(json.pain)).toEqual(['url', 'title', 'page_view', 'videos', 'worksheets']);
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
      result(
        '/a/',
        '<body data-page-id="a" data-page-viewed>',
        '<title>A</title>',
        '<p data-page-view></p><div data-videos="x" data-video-id="y"></div><a data-worksheets="x" data-worksheet-id="y" data-worksheet-open="z" xdata-worksheet="w"></a>',
      ),
    ]);
    expect(json.a).toEqual({ url: '/a/', title: 'A', page_view: false, videos: [], worksheets: [] });
  });

  it('reads a worksheet link\'s data-worksheet (SPEC §7.6): each worksheet_id once, sorted, and never as a video', () => {
    const link = (id) => `<a class="format-button" href="/media/worksheets/${id}.pdf" type="application/pdf" data-worksheet="${id}">W</a>`;
    const json = pagesIndex([
      // The same worksheet in two cards of one page (it can't happen today:
      // a page lists a video once), and ids out of order.
      result('/a/', '<body data-page-id="a">', '<title>A</title>', `<div data-video="a-video"></div>${link('sheet-b')}${link('sheet-a')}${link('sheet-b')}${link('sheet-10')}`),
      result('/b/', '<body data-page-id="b">', '<title>B</title>', '<div data-video="b-video"></div>'),
    ]);
    expect(json.a.worksheets).toEqual(['sheet-10', 'sheet-a', 'sheet-b']);
    expect(json.a.videos).toEqual(['a-video']);
    expect(json.b.worksheets).toEqual([]);
    // A video's attributes never add a worksheet.
    const videoOnly = pagesIndex([
      result('/a/', '<body data-page-id="a">', '', '<div data-video="v"></div><a data-handout="v"></a><audio data-media="v"></audio><div data-rating="v"></div><button data-feedback-video="v"></button>'),
    ]);
    expect(videoOnly.a).toMatchObject({ videos: ['v'], worksheets: [] });
    expect(() => pagesIndex([result('/a/', '<body data-page-id="a">', '', '<a data-worksheet="Not A Slug"></a>')])).toThrow(/"Not A Slug" is not a worksheet_id/);
    expect(() => pagesIndex([result('/a/', '<body data-page-id="a">', '', '<a data-worksheet="sheet.pdf"></a>')])).toThrow(/pages\.json: \.\/dist\/a\/index\.html: "sheet\.pdf" is not a worksheet_id/);
    expect(() => pagesIndex([result('/a/', '<body data-page-id="a">', '', '<a data-worksheet=""></a>')])).toThrow(/"" is not a worksheet_id/);
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

  // What a worksheet_open may name (SPEC §7.6, §10.2): the worksheets a
  // page's open solution cards link, which are those of its solution videos.
  it("lists, for every page, the worksheets of its solution videos, sorted and once each: none for a problem's own video, Start here or any other page", () => {
    const sheets = [...model.worksheets.values()].map((w) => w.data);
    const of = (video) => sheets.filter((w) => w.video_id === video).map((w) => w.worksheet_id);
    let listed = 0;
    for (const [id, { data }] of model.problems) {
      const expected = [...new Set((data.solutions ?? []).flatMap((s) => of(s.video)))].sort();
      expect(pages[id].worksheets, id).toEqual(expected);
      listed += expected.length;
      // The problem's own video adds none, whatever the spreadsheet says.
      if (!(data.solutions ?? []).some((s) => s.video === data.problem_video)) {
        for (const worksheet of of(data.problem_video)) expect(pages[id].worksheets, id).not.toContain(worksheet);
      }
    }
    for (const id of ['start', 'urgent-help', ...UNTRACKED]) expect(pages[id].worksheets, id).toEqual([]);
    // Every page has the key, a list, so the Worker never guesses.
    for (const [id, page] of Object.entries(pages)) {
      expect(Object.keys(page), id).toEqual(['url', 'title', 'page_view', 'videos', 'worksheets']);
      expect(Array.isArray(page.worksheets), id).toBe(true);
      expect(page.worksheets, id).toEqual([...new Set(page.worksheets)].sort());
    }
    // Say so if there is nothing to check: no solution video has a worksheet.
    const solutionVideos = new Set([...model.problems.values()].flatMap(({ data }) => (data.solutions ?? []).map((s) => s.video)));
    expect(listed > 0).toBe(sheets.some((w) => solutionVideos.has(w.video_id)));
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

  it('names worksheets only by worksheet_id, in data-worksheet, on links to their files: exactly the links players.js reports (worksheet_open, SPEC §10.2)', () => {
    const sheets = new Map([...model.worksheets.values()].map((w) => [w.data.worksheet_id, w.data]));
    let count = 0;
    for (const { file, html } of builtOn) {
      const id = attr(tags(html, 'body')[0], 'data-page-id');
      const named = [];
      for (const tag of tags(html, 'a').filter((t) => attr(t, 'data-worksheet') !== undefined)) {
        const worksheet = attr(tag, 'data-worksheet');
        expect(sheets.has(worksheet), `${file}: data-worksheet="${worksheet}"`).toBe(true);
        // players.js reports a click on a[href]: the link to this worksheet's own file.
        expect(attr(tag, 'href'), `${file} ${worksheet}`).toBe(`/media/worksheets/${sheets.get(worksheet).file}`);
        named.push(worksheet);
        count += 1;
      }
      // No other element carries the attribute, and no link to a worksheet's file goes without it.
      expect((html.match(/\sdata-worksheet="/g) ?? []).length, file).toBe(named.length);
      expect((html.match(/href="\/media\/worksheets\//g) ?? []).length, file).toBe(named.length);
      if (id !== undefined) expect(pages[id].worksheets, file).toEqual([...new Set(named)].sort());
      else expect(named, file).toEqual([]);
    }
    expect(count > 0).toBe(Object.values(pages).some((page) => page.worksheets.length > 0));
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
