// The site's pages as the Worker checks them (SPEC §8.3, §14.1, §14.2).
// worker/generated/pages.json is built from the rendered HTML by every
// Eleventy build (scripts/build-data.js, pagesIndex):
//
//   { page_id: { url, title, page_view, videos: [video_id, ...], worksheets: [worksheet_id, ...] } }
//
// Imports no JSON, so Node can load this module too.

/** A list from pages.json as a Set of its strings; anything else is an empty Set. */
const stringSet = (list) => new Set(Array.isArray(list) ? list.filter((item) => typeof item === 'string') : []);

/**
 * pages.json -> Map(page_id -> { title, pageView, videos: Set, worksheets:
 * Set }). A Map, so ids such as "__proto__" or "constructor" can never match.
 * `worksheets` holds the worksheet_ids the page's open solution cards link
 * (SPEC §7.6): empty for most pages, and for a file without the key. An
 * entry's `url` is left out: nothing in the Worker reads it.
 */
export function pageIndex(json) {
  const index = new Map();
  for (const [id, page] of Object.entries(json ?? {})) {
    index.set(id, {
      title: String(page?.title ?? ''),
      pageView: page?.page_view === true,
      videos: stringSet(page?.videos),
      worksheets: stringSet(page?.worksheets),
    });
  }
  return index;
}
