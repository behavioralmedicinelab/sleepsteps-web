// Content validation (SPEC §7.1-§7.3, §7.6, §9.2, §9.3, §18.1). Fails the
// build, with the file and field (or, in a spreadsheet, the row), on
// anything a template would otherwise render wrongly or silently drop: missing or
// misspelt fields, unknown references, solution counts outside 1-3 main /
// 0-3 extra (a stand-alone problem has none), a video used twice on one
// page, and media files that are missing or too large. Warns, without
// failing, about placeholder content that can still build.
//
// The video library is data/videos.csv, one row per video (SPEC §7.1): every
// field is required except youtube_url (blank until the video is on YouTube:
// a placeholder) and thumbnail. A video on YouTube has its own link (no two
// rows are one YouTube video), its own audio and handout, never the shared
// placeholder files, and a real duration. Media names must match a file
// exactly, capitals included. A transcript
// (data/transcripts/<video_id>.txt) is optional plain text, not shown on the
// site; the search index reads it. The team's CSVs and transcripts also fail
// on text that isn't UTF-8 or that was garbled by opening the file in the
// wrong encoding (MOJIBAKE).
//
// Worksheets are data/worksheets.csv, one row per worksheet (SPEC §7.6),
// checked with the same care as the video library: the worksheet_id, a
// video_id that is a row of data/videos.csv, a title, and a PDF in
// media/worksheets/ (it exists, its name matches exactly and it is 25 MiB at
// most). A worksheet of a video on YouTube has its own file, never the
// shared placeholder. It warns about a worksheet no page shows (its video is
// not a solution on any problem) and a solution video with none.
//
// CLI:    node scripts/validate-content.js [--no-placeholders]
//         (exit code 1 on errors; --no-placeholders is the launch check,
//         SPEC §20 M8: it also fails on placeholder videos and placeholder
//         worksheets)
// Module: validateContent(rootDir, { launch }) -> { errors, warnings, model }
//
// Front matter is read with Eleventy's own parser (gray-matter with js-yaml,
// resolved from Eleventy's install), and data/videos.csv with the same CSV
// parser as Eleventy's data extension, so this script reads every file
// exactly as the build does. No extra dependency (SPEC §5).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isMain } from './lib/cli.js';
import { parseCsvTable } from './lib/csv.js';
import { PLACEHOLDER_FILES, SLUG, TRANSCRIPTS_DIR, VIDEO_COLUMNS, readTranscript, toVideo, transcriptFiles, youtubeIdFromUrl } from './lib/videos.js';
import { PLACEHOLDER_WORKSHEET, WORKSHEET_COLUMNS, WORKSHEETS_DIR, WORKSHEETS_FILE, toWorksheet } from './lib/worksheets.js';

const require = createRequire(import.meta.url);
const fromEleventy = createRequire(require.resolve('@11ty/eleventy'));
const matter = fromEleventy('gray-matter');
const yaml = fromEleventy('js-yaml');

const MAX_FILE_BYTES = 25 * 1024 * 1024; // the static asset limit, for every file the site serves (SPEC §9.2)
const SOLUTION_LIMITS = { main: [1, 3], extra: [0, 3] };

// m:ss, as YouTube Studio shows a length (no video runs an hour: the audio
// limit is about 36 minutes, SPEC §9.2). Refusing h:mm:ss also catches
// Excel turning "6:40" into the time "6:40:00".
const DURATION = /^\d{1,2}:[0-5]\d$/;
const BRACKETED = /^\[.*\]$/;
// A line of a stand-in transcript: [bracketed] text, perhaps as a list item,
// such as "[Transcript of “Pain”.]" or "- [one point]".
const STAND_IN_LINE = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?\[.*\]\s*$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// What a UTF-8 decoder puts in place of bytes that aren't UTF-8: a file
// Excel saved as plain "CSV" (Windows-1252) instead of "CSV UTF-8".
const NOT_UTF8 = '\uFFFD';
// Text that is valid UTF-8 but garbled: a UTF-8 file that Excel (or an
// editor) opened as Windows-1252, Latin-1 or Mac Roman and then saved as
// UTF-8, so each accented letter or curly quote became two or three
// characters. “ turns into â€œ (Windows-1252), â\u0080\u009C (Latin-1) or
// ‚Äú (Mac Roman); é into Ã© (Windows-1252) or √© (Mac Roman); a no-break
// space into Â and a no-break space, or ¬†. None of these pairs occurs in
// real text. CP1252_HIGH is what Windows-1252 shows for the bytes 0x80-0x9F
// (its five unused bytes come through as C1 controls), MAC_HIGH what Mac
// Roman shows for 0x80-0xBF.
const CP1252_HIGH = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const MAC_HIGH = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø';
const MOJIBAKE = new RegExp(`[\\u0080-\\u009F]|â€|Ã[\\u00A0-\\u00BF${CP1252_HIGH}]|Â[\\u00A0-\\u00BF]|‚Ä|[√¬][${MAC_HIGH}]`);
const NOT_UTF8_CSV = 'has characters that aren\'t UTF-8: in Excel, save the file as "CSV UTF-8 (Comma delimited)", not "CSV"';
const GARBLED_CSV = 'has garbled characters (for example â€œ in place of “): Excel opened the file in the wrong encoding. Undo, open it through Data > From Text/CSV with "65001: Unicode (UTF-8)", then save as "CSV UTF-8 (Comma delimited)"';

