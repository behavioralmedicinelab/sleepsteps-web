// scripts/validate-content.js (SPEC §7.1-§7.3, §7.6, §9.2, §9.3, §18.1), run against
// small content trees in temporary directories, never the real content
// (except one check that the real content passes).
import { execFile } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, ftruncateSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { formatIssue, groupWarnings, validateContent } from '../../scripts/validate-content.js';
import { VIDEO_COLUMNS, readTranscripts, transcriptFiles, youtubeIdFromUrl } from '../../scripts/lib/videos.js';
import { PLACEHOLDER_WORKSHEET, WORKSHEET_COLUMNS, WORKSHEETS_DIR, WORKSHEETS_FILE, toWorksheet, worksheetsByVideo } from '../../scripts/lib/worksheets.js';

const SCRIPT = path.resolve('scripts/validate-content.js');
const dirs = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

// Front matter written as JSON, which is valid YAML.
const md = (data, body = '') => `---\n${JSON.stringify(data, null, 2)}\n---\n${body}`;

// ---- data/videos.csv ---------------------------------------------------------
// A video on YouTube with its own link, audio and handout (SPEC §7.1, §9.2,
// §9.3): each base video has its own pair of files, so removing one file
// affects one video, and its own made-up YouTube ID (its video_id padded to
// 11 characters: aboutxxxxxx, m1xxxxxxxxx, ...), as no two rows may be the
// same video. AbCdEfGhIjK, used below for one-off links, is not a real
// video ID either.
const ytIdOf = (video_id) => video_id.padEnd(11, 'x').slice(0, 11);
const vid = (video_id, title, extra = {}) => ({
  video_id,
  title,
  description: `What “${title}” is about.`,
  youtube_url: `https://youtu.be/${ytIdOf(video_id)}`,
  duration: '6:40',
  audio: `${video_id}.mp3`,
  handout: `${video_id}.pdf`,
  thumbnail: '',
  ...extra,
});
/**
 * `text` as it comes out after a UTF-8 file is opened as `encoding`
 * ('windows-1252', 'latin1' or 'macintosh') and saved again as UTF-8.
 * (TextDecoder's "latin1" is Windows-1252; Buffer's is ISO-8859-1.)
 */
const misread = (text, encoding) => (encoding === 'latin1'
  ? Buffer.from(text, 'utf8').toString('latin1')
  : new TextDecoder(encoding).decode(Buffer.from(text, 'utf8')));
// Not on YouTube yet: a blank link, and the shared stand-in files (SPEC §7).
const PH = { youtube_url: '', duration: '[mm:ss]', audio: 'placeholder-audio.mp3', handout: 'placeholder-handout.pdf' };
// Rows 2-11, in this order: about is row 2, m1 row 5, m2 row 6, intro row 11.
const BASE_VIDEOS = [
  vid('about', 'About'),
  vid('about-two', 'About two'),
  vid('about-three', 'About three'),
  vid('m1', 'Main one', { audio: 'a.mp3', handout: 'h.pdf', thumbnail: 't.jpg' }),
  vid('m2', 'Main two'),
  vid('m3', 'Main three'),
  vid('x1', 'Extra one'),
  vid('x2', 'Extra two'),
  vid('x3', 'Extra three'),
  vid('intro', 'Intro', { duration: '12:05' }),
];
const PAIRED = BASE_VIDEOS.map((v) => v.video_id).filter((id) => id !== 'm1');

const cell = (value) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
/** CSV text for rows (objects), with the given columns. */
const csvOf = (rows, columns = VIDEO_COLUMNS) =>
  [columns.join(','), ...rows.map((row) => columns.map((c) => cell(String(row[c] ?? ''))).join(','))].join('\n') + '\n';
/**
 * The changes for a data/videos.csv made from the base rows: `edits` maps a
 * video_id to fields to change (null drops the row), and `extra` rows go
 * at the end (row 12 on).
 */
const videosCsv = (edits = {}, extra = []) => ({
  'data/videos.csv': csvOf([
    ...BASE_VIDEOS.filter((v) => edits[v.video_id] !== null).map((v) => ({ ...v, ...edits[v.video_id] })),
    ...extra,
  ]),
});

// ---- data/worksheets.csv -----------------------------------------------------
// One worksheet, with a file of its own, for each solution video of the base
// tree (problem "one" lists all six: m1-m3 and x1-x3), so a valid tree has
// no warnings (SPEC §7.6). Rows 2-7, in this order: m1-sheet is row 2,
// m2-sheet row 3, m3-sheet row 4.
const WS = 'data/worksheets.csv';
const sheet = (worksheet_id, video_id, extra = {}) => ({
  worksheet_id,
  video_id,
  title: `Worksheet for ${video_id}`,
  file: `${worksheet_id}.pdf`,
  ...extra,
});
const SOLUTION_VIDEOS = ['m1', 'm2', 'm3', 'x1', 'x2', 'x3'];
const BASE_WORKSHEETS = SOLUTION_VIDEOS.map((id) => sheet(`${id}-sheet`, id));
/**
 * The changes for a data/worksheets.csv made from the base rows: `edits`
 * maps a worksheet_id to fields to change (null drops the row), and `extra`
 * rows go at the end (row 8 on).
 */
const worksheetsCsv = (edits = {}, extra = []) => ({
  [WS]: csvOf(
    [...BASE_WORKSHEETS.filter((w) => edits[w.worksheet_id] !== null).map((w) => ({ ...w, ...edits[w.worksheet_id] })), ...extra],
    WORKSHEET_COLUMNS,
  ),
});

const problem = (title, extra = {}) => ({
  title,
  statement: `${title}, in the first person`,
  source_title: 'The team wording',
  area: 'core',
  order: 10,
  problem_video: 'about',
  is_this_you: { summary: 'One sentence.', bullets: ['one', 'two'] },
  solutions: [{ tier: 'main', video: 'm1', blurb: 'Try this if...' }],
  // The two other problems in the base tree.
  related: ['one', 'two', 'three'].filter((slug) => slug !== title.toLowerCase()),
  ...extra,
});

/** A small valid site: { relative path: file contents }. */
function baseTree() {
  return {
    'data/areas.csv': 'area_id,name,description,source_name,order\ncore,Core,Desc,Source,10\nday,Day,Desc,Source,20\n',
    ...videosCsv(),
    ...worksheetsCsv(),
    'data/transcripts/about.txt': 'A transcript.\n\nSecond paragraph.\n',
    'content/problems/one.md': md(
      problem('One', {
        solutions: [
          { tier: 'main', video: 'm1', blurb: 'A' },
          { tier: 'main', video: 'm2', blurb: 'B' },
          { tier: 'main', video: 'm3', blurb: 'C' },
          { tier: 'extra', video: 'x1', blurb: 'D' },
          { tier: 'extra', video: 'x2', blurb: 'E' },
          // No blurb: the card shows the video's description (SPEC §7.2).
          { tier: 'extra', video: 'x3' },
        ],
      }),
    ),
    'content/problems/two.md': md(problem('Two', { problem_video: 'about-two' })),
    'content/problems/three.md': md(problem('Three', { problem_video: 'about-three' })),
    'content/start.md': md({ title: 'Start here', chapters: [{ video: 'intro' }] }),
    'content/pages/help.md': md({ title: 'Referral info', summary: 'When to see someone.' }, '<p>Body.</p>\n'),
    'content/pages/search-free.md': md({ title: 'Not searchable', search: false }),
    // Every searchable page has keywords (SPEC §8.2); search-free.md opts out.
    'data/keywords.csv': 'page_id,keywords\none,"one; uno"\ntwo,"two; dos"\nthree,three\nstart,"intro; start"\nhelp,"GP; doctor"\n',
    'media/audio/a.mp3': 'mp3',
    'media/pdf/h.pdf': 'pdf',
    'media/thumbs/t.jpg': 'jpg',
    'media/audio/placeholder-audio.mp3': 'mp3',
    'media/pdf/placeholder-handout.pdf': 'pdf',
    ...Object.fromEntries(PAIRED.flatMap((id) => [[`media/audio/${id}.mp3`, 'mp3'], [`media/pdf/${id}.pdf`, 'pdf']])),
    'media/worksheets/placeholder-worksheet.pdf': 'pdf',
    ...Object.fromEntries(BASE_WORKSHEETS.map((w) => [`media/worksheets/${w.file}`, 'pdf'])),
  };
}

/** Write a tree (null removes a file from the base) and validate it. */
function run(changes = {}, options) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sleepsteps-content-'));
  dirs.push(dir);
  const tree = { ...baseTree(), ...changes };
  for (const [rel, contents] of Object.entries(tree)) {
    if (contents === null) continue;
    // A path ending in "/" is a folder.
    mkdirSync(rel.endsWith('/') ? path.join(dir, rel) : path.dirname(path.join(dir, rel)), { recursive: true });
    if (!rel.endsWith('/')) writeFileSync(path.join(dir, rel), contents);
  }
  return { dir, ...validateContent(dir, options) };
}

const messages = (result) => result.errors.map(formatIssue);
const codes = (result) => [...new Set(result.warnings.map((w) => w.code))].sort();
const PLACEHOLDERS_WARNING = (ids) => ids.map((id) => ({ code: 'placeholder-video', file: 'data/videos.csv', message: id }));

