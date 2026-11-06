// Directory data for the video library, content/videos/<video_id>.md
// (SPEC §7.1). Videos have no page of their own: problem pages and Start here
// embed them through the `videos` collection and the `videoById` filter
// (eleventy.config.js). The body, if any, is the video's transcript: no page
// shows it (SPEC §9.3), but the site search indexes it and it can be the
// source of the YouTube captions. It is treated as plain Markdown (never as
// a template, so `{{` in a transcript can't break the build).
export default {
  permalink: false,
  templateEngineOverride: 'md',
  eleventyComputed: {
    video_id: (data) => data.page.fileSlug,
  },
};
