import { readFileSync } from 'node:fs';
import { parseCsvRecords } from './scripts/lib/csv.js';

const site = JSON.parse(readFileSync(new URL('./site.config.json', import.meta.url), 'utf8'));

export default function (eleventyConfig) {
  eleventyConfig.addGlobalData('site', site);

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