describe('validateContent on a valid tree', () => {
  it('passes with no errors and no warnings, and passes the launch check', () => {
    const result = run();
    expect(messages(result)).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(messages(run({}, { launch: true }))).toEqual([]);
    expect([...result.model.videos.keys()]).toEqual(BASE_VIDEOS.map((v) => v.video_id));
    expect([...result.model.worksheets.keys()]).toEqual(BASE_WORKSHEETS.map((w) => w.worksheet_id));
    expect([...result.model.problems.keys()].sort()).toEqual(['one', 'three', 'two']);
    expect(result.model.start.data.chapters).toHaveLength(1);
  });

  it('gives each video its row number, the template shape and its transcript', () => {
    const { model } = run();
    expect(model.videos.get('m1')).toEqual({
      file: 'data/videos.csv',
      row: 5,
      data: {
        video_id: 'm1', title: 'Main one', description: 'What “Main one” is about.', youtube_id: 'm1xxxxxxxxx', duration: '6:40',
        audio: 'a.mp3', handout: 'h.pdf', thumbnail: 't.jpg', placeholder: false,
      },
      transcript: '',
    });
    expect(model.videos.get('about').transcript).toBe('A transcript.\n\nSecond paragraph.\n');
  });

  it('accepts a stand-alone problem with no solutions, or an empty list, without warnings (SPEC §7.2)', () => {
    for (const solutions of [undefined, []]) {
      const result = run({ 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', standalone: true, solutions })) });
      expect(messages(result)).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.model.problems.get('two').data.standalone).toBe(true);
    }
  });

  it('accepts the real content in this repository', () => {
    expect(validateContent(process.cwd()).errors.map(formatIssue)).toEqual([]);
  });
});

describe('data/videos.csv as Excel saves it (SPEC §7.1)', () => {
  it('reads a "CSV UTF-8" file: a byte-order mark, CRLF line endings and an empty row at the end', () => {
    const csv = videosCsv()['data/videos.csv'];
    const result = run({ 'data/videos.csv': `\uFEFF${csv.replace(/\n/g, '\r\n')},,,,,,,\r\n` });
    expect(messages(result)).toEqual([]);
    expect(result.model.videos.size).toBe(BASE_VIDEOS.length);
  });

  it('keeps commas, quotes and line breaks inside a quoted description', () => {
    const description = 'Why it helps, and "how":\nline two, with “curly” quotes.';
    const result = run(videosCsv({ m2: { description } }));
    expect(messages(result)).toEqual([]);
    expect(result.model.videos.get('m2').data.description).toBe(description);
  });

  it('counts rows as Excel numbers them: a blank row counts, a line break inside a cell does not', () => {
    const csv = videosCsv({ m3: { title: '' } })['data/videos.csv'].split('\n');
    // A blank row after row 3, and a line break in about-three's description (row 4, now 5).
    csv.splice(3, 0, '');
    csv[4] = csv[4].replace('What “About three” is about.', '"Two\nlines"');
    expect(messages(run({ 'data/videos.csv': csv.join('\n') }))).toEqual(['data/videos.csv: row 8 (m3): title: required']);
  });
});

describe('validateContent fails the build on', () => {
  // [description, changes, expected message (substring)]
  const cases = [
    // The file and its columns.
    ['a missing data/videos.csv', { 'data/videos.csv': null }, 'data/videos.csv: missing: the video library'],
    ['columns in another order', { 'data/videos.csv': csvOf(BASE_VIDEOS, ['video_id', 'title', 'youtube_url', 'description', 'duration', 'audio', 'handout', 'thumbnail']) },
      'data/videos.csv: the columns must be video_id,title,description,youtube_url,duration,audio,handout,thumbnail, in that order (found video_id,title,youtube_url,description,'],
    ['a missing column', { 'data/videos.csv': csvOf(BASE_VIDEOS, VIDEO_COLUMNS.slice(0, -1)) }, 'data/videos.csv: the columns must be'],
    ['an extra column', { 'data/videos.csv': csvOf(BASE_VIDEOS, [...VIDEO_COLUMNS, 'notes']) }, '(found video_id,title,description,youtube_url,duration,audio,handout,thumbnail,notes)'],
    ['an empty file', { 'data/videos.csv': '' }, 'data/videos.csv: the columns must be video_id,title,description,youtube_url,duration,audio,handout,thumbnail, in that order (found none)'],
    ['an unclosed quote', { 'data/videos.csv': `${videosCsv()['data/videos.csv']}y,"Oops,d,,[mm:ss],a.mp3,h.pdf,\n` }, 'data/videos.csv: Unterminated quoted field'],
    ['a row with a missing cell', { 'data/videos.csv': `${videosCsv()['data/videos.csv']}y,T,D,,[mm:ss],a.mp3,h.pdf\n` }, 'data/videos.csv: Expected 8 fields but found 7 in row 12 (line 12)'],
    ['text that is not UTF-8 (saved as "CSV", not "CSV UTF-8")',
      { 'data/videos.csv': Buffer.concat([Buffer.from(videosCsv()['data/videos.csv']), Buffer.from('y,T,\x93Quoted\x94,,[mm:ss],placeholder-audio.mp3,placeholder-handout.pdf,\n', 'latin1')]) },
      `data/videos.csv: row 12 (y): has characters that aren't UTF-8: in Excel, save the file as "CSV UTF-8 (Comma delimited)", not "CSV"`],
    // A UTF-8 file Excel opened in another encoding and then saved as "CSV UTF-8".
    ...[
      ['Windows-1252', 'windows-1252'],
      ['Latin-1', 'latin1'],
      ['Mac Roman', 'macintosh'],
    ].map(([name, encoding]) => [
      `curly quotes garbled by opening the file as ${name}`,
      videosCsv({ m2: { description: misread('Why “sleep drive” matters.', encoding) } }),
      'data/videos.csv: row 6 (m2): description: has garbled characters (for example â€œ in place of “): Excel opened the file in the wrong encoding. Undo, open it through Data > From Text/CSV with "65001: Unicode (UTF-8)", then save as "CSV UTF-8 (Comma delimited)"',
    ]),
    ['accented letters and a no-break space garbled, in two cells', videosCsv({ m2: { title: misread('Café', 'windows-1252'), description: misread('Ten\u00A0minutes.', 'macintosh') } }),
      'data/videos.csv: row 6 (m2): title, description: has garbled characters'],
    // video_id
    ['a row without a video_id', videosCsv({ m2: { video_id: '' } }), 'data/videos.csv: row 6: video_id: required'],
    ['a video_id that is not lowercase-hyphenated', videosCsv({ m2: { video_id: 'Bad_Name' } }), 'data/videos.csv: row 6 (Bad_Name): video_id: "Bad_Name" must be lowercase words joined by hyphens'],
    ['a video_id on two rows', videosCsv({}, [vid('m2', 'Again')]), 'data/videos.csv: row 12 (m2): video_id: "m2" is already on row 6; each video has one row'],
    // title, description
    ['a video without a title', videosCsv({ m2: { title: '' } }), 'data/videos.csv: row 6 (m2): title: required'],
    ['a video without a description', videosCsv({ m2: { description: ' ' } }), 'data/videos.csv: row 6 (m2): description: required'],
    // duration
    ['a video without a duration', videosCsv({ m2: { duration: '' } }), 'data/videos.csv: row 6 (m2): duration: required: minutes:seconds, e.g. 6:40'],
    ['a placeholder without a duration', videosCsv({ m2: { ...PH, duration: '' } }), 'row 6 (m2): duration: required: minutes:seconds, e.g. 6:40, or [mm:ss] until the video is on YouTube'],
    ['a duration that is not m:ss', videosCsv({ m2: { duration: '6m40s' } }), 'row 6 (m2): duration: "6m40s" must be minutes:seconds, e.g. 6:40'],
    ['seconds over 59', videosCsv({ m2: { duration: '6:75' } }), 'row 6 (m2): duration: "6:75" must be minutes:seconds'],
    ['h:mm:ss, as Excel writes a time', videosCsv({ m2: { duration: '6:40:00' } }), 'duration: "6:40:00" must be minutes:seconds, e.g. 6:40 (if Excel shows a time such as 6:40:00, format the column as Text and type it again)'],
    ['a bracketed duration on a video on YouTube', videosCsv({ m2: { duration: '[mm:ss]' } }), `row 6 (m2): duration: "[mm:ss]" is a placeholder: put in the video's length as minutes:seconds, e.g. 6:40`],
    // youtube_url
    ...[
      'AbCdEfGhIjK',
      'PLACEHOLDER',
      'youtube.com/watch?v=AbCdEfGhIjK',
      'http://youtu.be/AbCdEfGhIjK',
      'https://youtu.be/AbCdEfGhIj',
      'https://youtu.be/AbCdEfGhIjK/',
      'https://youtu.be/AbCdEfGhIj!',
      'https://www.youtube.com/watch?v=AbCdEfGhIjK&v=ZyXwVuTsRqP',
      'https://www.youtube.com/watch?list=PL123',
      'https://www.youtube.com/shorts/AbCdEfGhIjK',
      'https://www.youtube.com/@channel',
      'https://user@youtu.be/AbCdEfGhIjK',
      'https://youtu.be:8443/AbCdEfGhIjK',
      'https://www.youtube.com.example.org/watch?v=AbCdEfGhIjK',
      'https://vimeo.com/123456',
    ].map((url) => [`the link ${url}`, videosCsv({ m2: { youtube_url: url } }), `data/videos.csv: row 6 (m2): youtube_url: "${url}" isn't a link to a YouTube video`]),
    // audio, handout, thumbnail
    ['a video without audio', videosCsv({ m2: { audio: '' } }), 'row 6 (m2): audio: required: a file name in media/audio/, e.g. m2.mp3'],
    ['a video without a handout', videosCsv({ m2: { handout: '' } }), 'row 6 (m2): handout: required: a file name in media/pdf/, e.g. m2.pdf'],
    ['a placeholder without audio', videosCsv({ m2: { ...PH, audio: '' } }), "row 6 (m2): audio: required: a file name in media/audio/ (placeholder-audio.mp3 until the video's own file exists)"],
    ['a placeholder without a handout', videosCsv({ m2: { ...PH, handout: '' } }), "row 6 (m2): handout: required: a file name in media/pdf/ (placeholder-handout.pdf until the video's own file exists)"],
    ['a missing audio file', { 'media/audio/a.mp3': null }, 'data/videos.csv: row 5 (m1): audio: media/audio/a.mp3 does not exist'],
    ['a missing handout', { 'media/pdf/h.pdf': null }, 'data/videos.csv: row 5 (m1): handout: media/pdf/h.pdf does not exist'],
    ['a missing thumbnail', { 'media/thumbs/t.jpg': null }, 'data/videos.csv: row 5 (m1): thumbnail: media/thumbs/t.jpg does not exist'],
    ['a missing placeholder file', { ...videosCsv({ m2: PH }), 'media/audio/placeholder-audio.mp3': null }, 'row 6 (m2): audio: media/audio/placeholder-audio.mp3 does not exist'],
    ['audio that is not an MP3', videosCsv({ m2: { audio: 'm2.wav' } }), 'row 6 (m2): audio: "m2.wav" must be a .mp3 file'],
    ['a handout that is not a PDF', videosCsv({ m2: { handout: 'm2.docx' } }), 'row 6 (m2): handout: "m2.docx" must be a .pdf file'],
    ['a thumbnail that is not an image', videosCsv({ m2: { thumbnail: 'm2.gif' } }), 'row 6 (m2): thumbnail: "m2.gif" must be a .jpg or .jpeg or .png or .webp file'],
    ['a media path outside its folder', videosCsv({ m2: { handout: '../h.pdf' } }), 'row 6 (m2): handout: "../h.pdf" must be a file name in media/pdf/'],
    ['a media path with a folder', videosCsv({ m2: { audio: 'media/audio/m2.mp3' } }), 'row 6 (m2): audio: "media/audio/m2.mp3" must be a file name in media/audio/'],
    // A video on YouTube has its own files (SPEC §9.2, §9.3).
    ['a video on YouTube with the placeholder audio', videosCsv({ m2: { audio: 'placeholder-audio.mp3' } }), 'row 6 (m2): audio: a video on YouTube needs its own audio-only version, not the shared placeholder-audio.mp3'],
    ['a video on YouTube with the placeholder handout', videosCsv({ m2: { handout: 'placeholder-handout.pdf' } }), 'row 6 (m2): handout: a video on YouTube needs its own handout, not the shared placeholder-handout.pdf'],
    // Transcripts (data/transcripts/<video_id>.txt).
    ['a transcript for a video that is not in the CSV', { 'data/transcripts/gone.txt': 'Words.\n' }, 'data/transcripts/gone.txt: no video "gone" in data/videos.csv: name the file after its video_id, or delete it'],
    ['a transcript that is not a .txt file', { 'data/transcripts/m2.md': 'Words.\n' }, 'data/transcripts/m2.md: a transcript is a plain-text file named after its video, <video_id>.txt, e.g. sleep-drive.txt'],
    ['a transcript named otherwise', { 'data/transcripts/Main two.txt': 'Words.\n' }, 'data/transcripts/Main two.txt: a transcript is a plain-text file'],
    ['a folder among the transcripts', { 'data/transcripts/m2.txt/': '' }, 'data/transcripts/m2.txt: a transcript is a plain-text file'],
    ['a transcript that is not UTF-8', { 'data/transcripts/m2.txt': Buffer.from('Caf\xe9 au lait.\n', 'latin1') }, "data/transcripts/m2.txt: has characters that aren't UTF-8: save it as UTF-8 plain text"],
    ['a garbled transcript', { 'data/transcripts/m2.txt': misread('I’m Sam. Let’s begin.\n', 'windows-1252') },
      'data/transcripts/m2.txt: has garbled characters (for example â€œ in place of “): it was opened in the wrong encoding and saved again. Undo, or open it again as UTF-8, and save it as UTF-8 plain text'],
    ['a stand-in transcript on a video on YouTube', { 'data/transcripts/m2.txt': '[Transcript of “Main two”.]\n' }, 'data/transcripts/m2.txt: is still a [bracketed] stand-in: put in the real transcript, or delete the file until there is one'],
    ['a stand-in transcript with a list, on a video on YouTube', { 'data/transcripts/m2.txt': '[Transcript of “T”.]\n\n[Each paragraph:]\n\n- [one point]\n- [another point]\n' }, 'data/transcripts/m2.txt: is still a [bracketed] stand-in'],
    // Problems and Start here.
    ['a problem without a title', { 'content/problems/two.md': md(problem('Two', { title: '', problem_video: 'about-two' })) }, 'content/problems/two.md: title: required'],
    ['a problem without a statement', { 'content/problems/two.md': md(problem('Two', { statement: undefined, problem_video: 'about-two' })) }, 'two.md: statement: required'],
    ['an unknown area', { 'content/problems/two.md': md(problem('Two', { area: 'sleepy', problem_video: 'about-two' })) }, 'two.md: area: unknown area "sleepy"'],
    ['a missing order', { 'content/problems/two.md': md(problem('Two', { order: 'first', problem_video: 'about-two' })) }, 'two.md: order: required'],
    ['a missing problem_video', { 'content/problems/two.md': md(problem('Two', { problem_video: undefined })) }, 'two.md: problem_video: required'],
    ['an unknown problem_video', { 'content/problems/two.md': md(problem('Two', { problem_video: 'gone' })) }, 'two.md: problem_video: unknown video "gone" (not in data/videos.csv)'],
    ['an unknown solution video', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', solutions: [{ tier: 'main', video: 'gone', blurb: 'A' }] })) }, 'two.md: solutions[1].video: unknown video "gone"'],
    ['no main solution', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', solutions: [{ tier: 'extra', video: 'x1', blurb: 'A' }] })) }, 'two.md: solutions: has 0 main solutions; allowed 1-3'],
    ['no solutions at all', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', solutions: undefined })) }, 'two.md: solutions: required'],
    // SPEC §7.2: only a stand-alone problem has no solutions, and it has none.
    [
      'an empty solutions list on a problem that is not stand-alone',
      { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', solutions: [] })) },
      'two.md: solutions: required: 1-3 main and 0-3 extra solutions; or, for a problem whose own video is its only video, add `standalone: true`',
    ],
    ['no solutions with standalone: false', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', standalone: false, solutions: undefined })) }, 'two.md: solutions: required: 1-3 main'],
    [
      'solutions on a stand-alone problem',
      { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', standalone: true })) },
      'two.md: solutions: a stand-alone problem (standalone: true) has no solutions: delete `solutions`, or delete `standalone: true` to list them',
    ],
    ['a standalone flag that is not true or false', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', standalone: 'yes' })) }, 'two.md: standalone: must be true or false'],
    ['solutions that are not a list', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', solutions: 'm1' })) }, 'two.md: solutions: must be a list of 1-3 main and 0-3 extra solutions'],
    [
      '4 main solutions',
      { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', solutions: ['m1', 'm2', 'm3', 'x1'].map((v) => ({ tier: 'main', video: v, blurb: 'A' })) })) },
      'two.md: solutions: has 4 main solutions; allowed 1-3',
    ],
    [
      '4 extra solutions',
      {
        'content/problems/two.md': md(
          problem('Two', {
            problem_video: 'about-two',
            solutions: [{ tier: 'main', video: 'm1', blurb: 'A' }, ...['m2', 'x1', 'x2', 'x3'].map((v) => ({ tier: 'extra', video: v, blurb: 'B' }))],
          }),
        ),
      },
      'two.md: solutions: has 4 extra solutions; allowed 0-3',
    ],
    ['a solution tier other than main or extra', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', solutions: [{ tier: 'main', video: 'm1', blurb: 'A' }, { tier: 'bonus', video: 'm2', blurb: 'B' }] })) }, 'two.md: solutions[2].tier: must be "main" or "extra"'],
    ['an unknown solution field', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', solutions: [{ tier: 'main', video: 'm1', blurb: 'A', blrub: 'x' }] })) }, 'two.md: solutions[1].blrub: unknown field'],
    ['a video used twice on one page', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', solutions: [{ tier: 'main', video: 'm1', blurb: 'A' }, { tier: 'extra', video: 'm1', blurb: 'B' }] })) }, 'two.md: solutions[2].video: video "m1" is already on this page (solutions[1].video)'],
    ['the problem video also used as a solution', { 'content/problems/two.md': md(problem('Two', { problem_video: 'm1' })) }, 'video "m1" is already on this page (problem_video)'],
    ['an unknown related problem', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', related: ['one', 'nine'] })) }, 'two.md: related[2]: unknown problem "nine"'],
    ['a problem listing itself as related', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', related: ['one', 'two'] })) }, "two.md: related[2]: a problem can't list itself"],
    ['a related problem listed twice', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', related: ['one', 'one'] })) }, 'two.md: related[2]: "one" is listed twice'],
    ['more than 3 related problems', { 'content/problems/four.md': md(problem('Four', { problem_video: 'm2', solutions: [{ tier: 'main', video: 'm3', blurb: 'A' }], related: ['one', 'two', 'three', 'four'] })) }, 'four.md: related: has 4 topics; the most is 3'],
    ['more than 4 bullets', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', is_this_you: { summary: 'S', bullets: ['a', 'b', 'c', 'd', 'e'] } })) }, 'two.md: is_this_you.bullets: has 5 items; the most is 4'],
    ['an unknown "Is this you?" field', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', is_this_you: { sumary: 'S', bullets: ['a', 'b'] } })) }, 'two.md: is_this_you.sumary: unknown field'],
    ['a solution blurb that is empty', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', solutions: [{ tier: 'main', video: 'm1', blurb: '' }] })) }, `two.md: solutions[1].blurb: leave it out to show the video's description, or write one or two sentences`],
    ['a solution blurb that is not text', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', solutions: [{ tier: 'main', video: 'm1', blurb: ['A'] }] })) }, 'two.md: solutions[1].blurb: leave it out'],
    ['no Start here chapters', { 'content/start.md': md({ title: 'Start here', chapters: [] }) }, 'content/start.md: chapters: required: a list of intro videos, each with a video'],
    ['an unknown Start here video', { 'content/start.md': md({ chapters: [{ video: 'gone' }] }) }, 'content/start.md: chapters[1].video: unknown video "gone" (not in data/videos.csv)'],
    ['a Start here chapter without a video', { 'content/start.md': md({ chapters: [{}] }) }, 'content/start.md: chapters[1].video: required: a video_id from data/videos.csv'],
    // The description is the video's, from the CSV (SPEC §7.3).
    ['a Start here chapter with its own description', { 'content/start.md': md({ chapters: [{ video: 'intro', description: 'Old' }] }) }, `content/start.md: chapters[1].description: a chapter has only a video: its description is the video's, in the description column of data/videos.csv`],
    ['a Start here video listed twice', { 'content/start.md': md({ chapters: [{ video: 'intro' }, { video: 'intro' }] }) }, 'content/start.md: chapters[2].video: video "intro" is already listed'],
    ['an unknown Start here chapter field', { 'content/start.md': md({ chapters: [{ video: 'intro', title: 'Old' }] }) }, 'content/start.md: chapters[1].title: unknown field; a chapter has only a video (its title, description and duration come from data/videos.csv)'],
    ['a missing content/start.md', { 'content/start.md': null }, 'content/start.md: missing'],
  ];

  it.each(cases)('%s', (name, changes, expected) => {
    const errors = messages(run(changes));
    expect(errors.some((m) => m.includes(expected)), `${expected}\nin:\n${errors.join('\n')}`).toBe(true);
  });

  it('an audio file over 25 MiB', () => {
    const { dir } = run();
    const fd = openSync(path.join(dir, 'media/audio/a.mp3'), 'w');
    ftruncateSync(fd, 25 * 1024 * 1024 + 1); // sparse: no real 25 MiB written
    closeSync(fd);
    expect(validateContent(dir).errors.map(formatIssue)).toEqual([
      'data/videos.csv: row 5 (m1): audio: media/audio/a.mp3 is over 25 MiB, the most a static file can be (SPEC §9.2)',
    ]);
  });

  it('two videos on YouTube sharing an audio or handout file, naming each other', () => {
    expect(messages(run(videosCsv({ m3: { audio: 'm2.mp3' }, x1: { handout: 'm2.pdf' } })))).toEqual([
      'data/videos.csv: row 6 (m2): audio: m2.mp3 is also the audio of row 7 (m3); each video on YouTube has its own',
      'data/videos.csv: row 7 (m3): audio: m2.mp3 is also the audio of row 6 (m2); each video on YouTube has its own',
      'data/videos.csv: row 6 (m2): handout: m2.pdf is also the handout of row 8 (x1); each video on YouTube has its own',
      'data/videos.csv: row 8 (x1): handout: m2.pdf is also the handout of row 6 (m2); each video on YouTube has its own',
    ]);
  });

  it('two rows with the same YouTube video, by its ID whatever the link\'s form, naming each other', () => {
    expect(messages(run(videosCsv({ m3: { youtube_url: `https://www.youtube.com/watch?v=${ytIdOf('m2')}&t=5` } })))).toEqual([
      'data/videos.csv: row 6 (m2): youtube_url: the same YouTube video (m2xxxxxxxxx) as row 7 (m3); each video has its own link',
      'data/videos.csv: row 7 (m3): youtube_url: the same YouTube video (m2xxxxxxxxx) as row 6 (m2); each video has its own link',
    ]);
    // A placeholder's blank link is no video, so placeholders never clash.
    expect(messages(run(videosCsv({ m2: PH, m3: PH })))).toEqual([]);
  });

  // macOS opens Placeholder-Audio.mp3 as placeholder-audio.mp3; the site's
  // host doesn't. Same result on macOS and Linux.
  it('a media file name whose capitals differ from the file\'s, suggesting the real name', () => {
    expect(messages(run(videosCsv({ m2: { audio: 'Placeholder-Audio.mp3', handout: 'PLACEHOLDER-HANDOUT.PDF' }, m3: { thumbnail: 'T.jpg' } })))).toEqual([
      'data/videos.csv: row 6 (m2): audio: media/audio/Placeholder-Audio.mp3 does not exist: did you mean placeholder-audio.mp3? (capitals must match exactly)',
      'data/videos.csv: row 6 (m2): handout: media/pdf/PLACEHOLDER-HANDOUT.PDF does not exist: did you mean placeholder-handout.pdf? (capitals must match exactly)',
      'data/videos.csv: row 7 (m3): thumbnail: media/thumbs/T.jpg does not exist: did you mean t.jpg? (capitals must match exactly)',
    ]);
  });

  // One spreadsheet mistake is one error, not one per problem and chapter
  // that names a video (or per transcript).
  it('a data/videos.csv that can\'t be read, once, without an error for each reference to it', () => {
    const notChecked = 'data/videos.csv: video references in problems, Start here, transcripts and worksheets were not checked: fix this file first';
    const lines = videosCsv()['data/videos.csv'].trimEnd().split('\n');
    const strayColumn = run({ 'data/videos.csv': `${lines.map((line) => `${line},`).join('\n')}\n` });
    expect(messages(strayColumn)).toEqual([
      'data/videos.csv: Column I has no name in row 1: delete column I in Excel if it should be empty (line 1)',
      notChecked,
    ]);
    expect(codes(strayColumn)).not.toContain('unused-video');
    const wrongColumns = run({ 'data/videos.csv': csvOf(BASE_VIDEOS, ['video_id', 'name', ...VIDEO_COLUMNS.slice(2)]), 'data/transcripts/gone.txt': 'Words.\n' });
    expect(messages(wrongColumns)).toEqual([
      'data/videos.csv: the columns must be video_id,title,description,youtube_url,duration,audio,handout,thumbnail, in that order (found video_id,name,description,youtube_url,duration,audio,handout,thumbnail)',
      notChecked,
    ]);
    // A missing file says so, and nothing else.
    expect(messages(run({ 'data/videos.csv': null }))).toEqual([
      'data/videos.csv: missing: the video library, one row per video with the columns video_id,title,description,youtube_url,duration,audio,handout,thumbnail',
    ]);
  });

  it('a video on YouTube sharing a file with a placeholder, which may use any file until its own exists', () => {
    expect(messages(run(videosCsv({ m3: { ...PH, audio: 'm2.mp3' } })))).toEqual([
      'data/videos.csv: row 6 (m2): audio: m2.mp3 is also the audio of row 7 (m3); each video on YouTube has its own',
    ]);
  });

  it('several problems at once, each once, in row order', () => {
    expect(messages(run(videosCsv({ m2: { title: '', duration: 'six' }, m3: { youtube_url: 'x' } })))).toEqual([
      'data/videos.csv: row 6 (m2): title: required',
      'data/videos.csv: row 6 (m2): duration: "six" must be minutes:seconds, e.g. 6:40 (if Excel shows a time such as 6:40:00, format the column as Text and type it again)',
      `data/videos.csv: row 7 (m3): youtube_url: "x" isn't a link to a YouTube video: use the link from YouTube's Share button (https://youtu.be/...), the watch page (https://www.youtube.com/watch?v=...) or an embed link (https://www.youtube.com/embed/...), or leave it blank until the video is on YouTube`,
    ]);
  });

  it('placeholder videos, with launch: true (SPEC §20 M8)', () => {
    const changes = videosCsv({ m2: PH });
    expect(messages(run(changes))).toEqual([]);
    expect(messages(run(changes, { launch: true }))).toEqual([
      'data/videos.csv: row 6 (m2): youtube_url: blank: placeholder videos (no YouTube link yet) are not allowed at launch',
    ]);
  });
});

describe('youtube_url (SPEC §7.1)', () => {
  it.each([
    ['https://youtu.be/AbCdEfGhIjK', 'AbCdEfGhIjK'],
    ['https://youtu.be/Zz_-9yXwVu0?si=AbCdEf123', 'Zz_-9yXwVu0'],
    ['https://www.youtube.com/watch?v=AbCdEfGhIjK', 'AbCdEfGhIjK'],
    ['https://www.youtube.com/watch?v=AbCdEfGhIjK&t=42s&list=PL1', 'AbCdEfGhIjK'],
    ['https://youtube.com/watch?feature=share&v=AbCdEfGhIjK', 'AbCdEfGhIjK'],
    ['https://m.youtube.com/watch?v=AbCdEfGhIjK', 'AbCdEfGhIjK'],
    ['https://WWW.YouTube.com/watch?v=AbCdEfGhIjK', 'AbCdEfGhIjK'],
    ['https://www.youtube.com/embed/AbCdEfGhIjK', 'AbCdEfGhIjK'],
    ['https://www.youtube.com/embed/AbCdEfGhIjK?si=x&start=10', 'AbCdEfGhIjK'],
    ['https://www.youtube-nocookie.com/embed/AbCdEfGhIjK', 'AbCdEfGhIjK'],
    ['  https://youtu.be/AbCdEfGhIjK  ', 'AbCdEfGhIjK'],
  ])('takes the ID from %s', (url, id) => {
    expect(youtubeIdFromUrl(url)).toBe(id);
  });

  it.each(['', 'AbCdEfGhIjK', 'https://youtu.be/', 'https://www.youtube.com/watch', 'https://www.youtube.com/watch/?v=AbCdEfGhIjK', 'https://youtu.be/watch?v=AbCdEfGhIjK', 'ftp://youtu.be/AbCdEfGhIjK', 'https://www.youtube.com/v/AbCdEfGhIjK', 'https://youtube-nocookie.com/watch?v=AbCdEfGhIjK', undefined])(
    'refuses %j',
    (url) => {
      expect(youtubeIdFromUrl(url)).toBe(null);
    },
  );

  it('accepts a watch, Share or embed link on the real content check, and builds the same ID', () => {
    const result = run(videosCsv({
      m2: { youtube_url: 'https://www.youtube.com/watch?v=Zz_-9yXwVu0&t=3' },
      m3: { youtube_url: 'https://www.youtube.com/embed/Zz_-9yXwVu1' },
    }));
    expect(messages(result)).toEqual([]);
    expect([result.model.videos.get('m2').data.youtube_id, result.model.videos.get('m3').data.youtube_id]).toEqual(['Zz_-9yXwVu0', 'Zz_-9yXwVu1']);
  });
});

describe('placeholder videos: a blank youtube_url (SPEC §7)', () => {
  it('may use the shared placeholder files, share them, and have [mm:ss] or a real duration', () => {
    const result = run(videosCsv({ m2: PH, m3: { ...PH, duration: '4:10' } }));
    expect(messages(result)).toEqual([]);
    expect(result.warnings).toEqual(PLACEHOLDERS_WARNING(['m2', 'm3']));
    expect(result.model.videos.get('m2').data).toMatchObject({ placeholder: true, youtube_id: '', duration: '[mm:ss]' });
  });

  it('may have their own files already', () => {
    const result = run(videosCsv({ m2: { youtube_url: '' } }));
    expect(messages(result)).toEqual([]);
    expect(result.warnings).toEqual(PLACEHOLDERS_WARNING(['m2']));
  });
});

describe('transcripts: data/transcripts/<video_id>.txt, optional plain text (SPEC §7.1, §8.3)', () => {
  it('takes any plain text, including what looked like Markdown or HTML: no page shows it', () => {
    const text = '# Not a heading\n\n<b>Hello</b> [link](https://elsewhere.example) ![x](y.png)\n';
    const result = run({ 'data/transcripts/m2.txt': text });
    expect(messages(result)).toEqual([]);
    expect(result.model.videos.get('m2').transcript).toBe(text);
  });

  it('drops a byte-order mark and ignores hidden files such as .DS_Store', () => {
    const result = run({ 'data/transcripts/m2.txt': '\uFEFFWords.\n', 'data/transcripts/.DS_Store': 'x' });
    expect(messages(result)).toEqual([]);
    expect(result.model.videos.get('m2').transcript).toBe('Words.\n');
  });

  it('lets a placeholder keep a [bracketed] stand-in, and an empty file be', () => {
    const result = run({ ...videosCsv({ m2: PH }), 'data/transcripts/m2.txt': '[Transcript of “Main two”.]\n', 'data/transcripts/m3.txt': '' });
    expect(messages(result)).toEqual([]);
  });

  it('lets a real transcript have [bracketed] sound notes among its words', () => {
    const changes = { 'data/transcripts/m2.txt': '[Gentle music]\n\nHello, I’m Sam.\n\n[Pause]\n' };
    expect(messages(run(changes))).toEqual([]);
    expect(messages(run(changes, { launch: true }))).toEqual([]);
  });

  it('readTranscripts and transcriptFiles read the folder as the search index does', () => {
    const { dir } = run({ 'data/transcripts/m2.txt': '\uFEFFOne.\r\nTwo.\r\n', 'data/transcripts/notes.md': 'x', 'data/transcripts/.hidden': 'x' });
    const folder = path.join(dir, 'data/transcripts');
    expect(transcriptFiles(folder)).toEqual([{ name: 'about.txt', id: 'about' }, { name: 'm2.txt', id: 'm2' }, { name: 'notes.md', id: null }]);
    expect([...readTranscripts(folder)]).toEqual([['about', 'A transcript.\n\nSecond paragraph.\n'], ['m2', 'One.\r\nTwo.\r\n']]);
    expect([...readTranscripts(path.join(dir, 'nowhere'))]).toEqual([]);
  });
});

describe('solution blurbs are optional (SPEC §7.2)', () => {
  it('accepts a solution without a blurb: the card shows the video\'s description', () => {
    const result = run({ 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', solutions: [{ tier: 'main', video: 'm1' }] })) });
    expect(messages(result)).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

// What each of the team's CSVs says about a file saved as "CSV" (not "CSV
// UTF-8"), and about one opened in the wrong encoding (SPEC §7.1).
const NOT_UTF8_MESSAGE = 'has characters that aren\'t UTF-8: in Excel, save the file as "CSV UTF-8 (Comma delimited)", not "CSV"';
const GARBLED_MESSAGE = 'has garbled characters (for example â€œ in place of “): Excel opened the file in the wrong encoding. Undo, open it through Data > From Text/CSV with "65001: Unicode (UTF-8)", then save as "CSV UTF-8 (Comma delimited)"';

describe('data/areas.csv (SPEC §7.2)', () => {
  const AREAS = 'data/areas.csv';
  const HEADER = 'area_id,name,description,source_name,order';
  const csv = (...rows) => [HEADER, ...rows].join('\n') + '\n';
  const base = ['core,Core,Desc,Source,10', 'day,Day,Desc,Source,20'];

  it('reads a "CSV UTF-8" file: a byte-order mark, CRLF line endings, a blank row and a decimal order', () => {
    const result = run({ [AREAS]: `﻿${csv(base[0], ',,,,', 'day,Day,,,15.5').replace(/\n/g, '\r\n')}` });
    expect(messages(result)).toEqual([]);
    expect(result.model.areas.map((a) => [a.area_id, a.order])).toEqual([['core', '10'], ['day', '15.5']]);
  });

  // [description, the file, the messages]
  it.each([
    ['an area_id on two rows', csv(...base, 'core,Again,Desc,Source,30'), ['data/areas.csv: row 4 (core): area_id: "core" is already on row 2; each area has one row']],
    ['an area_id that is not lowercase-hyphenated', csv(...base, 'New Area!,New,Desc,Source,30'), ['data/areas.csv: row 4 (New Area!): area_id: "New Area!" must be lowercase words joined by hyphens, e.g. body-clock']],
    ['a row without an area_id', csv(...base, ',New,Desc,Source,30'), ['data/areas.csv: row 4: area_id: required: lowercase words joined by hyphens, e.g. body-clock']],
    ['a row without a name', csv(...base, 'new,,Desc,Source,30'), ['data/areas.csv: row 4 (new): name: required']],
    ['a row without an order', csv(...base, 'new,New,Desc,Source,'), ['data/areas.csv: row 4 (new): order: required: a number, e.g. 20 (the areas are listed from the lowest)']],
    ['an order that is not a number', csv(...base, 'new,New,Desc,Source,third'), ['data/areas.csv: row 4 (new): order: "third" must be a number, e.g. 20 (the areas are listed from the lowest)']],
    ['several problems on one row, each once, counting a blank row as Excel does', csv(base[0], '', base[1], 'New Area!,,x,,'), [
      'data/areas.csv: row 5 (New Area!): area_id: "New Area!" must be lowercase words joined by hyphens, e.g. body-clock',
      'data/areas.csv: row 5 (New Area!): name: required',
      'data/areas.csv: row 5 (New Area!): order: required: a number, e.g. 20 (the areas are listed from the lowest)',
    ]],
    ['text that is not UTF-8 (saved as "CSV", not "CSV UTF-8")', Buffer.from(csv(base[0], 'day,Caf\xe9 days,Desc,Source,20'), 'latin1'), [`data/areas.csv: row 3 (day): ${NOT_UTF8_MESSAGE}`]],
    ['a description garbled by opening the file as Windows-1252', csv(base[0], `day,Day,${misread('When you’re awake.', 'windows-1252')},Source,20`), [`data/areas.csv: row 3 (day): description: ${GARBLED_MESSAGE}`]],
  ])('fails on %s', (name, file, expected) => {
    expect(messages(run({ [AREAS]: file }))).toEqual(expected);
  });

  // One spreadsheet mistake is one error, not one per problem that names an area.
  it("fails on a file that can't be read, once, without an error for each problem's area", () => {
    const notChecked = "data/areas.csv: each problem's area was not checked: fix this file first";
    expect(messages(run({ [AREAS]: null }))).toEqual([`data/areas.csv: missing: the problem areas, one row per area with the columns ${HEADER}`]);
    expect(messages(run({ [AREAS]: '' }))).toEqual([`data/areas.csv: the columns must be ${HEADER}, in that order (found none)`, notChecked]);
    expect(messages(run({ [AREAS]: 'id,name,description,source_name,order\ncore,Core,Desc,Source,10\n' }))).toEqual([
      `data/areas.csv: the columns must be ${HEADER}, in that order (found id,name,description,source_name,order)`,
      notChecked,
    ]);
    // The parser names the line the file ended on, as for data/videos.csv.
    expect(messages(run({ [AREAS]: csv(...base, 'new,"New,Desc,Source,30') }))).toEqual(['data/areas.csv: Unterminated quoted field (line 5)', notChecked]);
  });
});

describe('data/team.csv (SPEC §7.4)', () => {
  const TEAM = 'data/team.csv';

  it('passes with name, role and an optional organisation', () => {
    expect(messages(run({ [TEAM]: 'name,role,organisation\nA Person,Researcher,Uni\nB Person,Lived experience expert,\n' }))).toEqual([]);
  });

  it('fails on text that is not UTF-8 (saved as "CSV", not "CSV UTF-8")', () => {
    expect(messages(run({ [TEAM]: Buffer.from('name,role,organisation\nJos\xe9 N\xfa\xf1ez,Researcher,Uni\n', 'latin1') }))).toEqual([
      `data/team.csv: row 2: ${NOT_UTF8_MESSAGE}`,
    ]);
  });

  it('numbers rows as Excel does: a blank row counts', () => {
    expect(messages(run({ [TEAM]: 'name,role,organisation\nA Person,Researcher,Uni\n,,\n\nB Person,,Uni\n' }))).toEqual([
      'data/team.csv: row 5: role is empty',
    ]);
  });

  it('fails on a garbled name (the file opened in the wrong encoding)', () => {
    expect(messages(run({ [TEAM]: `name,role,organisation\n${misread('José Núñez', 'windows-1252')},Researcher,Uni\n` }))).toEqual([
      'data/team.csv: row 2: name: has garbled characters (for example â€œ in place of “): Excel opened the file in the wrong encoding. Undo, open it through Data > From Text/CSV with "65001: Unicode (UTF-8)", then save as "CSV UTF-8 (Comma delimited)"',
    ]);
  });

  it('fails on other columns, or a row without a name or role', () => {
    expect(messages(run({ [TEAM]: 'name,title,organisation\nA,B,C\n' }))).toEqual([
      'data/team.csv: the columns must be name,role,organisation (found name,title,organisation)',
    ]);
    expect(messages(run({ [TEAM]: 'name,role,organisation\n,Researcher,Uni\nB Person,,Uni\n' }))).toEqual([
      'data/team.csv: row 2: name is empty',
      'data/team.csv: row 3: role is empty',
    ]);
  });
});

describe('data/keywords.csv (SPEC §8.2)', () => {
  const KEYWORDS = 'data/keywords.csv';
  const csv = (...rows) => ['page_id,keywords', ...rows].join('\n') + '\n';
  const base = ['one,uno', 'two,dos', 'three,tres', 'start,intro', 'help,GP'];

  it('fails on a page that is not searchable, or a page_id that is unknown or empty', () => {
    expect(messages(run({ [KEYWORDS]: csv(...base, 'search-free,x', 'nope,x', ',x') }))).toEqual([
      'data/keywords.csv: row 7: "search-free" has search: false, so it isn\'t in the site search; delete its row or remove search: false',
      'data/keywords.csv: row 8: unknown page "nope" (use a problem\'s file name, start, or an information page\'s file name)',
      'data/keywords.csv: row 9: page_id is empty',
    ]);
  });

  it('fails on garbled keywords (the file opened in the wrong encoding)', () => {
    expect(messages(run({ [KEYWORDS]: csv(...base.slice(0, -1), `help,"GP; ${misread('naïve; “doctor”', 'macintosh')}"`) }))).toEqual([
      'data/keywords.csv: row 6: keywords: has garbled characters (for example â€œ in place of “): Excel opened the file in the wrong encoding. Undo, open it through Data > From Text/CSV with "65001: Unicode (UTF-8)", then save as "CSV UTF-8 (Comma delimited)"',
    ]);
  });

  it('fails on text that is not UTF-8 (saved as "CSV", not "CSV UTF-8")', () => {
    expect(messages(run({ [KEYWORDS]: Buffer.from(csv(...base.slice(0, -1), 'help,"GP; na\xefve"'), 'latin1') }))).toEqual([
      `data/keywords.csv: row 6: ${NOT_UTF8_MESSAGE}`,
    ]);
  });

  it('numbers rows as Excel does: a blank row counts', () => {
    expect(messages(run({ [KEYWORDS]: csv('one,uno', ',', 'two,dos', '', 'three,tres', 'nope,x', 'start,intro', 'help,GP') }))).toEqual([
      'data/keywords.csv: row 7: unknown page "nope" (use a problem\'s file name, start, or an information page\'s file name)',
    ]);
  });

  it('fails on a second row for the same page, even after an empty first one', () => {
    expect(messages(run({ [KEYWORDS]: csv('one,', ...base) }))).toEqual([
      'data/keywords.csv: row 3: "one" already has a row; put all its keywords in one row',
    ]);
  });

  it('fails on columns other than page_id,keywords', () => {
    const result = run({ [KEYWORDS]: 'page_id,keyword\none,uno\n' });
    expect(messages(result)).toEqual(['data/keywords.csv: the columns must be page_id,keywords (found page_id,keyword)']);
  });

  it('warns about each searchable page with no keywords, or only separators', () => {
    const result = run({ [KEYWORDS]: csv('one,uno', 'two," ; "', 'start,intro') });
    expect(messages(result)).toEqual([]);
    expect(result.warnings.filter((w) => w.code === 'keywords-missing').map((w) => w.message)).toEqual(['three', 'two', 'help']);
  });

  it('warns about every searchable page when the file is missing', () => {
    const result = run({ [KEYWORDS]: null });
    expect(messages(result)).toEqual([]);
    expect(result.warnings.filter((w) => w.code === 'keywords-missing').map((w) => w.message)).toEqual(['one', 'three', 'two', 'start', 'help']);
  });
});

describe('validateContent warns, without failing, about', () => {
  it('placeholder videos (no YouTube link yet)', () => {
    const result = run(videosCsv({ m2: PH }));
    expect(messages(result)).toEqual([]);
    expect(result.warnings).toEqual(PLACEHOLDERS_WARNING(['m2']));
    expect(groupWarnings(result.warnings)).toEqual([['Placeholder videos (no YouTube link yet; SPEC §20 M8 requires none)', ['m2']]]);
  });

  it('fewer than 2 related problems, and an empty or short "Is this you?"', () => {
    const result = run({
      'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', related: ['one'], is_this_you: undefined })),
      'content/problems/three.md': md(problem('Three', { problem_video: 'about-three', related: [], is_this_you: { summary: 'S', bullets: ['one'] } })),
    });
    expect(messages(result)).toEqual([]);
    expect(result.warnings.map((w) => [w.code, w.message])).toEqual([
      ['bullets-few', 'three'],
      ['related-few', 'three'],
      ['is-this-you-empty', 'two'],
      ['related-few', 'two'],
    ]);
  });

  it('videos used nowhere, and problem fields the templates do not read', () => {
    const result = run({
      ...videosCsv({}, [vid('spare', 'Spare', PH)]),
      // `time_of_day` went with the "When it happens" view, and `new` with
      // the "New" pill (SPEC §7.2, §22): a file that still has either
      // builds, with this warning.
      'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', keywords: 'x', time_of_day: 'night', new: true })),
    });
    expect(messages(result)).toEqual([]);
    expect(codes(result)).toEqual(['placeholder-video', 'unknown-key', 'unused-video']);
    expect(groupWarnings(result.warnings).slice(1)).toEqual([
      ['Front-matter keys the templates do not read (a typo?)', ['content/problems/two.md: keywords', 'content/problems/two.md: time_of_day', 'content/problems/two.md: new']],
      ['Videos not used on any page', ['spare']],
    ]);
  });
});

// ---- data/worksheets.csv (SPEC §7.6) -----------------------------------------
// A worksheet belongs to a video, whose open solution card lists it on every
// problem where the video is a solution. Each rule on its own, with the
// whole list of errors, so a rule can't hide behind another's message.
describe('data/worksheets.csv (SPEC §7.6)', () => {
  const HEADER = 'worksheet_id,video_id,title,file\n';
  const GARBLED = 'has garbled characters (for example â€œ in place of “): Excel opened the file in the wrong encoding. Undo, open it through Data > From Text/CSV with "65001: Unicode (UTF-8)", then save as "CSV UTF-8 (Comma delimited)"';
  const worksheetWarnings = (result) => result.warnings.filter((w) => /worksheet/.test(w.code));

  it('names its file, folder, columns and stand-in once, in scripts/lib/worksheets.js', () => {
    expect([WORKSHEETS_FILE, WORKSHEETS_DIR, PLACEHOLDER_WORKSHEET]).toEqual([WS, 'media/worksheets', 'placeholder-worksheet.pdf']);
    expect(WORKSHEET_COLUMNS).toEqual(['worksheet_id', 'video_id', 'title', 'file']);
  });

  it('gives each worksheet its row number and the template shape, in the file\'s order', () => {
    const { model } = run();
    expect([...model.worksheets.keys()]).toEqual(['m1-sheet', 'm2-sheet', 'm3-sheet', 'x1-sheet', 'x2-sheet', 'x3-sheet']);
    expect(model.worksheets.get('m2-sheet')).toEqual({
      file: WS,
      row: 3,
      data: { worksheet_id: 'm2-sheet', video_id: 'm2', title: 'Worksheet for m2', file: 'm2-sheet.pdf', placeholder: false },
    });
  });

  it('toWorksheet trims a row and marks the shared stand-in; worksheetsByVideo groups rows by video in the file\'s order', () => {
    expect(toWorksheet({ worksheet_id: ' a ', video_id: ' v ', title: ' T ', file: ' a.pdf ' })).toEqual({ worksheet_id: 'a', video_id: 'v', title: 'T', file: 'a.pdf', placeholder: false });
    expect(toWorksheet({ worksheet_id: 'a', video_id: 'v', title: 'T', file: PLACEHOLDER_WORKSHEET }).placeholder).toBe(true);
    expect(toWorksheet(undefined)).toEqual({ worksheet_id: '', video_id: '', title: '', file: '', placeholder: false });
    const rows = [sheet('b', 'v2'), sheet('a', 'v1'), sheet('c', 'v2'), sheet('d', 'v1')];
    expect([...worksheetsByVideo(rows)].map(([video, list]) => [video, list.map((w) => w.worksheet_id)])).toEqual([['v2', ['b', 'c']], ['v1', ['a', 'd']]]);
    expect([...worksheetsByVideo([])]).toEqual([]);
    expect([...worksheetsByVideo(undefined)]).toEqual([]);
  });

  describe('as Excel saves it', () => {
    it('reads a "CSV UTF-8" file: a byte-order mark, CRLF line endings and an empty row at the end', () => {
      const result = run({ [WS]: `﻿${worksheetsCsv()[WS].replace(/\n/g, '\r\n')},,,\r\n` });
      expect(messages(result)).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.model.worksheets.size).toBe(BASE_WORKSHEETS.length);
    });

    it('keeps commas and quotes inside a quoted title', () => {
      const title = 'Plan, then "do": a “wind-down” sheet';
      const result = run(worksheetsCsv({ 'm2-sheet': { title } }));
      expect(messages(result)).toEqual([]);
      expect(result.model.worksheets.get('m2-sheet').data.title).toBe(title);
    });

    // A title is plain text, whatever the team types: the pages escape it
    // (page-problem.test.js) and the search index holds it as typed
    // (search-index.test.js), so none of these is refused or changed.
    it.each([
      'Sleep under 6 hours -> plan',
      '[Sleep under 6 hours -> plan]',
      'Bed & sleep <plan>',
      'Fewer than 5 hours < most nights > 8 hours',
      'It’s 3 a.m. & I’m awake: "now what?"',
    ])('accepts the title %j, as typed', (title) => {
      const result = run(worksheetsCsv({ 'm2-sheet': { title } }));
      expect(messages(result)).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.model.worksheets.get('m2-sheet').data.title).toBe(title);
      expect(messages(run(worksheetsCsv({ 'm2-sheet': { title } }), { launch: true }))).toEqual([]);
    });

    it('counts rows as Excel numbers them: a blank row counts', () => {
      const lines = worksheetsCsv({ 'm3-sheet': { title: '' } })[WS].split('\n');
      lines.splice(2, 0, ''); // a blank row after row 2: m3-sheet moves from row 4 to row 5
      expect(messages(run({ [WS]: lines.join('\n') }))).toEqual(["data/worksheets.csv: row 5 (m3-sheet): title: required: the text of the worksheet's link"]);
    });
  });

  it('accepts a file with only its header row: no worksheets yet, and the build lists each solution video', () => {
    const result = run({ [WS]: HEADER });
    expect(messages(result)).toEqual([]);
    expect(result.model.worksheets.size).toBe(0);
    expect(result.warnings).toEqual(SOLUTION_VIDEOS.map((id) => ({ code: 'solution-no-worksheet', file: WS, message: id })));
    // Not a placeholder, so the launch check passes too.
    expect(messages(run({ [WS]: HEADER }, { launch: true }))).toEqual([]);
    // With a byte-order mark and Excel's CRLF, the same.
    expect(messages(run({ [WS]: `﻿${HEADER.trim()}\r\n` }))).toEqual([]);
  });

  // [description, changes, the whole list of errors]
  const cases = [
    // The file and its columns.
    ['a missing data/worksheets.csv', { [WS]: null },
      ['data/worksheets.csv: missing: the worksheets, one row per worksheet with the columns worksheet_id,video_id,title,file (the header row alone means there are none yet)']],
    ['columns in another order', { [WS]: csvOf(BASE_WORKSHEETS, ['worksheet_id', 'title', 'video_id', 'file']) },
      ['data/worksheets.csv: the columns must be worksheet_id,video_id,title,file, in that order (found worksheet_id,title,video_id,file)']],
    ['a missing column', { [WS]: csvOf(BASE_WORKSHEETS, WORKSHEET_COLUMNS.slice(0, -1)) },
      ['data/worksheets.csv: the columns must be worksheet_id,video_id,title,file, in that order (found worksheet_id,video_id,title)']],
    ['an extra column', { [WS]: csvOf(BASE_WORKSHEETS, [...WORKSHEET_COLUMNS, 'notes']) },
      ['data/worksheets.csv: the columns must be worksheet_id,video_id,title,file, in that order (found worksheet_id,video_id,title,file,notes)']],
    ['a column under another name', { [WS]: csvOf(BASE_WORKSHEETS.map((w) => ({ ...w, id: w.worksheet_id })), ['id', 'video_id', 'title', 'file']) },
      ['data/worksheets.csv: the columns must be worksheet_id,video_id,title,file, in that order (found id,video_id,title,file)']],
    ['an empty file, with no header row', { [WS]: '' },
      ['data/worksheets.csv: the columns must be worksheet_id,video_id,title,file, in that order (found none)']],
    ['a stray empty column, as Excel writes one', { [WS]: `${worksheetsCsv()[WS].trimEnd().split('\n').map((line) => `${line},`).join('\n')}\n` },
      ['data/worksheets.csv: Column E has no name in row 1: delete column E in Excel if it should be empty (line 1)']],
    ['an unclosed quote', { [WS]: `${worksheetsCsv()[WS]}y,m1,"Oops,m1-sheet.pdf\n` },
      ['data/worksheets.csv: Unterminated quoted field (line 9)']],
    ['a row with a missing cell', { [WS]: `${worksheetsCsv()[WS]}y,m1,T\n` },
      ['data/worksheets.csv: Expected 4 fields but found 3 in row 8 (line 8)']],
    ['text that is not UTF-8 (saved as "CSV", not "CSV UTF-8")',
      { [WS]: Buffer.concat([Buffer.from(worksheetsCsv()[WS]), Buffer.from('y,m1,\x93Quoted\x94,m1-sheet.pdf\n', 'latin1')]) },
      [`data/worksheets.csv: row 8 (y): has characters that aren't UTF-8: in Excel, save the file as "CSV UTF-8 (Comma delimited)", not "CSV"`]],
    // A UTF-8 file Excel opened in another encoding and then saved as "CSV UTF-8".
    ...[
      ['Windows-1252', 'windows-1252'],
      ['Latin-1', 'latin1'],
      ['Mac Roman', 'macintosh'],
    ].map(([name, encoding]) => [
      `curly quotes garbled by opening the file as ${name}`,
      worksheetsCsv({ 'm2-sheet': { title: misread('Your “wind-down” plan', encoding) } }),
      [`data/worksheets.csv: row 3 (m2-sheet): title: ${GARBLED}`],
    ]),
    // worksheet_id
    ['a row without a worksheet_id', worksheetsCsv({ 'm2-sheet': { worksheet_id: '' } }, [sheet('m2-again', 'm2', { file: 'm2-sheet.pdf' })]),
      ['data/worksheets.csv: row 3: worksheet_id: required: lowercase words joined by hyphens, e.g. sleep-drive-worksheet-1']],
    ['a worksheet_id that is not lowercase-hyphenated', worksheetsCsv({ 'm2-sheet': { worksheet_id: 'Sleep_Diary' } }, [sheet('m2-again', 'm2', { file: 'm2-sheet.pdf' })]),
      ['data/worksheets.csv: row 3 (Sleep_Diary): worksheet_id: "Sleep_Diary" must be lowercase words joined by hyphens, e.g. sleep-drive-worksheet-1']],
    ['a worksheet_id on two rows', worksheetsCsv({}, [sheet('m2-sheet', 'm3', { file: 'm3-sheet.pdf' })]),
      ['data/worksheets.csv: row 8 (m2-sheet): worksheet_id: "m2-sheet" is already on row 3; each worksheet has one row']],
    // video_id
    ['a worksheet without a video_id', worksheetsCsv({ 'm2-sheet': { video_id: '' } }, [sheet('m2-again', 'm2', { file: 'm2-sheet.pdf' })]),
      ['data/worksheets.csv: row 3 (m2-sheet): video_id: required: a video_id from data/videos.csv']],
    ['a video_id that is not in data/videos.csv', worksheetsCsv({ 'm2-sheet': { video_id: 'gone' } }, [sheet('m2-again', 'm2', { file: 'm2-sheet.pdf' })]),
      ['data/worksheets.csv: row 3 (m2-sheet): video_id: unknown video "gone" (not in data/videos.csv)']],
    ['a video\'s title in place of its video_id', worksheetsCsv({ 'm2-sheet': { video_id: 'Main two' } }, [sheet('m2-again', 'm2', { file: 'm2-sheet.pdf' })]),
      ['data/worksheets.csv: row 3 (m2-sheet): video_id: unknown video "Main two" (not in data/videos.csv)']],
    // title
    ['a worksheet without a title', worksheetsCsv({ 'm2-sheet': { title: '' } }), ["data/worksheets.csv: row 3 (m2-sheet): title: required: the text of the worksheet's link"]],
    ['a title of spaces', worksheetsCsv({ 'm2-sheet': { title: '   ' } }), ["data/worksheets.csv: row 3 (m2-sheet): title: required: the text of the worksheet's link"]],
    // file
    ['a worksheet without a file', worksheetsCsv({ 'm2-sheet': { file: '' } }),
      ["data/worksheets.csv: row 3 (m2-sheet): file: required: a file name in media/worksheets/, e.g. m2-sheet.pdf (placeholder-worksheet.pdf until the worksheet's own file exists)"]],
    ['a file path outside its folder', worksheetsCsv({ 'm2-sheet': { file: '../pdf/h.pdf' } }),
      ['data/worksheets.csv: row 3 (m2-sheet): file: "../pdf/h.pdf" must be a file name in media/worksheets/, e.g. m2-sheet.pdf']],
    ['a file path with its folder', worksheetsCsv({ 'm2-sheet': { file: 'media/worksheets/m2-sheet.pdf' } }),
      ['data/worksheets.csv: row 3 (m2-sheet): file: "media/worksheets/m2-sheet.pdf" must be a file name in media/worksheets/, e.g. m2-sheet.pdf']],
    ['a link in place of a file name', worksheetsCsv({ 'm2-sheet': { file: 'https://example.org/m2-sheet.pdf' } }),
      ['data/worksheets.csv: row 3 (m2-sheet): file: "https://example.org/m2-sheet.pdf" must be a file name in media/worksheets/, e.g. m2-sheet.pdf']],
    ['a file name with a space', worksheetsCsv({ 'm2-sheet': { file: 'm2 sheet.pdf' } }),
      ['data/worksheets.csv: row 3 (m2-sheet): file: "m2 sheet.pdf" must be a file name in media/worksheets/, e.g. m2-sheet.pdf']],
    ['a file that is not a PDF', { ...worksheetsCsv({ 'm2-sheet': { file: 'm2-sheet.docx' } }), 'media/worksheets/m2-sheet.docx': 'docx' },
      ['data/worksheets.csv: row 3 (m2-sheet): file: "m2-sheet.docx" must be a .pdf file']],
    ['a file name without an extension', worksheetsCsv({ 'm2-sheet': { file: 'm2-sheet' } }),
      ['data/worksheets.csv: row 3 (m2-sheet): file: "m2-sheet" must be a .pdf file']],
    ['a missing file', { 'media/worksheets/m2-sheet.pdf': null },
      ['data/worksheets.csv: row 3 (m2-sheet): file: media/worksheets/m2-sheet.pdf does not exist']],
    ['a file that is in media/pdf/, not media/worksheets/', worksheetsCsv({ 'm2-sheet': { file: 'h.pdf' } }),
      ['data/worksheets.csv: row 3 (m2-sheet): file: media/worksheets/h.pdf does not exist']],
    ['a folder where the file should be', { ...worksheetsCsv({ 'm2-sheet': { file: 'folder.pdf' } }), 'media/worksheets/folder.pdf/': '' },
      ['data/worksheets.csv: row 3 (m2-sheet): file: media/worksheets/folder.pdf does not exist']],
    ['a missing media/worksheets/ folder', Object.fromEntries([['media/worksheets/placeholder-worksheet.pdf', null], ...BASE_WORKSHEETS.map((w) => [`media/worksheets/${w.file}`, null])]),
      BASE_WORKSHEETS.map((w, i) => `data/worksheets.csv: row ${i + 2} (${w.worksheet_id}): file: media/worksheets/${w.file} does not exist`)],
    // A video on YouTube has its own worksheets, as it has its own handout.
    ['a video on YouTube with the placeholder worksheet', worksheetsCsv({ 'm2-sheet': { file: PLACEHOLDER_WORKSHEET } }),
      ['data/worksheets.csv: row 3 (m2-sheet): file: a video on YouTube needs its own worksheets, not the shared placeholder-worksheet.pdf']],
    ['a missing placeholder file', { ...videosCsv({ m2: PH }), ...worksheetsCsv({ 'm2-sheet': { file: PLACEHOLDER_WORKSHEET } }), 'media/worksheets/placeholder-worksheet.pdf': null },
      ['data/worksheets.csv: row 3 (m2-sheet): file: media/worksheets/placeholder-worksheet.pdf does not exist']],
  ];

  it.each(cases)('fails the build on %s', (name, changes, expected) => {
    expect(messages(run(changes))).toEqual(expected);
  });

  // macOS opens M2-Sheet.PDF as m2-sheet.pdf; the site's host doesn't.
  it('fails on a file name whose capitals differ from the file\'s, suggesting the real name', () => {
    expect(messages(run(worksheetsCsv({ 'm2-sheet': { file: 'M2-Sheet.PDF' }, 'm3-sheet': { file: 'Placeholder-Worksheet.pdf' } })))).toEqual([
      'data/worksheets.csv: row 3 (m2-sheet): file: media/worksheets/M2-Sheet.PDF does not exist: did you mean m2-sheet.pdf? (capitals must match exactly)',
      'data/worksheets.csv: row 4 (m3-sheet): file: media/worksheets/Placeholder-Worksheet.pdf does not exist: did you mean placeholder-worksheet.pdf? (capitals must match exactly)',
    ]);
  });

  it('accepts a .PDF extension in capitals when the file has it', () => {
    expect(messages(run({ ...worksheetsCsv({ 'm2-sheet': { file: 'Sleep-Diary.PDF' } }), 'media/worksheets/Sleep-Diary.PDF': 'pdf' }))).toEqual([]);
  });

  it('fails on a file over 25 MiB, and accepts one of exactly 25 MiB', () => {
    const { dir } = run();
    const size = (bytes) => {
      const fd = openSync(path.join(dir, 'media/worksheets/m2-sheet.pdf'), 'w');
      ftruncateSync(fd, bytes); // sparse: no real 25 MiB written
      closeSync(fd);
    };
    size(25 * 1024 * 1024);
    expect(validateContent(dir).errors.map(formatIssue)).toEqual([]);
    size(25 * 1024 * 1024 + 1);
    expect(validateContent(dir).errors.map(formatIssue)).toEqual([
      'data/worksheets.csv: row 3 (m2-sheet): file: media/worksheets/m2-sheet.pdf is over 25 MiB, the most a static file can be (SPEC §7.6)',
    ]);
  });

  it('lets two rows name one file (a worksheet used with two videos), and a video have several worksheets', () => {
    const result = run(worksheetsCsv({ 'm3-sheet': { file: 'm2-sheet.pdf' } }, [sheet('m2-second', 'm2', { file: 'x1-sheet.pdf' }), sheet('m2-third', 'm2', { file: 'm2-sheet.pdf' })]));
    expect(messages(result)).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect([...result.model.worksheets.values()].filter((w) => w.data.video_id === 'm2').map((w) => [w.row, w.data.worksheet_id, w.data.file])).toEqual([
      [3, 'm2-sheet', 'm2-sheet.pdf'],
      [8, 'm2-second', 'x1-sheet.pdf'],
      [9, 'm2-third', 'm2-sheet.pdf'],
    ]);
  });

  describe('placeholder worksheets: the shared placeholder-worksheet.pdf (SPEC §7)', () => {
    const placeholders = { ...videosCsv({ m2: PH, m3: PH }), ...worksheetsCsv({ 'm2-sheet': { file: PLACEHOLDER_WORKSHEET }, 'm3-sheet': { file: PLACEHOLDER_WORKSHEET } }) };

    it('build for a placeholder video, sharing the file, and are listed together', () => {
      const result = run(placeholders);
      expect(messages(result)).toEqual([]);
      expect(result.warnings).toEqual([
        ...PLACEHOLDERS_WARNING(['m2', 'm3']),
        { code: 'placeholder-worksheet', file: WS, message: 'm2-sheet' },
        { code: 'placeholder-worksheet', file: WS, message: 'm3-sheet' },
      ]);
      expect(result.model.worksheets.get('m2-sheet').data.placeholder).toBe(true);
      expect(groupWarnings(result.warnings)).toEqual([
        ['Placeholder videos (no YouTube link yet; SPEC §20 M8 requires none)', ['m2', 'm3']],
        ['Placeholder worksheets (the shared placeholder-worksheet.pdf; the launch check allows none, SPEC §7.6)', ['m2-sheet', 'm3-sheet']],
      ]);
    });

    it('fail the launch check, each once (SPEC §20 M8)', () => {
      expect(messages(run(placeholders, { launch: true }))).toEqual([
        'data/videos.csv: row 6 (m2): youtube_url: blank: placeholder videos (no YouTube link yet) are not allowed at launch',
        'data/videos.csv: row 7 (m3): youtube_url: blank: placeholder videos (no YouTube link yet) are not allowed at launch',
        'data/worksheets.csv: row 3 (m2-sheet): file: placeholder-worksheet.pdf: placeholder worksheets are not allowed at launch',
        'data/worksheets.csv: row 4 (m3-sheet): file: placeholder-worksheet.pdf: placeholder worksheets are not allowed at launch',
      ]);
    });

    it('fail on a video on YouTube with or without the launch check, with the one message', () => {
      const changes = worksheetsCsv({ 'm2-sheet': { file: PLACEHOLDER_WORKSHEET } });
      const expected = ['data/worksheets.csv: row 3 (m2-sheet): file: a video on YouTube needs its own worksheets, not the shared placeholder-worksheet.pdf'];
      expect(messages(run(changes))).toEqual(expected);
      expect(messages(run(changes, { launch: true }))).toEqual(expected);
      // An error, so not also listed as a placeholder.
      expect(worksheetWarnings(run(changes))).toEqual([]);
    });

    it('are not needed: a placeholder video may have its own worksheets already, which pass the launch check', () => {
      const changes = videosCsv({ m2: PH });
      const result = run(changes);
      expect(messages(result)).toEqual([]);
      expect(result.warnings).toEqual(PLACEHOLDERS_WARNING(['m2']));
      expect(messages(run(changes, { launch: true }))).toEqual([
        'data/videos.csv: row 6 (m2): youtube_url: blank: placeholder videos (no YouTube link yet) are not allowed at launch',
      ]);
    });

    it('fail the launch check even when their video is unknown', () => {
      expect(messages(run(worksheetsCsv({ 'm2-sheet': { video_id: 'gone', file: PLACEHOLDER_WORKSHEET } }, [sheet('m2-again', 'm2', { file: 'm2-sheet.pdf' })]), { launch: true }))).toEqual([
        'data/worksheets.csv: row 3 (m2-sheet): video_id: unknown video "gone" (not in data/videos.csv)',
        'data/worksheets.csv: row 3 (m2-sheet): file: placeholder-worksheet.pdf: placeholder worksheets are not allowed at launch',
      ]);
    });
  });

  describe('warns, without failing, about', () => {
    it('a worksheet no page shows: its video is a problem\'s own video, an intro video or on no page', () => {
      const changes = {
        ...videosCsv({}, [vid('spare', 'Spare', PH)]),
        ...worksheetsCsv({}, [
          sheet('about-sheet', 'about', { file: 'm1-sheet.pdf' }),
          sheet('intro-sheet', 'intro', { file: 'm1-sheet.pdf' }),
          sheet('spare-sheet', 'spare', { file: 'm1-sheet.pdf' }),
        ]),
      };
      const result = run(changes);
      expect(messages(result)).toEqual([]);
      expect(worksheetWarnings(result)).toEqual([
        { code: 'worksheet-not-shown', file: WS, message: 'about-sheet (about)' },
        { code: 'worksheet-not-shown', file: WS, message: 'intro-sheet (intro)' },
        { code: 'worksheet-not-shown', file: WS, message: 'spare-sheet (spare)' },
      ]);
      expect(groupWarnings(result.warnings)).toContainEqual([
        'Worksheets no page shows: their video is not a solution on any problem (SPEC §7.6)',
        ['about-sheet (about)', 'intro-sheet (intro)', 'spare-sheet (spare)'],
      ]);
      // They still belong to the model, as rows of the file.
      expect(result.model.worksheets.get('intro-sheet').data.video_id).toBe('intro');
    });

    it('nothing for a video that is a solution on one problem and another problem\'s own video', () => {
      // x1 is a solution on "one" and now also "three"'s own video.
      const result = run({ 'content/problems/three.md': md(problem('Three', { problem_video: 'x1' })) });
      expect(messages(result)).toEqual([]);
      expect(worksheetWarnings(result)).toEqual([]);
    });

    it('a solution video with no worksheet, in the video library\'s order', () => {
      const result = run(worksheetsCsv({ 'x2-sheet': null, 'm1-sheet': null }));
      expect(messages(result)).toEqual([]);
      expect(result.warnings).toEqual([
        { code: 'solution-no-worksheet', file: WS, message: 'm1' },
        { code: 'solution-no-worksheet', file: WS, message: 'x2' },
      ]);
      expect(groupWarnings(result.warnings)).toEqual([['Solution videos with no worksheet in data/worksheets.csv (SPEC §7.6)', ['m1', 'x2']]]);
      // Never a failure, at launch either.
      expect(messages(run(worksheetsCsv({ 'x2-sheet': null, 'm1-sheet': null }), { launch: true }))).toEqual([]);
    });

    it('neither a problem\'s own video nor an intro video for having no worksheet', () => {
      // The base tree gives about, about-two, about-three and intro none.
      expect(run().warnings).toEqual([]);
    });

    it('neither while data/worksheets.csv can\'t be read: its own error is the cause', () => {
      for (const contents of [null, '', csvOf(BASE_WORKSHEETS, ['worksheet_id', 'video', 'title', 'file'])]) {
        const result = run({ [WS]: contents });
        expect(messages(result)).toHaveLength(1);
        expect(result.warnings).toEqual([]);
      }
    });
  });

  // One spreadsheet mistake is one error: while the video library can't be
  // read, a worksheet's video_id isn't looked up, and neither warning is
  // given. The rest of each row is still checked.
  it('doesn\'t look a video_id up while data/videos.csv can\'t be read', () => {
    const notChecked = 'data/videos.csv: video references in problems, Start here, transcripts and worksheets were not checked: fix this file first';
    const result = run({
      'data/videos.csv': csvOf(BASE_VIDEOS, ['video_id', 'name', ...VIDEO_COLUMNS.slice(2)]),
      ...worksheetsCsv({ 'm2-sheet': { video_id: 'gone' }, 'm3-sheet': { title: '' }, 'x1-sheet': { video_id: '' } }),
    });
    expect(messages(result)).toEqual([
      'data/videos.csv: the columns must be video_id,title,description,youtube_url,duration,audio,handout,thumbnail, in that order (found video_id,name,description,youtube_url,duration,audio,handout,thumbnail)',
      notChecked,
      "data/worksheets.csv: row 4 (m3-sheet): title: required: the text of the worksheet's link",
      'data/worksheets.csv: row 5 (x1-sheet): video_id: required: a video_id from data/videos.csv',
    ]);
    expect(worksheetWarnings(result)).toEqual([]);
    // A missing video library says so, and nothing else.
    expect(messages(run({ 'data/videos.csv': null }))).toEqual([
      'data/videos.csv: missing: the video library, one row per video with the columns video_id,title,description,youtube_url,duration,audio,handout,thumbnail',
    ]);
  });

  it('reports several problems at once, each once, in row order and after the video library\'s', () => {
    expect(messages(run({
      ...videosCsv({ m3: { title: '' } }),
      ...worksheetsCsv({ 'm1-sheet': { title: '', file: 'm1-sheet.txt' }, 'm3-sheet': { video_id: 'gone', file: 'gone.pdf' } }, [sheet('Bad Id', 'm1')]),
    }))).toEqual([
      'data/videos.csv: row 7 (m3): title: required',
      "data/worksheets.csv: row 2 (m1-sheet): title: required: the text of the worksheet's link",
      'data/worksheets.csv: row 2 (m1-sheet): file: "m1-sheet.txt" must be a .pdf file',
      'data/worksheets.csv: row 4 (m3-sheet): video_id: unknown video "gone" (not in data/videos.csv)',
      'data/worksheets.csv: row 4 (m3-sheet): file: media/worksheets/gone.pdf does not exist',
      'data/worksheets.csv: row 8 (Bad Id): worksheet_id: "Bad Id" must be lowercase words joined by hyphens, e.g. sleep-drive-worksheet-1',
    ]);
  });

  it('reads the real data/worksheets.csv without an error', () => {
    const { errors, model } = validateContent(process.cwd());
    expect(errors.filter((e) => e.file === WS)).toEqual([]);
    expect(model.worksheets).toBeInstanceOf(Map);
  });
});

describe('the CLI', () => {
  const exec = promisify(execFile);

  it('exits 0 and says so for valid content, listing warnings', async () => {
    const { dir } = run(videosCsv({}, [vid('spare', 'Spare', PH)]));
    const { stdout, stderr } = await exec(process.execPath, [SCRIPT], { cwd: dir });
    expect(stdout).toContain('Content check passed.');
    expect(stderr).toContain('Warning: Videos not used on any page (1): spare');
    expect(stderr).toContain('Warning: Placeholder videos (no YouTube link yet; SPEC §20 M8 requires none) (1): spare');
  });

  it('exits 1 and lists each problem with its file, row and field', async () => {
    const { dir } = run({ 'media/pdf/h.pdf': null });
    const error = await exec(process.execPath, [SCRIPT], { cwd: dir }).catch((e) => e);
    expect(error.code).toBe(1);
    expect(error.stderr).toContain('Content check failed (1 problem):');
    expect(error.stderr).toContain('data/videos.csv: row 5 (m1): handout: media/pdf/h.pdf does not exist');
  });

  it('lists the worksheet warnings, and fails on placeholder worksheets with --no-placeholders', async () => {
    const { dir } = run({
      ...videosCsv({ m2: PH }),
      ...worksheetsCsv({ 'm2-sheet': { file: PLACEHOLDER_WORKSHEET }, 'x2-sheet': null }, [sheet('intro-sheet', 'intro', { file: 'm1-sheet.pdf' })]),
    });
    const { stdout, stderr } = await exec(process.execPath, [SCRIPT], { cwd: dir });
    expect(stdout).toContain('Content check passed.');
    expect(stderr).toContain('Warning: Placeholder worksheets (the shared placeholder-worksheet.pdf; the launch check allows none, SPEC §7.6) (1): m2-sheet');
    expect(stderr).toContain('Warning: Worksheets no page shows: their video is not a solution on any problem (SPEC §7.6) (1): intro-sheet (intro)');
    expect(stderr).toContain('Warning: Solution videos with no worksheet in data/worksheets.csv (SPEC §7.6) (1): x2');
    const error = await exec(process.execPath, [SCRIPT, '--no-placeholders'], { cwd: dir }).catch((e) => e);
    expect(error.code).toBe(1);
    expect(error.stderr).toContain('Content check failed (2 problems):');
    expect(error.stderr).toContain('data/worksheets.csv: row 3 (m2-sheet): file: placeholder-worksheet.pdf: placeholder worksheets are not allowed at launch');
  });

  it('exits 1 on a worksheet whose file is missing, naming the row', async () => {
    const { dir } = run({ 'media/worksheets/m2-sheet.pdf': null });
    const error = await exec(process.execPath, [SCRIPT], { cwd: dir }).catch((e) => e);
    expect(error.code).toBe(1);
    expect(error.stderr).toContain('Content check failed (1 problem):');
    expect(error.stderr).toContain('data/worksheets.csv: row 3 (m2-sheet): file: media/worksheets/m2-sheet.pdf does not exist');
  });

  it('fails on placeholder videos with --no-placeholders', async () => {
    const { dir } = run(videosCsv({ m2: PH }));
    await expect(exec(process.execPath, [SCRIPT], { cwd: dir })).resolves.toBeTruthy();
    const error = await exec(process.execPath, [SCRIPT, '--no-placeholders'], { cwd: dir }).catch((e) => e);
    expect(error.code).toBe(1);
    expect(error.stderr).toContain('data/videos.csv: row 6 (m2): youtube_url: blank: placeholder videos (no YouTube link yet) are not allowed at launch');
  });
});
