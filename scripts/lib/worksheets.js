// Worksheets (SPEC §7.6): data/worksheets.csv, one row per worksheet, which
// the team edits in Excel (saved as CSV UTF-8) like data/videos.csv. A
// worksheet belongs to a video, and shows in that video's open solution card
// on every problem that lists the video as a solution. The content check
// (scripts/validate-content.js), the templates' solutionsByTier filter
// (eleventy.config.js) and the search index (scripts/build-data.js) all read
// a row through this module, so they agree on what it means.

/** The spreadsheet, relative to the repository root. */
export const WORKSHEETS_FILE = 'data/worksheets.csv';

/** The folder the `file` column names a file in; served at /media/worksheets/. */
export const WORKSHEETS_DIR = 'media/worksheets';

/** data/worksheets.csv's columns, in order (SPEC §7.6). */
export const WORKSHEET_COLUMNS = ['worksheet_id', 'video_id', 'title', 'file'];

/**
 * The shared stand-in file in media/worksheets/ that a placeholder worksheet
 * names until its own file exists (SPEC §7). A worksheet of a video on
 * YouTube may not use it, and the launch check allows none.
 */
export const PLACEHOLDER_WORKSHEET = 'placeholder-worksheet.pdf';

/**
 * A data/worksheets.csv row as templates see it:
 *
 *   { worksheet_id, video_id, title, file, placeholder }
 *
 * - worksheet_id: the permanent id, in the link's data-worksheet;
 * - video_id: the video it belongs to (a row of data/videos.csv);
 * - title: the link's text;
 * - file: a file name in media/worksheets/;
 * - placeholder: true while `file` is the shared stand-in.
 */
export function toWorksheet(row) {
  const text = (value) => String(value ?? '').trim();
  const file = text(row?.file);
  return {
    worksheet_id: text(row?.worksheet_id),
    video_id: text(row?.video_id),
    title: text(row?.title),
    file,
    placeholder: file === PLACEHOLDER_WORKSHEET,
  };
}

/**
 * Each video's worksheets, in the file's order: Map(video_id -> [worksheet,
 * ...]), each in toWorksheet()'s shape. A video with none isn't in the map.
 * @param {object[]} rows data/worksheets.csv rows (the `worksheets` global data)
 */
export function worksheetsByVideo(rows = []) {
  const map = new Map();
  for (const row of rows ?? []) {
    const worksheet = toWorksheet(row);
    if (!map.has(worksheet.video_id)) map.set(worksheet.video_id, []);
    map.get(worksheet.video_id).push(worksheet);
  }
  return map;
}
