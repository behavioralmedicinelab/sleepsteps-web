// Dependency-free CSV parser (RFC 4180) for the team-edited files in data/
// (SPEC §7.2, §8.2). Used by Eleventy's CSV data extension and, later, by the
// build scripts. It accepts what Excel's "CSV UTF-8" export produces:
//
// - a UTF-8 byte-order mark at the start of the file;
// - CRLF, LF or lone CR line endings;
// - quoted fields containing commas, doubled quotes ("") and line breaks;
// - a trailing line break after the last row.
//
// Malformed input (a quote inside an unquoted field, text after a closing
// quote, or an unterminated quote) throws a CsvError naming the line, so the
// build fails with a message an editor can act on.

export class CsvError extends Error {
  constructor(message, line) {
    super(`${message} (line ${line})`);
    this.name = 'CsvError';
    this.line = line;
  }
}

/**
 * Parse CSV text into rows of raw string fields. Field values are not
 * trimmed. A blank line becomes a row with one empty field, except that a
 * trailing line break does not add an empty last row.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  if (typeof text !== 'string') throw new TypeError('parseCsv expects a string');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = '';
  let line = 1; // physical line, for error messages
  let i = 0;
  // Field states: 'start' (nothing read yet), 'unquoted', 'quoted',
  // 'closed' (just read the closing quote of a quoted field).
  let state = 'start';

  const endField = () => {
    row.push(field);
    field = '';
    state = 'start';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];

    if (state === 'quoted') {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          state = 'closed';
          i += 1;
        }
        continue;
      }
      if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) line += 1;
      field += c;
      i += 1;
      continue;
    }

    if (c === ',') {
      endField();
      i += 1;
      continue;
    }

    if (c === '\r' || c === '\n') {
      endRow();
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
      line += 1;
      continue;
    }

    if (c === '"') {
      if (state === 'start') {
        state = 'quoted';
        i += 1;
        continue;
      }
      if (state === 'closed') throw new CsvError('Unexpected quote after a quoted field', line);
      throw new CsvError('Quote inside an unquoted field; wrap the whole field in quotes and double any quotes inside it', line);
    }

    if (state === 'closed') {
      throw new CsvError('Unexpected text after a closing quote', line);
    }
    state = 'unquoted';
    field += c;
    i += 1;
  }

  if (state === 'quoted') throw new CsvError('Unterminated quoted field', line);

  // Text after the last line break forms a final row. A file that ends with a
  // line break (the usual case) leaves nothing pending here.
  if (field !== '' || row.length > 0 || state === 'closed') endRow();

  return rows;
}

/**
 * Parse CSV text with a header row into an array of objects keyed by the
 * header names. Header names and values are trimmed. Rows where every field
 * is empty (blank lines, or the empty rows Excel sometimes appends) are
 * skipped. A row with a different number of fields from the header throws.
 * @param {string} text
 * @returns {Record<string, string>[]}
 */
export function parseCsvRecords(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((name) => name.trim());
  const seen = new Set();
  header.forEach((name, index) => {
    if (name === '') throw new CsvError(`Empty column name in column ${index + 1} of the header`, 1);
    if (seen.has(name)) throw new CsvError(`Duplicate column name "${name}" in the header`, 1);
    seen.add(name);
  });

  const records = [];
  // Track the physical line each row started on for error messages.
  let line = 1 + countLineBreaks(rows[0]);
  for (const row of rows.slice(1)) {
    line += 1;
    const startLine = line;
    line += countLineBreaks(row);
    if (row.every((value) => value.trim() === '')) continue;
    if (row.length !== header.length) {
      throw new CsvError(`Expected ${header.length} fields but found ${row.length}`, startLine);
    }
    const record = {};
    header.forEach((name, index) => {
      record[name] = row[index].trim();
    });
    records.push(record);
  }
  return records;
}

function countLineBreaks(row) {
  let n = 0;
  for (const value of row) {
    const matches = value.match(/\r\n|\r|\n/g);
    if (matches) n += matches.length;
  }
  return n;
}
