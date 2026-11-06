// The site's pages as the Worker checks them (SPEC §8.3, §14.1, §14.2).
// worker/generated/pages.json is built from the rendered HTML by every
// Eleventy build (scripts/build-data.js, pagesIndex):
//
//   { page_id: { url, title, page_view, videos: [video_id, ...] } }
//
// Imports no JSON, so Node can load this module too.

/**
 * pages.json -> Map(page_id -> { url, title, pageView, videos: Set }). A Map,
 * so ids such as "__proto__" or "constructor" can never match.
 */
export function pageIndex(json) {
  const index = new Map();
  for (const [id, page] of Object.entries(json ?? {})) {
    index.set(id, {
      url: String(page?.url ?? ''),
      title: String(page?.title ?? ''),
      pageView: page?.page_view === true,
      videos: new Set(Array.isArray(page?.videos) ? page.videos.filter((v) => typeof v === 'string') : []),
    });
  }
  return index;
}
