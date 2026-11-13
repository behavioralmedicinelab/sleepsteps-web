// Helpers for checks on the built site. The HTML is our own template output,
// so small regular expressions are enough; no HTML parser dependency.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** All files under `dir` (recursive), as paths relative to `dir`. */
export function listFiles(dir, filter = () => true) {
  const out = [];
  const walk = (sub) => {
    for (const name of readdirSync(path.join(dir, sub))) {
      const rel = path.join(sub, name);
      if (statSync(path.join(dir, rel)).isDirectory()) walk(rel);
      else if (filter(rel)) out.push(rel);
    }
  };
  walk('');
  return out.sort();
}

export function readHtmlPages(dir) {
  return listFiles(dir, (f) => f.endsWith('.html')).map((file) => ({
    file,
    html: readFileSync(path.join(dir, file), 'utf8'),
  }));
}

/** Read a built page by its URL ('/help/' -> help/index.html). */
export function pageAt(dir, url) {
  const file = url.endsWith('/') ? `${url}index.html` : url;
  return readFileSync(path.join(dir, file), 'utf8');
}

/** Opening tags of an element, e.g. tags(html, 'a'). */
export function tags(html, name) {
  return html.match(new RegExp(`<${name}(?=[\\s>/])[^>]*>`, 'gi')) ?? [];
}

// An opening tag, up to the ">" that ends it (one inside a quoted value
// doesn't), and one attribute: a name, then perhaps = and a quoted or bare
// value.
const OPENING_TAG = /^<[^\s>/]+(?:[^>"']|"[^"]*"|'[^']*')*/;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/**
 * The value of an attribute in an opening tag, as written (not decoded),
 * '' for one without a value, or undefined. The tag's attributes are read
 * one at a time, so a word inside another attribute's value (a keyword
 * such as "hidden", "for" in a description) is never taken for an
 * attribute. Given a whole element, only its opening tag is read.
 */
export function attr(tag, name) {
  const opening = tag.match(OPENING_TAG)?.[0] ?? tag;
  const wanted = name.toLowerCase();
  for (const m of opening.replace(/^<[^\s>/]+/, '').matchAll(ATTRIBUTE)) {
    if (m[1].toLowerCase() === wanted) return m[2] ?? m[3] ?? m[4] ?? '';
  }
  return undefined;
}

/** The first element (opening tag to its matching close) with this class. */
export function elementByClass(html, className, tagName = '[a-z0-9]+') {
  const open = new RegExp(`<(${tagName})\\b[^>]*class="(?:[^"]*\\s)?${className}(?:\\s[^"]*)?"[^>]*>`, 'i');
  const m = open.exec(html);
  if (!m) return undefined;
  const name = m[1].toLowerCase();
  const re = new RegExp(`<(/?)${name}\\b[^>]*>`, 'gi');
  re.lastIndex = m.index;
  let depth = 0;
  let t;
  while ((t = re.exec(html))) {
    depth += t[1] ? -1 : 1;
    if (depth === 0) return html.slice(m.index, re.lastIndex);
  }
  return undefined;
}

/**
 * Text content with tags stripped, the template's escapes decoded and
 * whitespace collapsed: the words as a reader gets them. Nunjucks escapes
 * & < > " and ' in a title or description from a spreadsheet, so a title
 * such as "Sleep under 6 hours -> plan" comes back as the team typed it.
 * (&amp; last, so "&amp;lt;" is the text "&lt;", not "<".)
 */
export function text(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The worksheets section's markup (SPEC §7.6; problem/solutions.njk), as an
 * attribute inside a tag: one of its classes (worksheets, worksheets__*),
 * a link's data-worksheet, or an address in /media/worksheets/. What "no
 * worksheets here" means in the tests of the built pages: the section, its
 * links and their files, never the word. The team may write "worksheet" in
 * any page's text or a video's title or description
 * (and the template escapes a title's < > and quotes, so even markup typed
 * into one is text).
 */
export const WORKSHEET_MARKUP = /<[^<>]*\s(?:class="(?:[^"]*\s)?worksheets[\s"_]|data-worksheet[\s=>]|[a-z-]+="\/media\/worksheets\/)/;

/** Links with an aria-current attribute: [{ href, value, label }]. */
export function currentLinks(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .filter(([, attrs]) => /\saria-current=/.test(attrs))
    .map(([tag, , inner]) => ({ href: attr(tag, 'href'), value: attr(tag, 'aria-current'), label: text(inner) }));
}

/**
 * A data/videos.csv row (SPEC §7.1) as the CSV data extension gives it, for
 * filter and template tests: every column, as text. `youtube_url` blank
 * makes a placeholder. None of the tests' YouTube IDs is a real video.
 */
export function videoRow(video_id, fields = {}) {
  return {
    video_id,
    title: video_id,
    description: '',
    youtube_url: '',
    duration: '[mm:ss]',
    audio: '',
    handout: '',
    thumbnail: '',
    ...fields,
  };
}
