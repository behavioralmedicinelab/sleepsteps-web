// The site search index (SPEC §8.3): one entry per page that site search can
// find, as dist/search-index.json. content/search-index.11ty.js calls
// searchIndex() during every Eleventy build (so `npm run dev` and the tests'
// build have it too); this module only shapes the data.
//
// Entries: every sleep problem, Start here, and every information page
// (content/pages/) without `search: false` in its front matter. Home, the
// Sleep problems page and the search page are not entries.
//
//   { id, url, title, summary, keywords, transcript, type }
//
// - summary: a problem's statement, or the page's `summary`;
// - keywords: the page's row in data/keywords.csv, as words (SPEC §8.2);
// - transcript: plain text. For a problem, its "Is this you?" text and, for
//   every video on the page, the video's title, the solution's blurb and the
//   transcript, so a match in a solution video leads to the problem page. For
//   Start here, each intro video's title, description and transcript. For an
//   information page, the text of its rendered body.
// - type: "problem", "start" or "page".
//
// worker/generated/pages.json (SPEC §8.3) is built in M3, which uses it.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const MarkdownIt = createRequire(require.resolve('@11ty/eleventy'))('markdown-it');

// Transcripts are rendered as Eleventy renders them (markdown-it with HTML on
// and indented code off), then reduced to text.
const markdown = new MarkdownIt({ html: true }).disable('code');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
// Inline elements join their text to the words around them; any other tag
// separates words.
const INLINE = new Set('a abbr b bdi bdo cite code data dfn em i kbd mark q s samp small span strong sub sup time u var'.split(' '));

/** Text of an HTML fragment: no tags or comments, entities decoded, spaces collapsed. */
export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?([a-z][\w-]*)\b[^>]*>/gi, (tag, name) => (INLINE.has(name.toLowerCase()) ? '' : ' '))
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref) => {
      if (ref[0] !== '#') return ENTITIES[ref.toLowerCase()] ?? whole;
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      return String.fromCodePoint(code);
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text of a Markdown transcript. */
export function markdownToText(source) {
  return htmlToText(markdown.render(String(source ?? '')));
}

/** data/keywords.csv rows -> Map(page_id -> [keyword, ...]). */
export function keywordsByPage(rows = []) {
  const map = new Map();
  for (const row of rows ?? []) {
    const words = String(row.keywords ?? '')
      .split(';')
      .map((k) => k.trim())
      .filter(Boolean);
    map.set(String(row.page_id ?? '').trim(), words);
  }
  return map;
}

const join = (parts) => parts.map((p) => String(p ?? '').trim()).filter(Boolean).join(' ');

/**
 * Build the index entries.
 * @param {object} input
 * @param {object[]} input.problems  collections.problems items
 * @param {object[]} input.videos    collections.videos items (rawInput is the transcript)
 * @param {object} [input.start]     the Start here item (collections.all, page_id "start")
 * @param {object[]} [input.pages]   information page items, rendered (templateContent)
 * @param {object[]} [input.keywords] data/keywords.csv rows
 */
export function searchIndex({ problems = [], videos = [], start, pages = [], keywords = [] }) {
  const kw = keywordsByPage(keywords);
  const library = new Map(
    videos.map((item) => [item.page.fileSlug, { title: item.data.title, text: markdownToText(item.rawInput) }]),
  );
  const video = (id) => {
    const v = library.get(id);
    if (!v) throw new Error(`search index: unknown video "${id}"`);
    return v;
  };
  const entry = (item, type, summary, transcript) => ({
    id: item.data.page_id,
    url: item.url,
    title: item.data.title,
    summary: String(summary ?? '').trim(),
    keywords: (kw.get(item.data.page_id) ?? []).join(' '),
    transcript,
    type,
  });

  const entries = [];
  for (const item of problems) {
    const d = item.data;
    const parts = [d.is_this_you?.summary, ...(d.is_this_you?.bullets ?? [])];
    const about = video(d.problem_video);
    parts.push(about.title, about.text);
    for (const s of d.solutions ?? []) {
      const v = video(s.video);
      parts.push(v.title, s.blurb, v.text);
    }
    entries.push(entry(item, 'problem', d.statement, join(parts)));
  }
  if (start && start.data.search !== false) {
    const parts = [];
    for (const c of start.data.chapters ?? []) {
      const v = video(c.video);
      parts.push(v.title, c.description, v.text);
    }
    entries.push(entry(start, 'start', start.data.summary, join(parts)));
  }
  for (const item of pages) {
    if (item.data.search === false) continue;
    entries.push(entry(item, 'page', item.data.summary, htmlToText(item.templateContent)));
  }
  return entries;
}
