// The search index (SPEC §8.2, §8.3): scripts/build-data.js on stand-in
// items, and the built /search-index.json against the real content.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, inject, it, vi } from 'vitest';
import { TRANSCRIPTS } from '../../content/search-index.11ty.js';
import { htmlToText, keywordsByPage, searchIndex } from '../../scripts/build-data.js';
import { parseCsvRecords } from '../../scripts/lib/csv.js';
import { TRANSCRIPTS_DIR, readTranscripts } from '../../scripts/lib/videos.js';
import { validateContent } from '../../scripts/validate-content.js';
import { videoRow } from './helpers.js';

// data/videos.csv rows, and plain-text transcripts by video_id (data/transcripts/).
const videos = [
  videoRow('a', { title: 'About it', description: 'What it is.' }),
  videoRow('m', { title: 'Main idea', description: 'Main description.' }),
  videoRow('x', { title: 'Extra idea', description: 'Extra description.' }),
  videoRow('i', { title: 'Intro one', description: 'First.' }),
];
const transcripts = new Map([['a', 'The *about*\r\nwords.\n'], ['m', 'Main words.'], ['i', '']]);
const problem = {
  url: '/problems/pain/',
  data: {
    page_id: 'pain',
    title: 'Pain',
    statement: 'Pain is affecting my sleep',
    problem_video: 'a',
    solutions: [{ tier: 'main', video: 'm' }, { tier: 'extra', video: 'x' }],
  },
};
const start = { url: '/start/', data: { page_id: 'start', title: 'Start here', summary: 'Watch first.', chapters: [{ video: 'i' }] } };
const page = (id, data = {}, html = '<p>Body text.</p>') => ({ url: `/${id}/`, templateContent: html, data: { page_id: id, title: id, summary: `${id} summary`, ...data } });

