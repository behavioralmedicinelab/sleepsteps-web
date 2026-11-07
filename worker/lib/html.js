// Escape-by-default HTML for the admin pages (SPEC §14.4). Imports no JSON, so
// Node can load this module too.
//
// Every value put into an html`` template is escaped unless it is itself the
// result of html`` (or a list of them). There is deliberately no helper that
// inserts text unescaped: feedback and search text come from anyone, and the
// admin page's CSP (no script-src) is the second line of defence, not the
// first.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// C0 and C1 controls other than tab, LF and CR are not allowed in HTML text.
// A search's q isn't stripped of them (feedback is, SPEC §14.2), so they are
// shown as U+FFFD.
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Text -> HTML text, safe in element content and in a double-quoted attribute. */
export function escapeHtml(value) {
  return String(value).replace(CONTROLS, '\uFFFD').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Markup built by html``. Only html`` makes one, so nothing from D1 or a request can be an Html. */
export class Html {
  #text;

  constructor(text) {
    this.#text = text;
  }

  toString() {
    return this.#text;
  }
}

function part(value) {
  if (value instanceof Html) return value.toString();
  if (Array.isArray(value)) return value.map(part).join('');
  if (value === null || value === undefined || value === false) return '';
  if (typeof value === 'string' || typeof value === 'number') return escapeHtml(value);
  // An object, true, a symbol or a function here is a bug in the template.
  throw new TypeError('html: unsupported value');
}

/**
 * A tagged template: every interpolation is escaped unless it is itself
 * html`` (or a list of them); null, undefined and false render nothing.
 * Attribute values must always be double-quoted in the template.
 * @returns {Html}
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += part(values[i]) + strings[i + 1];
  return new Html(out);
}
