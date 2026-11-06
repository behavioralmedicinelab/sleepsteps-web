// /search-index.json, the site search index (SPEC §8.3; shape and contents in
// scripts/build-data.js). The information pages come from collections.all,
// which holds every page whatever order Eleventy renders them in: a
// config-API collection (addCollection) can be computed before a page that
// itself imports a collection has joined it.
import { searchIndex } from '../scripts/build-data.js';

export const data = {
  permalink: '/search-index.json',
  eleventyExcludeFromCollections: true,
};

const isInfoPage = (item) => /^\.?\/?content\/pages\/[^/]+\.md$/.test(item.inputPath);

export function render(data) {
  const { collections } = data;
  return JSON.stringify(
    searchIndex({
      problems: collections.problems,
      videos: collections.videos,
      start: collections.all.find((item) => item.data.page_id === 'start'),
      pages: collections.all.filter(isInfoPage).sort((a, b) => a.page.fileSlug.localeCompare(b.page.fileSlug)),
      keywords: data.keywords,
    }),
  );
}