describe('scripts/build-data.js', () => {
  it('htmlToText drops tags, comments and scripts, decodes entities and collapses spaces', () => {
    expect(htmlToText('<p>One &amp; <b>two</b></p>\n<!-- note -->\n<ul><li>three&nbsp;&#8217;s</li></ul><script>x()</script>')).toBe('One & two three ’s');
    expect(htmlToText(undefined)).toBe('');
  });

  it('keywordsByPage splits on semicolons and drops empty keywords', () => {
    const map = keywordsByPage([{ page_id: ' pain ', keywords: 'ache; sore ;; ' }, { page_id: 'start', keywords: '' }]);
    expect([...map]).toEqual([['pain', ['ache', 'sore']], ['start', []]]);
  });

  it('builds one entry per problem, Start here and information page', () => {
    const entries = searchIndex({
      problems: [problem],
      videos,
      transcripts,
      start,
      pages: [page('help', {}, '<h2>When</h2><p>See your <a href="/x/">GP</a>.</p>'), page('hidden', { search: false })],
      keywords: [{ page_id: 'pain', keywords: 'ache; sore' }, { page_id: 'help', keywords: 'doctor' }],
    });
    expect(entries).toEqual([
      {
        id: 'pain',
        url: '/problems/pain/',
        title: 'Pain',
        summary: 'Pain is affecting my sleep',
        keywords: 'ache sore',
        // Each video's title, its description and its transcript, as plain text on one line.
        transcript: 'About it What it is. The *about* words. Main idea Main description. Main words. Extra idea Extra description.',
        type: 'problem',
      },
      { id: 'start', url: '/start/', title: 'Start here', summary: 'Watch first.', keywords: '', transcript: 'Intro one First.', type: 'start' },
      { id: 'help', url: '/help/', title: 'help', summary: 'help summary', keywords: 'doctor', transcript: 'When See your GP.', type: 'page' },
    ]);
  });

  it('indexes no transcripts when there are none', () => {
    const [entry] = searchIndex({ problems: [problem], videos });
    expect(entry.transcript).toBe('About it What it is. Main idea Main description. Extra idea Extra description.');
  });

  // SPEC §7.6, §8.3: a solution video's worksheets are listed in its open
  // card, so their titles join that problem's text, after the video's own.
  describe('worksheets (data/worksheets.csv rows)', () => {
    const row = (worksheet_id, video_id, title) => ({ worksheet_id, video_id, title, file: `${worksheet_id}.pdf` });
    const worksheets = [
      row('m-two', 'm', 'Wind-down\r\n  planner'),
      row('a-one', 'a', 'For the problem video: never shown'),
      row('x-one', 'x', 'Sleep diary'),
      row('m-one', 'm', ' Thought record '),
      row('i-one', 'i', 'For an intro video: never shown'),
      row('z-one', 'elsewhere', 'For a video on another page'),
    ];

    it('adds each solution video\'s worksheet titles after that video\'s text, in the file\'s order, on one line', () => {
      const [entry] = searchIndex({ problems: [problem], videos, transcripts, worksheets });
      expect(entry.transcript).toBe(
        'About it What it is. The *about* words. Main idea Main description. Main words. Wind-down planner Thought record Extra idea Extra description. Sleep diary',
      );
    });

    it('adds none for a problem\'s own video or an intro video, which show no worksheets', () => {
      const [pain, startEntry] = searchIndex({ problems: [problem], videos, transcripts, worksheets, start });
      expect(pain.transcript).not.toMatch(/never shown|another page/);
      expect(startEntry.transcript).toBe('Intro one First.');
      // A stand-alone problem has no solutions, so no worksheets.
      const alone = { ...problem, data: { ...problem.data, solutions: undefined, standalone: true } };
      expect(searchIndex({ problems: [alone], videos, worksheets })[0].transcript).toBe('About it What it is.');
    });

    it('gives a video\'s worksheets to every problem that lists it as a solution', () => {
      const other = { url: '/problems/other/', data: { ...problem.data, page_id: 'other', problem_video: 'i', solutions: [{ tier: 'main', video: 'x' }] } };
      const entries = searchIndex({ problems: [problem, other], videos, worksheets });
      expect(entries.map((e) => /\bSleep diary$/.test(e.transcript))).toEqual([true, true]);
      expect(entries[1].transcript).toBe('Intro one First. Extra idea Extra description. Sleep diary');
    });

    it('changes nothing else: the other fields, the other entries, and the index without worksheets', () => {
      const input = { problems: [problem], videos, transcripts, start, pages: [page('help')], keywords: [{ page_id: 'pain', keywords: 'ache' }] };
      const without = searchIndex(input);
      expect(searchIndex({ ...input, worksheets: [] })).toEqual(without);
      expect(searchIndex({ ...input, worksheets: undefined })).toEqual(without);
      const withSheets = searchIndex({ ...input, worksheets });
      expect(withSheets.map(({ transcript, ...rest }) => rest)).toEqual(without.map(({ transcript, ...rest }) => rest));
      expect(withSheets.slice(1)).toEqual(without.slice(1));
    });
  });

  it('fails on a video that is not in the library', () => {
    expect(() => searchIndex({ problems: [{ ...problem, data: { ...problem.data, problem_video: 'nope' } }], videos })).toThrow(/unknown video "nope"/);
  });
});

