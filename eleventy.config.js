import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCsvRecords } from './scripts/lib/csv.js';
import { formatIssue, validateContent } from './scripts/validate-content.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const site = JSON.parse(readFileSync(new URL('./site.config.json', import.meta.url), 'utf8'));

// A video as templates see it (SPEC §7.1): the front matter, whether it has
// a transcript, and the transcript as HTML. `transcriptHtml` is read lazily,
// because a page can only use a video's rendered body once the video has been
// rendered (eleventyImport in content/videos/videos.11tydata.js). Test with
// `hasTranscript`, not `transcriptHtml`.
function toVideo(item) {
  const d = item.data;
  const video = {
    video_id: item.page.fileSlug,
    title: d.title,
    youtube_id: d.youtube_id,
    duration: d.duration,
    audio: d.audio || '',
    handout: d.handout || '',
    thumbnail: d.thumbnail || '',
    placeholder: d.placeholder === true,
    hasTranscript: String(item.rawInput ?? '').trim() !== '',
  };
  Object.defineProperty(video, 'transcriptHtml', {
    enumerable: true,
    get: () => (video.hasTranscript ? item.templateContent : ''),
  });
  return video;
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
      area.problems.push({
        slug: item.data.page_id,
        title: item.data.title,
        statement: item.data.statement,
        url: item.url,
        isNew: item.data.new === true,
      });
    }
    const result = [...byId.values()];
    grouped.set(problems, { areas, result });
    return result;
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
  //   placeholder, hasTranscript, transcriptHtml }. Unknown ids fail the build.
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

  // Which formats any video in the library has: { transcript, handout, audio }.
  eleventyConfig.addFilter('videoFormats', (videos) => {
    const all = (videos ?? []).map((item) => lookupVideo(item.page.fileSlug, videos));
    return {
      transcript: all.some((v) => v.hasTranscript),
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
  eleventyConfig.addFilter('moduleScripts', (scripts) => {
    if (scripts === undefined || scripts === null) return [];
    const list = Array.isArray(scripts) ? scripts : [scripts];
    return [
      ...new Set(
        list.map((entry) => {
          if (typeof entry !== 'string' || !/^[a-z0-9][a-z0-9-]*\.js$/.test(entry)) {
            throw new Error(`scripts: "${entry}" must be a file name in src/js/, e.g. "players.js"`);
          }
          return `/js/${entry}`;
        }),
      ),
    ];
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
