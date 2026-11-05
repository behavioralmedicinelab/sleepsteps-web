// Directory data for content/problems/*.md (SPEC §7.2). Each file is one
// sleep problem, rendered at /problems/<slug>/ with the slug as its page_id.
// The "problems" collection is defined in eleventy.config.js.
export default {
  layout: 'layouts/problem.njk',
  page_width: 'wide',
  eleventyComputed: {
    page_id: (data) => data.page.fileSlug,
    permalink: (data) => `/problems/${data.page.fileSlug}/`,
    // The statement doubles as the meta description (and, in M2, the search
    // summary, SPEC §8.3).
    summary: (data) => data.statement,
  },
};
