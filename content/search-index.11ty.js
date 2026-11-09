// /search-index.json, the site search index (SPEC §8.3; shape and contents in
// scripts/build-data.js). The information pages come from collections.all,
// which holds every page whatever order Eleventy renders them in: a
// config-API collection (addCollection) can be computed before a page that
// itself imports a collection has joined it.
import { fileURLToPath } from 'node:url';
import { searchIndex } from '../scripts/build-data.js';
import { TRANSCRIPTS_DIR, readTranscripts } from '../scripts/lib/videos.js';

// Optional plain-text transcripts, data/transcripts/<video_id>.txt (SPEC
// §7.1): read here, for the index only, and never passed to a page. The
// folder is the one the content check reads (TRANSCRIPTS_DIR); exported for
// the tests. Eleventy watches data/, so `npm run dev` rebuilds when one
// changes.
export const TRANSCRIPTS = fileURLToPath(new URL(`../${TRANSCRIPTS_DIR}/`, import.meta.url));

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
      videos: data.videos,
      transcripts: readTranscripts(TRANSCRIPTS),
      start: collections.all.find((item) => item.data.page_id === 'start'),
      pages: collections.all.filter(isInfoPage).sort((a, b) => a.page.fileSlug.localeCompare(b.page.fileSlug)),
      keywords: data.keywords,
    }),
  );
}