// The template's own steps: the folder it reads, and passing what it reads
// to searchIndex(). With those, readTranscripts (validate-content.test.js,
// on a temporary folder) and searchIndex (above, on a Map) cover every step
// from data/transcripts/ to /search-index.json, even while the real folder
// is empty.
describe('content/search-index.11ty.js', () => {
  it('reads transcripts from the folder the content check reads', () => {
    expect(TRANSCRIPTS_DIR).toBe('data/transcripts');
    expect(path.resolve(TRANSCRIPTS)).toBe(path.resolve(TRANSCRIPTS_DIR));
  });

  it('passes the transcripts it reads to the index', async () => {
    vi.resetModules();
    const read = vi.fn(() => new Map([['a', 'Unmistakable transcript words.'], ['i', 'Intro transcript words.']]));
    vi.doMock('../../scripts/lib/videos.js', async (importOriginal) => ({ ...(await importOriginal()), readTranscripts: read }));
    try {
      const template = await import('../../content/search-index.11ty.js');
      const json = template.render({
        collections: { problems: [problem], all: [start] },
        videos,
        keywords: [],
      });
      expect(read).toHaveBeenCalledWith(template.TRANSCRIPTS);
      const byId = new Map(JSON.parse(json).map((e) => [e.id, e]));
      expect(byId.get('pain').transcript).toContain('About it What it is. Unmistakable transcript words.');
      expect(byId.get('start').transcript).toBe('Intro one First. Intro transcript words.');
    } finally {
      vi.doUnmock('../../scripts/lib/videos.js');
      vi.resetModules();
    }
  });
});

describe('content/search-index.11ty.js and the worksheets (SPEC §7.6, §8.3)', () => {
  it('passes data/worksheets.csv\'s rows, the global data `worksheets`, to the index', async () => {
    const template = await import('../../content/search-index.11ty.js');
    const data = { collections: { problems: [problem], all: [start] }, videos, keywords: [] };
    const worksheets = [{ worksheet_id: 'm-one', video_id: 'm', title: 'Unmistakable worksheet title', file: 'm-one.pdf' }];
    const byId = (json) => new Map(JSON.parse(json).map((e) => [e.id, e]));
    expect(byId(template.render({ ...data, worksheets })).get('pain').transcript).toContain('Main idea Main description. Unmistakable worksheet title Extra idea');
    expect(byId(template.render({ ...data, worksheets })).get('start').transcript).not.toContain('Unmistakable');
    expect(byId(template.render(data)).get('pain').transcript).not.toContain('Unmistakable');
  });
});

