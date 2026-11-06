// Directory data for the video library, content/videos/<video_id>.md
// (SPEC §7.1). Videos have no page of their own: problem pages and Start here
// embed them through the `videos` collection and the `videoById` filter
// (eleventy.config.js). The body is the transcript, rendered as plain
// Markdown (never as a template, so `{{` in a transcript can't break the
// build); a template that shows transcripts must declare
// `eleventyImport: { collections: ['videos'] }` so they render first.
export default {
  permalink: false,
  templateEngineOverride: 'md',
  eleventyComputed: {
    video_id: (data) => data.page.fileSlug,
  },
};
