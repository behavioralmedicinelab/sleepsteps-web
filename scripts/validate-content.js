// Content validation (SPEC §7.1-§7.3, §9.2, §9.3, §18.1). Fails the build,
// with the file and field, on anything a template would otherwise render
// wrongly or silently drop: missing or misspelt fields, unknown references,
// solution counts outside 1-3 main / 0-3 extra, a video used twice on one
// page, and media files that are missing or too large. Warns, without
// failing, about placeholder content that can still build, and about a real
// (non-placeholder) video without its handout, audio-only version or
// transcript, which every video is to have by launch.
//
// CLI:    node scripts/validate-content.js [--no-placeholders]
//         (exit code 1 on errors; --no-placeholders is the launch check,
//         SPEC §20 M8: it also fails on placeholder videos and on any video
//         without a handout, audio or a transcript)
// Module: validateContent(rootDir, { launch }) -> { errors, warnings, model }
//
// Front matter is read with Eleventy's own parser (gray-matter with js-yaml,
// resolved from Eleventy's install), so this script reads every file exactly
// as the build does. No extra dependency (SPEC §5).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCsvRecords } from './lib/csv.js';

const require = createRequire(import.meta.url);
const fromEleventy = createRequire(require.resolve('@11ty/eleventy'));
const matter = fromEleventy('gray-matter');
const yaml = fromEleventy('js-yaml');
const MarkdownIt = fromEleventy('markdown-it');

// Transcripts parsed as Eleventy renders them: markdown-it with HTML on and
// indented code off (Eleventy's defaults, src/Engines/Markdown.js).
const markdown = new MarkdownIt({ html: true }).disable('code');

export const TIMES_OF_DAY = ['evening', 'bedtime', 'night', 'early-morning', 'day', 'any'];
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // the static asset limit (SPEC §9.2)
export const SOLUTION_LIMITS = { main: [1, 3], extra: [0, 3] };

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const DURATION = /^\d{1,2}:[0-5]\d(?::[0-5]\d)?$/;
const BRACKETED = /^\[.*\]$/;
// A line of a placeholder's stand-in transcript: [bracketed] text, perhaps as
// a list item, such as "[Transcript of “Pain”.]" or "- [one point]".
const STAND_IN_LINE = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?\[.*\]\s*$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const VIDEO_KEYS = ['title', 'youtube_id', 'duration', 'audio', 'handout', 'thumbnail', 'placeholder'];
const PROBLEM_KEYS = [
  'title', 'statement', 'source_title', 'area', 'time_of_day', 'order', 'new',
  'problem_video', 'is_this_you', 'solutions', 'related',
];
const MEDIA = {
  audio: { dir: 'media/audio', extensions: ['.mp3'] },
  handout: { dir: 'media/pdf', extensions: ['.pdf'] },
  thumbnail: { dir: 'media/thumbs', extensions: ['.jpg', '.jpeg', '.png', '.webp'] },
};

// Warning codes, with the heading the CLI prints above each group.
export const WARNINGS = {
  'placeholder-video': 'Placeholder videos (no real YouTube video yet; SPEC §20 M8 requires none)',
  'missing-handout': 'Videos without a handout (every video needs one by launch, SPEC §9.3)',
  'missing-audio': 'Videos without an audio-only version (every video needs one by launch, SPEC §9.2)',
  'missing-transcript': 'Videos without a transcript (every video needs one by launch, SPEC §9.3)',
  'related-few': 'Problems with fewer than 2 related topics (SPEC §7.2 asks for 2-3)',
  'is-this-you-empty': 'Problems with no "Is this you?" text',
  'bullets-few': 'Problems with fewer than 2 "Is this you?" bullets (SPEC §7.2 asks for 2-4)',
  'unused-video': 'Videos not used on any page',
  'keywords-missing': 'Searchable pages with no keywords in data/keywords.csv (SPEC §8.2)',
  'unknown-key': 'Front-matter keys the templates do not read (a typo?)',
};

