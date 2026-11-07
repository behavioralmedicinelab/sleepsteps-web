// worker/lib/csv.js: the admin exports' CSV writer (SPEC §14.4): RFC 4180
// quoting, the formula guard, and a round trip through the parser in
// scripts/lib/csv.js.
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../scripts/lib/csv.js';
import { BOM, csvCell, csvRecord, FORMULA_START } from '../../worker/lib/csv.js';

describe('csvCell', () => {
  it('quotes every text cell, doubling quotes; numbers bare; NULL empty', () => {
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('')).toBe('""');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(4.5)).toBe('4.5');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe('');
  });

  it("guards every formula start with one leading apostrophe (SPEC §14.4's list, LF, full-width forms and ')", () => {
    const starts = ['=', '+', '-', '@', '\t', '\r', '\n', "'", '＝', '＋', '－', '＠'];
    for (const start of starts) {
      expect(FORMULA_START.test(`${start}x`), JSON.stringify(start)).toBe(true);
      expect(csvCell(`${start}x`)).toBe(`"'${start}x"`);
    }
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    // Only at the start.
    expect(csvCell('a=b')).toBe('"a=b"');
    expect(csvCell(' =x')).toBe('" =x"');
    // Numbers are never guarded: -1 is a number cell.
    expect(csvCell(-1)).toBe('-1');
  });
});

describe('csvRecord', () => {
  it('joins cells with commas and ends with CRLF', () => {
    expect(csvRecord([1, 'a', null, '=b'])).toBe('1,"a",,"\'=b"\r\n');
  });

  it('round-trips through the parser: removing one leading apostrophe gives the text back', () => {
    const texts = ['commas, here', 'quotes "x"', 'line\nbreak', 'cr\r\nlf', 'é “curly” 😴', "'quoted", '=1', '＝1', '\tx', '  ', ''];
    const text = BOM + csvRecord(['text']) + texts.map((t) => csvRecord([t])).join('');
    const rows = parseCsv(text);
    expect(rows[0]).toEqual(['text']);
    expect(rows.slice(1).map(([cell]) => (cell.startsWith("'") ? cell.slice(1) : cell))).toEqual(texts);
  });

  it('starts files with the UTF-8 byte-order mark', () => {
    expect(BOM).toBe('\uFEFF');
    expect([...new TextEncoder().encode(BOM)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});