describe('/search-index.json, built from the real content', () => {
  const site = inject('builtSite');
  const file = path.join(site, 'search-index.json');
  const entries = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  const { model } = validateContent('.');
  const infoPages = readdirSync('content/pages')
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.slice(0, -3))
    .filter((id) => !/^search:\s*false\s*$/m.test(readFileSync(`content/pages/${id}.md`, 'utf8').split('\n---')[0]));
  const byId = new Map(entries.map((e) => [e.id, e]));

  it('has one entry for every problem, Start here and every searchable information page, and nothing else', () => {
    expect(entries.map((e) => e.id).sort()).toEqual([...model.problems.keys(), 'start', ...infoPages].sort());
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });

  it('has the documented fields, as non-empty text', () => {
    for (const e of entries) {
      expect(Object.keys(e), e.id).toEqual(['id', 'url', 'title', 'summary', 'keywords', 'transcript', 'type']);
      for (const field of ['url', 'title', 'summary', 'transcript']) expect(e[field], `${e.id} ${field}`).toMatch(/\S/);
      expect(['problem', 'start', 'page'], e.id).toContain(e.type);
    }
  });

  it('links each entry to a built page', () => {
    for (const e of entries) {
      expect(e.url, e.id).toMatch(/^\/[a-z0-9/-]*\/$/);
      expect(existsSync(path.join(site, e.url, 'index.html')), e.url).toBe(true);
    }
  });

  it('uses each problem\'s statement as its summary, and its videos in its text', () => {
    for (const [slug, { data }] of model.problems) {
      const e = byId.get(slug);
      expect([e.type, e.url, e.title, e.summary], slug).toEqual(['problem', `/problems/${slug}/`, data.title, data.statement]);
      for (const id of [data.problem_video, ...(data.solutions ?? []).map((s) => s.video)]) {
        expect(e.transcript, `${slug}: ${id}`).toContain(model.videos.get(id).data.title);
      }
    }
  });

  it('indexes each video\'s description with its title (SPEC §8.3)', () => {
    for (const [slug, { data }] of model.problems) {
      const e = byId.get(slug);
      expect(e.transcript, slug).toContain(model.videos.get(data.problem_video).data.description);
      for (const s of data.solutions ?? []) expect(e.transcript, `${slug}: ${s.video}`).toContain(model.videos.get(s.video).data.description);
    }
    for (const { video } of model.start.data.chapters) {
      const { title, description } = model.videos.get(video).data;
      expect(byId.get('start').transcript, video).toContain(`${title} ${description}`);
    }
  });

  // SPEC §7.6, §8.3: the worksheets a problem's solution cards list.
  it('indexes the titles of each solution video\'s worksheets with that solution, on every problem that has it, and nowhere else', () => {
    const sheets = [...model.worksheets.values()].map((w) => w.data);
    const titlesOf = (id) => sheets.filter((w) => w.video_id === id).map((w) => w.title.replace(/\s+/g, ' ').trim());
    // "Nowhere else", without counting on the titles' words: the index's
    // text for a problem and for Start here is exactly what the index
    // builder makes of the content as the content check read it, with the
    // worksheets and (to compare) without them. A title may be words the
    // site also uses elsewhere ("Sleep diary" in a description, a transcript or
    // an information page), so "this page's text doesn't hold another
    // video's worksheet title" would stop the team's edits, not a bug.
    const transcripts = readTranscripts(TRANSCRIPTS_DIR);
    const input = {
      problems: [...model.problems].map(([slug, { data }]) => ({ url: `/problems/${slug}/`, data: { ...data, page_id: slug } })),
      videos: [...model.videos.values()].map((v) => v.data),
      transcripts,
      start: { url: '/start/', data: { ...model.start.data, page_id: 'start' } },
    };
    const expected = new Map(searchIndex({ ...input, worksheets: sheets }).map((e) => [e.id, e.transcript]));
    const bare = new Map(searchIndex({ ...input, worksheets: [] }).map((e) => [e.id, e.transcript]));
    let checked = 0;
    for (const [slug, { data }] of model.problems) {
      const e = byId.get(slug);
      expect(e.transcript, slug).toBe(expected.get(slug));
      const listed = (data.solutions ?? []).flatMap((s) => titlesOf(s.video));
      // The titles are all that the worksheets add: as many characters as
      // they and their spaces take, and none on a page that lists none.
      expect(e.transcript.length - bare.get(slug).length, slug).toBe(listed.reduce((n, title) => n + title.length + 1, 0));
      if (!listed.length) expect(e.transcript, slug).toBe(bare.get(slug));
      for (const s of data.solutions ?? []) {
        const v = model.videos.get(s.video).data;
        const titles = titlesOf(s.video);
        // The video's title, its description, its transcript (none
        // yet for these), then its worksheets, in the file's order.
        if (titles.length && !model.videos.get(s.video).transcript.trim()) {
          expect(e.transcript, `${slug}: ${s.video}`).toContain([v.title, v.description, ...titles].join(' '));
        }
        for (const title of titles) {
          expect(e.transcript, `${slug}: ${title}`).toContain(title);
          checked += 1;
        }
      }
      // And the page itself shows each one it indexes.
      const page = readFileSync(path.join(site, 'problems', slug, 'index.html'), 'utf8');
      for (const s of data.solutions ?? []) {
        for (const w of sheets.filter((x) => x.video_id === s.video)) expect(page, `${slug}: ${w.worksheet_id}`).toContain(`data-worksheet="${w.worksheet_id}"`);
      }
    }
    // Start here lists no worksheets: its text is the intro videos' alone.
    expect(byId.get('start').transcript).toBe(expected.get('start'));
    expect(expected.get('start')).toBe(bare.get('start'));
    // An information page's text is its own rendered body (below), which
    // the worksheets never reach: no page but a problem's lists them
    // (video-template.test.js), and the builder gives them to problems
    // only ("changes nothing else", above).
    // The sample worksheets are on solution videos, so some were checked.
    const solutionVideos = new Set([...model.problems.values()].flatMap(({ data }) => (data.solutions ?? []).map((s) => s.video)));
    if (sheets.some((w) => solutionVideos.has(w.video_id))) expect(checked).toBeGreaterThan(0);
  });

  it('indexes every transcript in data/transcripts/, which no page shows (SPEC §8.3, §9.3)', () => {
    const transcripts = readTranscripts(TRANSCRIPTS_DIR);
    const words = (id) => (transcripts.get(id) ?? '').replace(/\s+/g, ' ').trim();
    let checked = 0;
    for (const [slug, { data }] of model.problems) {
      const page = readFileSync(path.join(site, 'problems', slug, 'index.html'), 'utf8');
      for (const id of [data.problem_video, ...(data.solutions ?? []).map((s) => s.video)]) {
        if (!words(id)) continue;
        expect(byId.get(slug).transcript, `${slug}: ${id}`).toContain(words(id));
        expect(page, `${slug}: ${id}`).not.toContain(words(id));
        checked += 1;
      }
    }
    const startPage = readFileSync(path.join(site, 'start', 'index.html'), 'utf8');
    for (const { video } of model.start.data.chapters) {
      if (!words(video)) continue;
      expect(byId.get('start').transcript, video).toContain(words(video));
      expect(startPage, video).not.toContain(words(video));
      checked += 1;
    }
    expect([...transcripts.keys()].every((id) => model.videos.has(id))).toBe(true);
    // Say which case this is, rather than passing an empty folder silently:
    // with any transcript with words in it, at least one was checked (every
    // video in the library is on a page, or the build warns).
    if ([...transcripts.keys()].some((id) => words(id))) expect(checked).toBeGreaterThan(0);
    else expect([...transcripts.values()].every((text) => text.trim() === ''), 'data/transcripts/ has no transcript with words in it yet').toBe(true);
  });

  it('holds the rendered text of the information pages, without markup (they render first)', () => {
    for (const id of infoPages) {
      const e = byId.get(id);
      expect(e.type, id).toBe('page');
      expect(e.transcript.length, id).toBeGreaterThan(40);
      expect(e.transcript, id).not.toMatch(/<[a-z/!]|\{[{%]/i);
    }
    expect(byId.get('urgent-help').transcript).toMatch(/000/);
  });

  // Markup is a tag from a template or a page's HTML. A title or a
  // description typed into a spreadsheet is plain text, whatever it holds
  // ("Bed & sleep <plan>", "Sleep under 6 hours -> plan"): the index has
  // it as typed, and the pages escape it (page-problem.test.js), so the
  // spreadsheets' own text is taken out before looking for tags.
  it('has no markup in any field', () => {
    const squash = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const typed = [
      ...[...model.worksheets.values()].map((w) => w.data.title),
      ...[...model.videos.values()].flatMap((v) => [v.data.title, v.data.description]),
    ].map(squash).filter((words) => /[<>]/.test(words)).sort((a, b) => b.length - a.length);
    const withoutTyped = (value) => typed.reduce((rest, words) => rest.split(words).join(' '), value);
    for (const e of entries) for (const [field, value] of Object.entries(e)) expect(withoutTyped(value), `${e.id} ${field}`).not.toMatch(/<\/?[a-z][^>]*>/i);
    // The check still sees a tag beside such text.
    expect(withoutTyped('<p>Body</p>')).toMatch(/<\/?[a-z][^>]*>/i);
  });

  it('carries each page\'s keywords from data/keywords.csv', () => {
    const rows = existsSync('data/keywords.csv') ? parseCsvRecords(readFileSync('data/keywords.csv', 'utf8')) : [];
    const words = keywordsByPage(rows);
    for (const e of entries) expect(e.keywords, e.id).toBe((words.get(e.id) ?? []).join(' '));
  });
});
