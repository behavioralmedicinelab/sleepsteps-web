// The real content (data/areas.csv, content/problems/, content/start.md,
// data/videos.csv and data/worksheets.csv) obeys the content model's rules
// (SPEC §7.1-§7.3, §7.6).
//
// These check rules, never the sample values. The team may reword a title,
// a statement or a video's description (with or without brackets), add a problem, an area,
// a video or a worksheet, or change which solutions a problem lists (README
// "Content editing", SPEC §19.2), and `npm test`, which Workers Builds runs
// before every deploy, must still pass. So nothing here compares the content
// with the wording in docs/design/HANDOFF.md, and every count comes from the
// content itself. The handoff is read for one thing: the ids the site
// started with, which are permanent (SPEC §7, "Identifiers"). Each rule's
// own cases, on small fixtures, are in validate-content.test.js.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseCsvRecords, parseCsvTable } from '../../scripts/lib/csv.js';
import { PLACEHOLDER_FILES, TRANSCRIPTS_DIR, readTranscripts } from '../../scripts/lib/videos.js';
import { PLACEHOLDER_WORKSHEET, WORKSHEETS_DIR, WORKSHEETS_FILE } from '../../scripts/lib/worksheets.js';
import { validateContent } from '../../scripts/validate-content.js';
import { listFiles } from './helpers.js';

const handoff = readFileSync('docs/design/HANDOFF.md', 'utf8');
/** The 36 problems the site started with: only their slugs are used here. */
const handoffProblems = JSON.parse(handoff.match(/```json\n([\s\S]*?)\n```/)[1]);
const areas = parseCsvRecords(readFileSync('data/areas.csv', 'utf8'));

// The shared solution library the site started with: the eight mechanism
// videos (SPEC §7.1, §7.2). Only their ids are used, as permanent ids.
const MECHANISMS = [
  'sleep-drive', 'circadian-rhythm', 'conditioning', 'cognitive-arousal', 'physiological-arousal',
  'sleep-effort-and-control', 'treatment-symptoms-and-sleep', 'daytime-rhythms-and-sleep',
];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isText = (value) => typeof value === 'string' && value.trim() !== '';

describe('data/areas.csv (SPEC §7.2)', () => {
  it('has the SPEC §7.2 columns', () => {
    expect(Object.keys(areas[0])).toEqual(['area_id', 'name', 'description', 'source_name', 'order']);
  });

  // However many areas there are, and whatever they are called.
  it('gives each area an id of its own (lowercase words joined by hyphens), a name and a numeric order', () => {
    expect(areas.length).toBeGreaterThan(0);
    const ids = areas.map((a) => a.area_id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const area of areas) {
      expect(area.area_id).toMatch(SLUG);
      expect(isText(area.name), area.area_id).toBe(true);
      expect(area.order, area.area_id).toMatch(/^\d+(?:\.\d+)?$/);
    }
  });
});

describe('content/problems (SPEC §7.2)', () => {
  const slugs = readdirSync('content/problems').filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  const { model } = validateContent(process.cwd());

  it('names each file by its page_id: lowercase words joined by hyphens', () => {
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) expect(slug).toMatch(SLUG);
    expect([...model.problems.keys()].sort()).toEqual([...slugs].sort());
  });

  // A page_id is never renamed without a redirect (SPEC §7): ratings, usage
  // rows and links name it. More problems are fine; a problem that goes
  // needs a rule for its address in src/_redirects (SPEC §18.2).
  it('keeps the page_id of every problem the site started with, or redirects its address', () => {
    const redirects = readFileSync('src/_redirects', 'utf8');
    for (const { slug } of handoffProblems) {
      const kept = slugs.includes(slug);
      const redirected = new RegExp(`^/problems/${slug}/ +\\S+`, 'm').test(redirects);
      expect(kept || redirected, `${slug}: content/problems/${slug}.md is gone, and src/_redirects has no rule for /problems/${slug}/`).toBe(true);
    }
  });

  // The wording is the team's to change; only its shape is checked.
  it('gives every problem a title, a statement, an area in data/areas.csv and a numeric order', () => {
    const areaIds = areas.map((a) => a.area_id);
    for (const [slug, { data }] of model.problems) {
      expect(isText(data.title), `${slug}: title`).toBe(true);
      expect(isText(data.statement), `${slug}: statement`).toBe(true);
      expect(areaIds, `${slug}: area`).toContain(data.area);
      expect(Number.isFinite(data.order), `${slug}: order`).toBe(true);
    }
  });
});

