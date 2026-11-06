// The areas and the 36 problem files match the handoff's content model
// (SPEC §7.2; HANDOFF §8), and the M1b content is in place: a problem video
// for every problem, solutions from the team's planning sheet (or none, for
// the 13 stand-alone problems), the eight mechanism videos, the Start here
// chapters and the problems that exercise each layout. Full validation is in
// validate-content.test.js.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsvRecords } from '../../scripts/lib/csv.js';
import { validateContent } from '../../scripts/validate-content.js';
import { listFiles } from './helpers.js';

const handoff = readFileSync('docs/design/HANDOFF.md', 'utf8');
const handoffProblems = JSON.parse(handoff.match(/```json\n([\s\S]*?)\n```/)[1]);
const areas = parseCsvRecords(readFileSync('data/areas.csv', 'utf8'));

// The planning sheet's "Separate video" rows (SPEC §7.2): one video made for
// the problem, and no solutions.
const STANDALONE = [
  'uncomfortable-sleep-environment', 'sleeping-in-hospital', 'sharing-a-bed', 'parents-of-young-children',
  'involving-others', 'sleep-not-improving-yet', 'setbacks-and-bad-nights', 'following-sleep-advice',
  'if-sleep-problems-return', 'dreams-and-nightmares', 'snoring', 'restless-legs', 'accepting-changes-to-my-sleep',
];
// The shared solution library: the eight mechanism videos (SPEC §7.1, §7.2).
const MECHANISMS = [
  'sleep-drive', 'circadian-rhythm', 'conditioning', 'cognitive-arousal', 'physiological-arousal',
  'sleep-effort-and-control', 'treatment-symptoms-and-sleep', 'daytime-rhythms-and-sleep',
];

