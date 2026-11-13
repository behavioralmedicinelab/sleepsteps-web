// The areas and the 36 problem files match the handoff's content model
// (SPEC §7.2; HANDOFF §8), and the M1b content is in place: a problem video
// for every problem, solutions from the team's planning sheet (or none, for
// the 13 stand-alone problems), the eight mechanism videos, the Start here
// chapters and the problems that exercise each layout. Full validation is in
// validate-content.test.js.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsvRecords, parseCsvTable } from '../../scripts/lib/csv.js';
import { PLACEHOLDER_FILES, TRANSCRIPTS_DIR, readTranscripts } from '../../scripts/lib/videos.js';
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

  // The video's title is the team's to change in data/videos.csv, so it is
  // checked only while the video is still a placeholder.
  it('has the 13 stand-alone problems, each with no solutions and its own video, whose placeholder title names it', () => {
    const standalone = [...problems].filter(([, { data }]) => data.standalone === true).map(([slug]) => slug);
    expect(standalone.sort()).toEqual([...STANDALONE].sort());
    for (const slug of STANDALONE) {
      const { data } = problems.get(slug);
      expect(data.solutions, slug).toBeUndefined();
      const video = model.videos.get(data.problem_video).data;
      if (!video.placeholder) continue;
      expect(video.title, slug).toMatch(/^\[.+\]$/);
      expect(video.title, slug).not.toMatch(/^\[About:/);
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

  // Their wording and transcripts are the team's to change (data/videos.csv,
  // data/transcripts/), so the brackets are checked only on placeholders.
  it('has the eight mechanism videos in the library, each placeholder with a [bracketed] title and description', () => {
    for (const id of MECHANISMS) {
      const { data } = model.videos.get(id);
      if (!data.placeholder) continue;
      expect(data.title, id).toMatch(/^\[.+\]$/);
      expect(data.description, id).toMatch(/^\[.+\]$/);
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

  it('lists the two Start here videos in order, each with only its video (the rest is its row)', () => {
    expect(model.start.data.chapters).toEqual([{ video: 'sleep-and-cancer' }, { video: 'how-to-use-this-program' }]);
  });
});

// The video library, migrated from content/videos/*.md (project lead,
// 2026-11-09, SPEC §7.1, §22). The team edits it in Excel, so these check
// rules, not the sample rows: rows may be in any order, videos may be added,
// and a placeholder may become a real video (README "Videos"). The
// validator's fixture tests (validate-content.test.js) cover each rule.
describe('data/videos.csv', () => {
  const { model, warnings } = validateContent(process.cwd());
  const bytes = readFileSync('data/videos.csv');
  const { columns, rows } = parseCsvTable(bytes.toString('utf8'));
  // sleep-and-cancer replaced the placeholders how-sleep-works and
  // why-cancer-can-change-sleep: two intro videos, not three (project lead,
  // 2026-11-13, SPEC §7.3, §22).
  const INTRO = ['sleep-and-cancer', 'how-to-use-this-program'];
  const problemVideos = handoffProblems.map((p) => `${p.slug}-about`);

  it('has the SPEC §7.1 columns, in order', () => {
    expect(columns).toEqual(['video_id', 'title', 'description', 'youtube_url', 'duration', 'audio', 'handout', 'thumbnail']);
  });

  // Excel reads a CSV without a byte-order mark as Windows-1252 (or Mac
  // Roman), garbling the curly quotes, and the team then saves the garbled
  // text as "CSV UTF-8" (SPEC §7.1). Excel's own "CSV UTF-8" save writes one.
  it('starts with a UTF-8 byte-order mark, so Excel opens it as UTF-8', () => {
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  // video_ids are permanent (SPEC §7.1): ratings, events and pages.json use
  // them. Any order, and more rows, are fine.
  it('keeps the video_id of every intro, mechanism and problem video', () => {
    const ids = rows.map((r) => r.record.video_id);
    expect(ids).toEqual(expect.arrayContaining([...INTRO, ...MECHANISMS, ...problemVideos]));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('numbers its rows as Excel does: unique and increasing from row 2', () => {
    const numbers = rows.map((r) => r.row);
    expect(numbers[0]).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < numbers.length; i += 1) expect(numbers[i]).toBeGreaterThan(numbers[i - 1]);
  });

  it('marks each video without a link as a placeholder, with no YouTube ID and a [bracketed] title and description', () => {
    for (const { record } of rows.filter((r) => r.record.youtube_url === '')) {
      expect(model.videos.get(record.video_id).data, record.video_id).toMatchObject({ placeholder: true, youtube_id: '' });
      expect(record.title, record.video_id).toMatch(/^\[.+\]$/);
      expect(record.description, record.video_id).toMatch(/^\[.+\]$/);
    }
    // The build lists them (SPEC §20 M8 requires none).
    const placeholders = rows.filter((r) => r.record.youtube_url === '').map((r) => r.record.video_id);
    expect(warnings.filter((w) => w.code === 'placeholder-video').map((w) => w.message)).toEqual(placeholders);
  });

  it('gives each video with a link a YouTube ID, its own audio and handout, and a real duration', () => {
    for (const { record } of rows.filter((r) => r.record.youtube_url !== '')) {
      const { data } = model.videos.get(record.video_id);
      expect(data.placeholder, record.video_id).toBe(false);
      expect(data.youtube_id, record.video_id).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(data.duration, record.video_id).toMatch(/^\d{1,2}:[0-5]\d$/);
      expect([data.audio, data.handout], record.video_id).not.toContain(PLACEHOLDER_FILES.audio);
      expect([data.audio, data.handout], record.video_id).not.toContain(PLACEHOLDER_FILES.handout);
    }
  });

  it('gives every transcript in data/transcripts/ a video in the library', () => {
    for (const id of readTranscripts(TRANSCRIPTS_DIR).keys()) expect(model.videos.has(id), id).toBe(true);
  });
});

describe('the M1b layouts', () => {
  const { model, warnings } = validateContent(process.cwd());
  // A video may be added to the spreadsheet before a page names it: the
  // build warns about it rather than failing (SPEC §7.1).
  it('use only videos in the library, and the build lists any video no page uses', () => {
    const used = new Set();
    for (const { data } of model.problems.values()) {
      used.add(data.problem_video);
      for (const s of data.solutions ?? []) used.add(s.video);
    }
    for (const c of model.start.data.chapters) used.add(c.video);
    for (const id of used) expect(model.videos.has(id), id).toBe(true);
    const unused = [...model.videos.keys()].filter((id) => !used.has(id));
    expect(warnings.filter((w) => w.code === 'unused-video').map((w) => w.message)).toEqual(unused);
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

