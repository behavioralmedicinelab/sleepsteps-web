// Dependency-free CSV parser (RFC 4180) for the team-edited files in data/
// (SPEC §7.1, §7.2, §8.2). Used by Eleventy's CSV data extension and by the
// content check. It accepts what Excel's "CSV UTF-8" export produces:
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
  return parseCsvTable(text).rows.map(({ record }) => record);
}

/**
 * parseCsvRecords, keeping the header and each record's row number as a
 * spreadsheet shows it: the header is row 1, and a line break inside a
 * quoted field doesn't start a new row (as in Excel). For messages an
 * editor can find in Excel ("row 12").
 * @param {string} text
 * @returns {{ columns: string[], rows: { row: number, record: Record<string, string> }[] }}
 */
export function parseCsvTable(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return { columns: [], rows: [] };

  const header = rows[0].map((name) => name.trim());
  const seen = new Set();
  header.forEach((name, index) => {
    if (name === '') {
      // Excel writes an empty column when a cell right of the table was ever
      // used, so name it as Excel does.
      const letter = columnLetter(index);
      throw new CsvError(`Column ${letter} has no name in row 1: delete column ${letter} in Excel if it should be empty`, 1);
    }
    if (seen.has(name)) throw new CsvError(`Duplicate column name "${name}" in the header`, 1);
    seen.add(name);
  });

  const records = [];
  // Track the physical line each row started on for error messages.
  let line = 1 + countLineBreaks(rows[0]);
  rows.slice(1).forEach((row, index) => {
    line += 1;
    const startLine = line;
    line += countLineBreaks(row);
    if (row.every((value) => value.trim() === '')) return;
    if (row.length !== header.length) {
      throw new CsvError(`Expected ${header.length} fields but found ${row.length} in row ${index + 2}`, startLine);
    }
    const record = {};
    header.forEach((name, i) => {
      record[name] = row[i].trim();
    });
    records.push({ row: index + 2, record });
  });
  return { columns: header, rows: records };
}

/** A spreadsheet's column letter for a 0-based index: A, ..., Z, AA, AB, ... */
export function columnLetter(index) {
  let letters = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

function countLineBreaks(row) {
  let n = 0;
  for (const value of row) {
    const matches = value.match(/\r\n|\r|\n/g);
    if (matches) n += matches.length;
  }
  return n;
}
