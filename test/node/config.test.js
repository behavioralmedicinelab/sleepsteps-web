// Unit tests for the filters and data extension in eleventy.config.js,
// registered against a stand-in for Eleventy's config API.
import { describe, expect, it } from 'vitest';
import configure, { config } from '../../eleventy.config.js';

const registered = { filters: {}, collections: {}, dataExtensions: {}, passthrough: [] };
configure({
  addGlobalData: () => {},
  addDataExtension: (ext, options) => (registered.dataExtensions[ext] = options),
  addPassthroughCopy: (map) => registered.passthrough.push(map),
  addCollection: (name, fn) => (registered.collections[name] = fn),
  addFilter: (name, fn) => (registered.filters[name] = fn),
});
const f = registered.filters;

describe('eleventy.config.js', () => {
  it('reads global data from data/ and passes the logo through', () => {
    expect(config.dir.data).toBe('../data');
    expect(registered.dataExtensions.csv.parser('a,b\n1,"x, y"\n')).toEqual([{ a: '1', b: 'x, y' }]);
    expect(registered.passthrough).toContainEqual({ 'src/img': 'img' });
  });

  it('ariaCurrent marks the page and, in section mode, pages below it', () => {
    expect(f.ariaCurrent('/about/', '/about/')).toBe(' aria-current="page"');
    expect(f.ariaCurrent('/problems/pain/', '/problems/', 'section')).toBe(' aria-current="true"');
    expect(f.ariaCurrent('/problems/pain/', '/problems/')).toBe('');
    expect(f.ariaCurrent('/', '/start/', 'section')).toBe('');
    expect(f.ariaCurrent(undefined, '/start/')).toBe('');
  });

  it('telHref keeps digits and a leading +', () => {
    expect(f.telHref('13 11 14')).toBe('tel:131114');
    expect(f.telHref('000')).toBe('tel:000');
    expect(f.telHref('+61 2 9999 0000')).toBe('tel:+61299990000');
  });

  it('sentence adds a full stop only when needed', () => {
    expect(f.sentence("I'm tired")).toBe("I'm tired.");
    expect(f.sentence('What if my sleep problems come back?')).toBe('What if my sleep problems come back?');
  });

  it('stylesheets maps front-matter paths to /css/ URLs and rejects anything else', () => {
    expect(f.stylesheets(undefined)).toEqual([]);
    expect(f.stylesheets('pages/help.css')).toEqual(['/css/pages/help.css']);
    expect(f.stylesheets(['pages/help.css', 'about.css'])).toEqual(['/css/pages/help.css', '/css/about.css']);
    for (const bad of ['https://example.com/x.css', '/css/x.css', '../x.css', 'pages/../x.css', 'x.js', 42]) {
      expect(() => f.stylesheets([bad]), String(bad)).toThrow(/styles/);
    }
  });

  it('groupByArea orders areas and fails on an unknown area', () => {
    const areas = [
      { area_id: 'day', name: 'Day', order: '20' },
      { area_id: 'core', name: 'Core', order: '10' },
    ];
    const item = (slug, area) => ({ url: `/problems/${slug}/`, inputPath: `${slug}.md`, data: { page_id: slug, title: slug, area } });
    const grouped = f.groupByArea([item('a', 'day'), item('b', 'core'), item('c', 'core')], areas);
    expect(grouped.map((a) => [a.area_id, a.problems.map((p) => p.slug)])).toEqual([
      ['core', ['b', 'c']],
      ['day', ['a']],
    ]);
    expect(() => f.groupByArea([item('x', 'nope')], areas)).toThrow(/unknown area "nope"/);
  });
});