describe('the problems and Start here (SPEC §7.1-§7.3)', () => {
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

  // A problem either lists solutions or is stand-alone, with the one video
  // made for it (SPEC §7.2); which problems are which is the team's choice.
  it('gives every problem a problem video in the library, and 1-3 main and 0-3 extra solutions or, stand-alone, none', () => {
    for (const [slug, { data }] of problems) {
      expect(model.videos.has(data.problem_video), slug).toBe(true);
      const { main, extra } = tiers(slug);
      if (data.standalone === true) {
        expect({ main, extra }, slug).toEqual({ main: 0, extra: 0 });
        continue;
      }
      expect(main, slug).toBeGreaterThanOrEqual(1);
      expect(main, slug).toBeLessThanOrEqual(3);
      expect(extra, slug).toBeLessThanOrEqual(3);
    }
  });

  // Any video in the library may be a solution. A solution names its tier
  // and its video and nothing else: the card's title and description are the
  // video's, the same on every problem (project lead, 2026-11-14; SPEC §7.2).
  it('gives every solution a video in the library, once on its page, and no text of its own', () => {
    for (const [slug, { data }] of problems) {
      const onPage = [data.problem_video, ...(data.solutions ?? []).map((s) => s.video)];
      expect(new Set(onPage).size, slug).toBe(onPage.length);
      for (const s of data.solutions ?? []) {
        expect(model.videos.has(s.video), `${slug}: ${s.video}`).toBe(true);
        expect(Object.keys(s).sort(), `${slug}: ${s.video}`).toEqual(['tier', 'video']);
      }
    }
  });

  it('lists as related only other problems that exist, three at most', () => {
    for (const [slug, { data }] of problems) {
      const related = data.related ?? [];
      expect(related.length, slug).toBeLessThanOrEqual(3);
      expect(new Set(related).size, slug).toBe(related.length);
      for (const other of related) {
        expect(other, slug).not.toBe(slug);
        expect(problems.has(other), `${slug}: ${other}`).toBe(true);
      }
    }
  });

  // However many intro videos there are (README "Start here").
  it('lists the Start here videos, each once and with only its video (the rest is its row)', () => {
    const chapters = model.start.data.chapters;
    expect(chapters.length).toBeGreaterThan(0);
    for (const chapter of chapters) {
      expect(Object.keys(chapter)).toEqual(['video']);
      expect(model.videos.has(chapter.video), chapter.video).toBe(true);
    }
    expect(new Set(chapters.map((c) => c.video)).size).toBe(chapters.length);
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
  // them. Any order, and more rows, are fine; so are other titles.
  it('keeps the video_id of every intro, mechanism and problem video the site started with', () => {
    const ids = rows.map((r) => r.record.video_id);
    expect(ids).toEqual(expect.arrayContaining([...INTRO, ...MECHANISMS, ...problemVideos]));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('numbers its rows as Excel does: unique and increasing from row 2', () => {
    const numbers = rows.map((r) => r.row);
    expect(numbers[0]).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < numbers.length; i += 1) expect(numbers[i]).toBeGreaterThan(numbers[i - 1]);
  });

  // Its title and description are the team's to write at any time: the
  // blank link is what makes a row a placeholder (README "Videos").
  it('marks each video without a link as a placeholder, with no YouTube ID', () => {
    for (const { record } of rows.filter((r) => r.record.youtube_url === '')) {
      expect(model.videos.get(record.video_id).data, record.video_id).toMatchObject({ placeholder: true, youtube_id: '' });
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

// The worksheets of the solution videos (project lead, 2026-11-13; SPEC
// §7.6). The team edits the file in Excel, so, as for data/videos.csv, these
// check rules, never the sample rows: how many there are, which video has
// how many, their ids' numbering and their titles are the team's (README
// "Worksheets"). The rules are checked on the files as committed and again
// after each kind of edit the team makes ("after the team's edits", below),
// so a rule that pinned the samples would fail here, not on the team's
// push. (That the page the accessibility check opens shows a worksheet is
// that check's own rule: scripts/a11y/run.js.)

/** CSV text as Excel's "CSV UTF-8" save writes it: the byte-order mark, then the rows, each ended CRLF. */
const csvText = (columns, records) => {
  const cell = (value) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [columns, ...records.map((record) => columns.map((c) => record[c] ?? ''))].map((cells) => `${cells.map(cell).join(',')}\r\n`);
  return `${String.fromCharCode(0xfeff)}${lines.join('')}`;
};

/**
 * The rules of data/worksheets.csv (SPEC §7.6), as tests of the content in
 * `root`: the repository, or a copy of its content with one edit.
 */
function worksheetRules(root) {
  const at = (...parts) => path.join(root, ...parts);
  const { errors, model, warnings } = validateContent(root);
  const bytes = readFileSync(at(WORKSHEETS_FILE));
  const { columns, rows } = parseCsvTable(bytes.toString('utf8'));
  const solutionVideos = new Set([...model.problems.values()].flatMap(({ data }) => (data.solutions ?? []).map((s) => s.video)));
  const countFor = (video) => rows.filter((r) => r.record.video_id === video).length;

  it('passes the content check', () => {
    expect(errors).toEqual([]);
  });

  it('is data/worksheets.csv, with the SPEC §7.6 columns, in order', () => {
    expect(WORKSHEETS_FILE).toBe('data/worksheets.csv');
    expect(columns).toEqual(['worksheet_id', 'video_id', 'title', 'file']);
  });

  // As data/videos.csv (SPEC §7.1): without the mark, Excel opens a
  // double-clicked CSV as Windows-1252 and garbles the curly quotes.
  it('starts with a UTF-8 byte-order mark, so Excel opens it as UTF-8', () => {
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    // The same mark as the video library, and no second one.
    expect([...readFileSync(at('data/videos.csv')).subarray(0, 3)]).toEqual([...bytes.subarray(0, 3)]);
    expect(bytes.subarray(3).includes(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
  });

  // No test of its line endings: the committed file has data/videos.csv's
  // (LF), and Excel's "CSV UTF-8" save writes CRLF, which the parser reads
  // as well (validate-content.test.js; the edited copies below are CRLF).

  // worksheet_ids are permanent, like video_ids (SPEC §7.6): the links carry them.
  it('gives every row its own lowercase-hyphenated worksheet_id, and the model holds each row in the file\'s order', () => {
    const ids = rows.map((r) => r.record.worksheet_id);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...model.worksheets.keys()]).toEqual(ids);
    expect([...model.worksheets.values()].map((w) => w.row)).toEqual(rows.map((r) => r.row));
  });

  it('names a video in the library, a title and a PDF in media/worksheets/ of 25 MiB at most on every row', () => {
    // No folder is no worksheets: git keeps no empty folder.
    const names = new Set(existsSync(at(WORKSHEETS_DIR)) ? readdirSync(at(WORKSHEETS_DIR)) : []);
    for (const { record } of rows) {
      expect(model.videos.has(record.video_id), record.worksheet_id).toBe(true);
      expect(record.title, record.worksheet_id).toMatch(/\S/);
      expect(record.file, record.worksheet_id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/i);
      // The exact name, capitals included (the host is case-sensitive).
      expect(names.has(record.file), record.worksheet_id).toBe(true);
      expect(statSync(at(WORKSHEETS_DIR, record.file)).size, record.worksheet_id).toBeLessThanOrEqual(25 * 1024 * 1024);
    }
  });

  // The stand-in may be deleted once no row names it.
  it('has the placeholder worksheet while a row names it: a small one-page PDF that says what it is', () => {
    expect(PLACEHOLDER_WORKSHEET).toBe('placeholder-worksheet.pdf');
    if (!existsSync(at(WORKSHEETS_DIR, PLACEHOLDER_WORKSHEET))) {
      expect(rows.filter((r) => r.record.file === PLACEHOLDER_WORKSHEET)).toEqual([]);
      return;
    }
    const pdf = readFileSync(at(WORKSHEETS_DIR, PLACEHOLDER_WORKSHEET)).toString('latin1');
    expect(pdf.startsWith('%PDF-1.')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toMatch(/\/Type \/Pages \/Kids \[3 0 R\] \/Count 1\b/);
    expect(pdf).toContain('([Placeholder worksheet]) Tj');
    expect(pdf.length).toBeLessThan(2048);
    // Made as media/pdf/placeholder-handout.pdf was: the same file but for its words.
    if (existsSync(at('media/pdf', PLACEHOLDER_FILES.handout))) {
      const handout = readFileSync(at('media/pdf', PLACEHOLDER_FILES.handout)).toString('latin1');
      const frame = (text) => text.replace(/\/Length \d+/, '/Length N').replace(/stream\n[\s\S]*?endstream/, 'stream').replace(/startxref\n\d+/, 'startxref');
      expect(frame(pdf)).toBe(frame(handout));
    }
    // Its cross-reference table points at its objects, and its stream is as long as it says.
    const offsets = [...pdf.matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((offset, i) => expect(pdf.slice(offset, offset + `${i + 1} 0 obj`.length), `object ${i + 1}`).toBe(`${i + 1} 0 obj`));
    expect(pdf.slice(Number(pdf.match(/startxref\n(\d+)/)[1])).startsWith('xref')).toBe(true);
    const stream = pdf.match(/stream\n([\s\S]*?)\nendstream/)[1];
    expect(stream.length).toBe(Number(pdf.match(/\/Length (\d+)/)[1]));
  });

  // What a placeholder row must keep (SPEC §7): the brackets round its
  // title, which say on the page that the words are not final. Nothing
  // about the words inside them, the row's id or how many rows a video has.
  it('marks each row that names the placeholder file as a placeholder, with a [bracketed] title, and the build lists them', () => {
    const placeholders = rows.filter((r) => r.record.file === PLACEHOLDER_WORKSHEET).map((r) => r.record.worksheet_id);
    for (const { record } of rows) {
      expect(model.worksheets.get(record.worksheet_id).data.placeholder, record.worksheet_id).toBe(record.file === PLACEHOLDER_WORKSHEET);
      if (record.file === PLACEHOLDER_WORKSHEET) expect(record.title, record.worksheet_id).toMatch(/^\[.+\]$/);
    }
    expect(warnings.filter((w) => w.code === 'placeholder-worksheet').map((w) => w.message)).toEqual(placeholders);
  });

  // A video on YouTube has its own worksheets, as it has its own handout.
  it('gives no video with a YouTube link a placeholder worksheet', () => {
    for (const { record } of rows.filter((r) => r.record.file === PLACEHOLDER_WORKSHEET)) {
      expect(model.videos.get(record.video_id).data.placeholder, record.worksheet_id).toBe(true);
    }
  });

  it('lists a worksheet no page shows and a solution video with none as warnings, and nothing else', () => {
    const notShown = rows.filter((r) => !solutionVideos.has(r.record.video_id)).map((r) => `${r.record.worksheet_id} (${r.record.video_id})`);
    expect(warnings.filter((w) => w.code === 'worksheet-not-shown').map((w) => w.message)).toEqual(notShown);
    const none = [...model.videos.keys()].filter((id) => solutionVideos.has(id) && countFor(id) === 0);
    expect(warnings.filter((w) => w.code === 'solution-no-worksheet').map((w) => w.message)).toEqual(none);
  });
}

describe('data/worksheets.csv', () => {
  worksheetRules(process.cwd());
});

// The edits the team makes (README "Worksheets"), each made to a copy of the
// committed content: every rule above still holds, so `npm test`, and with
// it the deploy, doesn't stop on any of them. Each edit is worked out from
// the files as they are, not from the sample rows, so these keep checking
// something once the team's own worksheets replace the samples.
describe('data/worksheets.csv after the team\'s edits', () => {
  const copies = [];
  afterAll(() => copies.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
  const table = (root, file) => parseCsvTable(readFileSync(path.join(root, file), 'utf8'));
  /** A copy of the content (data/, content/ and media/) with `change(dir, sheets, videos)` made to it. */
  const edited = (change) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sleepsteps-content-'));
    copies.push(dir);
    for (const folder of ['data', 'content', 'media']) cpSync(folder, path.join(dir, folder), { recursive: true });
    const sheets = table(dir, WORKSHEETS_FILE);
    const videos = table(dir, 'data/videos.csv');
    change(dir, sheets, videos);
    writeFileSync(path.join(dir, WORKSHEETS_FILE), csvText(sheets.columns, sheets.rows.map((r) => r.record)));
    writeFileSync(path.join(dir, 'data/videos.csv'), csvText(videos.columns, videos.rows.map((r) => r.record)));
    return dir;
  };
  const records = (root) => table(root, WORKSHEETS_FILE).rows.map((r) => r.record);
  const committed = records(process.cwd());
  // A title in the brackets of a placeholder, or without them.
  const retitled = (title, words) => (/^\[.*\]$/.test(title) ? `[${words}]` : words);

  describe('saved again from Excel, unchanged', () => {
    const dir = edited(() => {});
    worksheetRules(dir);
    it('holds the same rows', () => {
      expect(records(dir)).toEqual(committed);
    });
  });

  // "Delete a sample row a video doesn't need."
  describe('with a row deleted', () => {
    const dir = edited((_, sheets) => sheets.rows.pop());
    worksheetRules(dir);
    it('holds every row but that one', () => {
      expect(records(dir)).toEqual(committed.slice(0, -1));
    });
  });

  describe('with every row deleted: the header alone, no worksheets yet', () => {
    const dir = edited((_, sheets) => sheets.rows.splice(0));
    worksheetRules(dir);
    it('holds no row', () => {
      expect(records(dir)).toEqual([]);
    });
  });

  describe('with a worksheet\'s title reworded', () => {
    const dir = edited((_, sheets) => {
      for (const { record } of sheets.rows.slice(0, 1)) record.title = retitled(record.title, 'Sleep under 6 hours -> a plan for “bed & sleep”, part 1');
    });
    worksheetRules(dir);
    it('holds the new title, as typed', () => {
      expect(records(dir).map((r) => r.title)).toEqual(committed.map((r, i) => (i ? r.title : retitled(r.title, 'Sleep under 6 hours -> a plan for “bed & sleep”, part 1'))));
    });
  });

  // A worksheet's title doesn't follow its video's: renaming the video in
  // data/videos.csv changes the section's hidden heading text and nothing
  // in this file.
  describe('with the video of a worksheet renamed in data/videos.csv', () => {
    const renamed = committed[0]?.video_id;
    const dir = edited((_, sheets, videos) => {
      for (const { record } of videos.rows.filter((r) => r.record.video_id === renamed)) record.title = retitled(record.title, 'Another name for this video');
    });
    worksheetRules(dir);
    it('holds the same rows, and the video its new title', () => {
      expect(records(dir)).toEqual(committed);
      if (renamed === undefined) return;
      const { model } = validateContent(dir);
      expect(model.videos.get(renamed).data.title).toMatch(/^\[?Another name for this video\]?$/);
      expect(model.videos.get(renamed).data.title).not.toBe(validateContent(process.cwd()).model.videos.get(renamed).data.title);
    });
  });

  // "Give a row its own PDF": the row stops being a placeholder, and its
  // title loses its brackets.
  describe('with a worksheet\'s own PDF and title', () => {
    const dir = edited((root, sheets) => {
      // (No folder is no worksheets yet: git keeps no empty folder.)
      mkdirSync(path.join(root, WORKSHEETS_DIR), { recursive: true });
      writeFileSync(path.join(root, WORKSHEETS_DIR, 'Zz-Test-Own-Worksheet.pdf'), '%PDF-1.4\n%%EOF\n');
      // On a video that isn't on YouTube yet a real worksheet is fine too.
      for (const { record } of sheets.rows.slice(0, 1)) Object.assign(record, { title: 'Sleep diary: a two-week record of your nights', file: 'Zz-Test-Own-Worksheet.pdf' });
    });
    worksheetRules(dir);
    it('holds the row with its own file, no longer a placeholder', () => {
      if (!committed.length) return;
      const { model } = validateContent(dir);
      expect(model.worksheets.get(committed[0].worksheet_id).data).toMatchObject({ title: 'Sleep diary: a two-week record of your nights', file: 'Zz-Test-Own-Worksheet.pdf', placeholder: false });
    });
  });
});

describe('the pages that show videos', () => {
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

