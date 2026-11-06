// Directory data for content/problems/*.md (SPEC §7.2). Each file is one
// sleep problem, rendered at /problems/<slug>/ with the slug as its page_id.
// The "problems" collection is defined in eleventy.config.js.
export default {
  layout: 'layouts/problem.njk',
  page_width: 'wide',
  scripts: ['players.js'],
  // Analytics (SPEC §10.2): problem pages send a page_view. base.njk renders
  // it as <body data-page-view>, which events.js and pages.json (SPEC §8.3)
  // read.
  track_page_view: true,
  // The page shows its videos' transcripts, so the video library must render
  // first (content/videos/videos.11tydata.js).
  eleventyImport: { collections: ['videos'] },
  eleventyComputed: {
    // layouts/problem.njk adds solutions.js, which upgrades the solution
    // cards; a stand-alone problem has none (SPEC §7.2), so it isn't loaded.
    scripts: (data) => (data.standalone ? (data.scripts ?? []).filter((src) => src !== 'solutions.js') : data.scripts),
    page_id: (data) => data.page.fileSlug,
    permalink: (data) => `/problems/${data.page.fileSlug}/`,
    // The statement doubles as the meta description (and, in M2, the search
    // summary, SPEC §8.3).
    summary: (data) => data.statement,
  },
};
