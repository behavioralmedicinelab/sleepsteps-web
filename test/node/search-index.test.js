// The search index (SPEC §8.2, §8.3): scripts/build-data.js on stand-in
// items, and the built /search-index.json against the real content.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import { htmlToText, keywordsByPage, markdownToText, searchIndex } from '../../scripts/build-data.js';
import { parseCsvRecords } from '../../scripts/lib/csv.js';
import { validateContent } from '../../scripts/validate-content.js';

describe('scripts/build-data.js', () => {
  it('htmlToText drops tags, comments and scripts, decodes entities and collapses spaces', () => {
    expect(htmlToText('<p>One &amp; <b>two</b></p>\n<!-- note -->\n<ul><li>three&nbsp;&#8217;s</li></ul><script>x()</script>')).toBe('One & two three ’s');
    expect(htmlToText(undefined)).toBe('');
  });

  it('markdownToText renders a transcript as text', () => {
    expect(markdownToText('Hello *there*.\n\n- one\n- [two](/problems/pain/)\n')).toBe('Hello there. one two');
  });

  it('keywordsByPage splits on semicolons and drops empty keywords', () => {
    const map = keywordsByPage([{ page_id: ' pain ', keywords: 'ache; sore ;; ' }, { page_id: 'start', keywords: '' }]);
    expect([...map]).toEqual([['pain', ['ache', 'sore']], ['start', []]]);
  });

  const video = (id, title, rawInput = '') => ({ page: { fileSlug: id }, data: { title }, rawInput });
  const videos = [video('a', 'About it', 'The *about* words.'), video('m', 'Main idea', 'Main words.'), video('i', 'Intro one')];
  const problem = {
    url: '/problems/pain/',
    data: {
      page_id: 'pain',
      title: 'Pain',
      statement: 'Pain is affecting my sleep',
      is_this_you: { summary: 'You hurt.', bullets: ['at night', 'in the morning'] },
      problem_video: 'a',
      solutions: [{ tier: 'main', video: 'm', blurb: 'Try this.' }],
    },
  };
  const start = { url: '/start/', data: { page_id: 'start', title: 'Start here', summary: 'Watch first.', chapters: [{ video: 'i', description: 'First.' }] } };
  const page = (id, data = {}, html = '<p>Body text.</p>') => ({ url: `/${id}/`, templateContent: html, data: { page_id: id, title: id, summary: `${id} summary`, ...data } });

  it('builds one entry per problem, Start here and information page', () => {
    const entries = searchIndex({
      problems: [problem],
      videos,
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
        transcript: 'You hurt. at night in the morning About it The about words. Main idea Try this. Main words.',
        type: 'problem',
      },
      { id: 'start', url: '/start/', title: 'Start here', summary: 'Watch first.', keywords: '', transcript: 'Intro one First.', type: 'start' },
      { id: 'help', url: '/help/', title: 'help', summary: 'help summary', keywords: 'doctor', transcript: 'When See your GP.', type: 'page' },
    ]);
  });

  it('fails on a video that is not in the library', () => {
    expect(() => searchIndex({ problems: [{ ...problem, data: { ...problem.data, problem_video: 'nope' } }], videos })).toThrow(/unknown video "nope"/);
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

  it('holds the rendered text of the information pages, without markup (they render first)', () => {
    for (const id of infoPages) {
      const e = byId.get(id);
      expect(e.type, id).toBe('page');
      expect(e.transcript.length, id).toBeGreaterThan(40);
      expect(e.transcript, id).not.toMatch(/<[a-z/!]|\{[{%]/i);
    }
    expect(byId.get('urgent-help').transcript).toMatch(/000/);
  });

  it('has no markup in any field', () => {
    for (const e of entries) for (const [field, value] of Object.entries(e)) expect(value, `${e.id} ${field}`).not.toMatch(/<\/?[a-z][^>]*>/i);
  });

  it('carries each page\'s keywords from data/keywords.csv', () => {
    const rows = existsSync('data/keywords.csv') ? parseCsvRecords(readFileSync('data/keywords.csv', 'utf8')) : [];
    const words = keywordsByPage(rows);
    for (const e of entries) expect(e.keywords, e.id).toBe((words.get(e.id) ?? []).join(' '));
  });
});
