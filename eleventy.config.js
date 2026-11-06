import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pagesIndex, writeIfChanged } from './scripts/build-data.js';
import { parseCsvRecords } from './scripts/lib/csv.js';
import { formatIssue, validateContent } from './scripts/validate-content.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
// Read by the Worker (SPEC §8.3, §14.1). Always this repository's own copy,
// whatever the output directory, so the tests' build (into a temporary
// directory) leaves it ready for the Worker tests and `wrangler deploy`.
const PAGES_JSON = path.join(ROOT, 'worker', 'generated', 'pages.json');
const site = JSON.parse(readFileSync(new URL('./site.config.json', import.meta.url), 'utf8'));

// A video as templates see it (SPEC §7.1): its front matter. The file's body
// (an optional transcript) isn't shown on any page (SPEC §9.3); only the
// search index reads it (scripts/build-data.js).
function toVideo(item) {
  const d = item.data;
  return {
    video_id: item.page.fileSlug,
    title: d.title,
    youtube_id: d.youtube_id,
    duration: d.duration,
    audio: d.audio || '',
    handout: d.handout || '',
    thumbnail: d.thumbnail || '',
    placeholder: d.placeholder === true,
  };
}

const NUMBER_WORDS = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' ');

export default function (eleventyConfig) {
  eleventyConfig.addGlobalData('site', site);

  // Every build fails on invalid content, including `npm run dev` rebuilds
  // and the tests' build, not only `npm run build` (SPEC §7, §18.1).
  eleventyConfig.on('eleventy.before', () => {
    const { errors } = validateContent(ROOT);
    if (errors.length) {
      throw new Error(`Content check failed:\n${errors.map(formatIssue).join('\n')}`);
    }
  });

  // worker/generated/pages.json, from the rendered pages of every full build
  // (`npm run build`, `npm run dev` rebuilds and the tests' build). An
  // incremental rebuild renders only some pages, and a dry run renders none,
  // so both leave the file as it is.
  eleventyConfig.on('eleventy.after', ({ results, incremental }) => {
    const rendered = (results ?? []).filter((r) => typeof r?.outputPath === 'string');
    if (incremental || rendered.length === 0) return;
    writeIfChanged(PAGES_JSON, `${JSON.stringify(pagesIndex(rendered), null, 2)}\n`);
  });

  // Team-edited CSV files in data/ become global data, one array of row
  // objects per file: data/areas.csv -> `areas` (SPEC §7.2).
  eleventyConfig.addDataExtension('csv', {
    parser: (contents) => parseCsvRecords(contents),
  });

  // Browser assets are copied as-is: plain ES modules, no bundler (SPEC §5).
  eleventyConfig.addPassthroughCopy({ 'src/css': 'css' });
  eleventyConfig.addPassthroughCopy({ 'src/js': 'js' });
  eleventyConfig.addPassthroughCopy({ 'src/img': 'img' });
  eleventyConfig.addPassthroughCopy({ media: 'media' });
  // Response headers for static assets, read by Workers (SPEC §16.1).
  eleventyConfig.addPassthroughCopy({ 'src/_headers': '_headers' });
  // MiniSearch for the search page (SPEC §5, §8), copied from node_modules as
  // published: its browser ES module, the source map it names, and its MIT
  // licence. Loaded by src/js/search.js and nowhere else.
  eleventyConfig.addPassthroughCopy({
    'node_modules/minisearch/dist/es/index.js': 'js/vendor/minisearch/index.js',
    'node_modules/minisearch/dist/es/index.js.map': 'js/vendor/minisearch/index.js.map',
    'node_modules/minisearch/LICENSE.txt': 'js/vendor/minisearch/LICENSE.txt',
  });

  // All sleep problems, ordered by area (areas.csv `order`) and then by each
  // problem's `order` within its area.
  eleventyConfig.addCollection('problems', (collectionApi) => {
    const items = collectionApi.getFilteredByGlob('./content/problems/*.md');
    const areaOrder = new Map((items[0]?.data.areas ?? []).map((a) => [a.area_id, Number(a.order)]));
    return items.sort(
      (a, b) =>
        (areaOrder.get(a.data.area) ?? Infinity) - (areaOrder.get(b.data.area) ?? Infinity) ||
        Number(a.data.order) - Number(b.data.order) ||
        a.data.title.localeCompare(b.data.title),
    );
  });

  // A problem as a link in a list: the shape groupByArea and groupByTime give.
  const problemLink = (item) => ({
    slug: item.data.page_id,
    title: item.data.title,
    statement: item.data.statement,
    url: item.url,
    isNew: item.data.new === true,
  });

  // Areas in display order, each with its problems: the shape TopicNav and
  // the Sleep problems page use. Fails the build on a problem whose `area` is
  // not in areas.csv. Cached per collection, since every page renders it.
  const grouped = new WeakMap();
  eleventyConfig.addFilter('groupByArea', (problems, areas) => {
    if (!Array.isArray(problems) || !Array.isArray(areas)) {
      throw new Error('groupByArea expects the problems collection and the areas data');
    }
    const cached = grouped.get(problems);
    if (cached?.areas === areas) return cached.result;

    const byId = new Map(
      [...areas]
        .sort((a, b) => Number(a.order) - Number(b.order))
        .map((a) => [a.area_id, { ...a, problems: [] }]),
    );
    for (const item of problems) {
      const area = byId.get(item.data.area);
      if (!area) {
        throw new Error(`${item.inputPath}: unknown area "${item.data.area}" (not in data/areas.csv)`);
      }
      area.problems.push(problemLink(item));
    }
    const result = [...byId.values()];
    grouped.set(problems, { areas, result });
    return result;
  });

  // The Sleep problems page's "When it happens" groups (`time_groups` in
  // content/problems.njk: [{ id, name }] in display order), each with its
  // problems in collection order (SPEC §7.2). Fails the build on a problem
  // whose `time_of_day` has no group. Only that page uses it.
  eleventyConfig.addFilter('groupByTime', (problems, times) => {
    if (!Array.isArray(problems) || !Array.isArray(times)) {
      throw new Error('groupByTime expects the problems collection and the time_groups front matter');
    }
    const byId = new Map(times.map((t) => [t.id, { ...t, problems: [] }]));
    for (const item of problems) {
      const time = byId.get(item.data.time_of_day);
      if (!time) {
        throw new Error(`${item.inputPath}: time_of_day "${item.data.time_of_day}" has no group in content/problems.njk`);
      }
      time.problems.push(problemLink(item));
    }
    return [...byId.values()];
  });

  // The video library (SPEC §7.1), ordered by video_id. Templates read a
  // video through `videoById`, which returns the shape documented on toVideo().
  eleventyConfig.addCollection('videos', (collectionApi) =>
    collectionApi
      .getFilteredByGlob('./content/videos/*.md')
      .sort((a, b) => a.page.fileSlug.localeCompare(b.page.fileSlug)),
  );

  const videoIndexes = new WeakMap();
  const lookupVideo = (id, videos) => {
    if (!Array.isArray(videos)) throw new Error('pass collections.videos, e.g. problem_video | videoById(collections.videos)');
    let index = videoIndexes.get(videos);
    if (!index) {
      index = new Map(videos.map((item) => [item.page.fileSlug, toVideo(item)]));
      videoIndexes.set(videos, index);
    }
    const video = index.get(id);
    if (!video) throw new Error(`unknown video "${id}" (no content/videos/${id}.md)`);
    return video;
  };

  // "sleep-drive" | videoById(collections.videos) ->
  // { video_id, title, youtube_id, duration, audio, handout, thumbnail,
  //   placeholder }. Unknown ids fail the build.
  eleventyConfig.addFilter('videoById', lookupVideo);

  // A problem's `solutions` split by tier, each with its video resolved:
  // { main: [{ n, tier, blurb, video }], extra: [...] }; n counts from 1
  // within each tier (the step chip number).
  eleventyConfig.addFilter('solutionsByTier', (solutions, videos) => {
    const tiers = { main: [], extra: [] };
    for (const solution of solutions ?? []) {
      const list = tiers[solution.tier];
      if (!list) throw new Error(`solution tier must be "main" or "extra", not "${solution.tier}"`);
      list.push({ n: list.length + 1, tier: solution.tier, blurb: solution.blurb, video: lookupVideo(solution.video, videos) });
    }
    return tiers;
  });

  // Start here chapters (SPEC §7.3) with their videos resolved:
  // [{ n, id: 'v1', video_id, title, duration, description, video }].
  // No chapters (any other page) gives [].
  eleventyConfig.addFilter('introChapters', (chapters, videos) =>
    (chapters ?? []).map((chapter, i) => {
      const video = lookupVideo(chapter.video, videos);
      return {
        n: i + 1,
        id: `v${i + 1}`,
        video_id: video.video_id,
        title: video.title,
        duration: video.duration,
        description: chapter.description,
        video,
      };
    }),
  );

  // Which formats any video in the library has: { handout, audio }.
  eleventyConfig.addFilter('videoFormats', (videos) => {
    const all = (videos ?? []).map((item) => lookupVideo(item.page.fileSlug, videos));
    return {
      handout: all.some((v) => Boolean(v.handout)),
      audio: all.some((v) => Boolean(v.audio)),
    };
  });

  // "cant-get-back-to-sleep" | problemBySlug(collections.problems) ->
  // { slug, title, statement, url, area }. Unknown slugs fail the build.
  eleventyConfig.addFilter('problemBySlug', (slug, problems) => {
    const item = (problems ?? []).find((p) => p.data.page_id === slug);
    if (!item) throw new Error(`unknown problem "${slug}" (no content/problems/${slug}.md)`);
    return { slug, title: item.data.title, statement: item.data.statement, url: item.url, area: item.data.area };
  });

  // "6:40" -> "6 minutes 40 seconds", for screen readers next to a visible
  // duration. Anything that isn't m:ss or h:mm:ss (a "[mm:ss]" placeholder)
  // gives "".
  eleventyConfig.addFilter('spokenDuration', (duration) => {
    const m = String(duration ?? '').trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):([0-5]\d)$/);
    if (!m) return '';
    const parts = [
      [Number(m[1] ?? 0), 'hour'],
      [Number(m[2]), 'minute'],
      [Number(m[3]), 'second'],
    ]
      .filter(([n]) => n > 0)
      .map(([n, unit]) => `${n} ${unit}${n === 1 ? '' : 's'}`);
    return parts.length ? parts.join(' ') : '0 seconds';
  });

  // 10 -> "ten" (0-20), for copy such as "grouped into ten areas"; larger
  // numbers stay as digits.
  eleventyConfig.addFilter('numberWord', (n) => NUMBER_WORDS[n] ?? String(n));

  eleventyConfig.addFilter('areaById', (areas, id) => areas.find((a) => a.area_id === id));

  // aria-current for navigation links, derived from the page URL so styling
  // and semantics can't drift (styles key off the attribute). Returns
  // ' aria-current="page"' for the page itself and, with mode 'section',
  // ' aria-current="true"' for pages below it. Use with `| safe`.
  eleventyConfig.addFilter('ariaCurrent', (pageUrl, href, mode) => {
    if (typeof pageUrl !== 'string') return '';
    if (pageUrl === href) return ' aria-current="page"';
    if (mode === 'section' && pageUrl.startsWith(href)) return ' aria-current="true"';
    return '';
  });

  // "13 11 14" -> "tel:131114". Keeps digits and a leading +.
  eleventyConfig.addFilter('telHref', (value) => {
    const text = String(value ?? '').trim();
    return `tel:${text.startsWith('+') ? '+' : ''}${text.replace(/[^0-9]/g, '')}`;
  });

  // Ends a line with a full stop unless it already ends with . ? or !
  eleventyConfig.addFilter('sentence', (text) => {
    const t = String(text ?? '').trim();
    return /[.?!]$/.test(t) ? t : `${t}.`;
  });

  // Per-page stylesheets from front matter: `styles: ["pages/help.css"]`
  // links /css/pages/help.css. Only our own files under src/css/ are allowed
  // (the CSP allows style-src 'self' only, SPEC §16.1).
  eleventyConfig.addFilter('stylesheets', (styles) => {
    if (styles === undefined || styles === null) return [];
    const list = Array.isArray(styles) ? styles : [styles];
    return list.map((entry) => {
      if (typeof entry !== 'string' || !/^[a-z0-9][a-z0-9/_-]*\.css$/i.test(entry) || entry.includes('..')) {
        throw new Error(`styles: "${entry}" must be a path under src/css/, e.g. "pages/help.css"`);
      }
      return `/css/${entry}`;
    });
  });

  // Per-page scripts from front matter: `scripts: ["players.js"]` loads
  // /js/players.js as a module in <head>. Only file names in src/js/ (the CSP
  // allows script-src 'self', SPEC §16.1). Duplicates are dropped.
  //
  // base.njk passes { features: site.features, track: track_page_view }, and
  // the modules of a switchable feature follow it (SPEC §10.1, §11, §12).
  // A feature counts as on only when its value is exactly true:
  // - events.js is added, first, when features.events is on and the page
  //   sends a page view (track) or loads players.js or search.js, the modules
  //   that report events. It is never listed in front matter;
  // - stats-switch.js (the privacy page's) is dropped while features.events
  //   is off;
  // - rating.js (problem pages and Start here) is dropped while
  //   features.ratings is off, as the templates then render no widgets;
  // - feedback.js is never listed in front matter either: base.njk loads it
  //   with the feedback dialog (SPEC §13).
  // Without the options, events.js, stats-switch.js and rating.js are left
  // out.
  eleventyConfig.addFilter('moduleScripts', (scripts, { features, track } = {}) => {
    const list = scripts === undefined || scripts === null ? [] : Array.isArray(scripts) ? scripts : [scripts];
    const names = list.map((entry) => {
      if (typeof entry !== 'string' || !/^[a-z0-9][a-z0-9-]*\.js$/.test(entry)) {
        throw new Error(`scripts: "${entry}" must be a file name in src/js/, e.g. "players.js"`);
      }
      if (entry === 'events.js') {
        throw new Error('scripts: leave out "events.js"; base.njk adds it where it is needed (SPEC §10.1)');
      }
      if (entry === 'feedback.js') {
        throw new Error('scripts: leave out "feedback.js"; base.njk adds it with the feedback dialog (SPEC §13)');
      }
      return entry;
    });
    const events = features?.events === true;
    const ratings = features?.ratings === true;
    const reports = track === true || names.includes('players.js') || names.includes('search.js');
    return [
      ...new Set([
        ...(events && reports ? ['events.js'] : []),
        ...names.filter((name) => (events || name !== 'stats-switch.js') && (ratings || name !== 'rating.js')),
      ]),
    ].map((name) => `/js/${name}`);
  });
}

export const config = {
  dir: {
    input: 'content',
    includes: '../src/_includes',
    data: '../data',
    output: 'dist',
  },
  markdownTemplateEngine: 'njk',
  htmlTemplateEngine: 'njk',
};