const VIDEOS_FILE = 'data/videos.csv';
const PROBLEM_KEYS = [
  'title', 'statement', 'source_title', 'area', 'order',
  'problem_video', 'standalone', 'is_this_you', 'solutions', 'related',
];
const MEDIA = {
  audio: { dir: 'media/audio', extensions: ['.mp3'] },
  handout: { dir: 'media/pdf', extensions: ['.pdf'] },
  thumbnail: { dir: 'media/thumbs', extensions: ['.jpg', '.jpeg', '.png', '.webp'] },
};

// Warning codes, with the heading the CLI prints above each group.
const WARNINGS = {
  'placeholder-video': 'Placeholder videos (no YouTube link yet; SPEC §20 M8 requires none)',
  'placeholder-worksheet': `Placeholder worksheets (the shared ${PLACEHOLDER_WORKSHEET}; the launch check allows none, SPEC §7.6)`,
  'related-few': 'Problems with fewer than 2 related topics (SPEC §7.2 asks for 2-3)',
  'is-this-you-empty': 'Problems with no "Is this you?" text',
  'bullets-few': 'Problems with fewer than 2 "Is this you?" bullets (SPEC §7.2 asks for 2-4)',
  'thumbnail-missing': 'Videos with no thumbnail, while other videos have one (their frames will look different; SPEC §7.1)',
  'unused-video': 'Videos not used on any page',
  'worksheet-not-shown': 'Worksheets no page shows: their video is not a solution on any problem (SPEC §7.6)',
  'solution-no-worksheet': `Solution videos with no worksheet in ${WORKSHEETS_FILE} (SPEC §7.6)`,
  'keywords-missing': 'Searchable pages with no keywords in data/keywords.csv (SPEC §8.2)',
  'unknown-key': 'Front-matter keys the templates do not read (a typo?)',
};

const isText = (value) => typeof value === 'string' && value.trim() !== '';
/** The columns of a CSV record whose text is garbled (MOJIBAKE). */
const garbledFields = (record) => Object.keys(record).filter((key) => MOJIBAKE.test(String(record[key] ?? '')));
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