// The top-level one-line `key: value` scalars of a problem file, with strings
// written as JSON-style double-quoted scalars (valid YAML). Nested fields
// (is_this_you, solutions, related) and comments are skipped; the validator
// reads those with Eleventy's own parser.
function frontMatter(file) {
  const block = readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---\n/)[1];
  return Object.fromEntries(
    block
      .split('\n')
      .map((line) => line.match(/^([a-z_]+): (\S.*)$/))
      .filter((m) => m && !/^[[{]/.test(m[2]))
      .map(([, key, raw]) => [
        key,
        raw.startsWith('"') ? JSON.parse(raw) : /^\d+$/.test(raw) ? Number(raw) : raw === 'true' ? true : raw === 'false' ? false : raw,
      ]),
  );
}

describe('data/areas.csv', () => {
  it('has the SPEC §7.2 columns', () => {
    expect(Object.keys(areas[0])).toEqual(['area_id', 'name', 'description', 'source_name', 'order']);
  });

  it('has the 10 handoff areas in order 10..100', () => {
    expect(areas.map((a) => [a.area_id, a.order])).toEqual(
      ['core', 'day', 'clock', 'mind', 'med', 'env', 'social', 'hard', 'relapse', 'dis'].map((id, i) => [id, String((i + 1) * 10)]),
    );
  });

  it.each(areas.map((a) => [a.area_id, a]))('%s matches the handoff name, source name and description', (id, area) => {
    const row = handoff.match(new RegExp(`^\\| \`${id}\` \\| (.+?) \\| (.+?) \\|$`, 'm'));
    expect([area.name, area.source_name]).toEqual([row[1], row[2]]);
    const desc = handoff.match(new RegExp(`^\\| ${id} \\| (.+?) \\|$`, 'm'));
    expect(area.description).toBe(desc[1]);
  });
});

describe('content/problems', () => {
  const files = readdirSync('content/problems').filter((f) => f.endsWith('.md'));

  it('has one file per handoff problem', () => {
    expect(files.map((f) => f.replace(/\.md$/, '')).sort()).toEqual(handoffProblems.map((p) => p.slug).sort());
  });

  it.each(handoffProblems.map((p, i) => [p.slug, p, i]))('%s matches the handoff', (slug, p) => {
    const fm = frontMatter(`content/problems/${slug}.md`);
    const order = handoffProblems.filter((q) => q.areaId === p.areaId).findIndex((q) => q.slug === slug) + 1;
    expect(fm).toEqual({
      title: p.shortTitle,
      statement: p.statement,
      source_title: p.sourceTitle,
      area: p.areaId,
      time_of_day: p.timeOfDay,
      order: order * 10,
      new: p.isNew === true,
      problem_video: `${slug}-about`,
      ...(STANDALONE.includes(slug) ? { standalone: true } : {}),
    });
    expect(areas.map((a) => a.area_id)).toContain(fm.area);
  });
});

describe('M1b content (SPEC §7.1-§7.3)', () => {
  const { errors, model } = validateContent(process.cwd());
  const problems = model.problems;
  const tiers = (slug) => {
    const counts = { main: 0, extra: 0 };
    for (const s of problems.get(slug).data.solutions ?? []) counts[s.tier] += 1;
    return counts;
  };

  it('passes the content check', () => {
    expect(errors).toEqual([]);
  });

  it('gives all 36 problems a problem video, "Is this you?" text and at least one main solution, or stand-alone status', () => {
    expect(problems.size).toBe(36);
    for (const [slug, { data }] of problems) {
      expect(model.videos.has(data.problem_video), slug).toBe(true);
      expect(data.is_this_you.summary, slug).toBeTruthy();
      expect(data.is_this_you.bullets.length, slug).toBeGreaterThanOrEqual(2);
      if (data.standalone) expect(tiers(slug), slug).toEqual({ main: 0, extra: 0 });
      else expect(tiers(slug).main, slug).toBeGreaterThanOrEqual(1);
    }
  });

  it('has the 13 stand-alone problems, each with its own [bracketed] video title and no solutions', () => {
    const standalone = [...problems].filter(([, { data }]) => data.standalone === true).map(([slug]) => slug);
    expect(standalone.sort()).toEqual([...STANDALONE].sort());
    for (const slug of STANDALONE) {
      const { data } = problems.get(slug);
      expect(data.solutions, slug).toBeUndefined();
      const title = model.videos.get(data.problem_video).data.title;
      expect(title, slug).toMatch(/^\[.+\]$/);
      expect(title, slug).not.toMatch(/^\[About:/);
    }
  });

  it('uses only the eight mechanism videos as solutions, each with a [bracketed] blurb', () => {
    const used = new Set();
    for (const [slug, { data }] of problems) {
      for (const s of data.solutions ?? []) {
        expect(MECHANISMS, `${slug}: ${s.video}`).toContain(s.video);
        expect(s.blurb, `${slug}: ${s.video}`).toMatch(/^\[.+\]$/);
        used.add(s.video);
      }
    }
    expect([...used].sort()).toEqual([...MECHANISMS].sort());
  });

  it('gives each mechanism video a [bracketed] title and stand-in transcript', () => {
    for (const id of MECHANISMS) {
      const { data, body } = model.videos.get(id);
      expect(data.title, id).toMatch(/^\[.+\]$/);
      expect(body.trim(), id).toBe(`[Transcript of “${data.title.slice(1, -1)}”.]`);
    }
  });

  // One problem for each shape the layout handles (SPEC §7).
  it.each([
    ['cant-get-back-to-sleep', 3, 3],
    ['tired-but-wired', 3, 2],
    ['stress-and-worries', 3, 1],
    ['sleep-timing-all-over-the-place', 3, 0],
    ['putting-off-going-to-bed', 2, 2],
    ['sharing-a-bed', 0, 0],
  ])('layout sample %s has %i main and %i extra solutions', (slug, main, extra) => {
    expect(tiers(slug)).toEqual({ main, extra });
  });

  it.each(['tired-but-wired', 'cant-get-back-to-sleep', 'pain', 'hot-flushes-and-night-sweats'])(
    '%s has 2-3 placeholder related topics',
    (slug) => {
      expect(problems.get(slug).data.related.length).toBeGreaterThanOrEqual(2);
    },
  );

  it('lists the three Start here videos in order', () => {
    expect(model.start.data.chapters.map((c) => c.video)).toEqual(['how-sleep-works', 'why-cancer-can-change-sleep', 'how-to-use-this-program']);
  });

  it('has sample videos covering every combination of formats the templates handle (a transcript is not one: no page shows it)', () => {
    const videos = [...model.videos.values()].map(({ data }) => data);
    expect(videos.some((v) => v.handout && v.audio)).toBe(true);
    expect(videos.some((v) => !v.handout && !v.audio)).toBe(true);
    expect(videos.some((v) => v.audio && !v.handout)).toBe(true);
    expect(videos.some((v) => v.handout && !v.audio)).toBe(true);
  });

  it('marks every sample video as a placeholder, with no YouTube ID', () => {
    // Sample content must never carry a real third-party video ID.
    for (const [id, { data }] of model.videos) {
      expect([id, data.placeholder, data.youtube_id]).toEqual([id, true, 'PLACEHOLDER']);
    }
  });
});

// SPEC §10.2: only problem pages, Start here and Getting urgent help send a
// page_view (base.njk renders <body data-page-view>; pages-json.test.js checks
// the built pages).
describe('track_page_view', () => {
  it('is set on problem pages, Start here and Getting urgent help only', () => {
    const files = listFiles('content', (f) => /\.(md|njk|js)$/.test(f)).filter((f) =>
      /^\s*track_page_view:\s*true\b/m.test(readFileSync(path.join('content', f), 'utf8')),
    );
    expect(files).toEqual(['pages/urgent-help.md', 'problems/problems.11tydata.js', 'start.md']);
  });
});

