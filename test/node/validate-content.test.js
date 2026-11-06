// scripts/validate-content.js (SPEC §7.1-§7.3, §9.2, §9.3, §18.1), run against
// small content trees in temporary directories, never the real content
// (except one check that the real content passes).
import { execFile } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, ftruncateSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { formatIssue, groupWarnings, transcriptProblems, validateContent } from '../../scripts/validate-content.js';

const SCRIPT = path.resolve('scripts/validate-content.js');
const dirs = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

// Front matter written as JSON, which is valid YAML.
const md = (data, body = '') => `---\n${JSON.stringify(data, null, 2)}\n---\n${body}`;
const vid = (title, extra = {}) => ({ title, youtube_id: 'AbCdEfGhIjK', duration: '6:40', ...extra });
// Every real video has a handout and an audio-only version by launch (SPEC
// §9.2, §9.3). Each base video has its own pair of files, so removing one
// file affects one video, and an optional transcript (TX, its body), which
// the site doesn't show but the search indexes.
const withMedia = (id, extra = {}) => ({ audio: `${id}.mp3`, handout: `${id}.pdf`, ...extra });
const TX = 'A transcript.\n';
const PAIRED = ['about', 'about-two', 'about-three', 'm2', 'm3', 'x1', 'x2', 'x3', 'intro'];
const placeholderVid = (title, extra = {}) => vid(title, { youtube_id: 'PLACEHOLDER', duration: '[mm:ss]', placeholder: true, ...extra });
const problem = (title, extra = {}) => ({
  title,
  statement: `${title}, in the first person`,
  source_title: 'The team wording',
  area: 'core',
  time_of_day: 'night',
  order: 10,
  new: false,
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
    'content/videos/about.md': md(vid('About', withMedia('about')), 'A transcript.\n\nSecond paragraph.\n'),
    'content/videos/about-two.md': md(vid('About two', withMedia('about-two')), TX),
    'content/videos/about-three.md': md(vid('About three', withMedia('about-three')), TX),
    'content/videos/m1.md': md(vid('Main one', { audio: 'a.mp3', handout: 'h.pdf', thumbnail: 't.jpg' }), TX),
    'content/videos/m2.md': md(vid('Main two', withMedia('m2')), TX),
    'content/videos/m3.md': md(vid('Main three', withMedia('m3')), TX),
    'content/videos/x1.md': md(vid('Extra one', withMedia('x1')), TX),
    'content/videos/x2.md': md(vid('Extra two', withMedia('x2')), TX),
    'content/videos/x3.md': md(vid('Extra three', withMedia('x3')), TX),
    'content/videos/intro.md': md(vid('Intro', withMedia('intro', { duration: '1:02:03' })), TX),
    'content/problems/one.md': md(
      problem('One', {
        solutions: [
          { tier: 'main', video: 'm1', blurb: 'A' },
          { tier: 'main', video: 'm2', blurb: 'B' },
          { tier: 'main', video: 'm3', blurb: 'C' },
          { tier: 'extra', video: 'x1', blurb: 'D' },
          { tier: 'extra', video: 'x2', blurb: 'E' },
          { tier: 'extra', video: 'x3', blurb: 'F' },
        ],
      }),
    ),
    'content/problems/two.md': md(problem('Two', { problem_video: 'about-two' })),
    'content/problems/three.md': md(problem('Three', { problem_video: 'about-three' })),
    'content/start.md': md({ title: 'Start here', chapters: [{ video: 'intro', description: 'First.' }] }),
    'content/pages/help.md': md({ title: 'Getting more help', summary: 'When to see someone.' }, '<p>Body.</p>\n'),
    'content/pages/search-free.md': md({ title: 'Not searchable', search: false }),
    // Every searchable page has keywords (SPEC §8.2); search-free.md opts out.
    'data/keywords.csv': 'page_id,keywords\none,"one; uno"\ntwo,"two; dos"\nthree,three\nstart,"intro; start"\nhelp,"GP; doctor"\n',
    'media/audio/a.mp3': 'mp3',
    'media/pdf/h.pdf': 'pdf',
    'media/thumbs/t.jpg': 'jpg',
    ...Object.fromEntries(PAIRED.flatMap((id) => [[`media/audio/${id}.mp3`, 'mp3'], [`media/pdf/${id}.pdf`, 'pdf']])),
  };
}

