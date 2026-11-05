// Directory data for the information pages (SPEC §7.4). A page's page_id is
// its file name, and it renders at /<file name>/. Pages use the information
// layout unless their front matter names another (urgent-help.md does).
export default {
  layout: 'layouts/info.njk',
  eleventyComputed: {
    page_id: (data) => data.page.fileSlug,
    permalink: (data) => `/${data.page.fileSlug}/`,
  },
};