const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isGiven = (value) => value !== undefined && value !== null && value !== '';
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const listOf = (values) => values.map((v) => `"${v}"`).join(', ');

/** Read front matter the way Eleventy does. Returns { data, body } or throws. */
export function parseFrontMatter(text) {
  const { data, content } = matter(text, { engines: { yaml: yaml.load.bind(yaml) } });
  return { data: data ?? {}, body: content };
}

/** "content/x.md: field: message" */
export function formatIssue({ file, field, message }) {
  return [file, field, message].filter(Boolean).join(': ');
}

/** A link a transcript may carry: a path on this site, or a #fragment. */
const isSiteLink = (href) => /^\/(?!\/)/.test(href) || href.startsWith('#');

/**
 * Images and links in a transcript, from the parsed Markdown (so inline,
 * reference and <autolink> forms are all caught). An image would load from
 * wherever it points (the CSP blocks other sites, SPEC §16.1); a link to
 * another site would skip the outbound-link allowlist and rel="noreferrer".
 * Links to pages on this site ("/problems/pain/") are fine.
 */
function transcriptLinkProblems(body, lines) {
  const problems = [];
  // The line a token is on: the first line of its block that mentions it.
  const lineOf = (block, needle) => {
    const [start, end] = block.map ?? [0, 0];
    for (let i = start; i < end; i += 1) {
      if (needle && lines[i]?.includes(needle)) return i + 1;
    }
    return start + 1;
  };
  for (const block of markdown.parse(body, {})) {
    for (const token of block.children ?? []) {
      if (token.type === 'image') {
        const src = token.attrGet('src') ?? '';
        problems.push(`line ${lineOf(block, src)} has an image ("${src}"); transcripts are text only`);
      } else if (token.type === 'link_open') {
        const href = token.attrGet('href') ?? '';
        if (!isSiteLink(href)) {
          problems.push(`line ${lineOf(block, href)} links to "${href}"; a transcript can link only to pages on this site, such as /problems/pain/`);
        }
      }
    }
  }
  return problems;
}

/**
 * Transcript bodies are plain Markdown: no headings (they would break the
 * page's h1 > h2 > h3 outline), no raw HTML (the CSP and our own markup
 * rules apply to it, SPEC §16.1), including comments (a body that is only a
 * comment would show an empty "Read transcript"), no images and no links to
 * other sites. Returns a list of problems.
 */