/** Write a tree (null removes a file from the base) and validate it. */
function run(changes = {}, options) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sleepsteps-content-'));
  dirs.push(dir);
  const tree = { ...baseTree(), ...changes };
  for (const [rel, contents] of Object.entries(tree)) {
    if (contents === null) continue;
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), contents);
  }
  return { dir, ...validateContent(dir, options) };
}

const messages = (result) => result.errors.map(formatIssue);
const codes = (result) => [...new Set(result.warnings.map((w) => w.code))].sort();

describe('validateContent on a valid tree', () => {
  it('passes with no errors and no warnings, and passes the launch check', () => {
    const result = run();
    expect(messages(result)).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(messages(run({}, { launch: true }))).toEqual([]);
    expect([...result.model.videos.keys()]).toHaveLength(10);
    expect([...result.model.problems.keys()].sort()).toEqual(['one', 'three', 'two']);
    expect(result.model.start.data.chapters).toHaveLength(1);
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

describe('validateContent fails the build on', () => {
  // [description, changes, expected message (substring)]
  const cases = [
    ['a video without a title', { 'content/videos/m2.md': md({ youtube_id: 'AbCdEfGhIjK', duration: '6:40' }) }, 'content/videos/m2.md: title: required'],
    ['a video without a youtube_id', { 'content/videos/m2.md': md({ title: 'T', duration: '6:40' }) }, 'content/videos/m2.md: youtube_id: required'],
    ['a video without a duration', { 'content/videos/m2.md': md({ title: 'T', youtube_id: 'AbCdEfGhIjK' }) }, 'content/videos/m2.md: duration: required'],
    ['a youtube_id that is not 11 URL-safe characters', { 'content/videos/m2.md': md(vid('T', { youtube_id: 'abc def ghij' })) }, `youtube_id: "abc def ghij" isn't a YouTube video ID`],
    ['a full YouTube URL as the youtube_id', { 'content/videos/m2.md': md(vid('T', { youtube_id: 'https://youtu.be/AbCdEfGhIjK' })) }, "isn't a YouTube video ID"],
    ['a youtube_id YAML reads as a number', { 'content/videos/m2.md': '---\ntitle: T\nyoutube_id: 12345678901\nduration: "6:40"\n---\n' }, 'youtube_id: put the ID in double quotes'],
    ['"PLACEHOLDER" on a video not marked as a placeholder', { 'content/videos/m2.md': md(vid('T', { youtube_id: 'PLACEHOLDER' })) }, 'youtube_id: is a placeholder'],
    ['a duration that is not m:ss', { 'content/videos/m2.md': md(vid('T', { duration: '6m40s' })) }, 'duration: "6m40s" must be minutes:seconds'],
    ['seconds over 59', { 'content/videos/m2.md': md(vid('T', { duration: '6:75' })) }, 'duration: "6:75"'],
    ['a bracketed duration on a real video', { 'content/videos/m2.md': md(vid('T', { duration: '[mm:ss]' })) }, 'duration: "[mm:ss]"'],
    ['an unknown video field (a typo)', { 'content/videos/m2.md': md(vid('T', { handuot: 'h.pdf' })) }, 'content/videos/m2.md: handuot: unknown field'],
    ['a placeholder flag that is not true or false', { 'content/videos/m2.md': md(vid('T', { placeholder: 'yes' })) }, 'placeholder: must be true or false'],
    ['a missing audio file', { 'media/audio/a.mp3': null }, 'content/videos/m1.md: audio: media/audio/a.mp3 does not exist'],
    ['a missing handout', { 'media/pdf/h.pdf': null }, 'content/videos/m1.md: handout: media/pdf/h.pdf does not exist'],
    ['a missing thumbnail', { 'media/thumbs/t.jpg': null }, 'content/videos/m1.md: thumbnail: media/thumbs/t.jpg does not exist'],
    ['audio that is not an MP3', { 'content/videos/m2.md': md(vid('T', { audio: 'a.wav' })) }, 'audio: "a.wav" must be a .mp3 file'],
    ['a media path outside its folder', { 'content/videos/m2.md': md(vid('T', { handout: '../h.pdf' })) }, 'handout: must be a file name in media/pdf/'],
    ['a transcript with a Markdown heading', { 'content/videos/m2.md': md(vid('T'), 'Intro.\n\n## Part two\n\nMore.\n') }, 'transcript: line 3 is a Markdown heading'],
    ['a transcript with a setext heading', { 'content/videos/m2.md': md(vid('T'), 'Part two\n---\n') }, 'turns the line above into a heading'],
    ['a transcript with HTML', { 'content/videos/m2.md': md(vid('T'), 'Hello <script>alert(1)</script>\n') }, 'transcript: contains HTML tags'],
    ['a transcript that is only an HTML comment', { 'content/videos/m2.md': md(vid('T', withMedia('m2')), '<!-- transcript to come -->\n') }, 'transcript: contains an HTML comment'],
    ['an HTML comment inside a transcript', { 'content/videos/m2.md': md(vid('T', withMedia('m2')), 'Words.\n\n<!--\nnote\n-->\n') }, 'transcript: contains an HTML comment'],
    ['a stand-in transcript on a real video', { 'content/videos/m2.md': md(vid('T', withMedia('m2')), '[Transcript of “T”.]\n') }, 'content/videos/m2.md: transcript: is still the [bracketed] stand-in'],
    ['a stand-in transcript with a list, on a real video', { 'content/videos/m2.md': md(vid('T', withMedia('m2')), '[Transcript of “T”.]\n\n[Each paragraph:]\n\n- [one point]\n- [another point]\n') }, 'transcript: is still the [bracketed] stand-in'],
    ['a transcript with a Markdown image', { 'content/videos/m2.md': md(vid('T'), 'Intro.\n\nSee ![x](https://tracker.example/p.png) here.\n') }, 'content/videos/m2.md: transcript: line 3 has an image ("https://tracker.example/p.png")'],
    ['a transcript linking to another site', { 'content/videos/m2.md': md(vid('T'), 'Read [this](https://elsewhere.example/a).\n') }, 'transcript: line 1 links to "https://elsewhere.example/a"'],
    ['a transcript with an autolink', { 'content/videos/m2.md': md(vid('T'), 'One.\n\nTwo <https://elsewhere.example>.\n') }, 'transcript: line 3 links to "https://elsewhere.example"'],
    ['a transcript with a reference link to another site', { 'content/videos/m2.md': md(vid('T'), 'See [the guide][g].\n\n[g]: //elsewhere.example/guide\n') }, 'links to "//elsewhere.example/guide"'],
    ['a video_id that is not lowercase-hyphenated', { 'content/videos/Bad_Name.md': md(vid('T')) }, 'content/videos/Bad_Name.md: the file name'],
    ['unreadable front matter', { 'content/videos/m2.md': '---\ntitle: "unclosed\nyoutube_id: x\n---\n' }, "content/videos/m2.md: can't read the front matter"],
    ['a problem without a title', { 'content/problems/two.md': md(problem('Two', { title: '', problem_video: 'about-two' })) }, 'content/problems/two.md: title: required'],
    ['a problem without a statement', { 'content/problems/two.md': md(problem('Two', { statement: undefined, problem_video: 'about-two' })) }, 'two.md: statement: required'],
    ['an unknown area', { 'content/problems/two.md': md(problem('Two', { area: 'sleepy', problem_video: 'about-two' })) }, 'two.md: area: unknown area "sleepy"'],
    ['an unknown time_of_day', { 'content/problems/two.md': md(problem('Two', { time_of_day: 'midnight', problem_video: 'about-two' })) }, 'two.md: time_of_day: must be one of'],
    ['a missing order', { 'content/problems/two.md': md(problem('Two', { order: 'first', problem_video: 'about-two' })) }, 'two.md: order: required'],
    ['a missing problem_video', { 'content/problems/two.md': md(problem('Two', { problem_video: undefined })) }, 'two.md: problem_video: required'],
    ['an unknown problem_video', { 'content/problems/two.md': md(problem('Two', { problem_video: 'gone' })) }, 'two.md: problem_video: unknown video "gone" (no content/videos/gone.md)'],
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
    ['a solution without a blurb', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', solutions: [{ tier: 'main', video: 'm1' }] })) }, 'two.md: solutions[1].blurb: required'],
    ['an unknown solution field', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', solutions: [{ tier: 'main', video: 'm1', blurb: 'A', blrub: 'x' }] })) }, 'two.md: solutions[1].blrub: unknown field'],
    ['a video used twice on one page', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', solutions: [{ tier: 'main', video: 'm1', blurb: 'A' }, { tier: 'extra', video: 'm1', blurb: 'B' }] })) }, 'two.md: solutions[2].video: video "m1" is already on this page (solutions[1].video)'],
    ['the problem video also used as a solution', { 'content/problems/two.md': md(problem('Two', { problem_video: 'm1' })) }, 'video "m1" is already on this page (problem_video)'],
    ['an unknown related problem', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', related: ['one', 'nine'] })) }, 'two.md: related[2]: unknown problem "nine"'],
    ['a problem listing itself as related', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', related: ['one', 'two'] })) }, "two.md: related[2]: a problem can't list itself"],
    ['a related problem listed twice', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', related: ['one', 'one'] })) }, 'two.md: related[2]: "one" is listed twice'],
    ['more than 3 related problems', { 'content/problems/four.md': md(problem('Four', { problem_video: 'm2', solutions: [{ tier: 'main', video: 'm3', blurb: 'A' }], related: ['one', 'two', 'three', 'four'] })) }, 'four.md: related: has 4 topics; the most is 3'],
    ['more than 4 bullets', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', is_this_you: { summary: 'S', bullets: ['a', 'b', 'c', 'd', 'e'] } })) }, 'two.md: is_this_you.bullets: has 5 items; the most is 4'],
    ['an unknown "Is this you?" field', { 'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', is_this_you: { sumary: 'S', bullets: ['a', 'b'] } })) }, 'two.md: is_this_you.sumary: unknown field'],
    ['no Start here chapters', { 'content/start.md': md({ title: 'Start here', chapters: [] }) }, 'content/start.md: chapters: required'],
    ['an unknown Start here video', { 'content/start.md': md({ chapters: [{ video: 'gone', description: 'D' }] }) }, 'content/start.md: chapters[1].video: unknown video "gone"'],
    ['a Start here chapter without a description', { 'content/start.md': md({ chapters: [{ video: 'intro' }] }) }, 'content/start.md: chapters[1].description: required'],
    ['a Start here video listed twice', { 'content/start.md': md({ chapters: [{ video: 'intro', description: 'A' }, { video: 'intro', description: 'B' }] }) }, 'content/start.md: chapters[2].video: video "intro" is already listed'],
    ['an unknown Start here chapter field', { 'content/start.md': md({ chapters: [{ video: 'intro', description: 'A', title: 'Old' }] }) }, 'content/start.md: chapters[1].title: unknown field'],
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
      'content/videos/m1.md: audio: media/audio/a.mp3 is over 25 MiB, the most a static file can be (SPEC §9.2)',
    ]);
  });

  it('placeholder videos, with launch: true (SPEC §20 M8)', () => {
    const changes = { 'content/videos/m2.md': md(placeholderVid('[T]', withMedia('m2')), TX) };
    expect(messages(run(changes))).toEqual([]);
    expect(messages(run(changes, { launch: true }))).toEqual([
      'content/videos/m2.md: placeholder: placeholder videos are not allowed at launch',
    ]);
  });
});

describe('every video has a handout and an audio-only version by launch; a transcript is optional (SPEC §9.2, §9.3)', () => {
  const HANDOUT = 'content/videos/m2.md: handout: required at launch: every video has a handout (SPEC §9.3)';
  const AUDIO = 'content/videos/m2.md: audio: required at launch: every video has an audio-only version (SPEC §9.2)';
  const PLACEHOLDER = 'content/videos/m2.md: placeholder: placeholder videos are not allowed at launch';
  const NONE = [['missing-handout', 'm2'], ['missing-audio', 'm2']];
  // [description, m2's front matter, transcript, warnings ([code, video_id]), errors with launch: true]
  const cases = [
    ['a real video with both and a transcript', vid('T', withMedia('m2')), 'Words.\n', [], []],
    ['a real video without a handout', vid('T', { audio: 'm2.mp3' }), 'Words.\n', [['missing-handout', 'm2']], [HANDOUT]],
    ['a real video without audio', vid('T', { handout: 'm2.pdf' }), 'Words.\n', [['missing-audio', 'm2']], [AUDIO]],
    // The handout is the text alternative now: no transcript needed (project lead, 2026-11-06).
    ['a real video without a transcript', vid('T', withMedia('m2')), '', [], []],
    ['a real video whose transcript is only blank lines', vid('T', withMedia('m2')), '\n  \n\t\n', [], []],
    ['a real video with none of them', vid('T'), '', NONE, [HANDOUT, AUDIO]],
    ['a real video with empty handout and audio fields', vid('T', { handout: '', audio: '' }), '', NONE, [HANDOUT, AUDIO]],
    ['a placeholder with both', placeholderVid('[T]', withMedia('m2')), 'Words.\n', [['placeholder-video', 'm2']], [PLACEHOLDER]],
    ['a placeholder with none (listed only as a placeholder)', placeholderVid('[T]'), '', [['placeholder-video', 'm2']], [PLACEHOLDER, HANDOUT, AUDIO]],
  ];

  it.each(cases)('%s', (name, data, body, warnings, launchErrors) => {
    const changes = { 'content/videos/m2.md': md(data, body) };
    const result = run(changes);
    expect(messages(result)).toEqual([]);
    expect(result.warnings.map((w) => [w.code, w.message])).toEqual(warnings);
    const launch = run(changes, { launch: true });
    expect(messages(launch)).toEqual(launchErrors);
    expect(launch.warnings).toEqual([]);
  });

  it('groups the warnings under their own headings, with none for a missing transcript', () => {
    const result = run({ 'content/videos/m2.md': md(vid('T')), 'content/videos/m3.md': md(vid('T', { handout: 'm3.pdf' }), TX) });
    expect(groupWarnings(result.warnings)).toEqual([
      ['Videos without a handout (every video needs one by launch, SPEC §9.3)', ['m2']],
      ['Videos without an audio-only version (every video needs one by launch, SPEC §9.2)', ['m2', 'm3']],
    ]);
    expect(result.warnings.map((w) => w.code)).not.toContain('missing-transcript');
  });

  it('leaves a handout or audio file that does not exist to the usual error, not a second one', () => {
    const changes = { 'media/pdf/m2.pdf': null };
    const expected = ['content/videos/m2.md: handout: media/pdf/m2.pdf does not exist'];
    expect(messages(run(changes))).toEqual(expected);
    expect(messages(run(changes, { launch: true }))).toEqual(expected);
  });
});

describe('stand-in transcripts and HTML comments (SPEC §7, §7.1)', () => {
  const STAND_IN = 'content/videos/m2.md: transcript: is still the [bracketed] stand-in: put in the real transcript, or delete it until there is one';

  it('a placeholder may keep its [bracketed] stand-in transcript', () => {
    const changes = { 'content/videos/m2.md': md(placeholderVid('[T]', withMedia('m2')), '[Transcript of “T”.]\n\n- [one point]\n') };
    const result = run(changes);
    expect(messages(result)).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toEqual(['placeholder-video']);
  });

  it('a real video with the stand-in fails once, also at launch (the search would index it)', () => {
    const changes = { 'content/videos/m2.md': md(vid('T', withMedia('m2')), '[Transcript of “T”.]\n') };
    expect(messages(run(changes))).toEqual([STAND_IN]);
    expect(messages(run(changes, { launch: true }))).toEqual([STAND_IN]);
  });

  it('a real transcript may have [bracketed] sound notes among its words', () => {
    const changes = { 'content/videos/m2.md': md(vid('T', withMedia('m2')), '[Gentle music]\n\nHello, I’m Sam.\n\n[Pause]\n') };
    const result = run(changes);
    expect(messages(result)).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(messages(run(changes, { launch: true }))).toEqual([]);
  });

  it('"<!--" in a code span is text, not a comment', () => {
    expect(transcriptProblems('Type `<!--` to start a comment.\n')).toEqual([]);
  });
});

describe('data/team.csv (SPEC §7.4)', () => {
  const TEAM = 'data/team.csv';

  it('passes with name, role and an optional organisation', () => {
    expect(messages(run({ [TEAM]: 'name,role,organisation\nA Person,Researcher,Uni\nB Person,Lived experience expert,\n' }))).toEqual([]);
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
  it('placeholder videos, which may use "PLACEHOLDER" and a bracketed duration', () => {
    const result = run({ 'content/videos/m2.md': md(placeholderVid('[T]')) });
    expect(messages(result)).toEqual([]);
    expect(result.warnings).toEqual([{ code: 'placeholder-video', file: 'content/videos/m2.md', message: 'm2' }]);
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
      'content/videos/spare.md': md(vid('Spare', withMedia('m2')), TX),
      'content/problems/two.md': md(problem('Two', { problem_video: 'about-two', keywords: 'x' })),
    });
    expect(messages(result)).toEqual([]);
    expect(codes(result)).toEqual(['unknown-key', 'unused-video']);
    expect(groupWarnings(result.warnings)).toEqual([
      ['Front-matter keys the templates do not read (a typo?)', ['content/problems/two.md: keywords']],
      ['Videos not used on any page', ['spare']],
    ]);
  });
});

describe('transcriptProblems', () => {
  it('allows plain Markdown: paragraphs, lists, emphasis, a thematic break and code', () => {
    expect(transcriptProblems('One *two*.\n\n- a\n- b\n\n---\n\nThree `<b>` and 2 < 3.\n\n```\n# not a heading\n```\n')).toEqual([]);
  });

  it('allows links to pages on this site, and text that only looks like a link', () => {
    expect(transcriptProblems('See [Pain](/problems/pain/) and [the notes](#notes).\n\nA [bracket] and https://example.org as text.\n')).toEqual([]);
  });

  it('reports images and links to other sites, with their lines', () => {
    expect(transcriptProblems('One.\n\n![a](/img/a.png)\n\nMail <me@example.org>.\n')).toEqual([
      'line 3 has an image ("/img/a.png"); transcripts are text only',
      'line 5 links to "mailto:me@example.org"; a transcript can link only to pages on this site, such as /problems/pain/',
    ]);
  });
});

describe('the CLI', () => {
  const exec = promisify(execFile);

  it('exits 0 and says so for valid content, listing warnings', async () => {
    const { dir } = run({ 'content/videos/spare.md': md(vid('Spare', withMedia('m2'))) });
    const { stdout, stderr } = await exec(process.execPath, [SCRIPT], { cwd: dir });
    expect(stdout).toContain('Content check passed.');
    expect(stderr).toContain('Warning: Videos not used on any page (1): spare');
  });

  it('warns about a real video without a handout, and fails on it with --no-placeholders', async () => {
    const { dir } = run({ 'content/videos/m2.md': md(vid('T', { audio: 'm2.mp3' })) });
    const { stdout, stderr } = await exec(process.execPath, [SCRIPT], { cwd: dir });
    expect(stdout).toContain('Content check passed.');
    expect(stderr).toContain('Warning: Videos without a handout (every video needs one by launch, SPEC §9.3) (1): m2');
    const error = await exec(process.execPath, [SCRIPT, '--no-placeholders'], { cwd: dir }).catch((e) => e);
    expect(error.code).toBe(1);
    expect(error.stderr).toContain('content/videos/m2.md: handout: required at launch: every video has a handout (SPEC §9.3)');
  });

  it('exits 1 and lists each problem with its file and field', async () => {
    const { dir } = run({ 'media/pdf/h.pdf': null });
    const error = await exec(process.execPath, [SCRIPT], { cwd: dir }).catch((e) => e);
    expect(error.code).toBe(1);
    expect(error.stderr).toContain('Content check failed (1 problem):');
    expect(error.stderr).toContain('content/videos/m1.md: handout: media/pdf/h.pdf does not exist');
  });

  it('fails on placeholder videos with --no-placeholders', async () => {
    const { dir } = run({ 'content/videos/m2.md': md(placeholderVid('[T]', withMedia('m2'))) });
    await expect(exec(process.execPath, [SCRIPT], { cwd: dir })).resolves.toBeTruthy();
    const error = await exec(process.execPath, [SCRIPT, '--no-placeholders'], { cwd: dir }).catch((e) => e);
    expect(error.code).toBe(1);
    expect(error.stderr).toContain('placeholder videos are not allowed at launch');
  });
});
