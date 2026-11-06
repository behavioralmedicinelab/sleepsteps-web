// Unit tests for the filters and data extension in eleventy.config.js,
// registered against a stand-in for Eleventy's config API.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import configure, { config } from '../../eleventy.config.js';

const registered = { filters: {}, collections: {}, dataExtensions: {}, passthrough: [] };
configure({
  on: () => {},
  addGlobalData: () => {},
  addDataExtension: (ext, options) => (registered.dataExtensions[ext] = options),
  addPassthroughCopy: (map) => registered.passthrough.push(map),
  addCollection: (name, fn) => (registered.collections[name] = fn),
  addFilter: (name, fn) => (registered.filters[name] = fn),
});
const f = registered.filters;

describe('eleventy.config.js', () => {
  it('reads global data from data/ and passes the logo through', () => {
    expect(config.dir.data).toBe('../data');
    expect(registered.dataExtensions.csv.parser('a,b\n1,"x, y"\n')).toEqual([{ a: '1', b: 'x, y' }]);
    expect(registered.passthrough).toContainEqual({ 'src/img': 'img' });
  });

  it('ariaCurrent marks the page and, in section mode, pages below it', () => {
    expect(f.ariaCurrent('/about/', '/about/')).toBe(' aria-current="page"');
    expect(f.ariaCurrent('/problems/pain/', '/problems/', 'section')).toBe(' aria-current="true"');
    expect(f.ariaCurrent('/problems/pain/', '/problems/')).toBe('');
    expect(f.ariaCurrent('/', '/start/', 'section')).toBe('');
    expect(f.ariaCurrent(undefined, '/start/')).toBe('');
  });

  it('telHref keeps digits and a leading +', () => {
    expect(f.telHref('13 11 14')).toBe('tel:131114');
    expect(f.telHref('000')).toBe('tel:000');
    expect(f.telHref('+61 2 9999 0000')).toBe('tel:+61299990000');
  });

  it('sentence adds a full stop only when needed', () => {
    expect(f.sentence("I'm tired")).toBe("I'm tired.");
    expect(f.sentence('What if my sleep problems come back?')).toBe('What if my sleep problems come back?');
  });

  it('stylesheets maps front-matter paths to /css/ URLs and rejects anything else', () => {
    expect(f.stylesheets(undefined)).toEqual([]);
    expect(f.stylesheets('pages/help.css')).toEqual(['/css/pages/help.css']);
    expect(f.stylesheets(['pages/help.css', 'about.css'])).toEqual(['/css/pages/help.css', '/css/about.css']);
    for (const bad of ['https://example.com/x.css', '/css/x.css', '../x.css', 'pages/../x.css', 'x.js', 42]) {
      expect(() => f.stylesheets([bad]), String(bad)).toThrow(/styles/);
    }
  });

  it('groupByArea orders areas and fails on an unknown area', () => {
    const areas = [
      { area_id: 'day', name: 'Day', order: '20' },
      { area_id: 'core', name: 'Core', order: '10' },
    ];
    const item = (slug, area) => ({ url: `/problems/${slug}/`, inputPath: `${slug}.md`, data: { page_id: slug, title: slug, area } });
    const grouped = f.groupByArea([item('a', 'day'), item('b', 'core'), item('c', 'core')], areas);
    expect(grouped.map((a) => [a.area_id, a.problems.map((p) => p.slug)])).toEqual([
      ['core', ['b', 'c']],
      ['day', ['a']],
    ]);
    expect(() => f.groupByArea([item('x', 'nope')], areas)).toThrow(/unknown area "nope"/);
  });

  it('groupByTime keeps the given order and the collection order, and fails on a time with no group', () => {
    const times = [
      { id: 'evening', name: 'In the evening' },
      { id: 'night', name: 'During the night' },
      { id: 'any', name: 'Any time' },
    ];
    const item = (slug, time) => ({ url: `/problems/${slug}/`, inputPath: `${slug}.md`, data: { page_id: slug, title: slug, statement: `${slug}.`, time_of_day: time, new: slug === 'c' } });
    const grouped = f.groupByTime([item('a', 'night'), item('b', 'evening'), item('c', 'night')], times);
    expect(grouped.map((t) => [t.id, t.name, t.problems.map((p) => p.slug)])).toEqual([
      ['evening', 'In the evening', ['b']],
      ['night', 'During the night', ['a', 'c']],
      ['any', 'Any time', []],
    ]);
    // The same shape as groupByArea's problems.
    expect(grouped[1].problems[1]).toEqual({ slug: 'c', title: 'c', statement: 'c.', url: '/problems/c/', isNew: true });
    expect(() => f.groupByTime([item('x', 'noon')], times)).toThrow(/x\.md: time_of_day "noon" has no group/);
    expect(() => f.groupByTime(undefined, times)).toThrow(/groupByTime expects/);
  });

  // The templates, the moduleScripts filter and the Worker (worker/router.js)
  // all treat a feature as on only when it is exactly true, so a string such
  // as "false" can't render widgets the API then refuses (SPEC §11).
  it('site.config.json gives every feature switch as a boolean', () => {
    const { features } = JSON.parse(readFileSync('site.config.json', 'utf8'));
    expect(Object.keys(features).sort()).toEqual(['events', 'feedback', 'ratings']);
    for (const [name, value] of Object.entries(features)) expect(typeof value, `features.${name}`).toBe('boolean');
  });

  it('moduleScripts maps front-matter file names to /js/ URLs, once each, and rejects anything else', () => {
    expect(f.moduleScripts(undefined)).toEqual([]);
    expect(f.moduleScripts('players.js')).toEqual(['/js/players.js']);
    expect(f.moduleScripts(['players.js', 'solutions.js', 'players.js'])).toEqual(['/js/players.js', '/js/solutions.js']);
    for (const bad of ['https://www.youtube.com/iframe_api', '/js/x.js', 'js/x.js', '../x.js', 'x.css', 'X.js', 42]) {
      expect(() => f.moduleScripts([bad]), String(bad)).toThrow(/scripts/);
    }
  });

  // SPEC §10.1, §11: base.njk passes { features: site.features, track: track_page_view }.
  describe('moduleScripts and the usage statistics modules', () => {
    const on = { events: true };
    const off = { events: false };

    it('adds events.js first where the page tracks page views or loads players.js or search.js, while features.events is on', () => {
      expect(f.moduleScripts(undefined, { features: on, track: true })).toEqual(['/js/events.js']);
      expect(f.moduleScripts(['solutions.js', 'players.js'], { features: on, track: true })).toEqual([
        '/js/events.js', '/js/solutions.js', '/js/players.js',
      ]);
      expect(f.moduleScripts(['players.js'], { features: on })).toEqual(['/js/events.js', '/js/players.js']);
      expect(f.moduleScripts('search.js', { features: on, track: undefined })).toEqual(['/js/events.js', '/js/search.js']);
    });

    it('leaves events.js out on pages with nothing to send', () => {
      expect(f.moduleScripts(undefined, { features: on })).toEqual([]);
      expect(f.moduleScripts(['problems.js'], { features: on, track: false })).toEqual(['/js/problems.js']);
      expect(f.moduleScripts(['problems.js'], { features: on, track: 'yes' })).toEqual(['/js/problems.js']);
    });

    it('leaves events.js out everywhere while features.events is off or missing, and without the options', () => {
      for (const options of [{ features: off, track: true }, { features: {}, track: true }, { track: true }, undefined]) {
        expect(f.moduleScripts(['players.js'], options), JSON.stringify(options)).toEqual(['/js/players.js']);
        expect(f.moduleScripts(undefined, options), JSON.stringify(options)).toEqual([]);
      }
      // Only exactly true turns it on.
      expect(f.moduleScripts(['search.js'], { features: { events: 'true' } })).toEqual(['/js/search.js']);
    });

    it("keeps the privacy page's stats-switch.js only while features.events is on", () => {
      expect(f.moduleScripts(['stats-switch.js'], { features: on })).toEqual(['/js/stats-switch.js']);
      for (const options of [{ features: off }, { features: {} }, undefined]) {
        expect(f.moduleScripts(['stats-switch.js'], options), JSON.stringify(options)).toEqual([]);
      }
    });

    it('keeps rating.js only while features.ratings is exactly true (SPEC §11, §12)', () => {
      expect(f.moduleScripts(['players.js', 'rating.js'], { features: { ratings: true } })).toEqual(['/js/players.js', '/js/rating.js']);
      expect(f.moduleScripts(['solutions.js', 'rating.js', 'players.js'], { features: { ratings: true, events: true }, track: true })).toEqual([
        '/js/events.js', '/js/solutions.js', '/js/rating.js', '/js/players.js',
      ]);
      for (const options of [{ features: { ratings: false } }, { features: { ratings: 'true' } }, { features: { ratings: 1 } }, { features: {} }, {}, undefined]) {
        expect(f.moduleScripts(['players.js', 'rating.js'], options), JSON.stringify(options)).toEqual(['/js/players.js']);
      }
      // Each feature drops only its own modules.
      expect(f.moduleScripts(['stats-switch.js', 'rating.js'], { features: { ratings: true, events: false } })).toEqual(['/js/rating.js']);
      expect(f.moduleScripts(['stats-switch.js', 'rating.js'], { features: { ratings: false, events: true } })).toEqual(['/js/stats-switch.js']);
    });

    it('refuses events.js in front matter: the layout adds it', () => {
      for (const options of [{ features: on, track: true }, { features: off }, undefined]) {
        expect(() => f.moduleScripts(['players.js', 'events.js'], options)).toThrow(/leave out "events\.js"/);
      }
    });
  });

  it('spokenDuration reads a duration out in words, and gives "" for anything else', () => {
    expect(f.spokenDuration('6:40')).toBe('6 minutes 40 seconds');
    expect(f.spokenDuration('1:05')).toBe('1 minute 5 seconds');
    expect(f.spokenDuration('0:45')).toBe('45 seconds');
    expect(f.spokenDuration('10:00')).toBe('10 minutes');
    expect(f.spokenDuration('1:02:03')).toBe('1 hour 2 minutes 3 seconds');
    expect(f.spokenDuration('2:00:01')).toBe('2 hours 1 second');
    expect(f.spokenDuration('0:00')).toBe('0 seconds');
    for (const other of ['[mm:ss]', '', undefined, '6:4', '6:60', 'six']) expect(f.spokenDuration(other)).toBe('');
  });

  it('numberWord spells out 0-20 and leaves larger numbers as digits', () => {
    expect([f.numberWord(0), f.numberWord(3), f.numberWord(10), f.numberWord(20), f.numberWord(36)]).toEqual([
      'zero', 'three', 'ten', 'twenty', '36',
    ]);
  });

  describe('the video library filters', () => {
    // Stand-ins for Eleventy collection items.
    const item = (id, data, body = '') => ({
      page: { fileSlug: id },
      data: { video_id: id, ...data },
      rawInput: body,
      get templateContent() {
        if (!body.trim()) throw new Error('no transcript to render');
        return `<p>${body.trim()}</p>\n`;
      },
    });
    const videos = [
      item('intro', { title: 'Intro', youtube_id: 'AbCdEfGhIjK', duration: '6:40', handout: 'intro.pdf', audio: 'intro.mp3' }, 'Words.'),
      item('sleep-drive', { title: '[Sleep drive]', youtube_id: 'PLACEHOLDER', duration: '[mm:ss]', placeholder: true }),
      item('cognitive-arousal', { title: 'Cognitive arousal', youtube_id: 'AbCdEfGhIj0', duration: '3:05', thumbnail: 'w.jpg' }, '\n  \n'),
    ];

    it('videoById returns the template shape, with the transcript read lazily', () => {
      const intro = f.videoById('intro', videos);
      expect(intro).toEqual({
        video_id: 'intro', title: 'Intro', youtube_id: 'AbCdEfGhIjK', duration: '6:40', audio: 'intro.mp3',
        handout: 'intro.pdf', thumbnail: '', placeholder: false, hasTranscript: true, transcriptHtml: '<p>Words.</p>\n',
      });
      const arousal = f.videoById('cognitive-arousal', videos);
      expect([arousal.hasTranscript, arousal.transcriptHtml, arousal.thumbnail]).toEqual([false, '', 'w.jpg']);
      expect(f.videoById('sleep-drive', videos).placeholder).toBe(true);
      expect(f.videoById('intro', videos)).toBe(intro); // cached per collection
      expect(() => f.videoById('nope', videos)).toThrow(/unknown video "nope"/);
      expect(() => f.videoById('intro', undefined)).toThrow(/collections\.videos/);
    });

    it('solutionsByTier splits solutions by tier, numbering each tier from 1', () => {
      const tiers = f.solutionsByTier(
        [
          { tier: 'main', video: 'intro', blurb: 'A' },
          { tier: 'extra', video: 'cognitive-arousal', blurb: 'B' },
          { tier: 'main', video: 'sleep-drive', blurb: 'C' },
        ],
        videos,
      );
      expect(tiers.main.map((s) => [s.n, s.blurb, s.video.video_id])).toEqual([[1, 'A', 'intro'], [2, 'C', 'sleep-drive']]);
      expect(tiers.extra.map((s) => [s.n, s.tier, s.video.title])).toEqual([[1, 'extra', 'Cognitive arousal']]);
      expect(f.solutionsByTier(undefined, videos)).toEqual({ main: [], extra: [] });
      expect(() => f.solutionsByTier([{ tier: 'other', video: 'intro' }], videos)).toThrow(/tier/);
    });

    it('introChapters resolves Start here chapters, and gives [] without any', () => {
      const chapters = f.introChapters([{ video: 'intro', description: 'One.' }, { video: 'cognitive-arousal', description: 'Two.' }], videos);
      expect(chapters.map(({ video, ...rest }) => rest)).toEqual([
        { n: 1, id: 'v1', video_id: 'intro', title: 'Intro', duration: '6:40', description: 'One.' },
        { n: 2, id: 'v2', video_id: 'cognitive-arousal', title: 'Cognitive arousal', duration: '3:05', description: 'Two.' },
      ]);
      expect(chapters[0].video).toBe(f.videoById('intro', videos));
      expect(f.introChapters(undefined, videos)).toEqual([]);
      expect(() => f.introChapters([{ video: 'nope' }], videos)).toThrow(/unknown video/);
    });

    it('videoFormats says which formats any video has', () => {
      expect(f.videoFormats(videos)).toEqual({ transcript: true, handout: true, audio: true });
      expect(f.videoFormats(videos.slice(1))).toEqual({ transcript: false, handout: false, audio: false });
    });
  });

  it('problemBySlug returns a problem\'s title, statement and URL', () => {
    const problems = [{ url: '/problems/pain/', data: { page_id: 'pain', title: 'Pain', statement: 'Pain is affecting my sleep', area: 'med' } }];
    expect(f.problemBySlug('pain', problems)).toEqual({
      slug: 'pain', title: 'Pain', statement: 'Pain is affecting my sleep', url: '/problems/pain/', area: 'med',
    });
    expect(() => f.problemBySlug('nope', problems)).toThrow(/unknown problem "nope"/);
  });
});
