import { describe, expect, it } from 'vitest';
import { CsvError, columnLetter, parseCsv, parseCsvRecords, parseCsvTable } from '../../scripts/lib/csv.js';

describe('parseCsv (RFC 4180)', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('does not add an empty row for a trailing line break', () => {
    expect(parseCsv('a,b\n1,2\n')).toHaveLength(2);
    expect(parseCsv('a,b\r\n1,2\r\n')).toHaveLength(2);
    expect(parseCsv('a,b\n1,2')).toHaveLength(2);
  });

  it('handles CRLF, LF and lone CR line endings', () => {
    const expected = [['a', 'b'], ['1', '2'], ['3', '4']];
    expect(parseCsv('a,b\r\n1,2\r\n3,4\r\n')).toEqual(expected);
    expect(parseCsv('a,b\n1,2\n3,4')).toEqual(expected);
    expect(parseCsv('a,b\r1,2\r3,4\r')).toEqual(expected);
  });

  it('strips a UTF-8 byte-order mark from Excel', () => {
    const rows = parseCsv('\uFEFFpage_id,keywords\r\nhome,sleep\r\n');
    expect(rows[0][0]).toBe('page_id');
  });

  it('handles quoted fields with commas, doubled quotes and line breaks', () => {
    const csv = 'id,text\r\n1,"night sweats, hot flushes"\r\n2,"she said ""hello"""\r\n3,"line one\r\nline two\nline three"\r\n';
    expect(parseCsv(csv)).toEqual([
      ['id', 'text'],
      ['1', 'night sweats, hot flushes'],
      ['2', 'she said "hello"'],
      ['3', 'line one\r\nline two\nline three'],
    ]);
  });

  it('keeps empty fields, including quoted empty fields and a trailing empty field', () => {
    expect(parseCsv('a,,c\n,"",\n')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ]);
  });

  it('keeps non-ASCII text', () => {
    expect(parseCsv('t\n“Can’t sleep” · 13 11 14\n')[1][0]).toBe('“Can’t sleep” · 13 11 14');
  });

  it('returns no rows for empty input', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\uFEFF')).toEqual([]);
  });

  it('rejects malformed quoting with the line number', () => {
    expect(() => parseCsv('a,b\n1,"open\n')).toThrow(CsvError);
    expect(() => parseCsv('a,b\n1,"open\n')).toThrow(/Unterminated/);
    expect(() => parseCsv('a,b\n1,ab"c\n')).toThrow(/line 2/);
    expect(() => parseCsv('a,b\n1,"x"y\n')).toThrow(/after a closing quote.*line 2/);
    expect(() => parseCsv('a\n"x\ny"\n"z"z\n')).toThrow(/line 4/);
  });

  it('rejects input that is not a string', () => {
    expect(() => parseCsv(undefined)).toThrow(TypeError);
  });
});

describe('parseCsvRecords', () => {
  it('maps rows to objects by header and trims names and values', () => {
    expect(parseCsvRecords(' page_id , keywords \nhome, sleep ; rest \n')).toEqual([
      { page_id: 'home', keywords: 'sleep ; rest' },
    ]);
  });

  it('skips blank lines and all-empty rows Excel appends', () => {
    const csv = 'a,b\r\n1,2\r\n\r\n,\r\n3,4\r\n,\r\n';
    expect(parseCsvRecords(csv)).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('rejects rows with the wrong number of fields, naming the row and the line', () => {
    expect(() => parseCsvRecords('a,b\n1,2\n3\n')).toThrow(/Expected 2 fields but found 1 in row 3 \(line 3\)/);
    // Line numbers count line breaks inside quoted fields; rows, as in Excel, don't.
    expect(() => parseCsvRecords('a,b\n"x\ny",2\n3,4,5\n')).toThrow(/in row 3 \(line 4\)/);
  });

  it('rejects empty and duplicate column names, naming an empty one by its Excel letter', () => {
    expect(() => parseCsvRecords('a,,c\n1,2,3\n')).toThrow('Column B has no name in row 1: delete column B in Excel if it should be empty (line 1)');
    // The stray column Excel writes after a table when a cell right of it was used.
    expect(() => parseCsvRecords('a,b,c,d,e,f,g,h,\n1,2,3,4,5,6,7,8,\n')).toThrow(/^Column I has no name/);
    expect(() => parseCsvRecords('a,a\n1,2\n')).toThrow(/Duplicate column name "a"/);
  });

  it('names columns as Excel does: A-Z, then AA, AB, ...', () => {
    expect([0, 1, 8, 25, 26, 27, 51, 52, 701, 702].map(columnLetter)).toEqual(['A', 'B', 'I', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });

  it('returns no records for an empty file or a header only', () => {
    expect(parseCsvRecords('')).toEqual([]);
    expect(parseCsvRecords('a,b\n')).toEqual([]);
  });
});

describe('parseCsvTable', () => {
  it('gives the header and each record with its row number as Excel shows it', () => {
    // Row 3 is blank (skipped, but counted); row 4's quoted field has a line break.
    const csv = '\uFEFFvideo_id,description\r\none,"First"\r\n\r\ntwo,"Line one\r\nline two, with ""quotes"""\r\nthree,x\r\n';
    expect(parseCsvTable(csv)).toEqual({
      columns: ['video_id', 'description'],
      rows: [
        { row: 2, record: { video_id: 'one', description: 'First' } },
        { row: 4, record: { video_id: 'two', description: 'Line one\r\nline two, with "quotes"' } },
        { row: 5, record: { video_id: 'three', description: 'x' } },
      ],
    });
  });

  it('keeps the header of a file with no rows, and gives nothing for an empty file', () => {
    expect(parseCsvTable('a,b\n')).toEqual({ columns: ['a', 'b'], rows: [] });
    expect(parseCsvTable('')).toEqual({ columns: [], rows: [] });
  });

  it('agrees with parseCsvRecords', () => {
    const csv = 'a,b\n1,2\n\n,\n3,"4, 5"\n';
    expect(parseCsvTable(csv).rows.map((r) => r.record)).toEqual(parseCsvRecords(csv));
  });
});