function listMarkdown(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

/**
 * Validate the content in `rootDir` (the repository root).
 * `launch: true` is the launch check (SPEC §20 M8): placeholder videos and
 * placeholder worksheets are errors instead of warnings.
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

  // track_page_view, where a file sets it, is true or false: YAML reads
  // `yes` and "true" as text, which base.njk would render as the page-view
  // marker while the layout left events.js out (SPEC §7.4, §10.2).
  const checkPageView = (file, data) => {
    const value = data.track_page_view;
    if (value !== undefined && typeof value !== 'boolean') {
      error(file, 'track_page_view', `must be true or false, without quotes (found ${JSON.stringify(value)})`);
    }
  };
  // Start here and each information page: a title (the tab's title, the
  // heading and the page's name in search results) and a summary (the line
  // under the heading and the page's description), SPEC §7.3, §7.4.
  const checkPage = (file, data) => {
    for (const field of ['title', 'summary']) {
      if (!isText(data[field])) error(file, field, 'required');
    }
    checkPageView(file, data);
  };

  // Both encoding checks (SPEC §7.1) on one row of any of the team's CSVs;
  // `where` is the row as its messages name it ("row 12").
  const checkEncoding = (file, where, record) => {
    if (Object.values(record).some((value) => String(value ?? '').includes(NOT_UTF8))) error(file, where, NOT_UTF8_CSV);
    const garbled = garbledFields(record);
    if (garbled.length) error(file, `${where}: ${garbled.join(', ')}`, GARBLED_CSV);
  };

  // ---- Areas (data/areas.csv, SPEC §7.2) ----------------------------------
  // One row per area, edited in Excel; messages name the row as for
  // data/videos.csv. An area_id is each problem's `area` and, on Home, the
  // id of the area's group (/#<area_id>), so it is a slug, on one row only.
  const AREAS_FILE = 'data/areas.csv';
  const AREA_COLUMNS = ['area_id', 'name', 'description', 'source_name', 'order'];
  const AREA_ORDER = /^\d+(?:\.\d+)?$/;
  const areas = [];
  // False while the file is missing or unreadable: then no problem's `area`
  // is looked up, so one spreadsheet mistake is one error, not one per problem.
  let areasRead = false;
  if (!existsSync(at(AREAS_FILE))) {
    error(AREAS_FILE, '', `missing: the problem areas, one row per area with the columns ${AREA_COLUMNS.join(',')}`);
  } else {
    try {
      const table = parseCsvTable(readFileSync(at(AREAS_FILE), 'utf8'));
      if (table.columns.join(',') !== AREA_COLUMNS.join(',')) {
        error(AREAS_FILE, '', `the columns must be ${AREA_COLUMNS.join(',')}, in that order (found ${table.columns.join(',') || 'none'})`);
      } else {
        areasRead = true;
        const rowOf = new Map();
        for (const { row, record } of table.rows) {
          areas.push(record);
          const id = record.area_id;
          const where = isText(id) ? `row ${row} (${id})` : `row ${row}`;
          const fail = (field, message) => error(AREAS_FILE, `${where}: ${field}`, message);
          checkEncoding(AREAS_FILE, where, record);
          if (!isText(id)) fail('area_id', 'required: lowercase words joined by hyphens, e.g. body-clock');
          else if (!SLUG.test(id)) fail('area_id', `"${id}" must be lowercase words joined by hyphens, e.g. body-clock`);
          else if (rowOf.has(id)) fail('area_id', `"${id}" is already on row ${rowOf.get(id)}; each area has one row`);
          else rowOf.set(id, row);
          if (!isText(record.name)) fail('name', 'required');
          if (!isText(record.order)) fail('order', 'required: a number, e.g. 20 (the areas are listed from the lowest)');
          else if (!AREA_ORDER.test(record.order)) fail('order', `"${record.order}" must be a number, e.g. 20 (the areas are listed from the lowest)`);
        }
      }
    } catch (e) {
      error(AREAS_FILE, '', e.message);
    }
    if (!areasRead) error(AREAS_FILE, '', "each problem's area was not checked: fix this file first");
  }
  const areaIds = new Set(areas.map((a) => a.area_id));

  // ---- Team (data/team.csv, About's "Who we are", SPEC §7.4) -------------
  // Optional file: columns name, role, organisation; name and role required.
  const teamFile = 'data/team.csv';
  if (existsSync(at(teamFile))) {
    // Rows are numbered as Excel shows them (a blank row counts).
    let team = [];
    let columns = [];
    try {
      ({ columns, rows: team } = parseCsvTable(readFileSync(at(teamFile), 'utf8')));
    } catch (e) {
      error(teamFile, '', e.message);
    }
    if (team.length && columns.join(',') !== 'name,role,organisation') {
      error(teamFile, '', `the columns must be name,role,organisation (found ${columns.join(',')})`);
    } else {
      for (const { row, record: person } of team) {
        checkEncoding(teamFile, `row ${row}`, person);
        if (!isText(person.name)) error(teamFile, `row ${row}`, 'name is empty');
        if (!isText(person.role)) error(teamFile, `row ${row}`, 'role is empty');
      }
    }
  }

  // ---- Videos (data/videos.csv, SPEC §7.1) --------------------------------
  // One row per video, edited in Excel. Messages name the row as Excel shows
  // it (the header is row 1) and, when it has one, the row's video_id.
  const videos = new Map();
  let videoRows = [];
  // False while the file is missing or unreadable (wrong columns, a broken
  // quote, a stray empty column): then the checks that look a video_id up
  // (problems, Start here, transcripts, worksheets, unused videos) are
  // skipped, so one spreadsheet mistake is one error, not one per reference.
  let videoLibraryRead = false;
  if (!existsSync(at(VIDEOS_FILE))) {
    error(VIDEOS_FILE, '', `missing: the video library, one row per video with the columns ${VIDEO_COLUMNS.join(',')}`);
  } else {
    try {
      const table = parseCsvTable(readFileSync(at(VIDEOS_FILE), 'utf8'));
      if (table.columns.join(',') !== VIDEO_COLUMNS.join(',')) {
        error(VIDEOS_FILE, '', `the columns must be ${VIDEO_COLUMNS.join(',')}, in that order (found ${table.columns.join(',') || 'none'})`);
      } else {
        videoRows = table.rows;
        videoLibraryRead = true;
      }
    } catch (e) {
      error(VIDEOS_FILE, '', e.message);
    }
    if (!videoLibraryRead) {
      error(VIDEOS_FILE, '', 'video references in problems, Start here, transcripts and worksheets were not checked: fix this file first');
    }
  }

  // Media file names must match a file exactly, capitals included: macOS
  // ignores case when it opens a file, but the site's host doesn't. So each
  // name is looked up among the names in its folder (read once each).
  const dirNames = new Map();
  const namesIn = (dir) => {
    if (!dirNames.has(dir)) dirNames.set(dir, new Set(existsSync(at(dir)) ? readdirSync(at(dir)) : []));
    return dirNames.get(dir);
  };

  // Which rows name each audio and handout file, and each YouTube video, for
  // the "its own files" and "its own link" rules below.
  const filesUsed = { audio: new Map(), handout: new Map() };
  const youtubeIdsUsed = new Map();
  for (const { row, record } of videoRows) {
    const id = record.video_id;
    const where = isText(id) ? `row ${row} (${id})` : `row ${row}`;
    const fail = (field, message) => error(VIDEOS_FILE, field ? `${where}: ${field}` : where, message);

    checkEncoding(VIDEOS_FILE, where, record);
    if (!isText(id)) {
      fail('video_id', 'required: lowercase words joined by hyphens, e.g. sleep-drive');
      continue;
    }
    if (!SLUG.test(id)) {
      fail('video_id', `"${id}" must be lowercase words joined by hyphens, e.g. sleep-drive`);
      continue;
    }
    if (videos.has(id)) {
      fail('video_id', `"${id}" is already on row ${videos.get(id).row}; each video has one row`);
      continue;
    }

    const url = record.youtube_url;
    const placeholder = url === '';
    const youtubeId = placeholder ? null : youtubeIdFromUrl(url);
    if (!placeholder && !youtubeId) {
      fail('youtube_url', `"${url}" isn't a link to a YouTube video: use the link from YouTube's Share button (https://youtu.be/...), the watch page (https://www.youtube.com/watch?v=...) or an embed link (https://www.youtube.com/embed/...), or leave it blank until the video is on YouTube`);
    }
    if (youtubeId) {
      if (!youtubeIdsUsed.has(youtubeId)) youtubeIdsUsed.set(youtubeId, []);
      youtubeIdsUsed.get(youtubeId).push({ row, id, fail });
    }
    for (const field of ['title', 'description']) {
      if (!isText(record[field])) fail(field, 'required');
    }

    const duration = record.duration;
    if (!isText(duration)) {
      fail('duration', placeholder ? 'required: minutes:seconds, e.g. 6:40, or [mm:ss] until the video is on YouTube' : 'required: minutes:seconds, e.g. 6:40');
    } else if (!DURATION.test(duration) && !(placeholder && BRACKETED.test(duration))) {
      fail('duration', BRACKETED.test(duration)
        ? `"${duration}" is a placeholder: put in the video's length as minutes:seconds, e.g. 6:40`
        : `"${duration}" must be minutes:seconds, e.g. 6:40 (if Excel shows a time such as 6:40:00, format the column as Text and type it again)`);
    }

    for (const [field, { dir, extensions }] of Object.entries(MEDIA)) {
      const value = record[field];
      if (!isText(value)) {
        // Every video has an audio-only version (SPEC §9.2) and a handout
        // (SPEC §9.3); a placeholder names the shared stand-in files.
        if (field !== 'thumbnail') {
          fail(field, placeholder
            ? `required: a file name in ${dir}/ (${PLACEHOLDER_FILES[field]} until the video's own file exists)`
            : `required: a file name in ${dir}/, e.g. ${id}${extensions[0]}`);
        }
        continue;
      }
      if (!FILE_NAME.test(value)) {
        fail(field, `"${value}" must be a file name in ${dir}/, e.g. ${id}${extensions[0]}`);
        continue;
      }
      if (!extensions.includes(path.extname(value).toLowerCase())) {
        fail(field, `"${value}" must be a ${extensions.join(' or ')} file`);
        continue;
      }
      const target = at(dir, value);
      const names = namesIn(dir);
      if (!names.has(value) || !statSync(target).isFile()) {
        const near = [...names].find((name) => name !== value && name.toLowerCase() === value.toLowerCase());
        fail(field, near
          ? `${dir}/${value} does not exist: did you mean ${near}? (capitals must match exactly)`
          : `${dir}/${value} does not exist`);
      } else if (statSync(target).size > MAX_FILE_BYTES) {
        fail(field, `${dir}/${value} is over 25 MiB, the most a static file can be (SPEC §9.2)`);
      }
      if (field in filesUsed) {
        if (!filesUsed[field].has(value)) filesUsed[field].set(value, []);
        filesUsed[field].get(value).push({ row, id, placeholder, fail });
      }
      // A video on YouTube has its own soundtrack and its own handout, which
      // carries its narration (SPEC §9.2, §9.3), never the stand-ins.
      if (!placeholder && value === PLACEHOLDER_FILES[field]) {
        fail(field, `a video on YouTube needs its own ${field === 'audio' ? 'audio-only version' : 'handout'}, not the shared ${value}`);
      }
    }

    videos.set(id, { file: VIDEOS_FILE, row, data: toVideo(record), transcript: '' });

    if (placeholder) {
      if (launch) fail('youtube_url', 'blank: placeholder videos (no YouTube link yet) are not allowed at launch');
      else warn('placeholder-video', VIDEOS_FILE, id);
    }
  }

  // A video on YouTube shares its audio and handout files with no other row
  // (the shared placeholder files are refused above).
  for (const [field, used] of Object.entries(filesUsed)) {
    for (const [value, rows] of used) {
      if (rows.length < 2 || value === PLACEHOLDER_FILES[field]) continue;
      for (const { row, placeholder, fail } of rows) {
        if (placeholder) continue;
        const others = rows.filter((r) => r.row !== row).map((r) => `row ${r.row} (${r.id})`);
        fail(field, `${value} is also the ${field} of ${others.join(', ')}; each video on YouTube has its own`);
      }
    }
  }

  // Each row is a different YouTube video. Compared by the ID taken from the
  // link, so a Share link, a watch link and an embed link to one video count
  // as the same video.
  for (const [youtubeId, rows] of youtubeIdsUsed) {
    if (rows.length < 2) continue;
    for (const { row, fail } of rows) {
      const others = rows.filter((r) => r.row !== row).map((r) => `row ${r.row} (${r.id})`);
      fail('youtube_url', `the same YouTube video (${youtubeId}) as ${others.join(', ')}; each video has its own link`);
    }
  }

  // A thumbnail is optional, but a frame with one and a frame without look
  // different (SPEC §7.1, §9.1): once any video has one, list those that
  // don't. A warning only, at launch too.
  if ([...videos.values()].some((video) => video.data.thumbnail !== '')) {
    for (const [id, video] of videos) if (video.data.thumbnail === '') warn('thumbnail-missing', VIDEOS_FILE, id);
  }

  // ---- Transcripts (data/transcripts/<video_id>.txt, SPEC §7.1) ------------
  // Optional plain text, never shown; the search index reads it (SPEC §8.3).
  for (const { name, id } of transcriptFiles(at(TRANSCRIPTS_DIR))) {
    const file = `${TRANSCRIPTS_DIR}/${name}`;
    if (!id) {
      error(file, '', 'a transcript is a plain-text file named after its video, <video_id>.txt, e.g. sleep-drive.txt');
      continue;
    }
    if (!videoLibraryRead) continue; // the data/videos.csv error is the cause
    const video = videos.get(id);
    if (!video) {
      error(file, '', `no video "${id}" in ${VIDEOS_FILE}: name the file after its video_id, or delete it`);
      continue;
    }
    const text = readTranscript(at(TRANSCRIPTS_DIR, name));
    if (text.includes(NOT_UTF8)) error(file, '', 'has characters that aren\'t UTF-8: save it as UTF-8 plain text');
    else if (MOJIBAKE.test(text)) {
      error(file, '', 'has garbled characters (for example â€œ in place of “): it was opened in the wrong encoding and saved again. Undo, or open it again as UTF-8, and save it as UTF-8 plain text');
    }
    // A real video can't keep a [bracketed] stand-in, as with its duration:
    // the search would index it. An empty file is harmless.
    const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
    if (!video.data.placeholder && lines.length > 0 && lines.every((line) => STAND_IN_LINE.test(line))) {
      error(file, '', 'is still a [bracketed] stand-in: put in the real transcript, or delete the file until there is one');
    }
    video.transcript = text;
  }

  // ---- Worksheets (data/worksheets.csv, SPEC §7.6) -------------------------
  // One row per worksheet, edited in Excel like the video library: messages
  // name the row as Excel shows it and, when it has one, the row's
  // worksheet_id. A worksheet belongs to a video (video_id), whose open
  // solution card lists it wherever the video is a solution. The header row
  // alone is a valid file: no worksheets yet.
  const worksheets = new Map();
  let worksheetRows = [];
  // False while the file is missing or unreadable: then the two warnings
  // below (a worksheet no page shows, a solution video with none) are
  // skipped, as they would name every solution video.
  let worksheetsRead = false;
  if (!existsSync(at(WORKSHEETS_FILE))) {
    error(WORKSHEETS_FILE, '', `missing: the worksheets, one row per worksheet with the columns ${WORKSHEET_COLUMNS.join(',')} (the header row alone means there are none yet)`);
  } else {
    try {
      const table = parseCsvTable(readFileSync(at(WORKSHEETS_FILE), 'utf8'));
      if (table.columns.join(',') !== WORKSHEET_COLUMNS.join(',')) {
        error(WORKSHEETS_FILE, '', `the columns must be ${WORKSHEET_COLUMNS.join(',')}, in that order (found ${table.columns.join(',') || 'none'})`);
      } else {
        worksheetRows = table.rows;
        worksheetsRead = true;
      }
    } catch (e) {
      error(WORKSHEETS_FILE, '', e.message);
    }
  }

  for (const { row, record } of worksheetRows) {
    const id = record.worksheet_id;
    const where = isText(id) ? `row ${row} (${id})` : `row ${row}`;
    const fail = (field, message) => error(WORKSHEETS_FILE, `${where}: ${field}`, message);

    checkEncoding(WORKSHEETS_FILE, where, record);
    if (!isText(id)) {
      fail('worksheet_id', 'required: lowercase words joined by hyphens, e.g. sleep-drive-worksheet-1');
      continue;
    }
    if (!SLUG.test(id)) {
      fail('worksheet_id', `"${id}" must be lowercase words joined by hyphens, e.g. sleep-drive-worksheet-1`);
      continue;
    }
    if (worksheets.has(id)) {
      fail('worksheet_id', `"${id}" is already on row ${worksheets.get(id).row}; each worksheet has one row`);
      continue;
    }

    // Its video: a row of data/videos.csv. While that file can't be read,
    // its own error is the cause, so the id isn't looked up.
    const videoId = record.video_id;
    let video = null;
    if (!isText(videoId)) {
      fail('video_id', `required: a video_id from ${VIDEOS_FILE}`);
    } else if (videoLibraryRead) {
      video = videos.get(videoId) ?? null;
      if (!video) fail('video_id', `unknown video "${videoId}" (not in ${VIDEOS_FILE})`);
    }

    if (!isText(record.title)) fail('title', 'required: the text of the worksheet\'s link');

    // The file, by the handout's rules: a bare PDF name in its folder that
    // matches a file exactly, capitals included. Two rows may name one file
    // (one worksheet used with two videos).
    const file = record.file;
    if (!isText(file)) {
      fail('file', `required: a file name in ${WORKSHEETS_DIR}/, e.g. ${id}.pdf (${PLACEHOLDER_WORKSHEET} until the worksheet's own file exists)`);
    } else if (!FILE_NAME.test(file)) {
      fail('file', `"${file}" must be a file name in ${WORKSHEETS_DIR}/, e.g. ${id}.pdf`);
    } else if (path.extname(file).toLowerCase() !== '.pdf') {
      fail('file', `"${file}" must be a .pdf file`);
    } else {
      const target = at(WORKSHEETS_DIR, file);
      const names = namesIn(WORKSHEETS_DIR);
      if (!names.has(file) || !statSync(target).isFile()) {
        const near = [...names].find((name) => name !== file && name.toLowerCase() === file.toLowerCase());
        fail('file', near
          ? `${WORKSHEETS_DIR}/${file} does not exist: did you mean ${near}? (capitals must match exactly)`
          : `${WORKSHEETS_DIR}/${file} does not exist`);
      } else if (statSync(target).size > MAX_FILE_BYTES) {
        fail('file', `${WORKSHEETS_DIR}/${file} is over 25 MiB, the most a static file can be (SPEC §7.6)`);
      }
      // The shared stand-in: a video on YouTube has its own worksheets, as
      // it has its own handout; until then the build lists the stand-ins,
      // and the launch check allows none.
      if (file === PLACEHOLDER_WORKSHEET) {
        if (video && !video.data.placeholder) {
          fail('file', `a video on YouTube needs its own worksheets, not the shared ${PLACEHOLDER_WORKSHEET}`);
        } else if (launch) {
          fail('file', `${PLACEHOLDER_WORKSHEET}: placeholder worksheets are not allowed at launch`);
        } else {
          warn('placeholder-worksheet', WORKSHEETS_FILE, id);
        }
      }
    }

    worksheets.set(id, { file: WORKSHEETS_FILE, row, data: toWorksheet(record) });
  }

  const used = new Set();
  // Every video that some problem lists as a solution: the videos whose
  // worksheets a page shows (SPEC §7.6).
  const solutionVideos = new Set();
  const checkVideoRef = (file, field, id) => {
    if (!isText(id)) {
      error(file, field, `required: a video_id from ${VIDEOS_FILE}`);
      return false;
    }
    if (!videoLibraryRead) return false; // the data/videos.csv error is the cause
    if (!videos.has(id)) {
      error(file, field, `unknown video "${id}" (not in ${VIDEOS_FILE})`);
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
    checkPageView(file, data);
    if (data.source_title !== undefined && typeof data.source_title !== 'string') {
      error(file, 'source_title', 'must be text');
    }
    if (!isText(data.area)) error(file, 'area', `required: one of ${listOf([...areaIds])}`);
    else if (areasRead && !areaIds.has(data.area)) error(file, 'area', `unknown area "${data.area}" (not in data/areas.csv)`);
    if (typeof data.order !== 'number' || !Number.isFinite(data.order)) {
      error(file, 'order', 'required: a number (the order within the area)');
    }

    // Every video on the page, to catch one used twice (its ids, such as
    // audio-<video_id>, would clash, and ratings couldn't tell them apart).
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

    // A stand-alone problem has one video made for it (its problem_video)
    // and no solutions; every other problem has 1-3 main and 0-3 extra.
    if (data.standalone !== undefined && typeof data.standalone !== 'boolean') {
      error(file, 'standalone', 'must be true or false');
    }
    const standalone = data.standalone === true;
    const noSolutions = data.solutions === undefined || data.solutions === null
      || (Array.isArray(data.solutions) && data.solutions.length === 0);
    if (standalone) {
      if (!noSolutions) {
        error(file, 'solutions', 'a stand-alone problem (standalone: true) has no solutions: delete `solutions`, or delete `standalone: true` to list them');
      }
    } else if (noSolutions) {
      error(file, 'solutions', 'required: 1-3 main and 0-3 extra solutions; or, for a problem whose own video is its only video, add `standalone: true`');
    } else if (!Array.isArray(data.solutions)) {
      error(file, 'solutions', 'must be a list of 1-3 main and 0-3 extra solutions');
    } else {
      const counts = { main: 0, extra: 0 };
      data.solutions.forEach((solution, i) => {
        const field = `solutions[${i + 1}]`;
        if (!isObject(solution)) {
          error(file, field, 'must have tier and video (and, if you like, a blurb)');
          return;
        }
        for (const key of Object.keys(solution)) {
          if (!['tier', 'video', 'blurb'].includes(key)) error(file, `${field}.${key}`, 'unknown field; use tier, video and blurb');
        }
        if (!(solution.tier in counts)) error(file, `${field}.tier`, 'must be "main" or "extra"');
        else counts[solution.tier] += 1;
        if (checkVideoRef(file, `${field}.video`, solution.video)) {
          onPage.push([`${field}.video`, solution.video]);
          solutionVideos.add(solution.video);
        }
        // Optional: shown instead of the video's description on this page
        // only (SPEC §7.2).
        if (solution.blurb !== undefined && solution.blurb !== null && !isText(solution.blurb)) {
          error(file, `${field}.blurb`, 'leave it out to show the video\'s description, or write one or two sentences, "Try this if ..."');
        }
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
      checkPage(file, parsed.data);
      const chapters = parsed.data.chapters;
      if (!Array.isArray(chapters) || chapters.length === 0) {
        error(file, 'chapters', 'required: a list of intro videos, each with a video');
      } else {
        const seen = new Set();
        chapters.forEach((chapter, i) => {
          const field = `chapters[${i + 1}]`;
          if (!isObject(chapter)) {
            error(file, field, 'must have a video');
            return;
          }
          // The title, description, duration and formats are the video's,
          // from data/videos.csv (SPEC §7.3).
          for (const key of Object.keys(chapter)) {
            if (key === 'description') {
              error(file, `${field}.description`, `a chapter has only a video: its description is the video's, in the description column of ${VIDEOS_FILE}`);
            } else if (key !== 'video') {
              error(file, `${field}.${key}`, `unknown field; a chapter has only a video (its title, description and duration come from ${VIDEOS_FILE})`);
            }
          }
          if (checkVideoRef(file, `${field}.video`, chapter.video)) {
            if (seen.has(chapter.video)) error(file, `${field}.video`, `video "${chapter.video}" is already listed`);
            seen.add(chapter.video);
          }
        });
      }
    }
  } else {
    error('content/start.md', '', 'missing');
  }

  if (videoLibraryRead) {
    for (const id of videos.keys()) {
      if (!used.has(id)) warn('unused-video', VIDEOS_FILE, id);
    }
  }

  // Worksheets show only in a solution's open card (SPEC §7.6), so the build
  // lists a worksheet whose video no problem has as a solution (a problem's
  // own video, an intro video or a video on no page: it would never be
  // shown), and a solution video with no worksheet (so one that was left
  // out is noticed). Neither fails. Skipped while either spreadsheet can't
  // be read: its own error is the cause.
  if (videoLibraryRead && worksheetsRead) {
    const withWorksheets = new Set();
    for (const [id, { data }] of worksheets) {
      if (!videos.has(data.video_id)) continue; // refused above
      withWorksheets.add(data.video_id);
      if (!solutionVideos.has(data.video_id)) warn('worksheet-not-shown', WORKSHEETS_FILE, `${id} (${data.video_id})`);
    }
    for (const id of videos.keys()) {
      if (solutionVideos.has(id) && !withWorksheets.has(id)) warn('solution-no-worksheet', WORKSHEETS_FILE, id);
    }
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
    if (parsed) checkPage(`content/pages/${name}`, parsed.data);
    if (parsed && parsed.data.search !== false) searchable.push(name.slice(0, -3));
    else if (parsed) notSearched.add(name.slice(0, -3));
  }
  const keywordsFile = 'data/keywords.csv';
  // Its rows, each with its number as Excel shows it (a blank row counts).
  let keywords = [];
  if (existsSync(at(keywordsFile))) {
    try {
      keywords = parseCsvTable(readFileSync(at(keywordsFile), 'utf8')).rows;
    } catch (e) {
      error(keywordsFile, '', e.message);
    }
    const columns = Object.keys(keywords[0]?.record ?? {});
    if (keywords.length && (!columns.includes('page_id') || !columns.includes('keywords') || columns.length !== 2)) {
      error(keywordsFile, '', `the columns must be page_id,keywords (found ${columns.join(',')})`);
      keywords = [];
    }
  }
  const withKeywords = new Set();
  const rowFor = new Set();
  keywords.forEach(({ row: number, record: row }) => {
    const line = `row ${number}`;
    checkEncoding(keywordsFile, line, row);
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

  return { errors, warnings, model: { areas, videos, worksheets, problems, start, keywords: keywords.map(({ record }) => record) } };
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

if (isMain(import.meta.url)) runCli();
