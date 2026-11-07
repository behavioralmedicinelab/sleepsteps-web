// The CSV writer for the admin exports (SPEC §14.4). Imports no JSON, so Node
// can load this module too. scripts/lib/csv.js stays the parser (the tests
// read exports back with it).
//
// RFC 4180: records end with CRLF; every text cell is quoted, with `"`
// doubled, so a comma, a quote or a line break inside it stays in its field;
// numbers are bare; NULL is an empty field. The file starts with a UTF-8
// byte-order mark, so Excel opens it as UTF-8 by double-click.
//
// Formula guard (OWASP CSV injection): before quoting, a text cell that
// starts with a character a spreadsheet may read as a formula gets one
// leading apostrophe, so it shows as text. The list is SPEC §14.4's (`=`,
// `+`, `-`, `@`, tab, CR) plus LF, the full-width forms OWASP lists (＝ ＋ －
// ＠) and the apostrophe itself, so removing one leading `'` from any text
// cell always gives back the stored text. OWASP: "Microsoft Excel may remove
// quotes or escape characters from CSV cells when a file is saved and
// re-opened", so a file saved from Excel is no longer guarded.

/** The UTF-8 byte-order mark that starts every export (its first part only). */
export const BOM = '\uFEFF';

/** A text cell starting with one of these gets a leading apostrophe. */
export const FORMULA_START = /^[=+\-@\t\r\n'\uFF1D\uFF0B\uFF0D\uFF20]/;

/** One value -> one CSV field. */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = String(value);
  const guarded = FORMULA_START.test(text) ? `'${text}` : text;
  return `"${guarded.replaceAll('"', '""')}"`;
}

/** A list of values -> one CSV record, ending with CRLF. */
export const csvRecord = (values) => `${values.map(csvCell).join(',')}\r\n`;
