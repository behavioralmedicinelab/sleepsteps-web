// The video library (SPEC §7.1): data/videos.csv, one row per video, which
// the team edits in Excel (saved as CSV UTF-8), and the optional transcripts
// in data/transcripts/<video_id>.txt. The content check
// (scripts/validate-content.js), the templates' filters (eleventy.config.js)
// and the search index (scripts/build-data.js) all read a row through this
// module, so they agree on what it means.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * The transcripts folder, relative to the repository root (SPEC §7.1): the
 * content check and the search index (content/search-index.11ty.js) both
 * read it from here, so they can't drift apart.
 */
export const TRANSCRIPTS_DIR = 'data/transcripts';

/**
 * An id (SPEC §7): a video_id, a page_id, an area_id and a worksheet_id are
 * each lowercase words joined by hyphens. The one pattern for the content
 * check, the transcripts' file names and pages.json (scripts/build-data.js).
 */
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** data/videos.csv's columns, in order (SPEC §7.1). */
export const VIDEO_COLUMNS = ['video_id', 'title', 'description', 'youtube_url', 'duration', 'audio', 'handout', 'thumbnail'];

/**
 * The shared stand-in files in media/ that placeholder videos (no YouTube
 * link yet) name until their own audio and handout exist (SPEC §7). A video
 * on YouTube may not use them.
 */
export const PLACEHOLDER_FILES = { audio: 'placeholder-audio.mp3', handout: 'placeholder-handout.pdf' };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const WATCH_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com']);
const EMBED_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com']);

/**
 * The 11-character video ID in a YouTube link, or null if the text isn't
 * one of these (strictly: https only, no user name, password or port):
 *
 *   https://www.youtube.com/watch?v=<id>   the watch page (also youtube.com
 *                                          and m.youtube.com; other
 *                                          parameters such as &t= are fine,
 *                                          but only one v=)
 *   https://youtu.be/<id>                  YouTube's Share link (?si= is fine)
 *   https://www.youtube.com/embed/<id>     an embed link (also
 *                                          youtube-nocookie.com)
 */
export function youtubeIdFromUrl(text) {
  let url;
  try {
    url = new URL(String(text ?? '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  let id;
  if (url.hostname === 'youtu.be') {
    id = url.pathname.match(/^\/([^/]+)$/)?.[1];
  } else if (WATCH_HOSTS.has(url.hostname) && url.pathname === '/watch') {
    const values = url.searchParams.getAll('v');
    id = values.length === 1 ? values[0] : undefined;
  } else if (EMBED_HOSTS.has(url.hostname)) {
    id = url.pathname.match(/^\/embed\/([^/]+)$/)?.[1];
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

/**
 * A data/videos.csv row as templates see it:
 *
 *   { video_id, title, description, youtube_id, duration, audio, handout,
 *     thumbnail, placeholder }
 *
 * - placeholder: true when youtube_url is blank (the video isn't on YouTube
 *   yet): the frame shows "[Video coming soon]" with no link (SPEC §7, §9.1);
 * - youtube_id: the ID taken from youtube_url, "" for a placeholder (and for
 *   a link that isn't a YouTube video link, which the content check refuses
 *   before any page is built).
 * The link itself isn't passed on: the "Watch on YouTube" fallback is always
 * built from the ID (partials/video.njk).
 */
export function toVideo(row) {
  const text = (value) => String(value ?? '').trim();
  const url = text(row?.youtube_url);
  return {
    video_id: text(row?.video_id),
    title: text(row?.title),
    description: text(row?.description),
    youtube_id: url ? youtubeIdFromUrl(url) ?? '' : '',
    duration: text(row?.duration),
    audio: text(row?.audio),
    handout: text(row?.handout),
    thumbnail: text(row?.thumbnail),
    placeholder: url === '',
  };
}

/** The video_id in a transcript's file name, <video_id>.txt, or null. */
const transcriptId = (name) => (name.endsWith('.txt') && SLUG.test(name.slice(0, -4)) ? name.slice(0, -4) : null);

/**
 * The files in a transcripts folder (data/transcripts/), sorted, without
 * hidden files such as .DS_Store: [{ name, id }], where `id` is the
 * video_id for a file named <video_id>.txt and null for anything else.
 * A missing folder gives [].
 */
export function transcriptFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .sort()
    .map((name) => ({
      name,
      id: statSync(path.join(dir, name)).isFile() ? transcriptId(name) : null,
    }));
}

/** A transcript file's text, without the byte-order mark some editors add. */
export function readTranscript(file) {
  const text = readFileSync(file, 'utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Every transcript in `dir` (data/transcripts/): Map(video_id -> text).
 * Plain text, never shown on a page; the site search indexes it (SPEC §8.3,
 * §9.3). Files not named <video_id>.txt are skipped here; the content check
 * refuses them.
 */
export function readTranscripts(dir) {
  const map = new Map();
  for (const { name, id } of transcriptFiles(dir)) {
    if (id) map.set(id, readTranscript(path.join(dir, name)));
  }
  return map;
}
