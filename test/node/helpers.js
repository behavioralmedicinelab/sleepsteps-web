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

/** The value of an attribute in an opening tag, or undefined. */
export function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+)))?(?=[\\s>/])`, 'i'));
  if (!m) return undefined;
  return m[1] ?? m[2] ?? m[3] ?? '';
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

/** Text content with tags stripped and whitespace collapsed. */
export function text(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Links with an aria-current attribute: [{ href, value, label }]. */
export function currentLinks(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .filter(([, attrs]) => /\saria-current=/.test(attrs))
    .map(([tag, , inner]) => ({ href: attr(tag, 'href'), value: attr(tag, 'aria-current'), label: text(inner) }));
}