export function transcriptProblems(body) {
  const problems = [];
  const lines = body.split(/\r?\n/);
  let fenced = false;
  lines.forEach((line, i) => {
    if (/^\s{0,3}(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) return;
    if (/^\s{0,3}#{1,6}(\s|$)/.test(line)) {
      problems.push(`line ${i + 1} is a Markdown heading ("${line.trim()}"); transcripts can't have headings`);
    } else if (/^\s{0,3}(=+|-+)\s*$/.test(line) && i > 0 && lines[i - 1].trim() !== '') {
      problems.push(`line ${i + 1} ("${line.trim()}") turns the line above into a heading; add a blank line before it`);
    }
  });
  const outsideCode = body.replace(/`[^`]*`/g, '');
  if (/<\/?[a-z][a-z0-9-]*(\s[^>]*)?\/?>/i.test(outsideCode)) {
    problems.push('contains HTML tags; transcripts are plain Markdown');
  }
  if (outsideCode.includes('<!--')) {
    problems.push("contains an HTML comment (<!-- -->), which the page doesn't show; transcripts are plain Markdown");
  }
  problems.push(...transcriptLinkProblems(body, lines));
  return problems;
}

function listMarkdown(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

/**
 * Validate the content in `rootDir` (the repository root).
 * `launch: true` is the launch check (SPEC §20 M8): placeholder videos, and
 * any video without a handout, audio or a transcript, are errors instead of
 * warnings.
 * @param {string} rootDir
 * @param {{ launch?: boolean }} [options]
 * @returns {{ errors: object[], warnings: object[], model: object }}
 */
export function validateContent(rootDir = process.cwd(), { launch = false } = {}) {
  const errors = [];
  const warnings = [];
  const error = (file, field, message) => errors.push({ file, field, message });
  const warn = (code, file, message) => warnings.push({ code, file, message });
  const at = (...parts) => path.join(rootDir, ...parts);

  const read = (rel) => {
    try {
      return parseFrontMatter(readFileSync(at(rel), 'utf8'));
    } catch (e) {
      error(rel, '', `can't read the front matter: ${e.reason ?? e.message}`);
      return null;
    }
  };

  // ---- Areas (data/areas.csv) -------------------------------------------
  let areas = [];
  try {
    areas = parseCsvRecords(readFileSync(at('data/areas.csv'), 'utf8'));
  } catch (e) {
    error('data/areas.csv', '', e.message);
  }
  const areaIds = new Set(areas.map((a) => a.area_id));

  // ---- Videos (content/videos/<video_id>.md, SPEC §7.1) ------------------
  const videos = new Map();
  for (const name of listMarkdown(at('content/videos'))) {
    const file = `content/videos/${name}`;
    const id = name.slice(0, -3);
    const parsed = read(file);
    if (!parsed) continue;
    const { data, body } = parsed;
    videos.set(id, { file, data, body });

    if (!SLUG.test(id)) error(file, '', 'the file name (the video_id) must be lowercase words joined by hyphens');
    for (const key of Object.keys(data)) {
      if (!VIDEO_KEYS.includes(key)) error(file, key, `unknown field; a video takes only ${listOf(VIDEO_KEYS)}`);
    }

    const placeholder = data.placeholder === true;
    if (data.placeholder !== undefined && typeof data.placeholder !== 'boolean') {
      error(file, 'placeholder', 'must be true or false');
    }
    if (!isText(data.title)) error(file, 'title', 'required');

    if (data.youtube_id === undefined || data.youtube_id === null || data.youtube_id === '') {
      error(file, 'youtube_id', 'required (use "PLACEHOLDER" with placeholder: true until the video is on YouTube)');
    } else if (typeof data.youtube_id !== 'string') {
      error(file, 'youtube_id', 'put the ID in double quotes');
    } else if (!placeholder) {
      if (/^placeholder$/i.test(data.youtube_id)) {
        error(file, 'youtube_id', 'is a placeholder: add the real YouTube ID, or set placeholder: true');
      } else if (!YOUTUBE_ID.test(data.youtube_id)) {
        error(file, 'youtube_id', `"${data.youtube_id}" isn't a YouTube video ID (11 letters, digits, - or _)`);
      }
    }

    if (data.duration === undefined || data.duration === null || data.duration === '') {
      error(file, 'duration', 'required, e.g. "6:40"');
    } else if (typeof data.duration !== 'string') {
      error(file, 'duration', 'put the duration in double quotes, e.g. "6:40"');
    } else if (!DURATION.test(data.duration) && !(placeholder && BRACKETED.test(data.duration))) {
      error(file, 'duration', `"${data.duration}" must be minutes:seconds, e.g. "6:40" (or h:mm:ss)`);
    }

    for (const [field, { dir, extensions }] of Object.entries(MEDIA)) {
      const value = data[field];
      if (value === undefined || value === null || value === '') continue;
      if (typeof value !== 'string' || !FILE_NAME.test(value)) {
        error(file, field, `must be a file name in ${dir}/, e.g. "${id}${extensions[0]}"`);
        continue;
      }
      if (!extensions.includes(path.extname(value).toLowerCase())) {
        error(file, field, `"${value}" must be a ${extensions.join(' or ')} file`);
        continue;
      }
      const target = at(dir, value);
      if (!existsSync(target) || !statSync(target).isFile()) {
        error(file, field, `${dir}/${value} does not exist`);
      } else if (field === 'audio' && statSync(target).size > MAX_AUDIO_BYTES) {
        error(file, field, `${dir}/${value} is over 25 MiB, the most a static file can be (SPEC §9.2)`);
      }
    }

    for (const problem of transcriptProblems(body)) error(file, 'transcript', problem);
    // A real video can't keep a placeholder's [bracketed] stand-in, as with
    // its duration; with the stand-in deleted it is just missing (below).
    const lines = body.split(/\r?\n/).filter((line) => line.trim() !== '');
    if (!placeholder && lines.length > 0 && lines.every((line) => STAND_IN_LINE.test(line))) {
      error(file, 'transcript', 'is still the [bracketed] stand-in: put in the real transcript, or delete it until there is one');
    }

    if (placeholder) {
      if (launch) error(file, 'placeholder', 'placeholder videos are not allowed at launch');
      else warn('placeholder-video', file, id);
    }

    // Every video is to have a handout, an audio-only version and a
    // transcript (SPEC §9.2, §9.3). Placeholders are left out of the warnings
    // (they are already listed), but not out of the launch check. The
    // transcript is the file's body; whitespace alone is none, as on the page.
    for (const [field, present, missing, needs] of [
      ['handout', isGiven(data.handout), 'missing-handout', 'a handout (SPEC §9.3)'],
      ['audio', isGiven(data.audio), 'missing-audio', 'an audio-only version (SPEC §9.2)'],
      ['transcript', body.trim() !== '', 'missing-transcript', 'a transcript (SPEC §9.3)'],
    ]) {
      if (present) continue;
      if (launch) error(file, field, `required at launch: every video has ${needs}`);
      else if (!placeholder) warn(missing, file, id);
    }
  }

  const used = new Set();
  const checkVideoRef = (file, field, id) => {
    if (!isText(id)) {
      error(file, field, 'required: a video_id (a file name in content/videos/, without .md)');
      return false;
    }
    if (!videos.has(id)) {
      error(file, field, `unknown video "${id}" (no content/videos/${id}.md)`);
      return false;
    }
    used.add(id);
    return true;
  };

  // ---- Problems (content/problems/<slug>.md, SPEC §7.2) ------------------
  const problems = new Map();
  for (const name of listMarkdown(at('content/problems'))) {
    const file = `content/problems/${name}`;
    const parsed = read(file);
    if (parsed) problems.set(name.slice(0, -3), { file, data: parsed.data });
  }

  for (const [slug, { file, data }] of problems) {
    if (!SLUG.test(slug)) error(file, '', 'the file name (the page_id) must be lowercase words joined by hyphens');
    for (const key of Object.keys(data)) {
      if (!PROBLEM_KEYS.includes(key)) warn('unknown-key', file, key);
    }
    for (const field of ['title', 'statement']) {
      if (!isText(data[field])) error(file, field, 'required');
    }
    if (data.source_title !== undefined && typeof data.source_title !== 'string') {
      error(file, 'source_title', 'must be text');
    }
    if (!isText(data.area)) error(file, 'area', `required: one of ${listOf([...areaIds])}`);
    else if (!areaIds.has(data.area)) error(file, 'area', `unknown area "${data.area}" (not in data/areas.csv)`);
    if (!TIMES_OF_DAY.includes(data.time_of_day)) {
      error(file, 'time_of_day', `must be one of ${listOf(TIMES_OF_DAY)}`);
    }
    if (typeof data.order !== 'number' || !Number.isFinite(data.order)) {
      error(file, 'order', 'required: a number (the order within the area)');
    }
    if (data.new !== undefined && typeof data.new !== 'boolean') error(file, 'new', 'must be true or false');

    // Every video on the page, to catch one used twice (its ids, such as
    // transcript-<video_id>, would clash, and ratings couldn't tell them apart).
    const onPage = [];
    if (checkVideoRef(file, 'problem_video', data.problem_video)) onPage.push(['problem_video', data.problem_video]);

    const itsYou = data.is_this_you;
    if (itsYou === undefined || itsYou === null) {
      warn('is-this-you-empty', file, slug);
    } else if (!isObject(itsYou)) {
      error(file, 'is_this_you', 'must have `summary` and `bullets` under it');
    } else {
      for (const key of Object.keys(itsYou)) {
        if (!['summary', 'bullets'].includes(key)) error(file, `is_this_you.${key}`, 'unknown field; use summary and bullets');
      }
      if (itsYou.summary !== undefined && itsYou.summary !== null && typeof itsYou.summary !== 'string') {
        error(file, 'is_this_you.summary', 'must be text');
      }
      const bullets = itsYou.bullets ?? [];
      if (!Array.isArray(bullets) || !bullets.every(isText)) {
        error(file, 'is_this_you.bullets', 'must be a list of text items');
      } else {
        if (bullets.length > 4) error(file, 'is_this_you.bullets', `has ${bullets.length} items; the most is 4`);
        if (!isText(itsYou.summary) && bullets.length === 0) warn('is-this-you-empty', file, slug);
        else if (bullets.length < 2) warn('bullets-few', file, slug);
      }
    }

    if (!Array.isArray(data.solutions)) {
      error(file, 'solutions', 'required: a list of 1-3 main and 0-3 extra solutions');
    } else {
      const counts = { main: 0, extra: 0 };
      data.solutions.forEach((solution, i) => {
        const field = `solutions[${i + 1}]`;
        if (!isObject(solution)) {
          error(file, field, 'must have tier, video and blurb');
          return;
        }
        for (const key of Object.keys(solution)) {
          if (!['tier', 'video', 'blurb'].includes(key)) error(file, `${field}.${key}`, 'unknown field; use tier, video and blurb');
        }
        if (!(solution.tier in counts)) error(file, `${field}.tier`, 'must be "main" or "extra"');
        else counts[solution.tier] += 1;
        if (checkVideoRef(file, `${field}.video`, solution.video)) onPage.push([`${field}.video`, solution.video]);
        if (!isText(solution.blurb)) error(file, `${field}.blurb`, 'required: one or two sentences, "Try this if ..."');
      });
      for (const [tier, [min, max]] of Object.entries(SOLUTION_LIMITS)) {
        if (counts[tier] < min || counts[tier] > max) {
          error(file, 'solutions', `has ${counts[tier]} ${tier} solution${counts[tier] === 1 ? '' : 's'}; allowed ${min}-${max}`);
        }
      }
    }

    const seen = new Map();
    for (const [field, id] of onPage) {
      if (seen.has(id)) error(file, field, `video "${id}" is already on this page (${seen.get(id)}); each video appears once per page`);
      else seen.set(id, field);
    }

    const related = data.related ?? [];
    if (!Array.isArray(related)) {
      error(file, 'related', 'must be a list of problem slugs');
    } else {
      const unique = new Set();
      related.forEach((ref, i) => {
        const field = `related[${i + 1}]`;
        if (ref === slug) error(file, field, "a problem can't list itself");
        else if (!problems.has(ref)) error(file, field, `unknown problem "${ref}" (no content/problems/${ref}.md)`);
        if (unique.has(ref)) error(file, field, `"${ref}" is listed twice`);
        unique.add(ref);
      });
      if (related.length > 3) error(file, 'related', `has ${related.length} topics; the most is 3`);
      else if (related.length < 2) warn('related-few', file, slug);
    }
  }

  // ---- Start here (content/start.md, SPEC §7.3) ---------------------------
  let start = null;
  if (existsSync(at('content/start.md'))) {
    const file = 'content/start.md';
    const parsed = read(file);
    if (parsed) {
      start = { file, data: parsed.data };
      const chapters = parsed.data.chapters;
      if (!Array.isArray(chapters) || chapters.length === 0) {
        error(file, 'chapters', 'required: a list of intro videos, each with video and description');
      } else {
        const seen = new Set();
        chapters.forEach((chapter, i) => {
          const field = `chapters[${i + 1}]`;
          if (!isObject(chapter)) {
            error(file, field, 'must have video and description');
            return;
          }
          for (const key of Object.keys(chapter)) {
            if (!['video', 'description'].includes(key)) error(file, `${field}.${key}`, 'unknown field; use video and description');
          }
          if (checkVideoRef(file, `${field}.video`, chapter.video)) {
            if (seen.has(chapter.video)) error(file, `${field}.video`, `video "${chapter.video}" is already listed`);
            seen.add(chapter.video);
          }
          if (!isText(chapter.description)) error(file, `${field}.description`, 'required: one line');
        });
      }
    }
  } else {
    error('content/start.md', '', 'missing');
  }

  for (const [id, { file }] of videos) {
    if (!used.has(id)) warn('unused-video', file, id);
  }

  // ---- Search keywords (data/keywords.csv, SPEC §8.2) ---------------------
  // One row per searchable page: every problem, Start here, and every
  // information page without `search: false` (scripts/build-data.js). An
  // unknown or repeated page_id fails; a page without keywords is a warning.
  const searchable = [...problems.keys()];
  const notSearched = new Set();
  if (start) searchable.push('start');
  for (const name of listMarkdown(at('content/pages'))) {
    const parsed = read(`content/pages/${name}`);
    if (parsed && parsed.data.search !== false) searchable.push(name.slice(0, -3));
    else if (parsed) notSearched.add(name.slice(0, -3));
  }
  const keywordsFile = 'data/keywords.csv';
  let keywords = [];
  if (existsSync(at(keywordsFile))) {
    try {
      keywords = parseCsvRecords(readFileSync(at(keywordsFile), 'utf8'));
    } catch (e) {
      error(keywordsFile, '', e.message);
    }
    const columns = Object.keys(keywords[0] ?? {});
    if (keywords.length && (!columns.includes('page_id') || !columns.includes('keywords') || columns.length !== 2)) {
      error(keywordsFile, '', `the columns must be page_id,keywords (found ${columns.join(',')})`);
      keywords = [];
    }
  }
  const withKeywords = new Set();
  const rowFor = new Set();
  keywords.forEach((row, i) => {
    const line = `row ${i + 2}`;
    const id = String(row.page_id ?? '').trim();
    if (!id) return error(keywordsFile, line, 'page_id is empty');
    if (notSearched.has(id)) {
      return error(keywordsFile, line, `"${id}" has search: false, so it isn't in the site search; delete its row or remove search: false`);
    }
    if (!searchable.includes(id)) {
      return error(keywordsFile, line, `unknown page "${id}" (use a problem's file name, start, or an information page's file name)`);
    }
    if (rowFor.has(id)) return error(keywordsFile, line, `"${id}" already has a row; put all its keywords in one row`);
    rowFor.add(id);
    if (String(row.keywords ?? '').split(';').some((k) => k.trim())) withKeywords.add(id);
  });
  for (const id of searchable) if (!withKeywords.has(id)) warn('keywords-missing', keywordsFile, id);

  return { errors, warnings, model: { areas, videos, problems, start, keywords } };
}

/** Group warnings by code for printing: [[heading, [names...]], ...]. */
export function groupWarnings(warnings) {
  const groups = new Map();
  for (const w of warnings) {
    if (!groups.has(w.code)) groups.set(w.code, []);
    groups.get(w.code).push(w.code === 'unknown-key' ? `${w.file}: ${w.message}` : w.message);
  }
  return [...groups].map(([code, names]) => [WARNINGS[code] ?? code, names]);
}

function runCli() {
  const launch = process.argv.includes('--no-placeholders');
  const { errors, warnings } = validateContent(process.cwd(), { launch });
  for (const [heading, names] of groupWarnings(warnings)) {
    const shown = names.length > 8 ? [...names.slice(0, 8), `and ${names.length - 8} more`] : names;
    console.warn(`Warning: ${heading} (${names.length}): ${shown.join(', ')}`);
  }
  if (errors.length) {
    console.error(`\nContent check failed (${errors.length} problem${errors.length === 1 ? '' : 's'}):`);
    for (const issue of errors) console.error(`  ${formatIssue(issue)}`);
    process.exitCode = 1;
  } else {
    console.log('Content check passed.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli();
}
