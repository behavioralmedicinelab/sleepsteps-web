// Sleep problems page (/problems/): SPEC §7.2, §8.1, §10.2; HANDOFF §6.3.
// Checks the built HTML (the no-JavaScript page) and the filter's pure
// functions in src/js/problems.js. What the module does to the page is in
// browser-modules.test.js.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, inject, it } from 'vitest';
import { parseCsvRecords } from '../../scripts/lib/csv.js';
import { TIMES_OF_DAY } from '../../scripts/validate-content.js';
import {
  countText,
  displayQuery,
  laneCountText,
  matches,
  NO_MATCH,
  normalise,
  parseQuery,
  resultMessage,
} from '../../src/js/problems.js';
import { attr, elementByClass, pageAt, tags, text } from './helpers.js';

const site = inject('builtSite');
const html = pageAt(site, '/problems/');
const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));

const areas = parseCsvRecords(readFileSync('data/areas.csv', 'utf8')).sort((a, b) => Number(a.order) - Number(b.order));
const handoffProblems = JSON.parse(readFileSync('docs/design/HANDOFF.md', 'utf8').match(/```json\n([\s\S]*?)\n```/)[1]);
const KEYWORDS_FILE = 'data/keywords.csv';
const keywordRows = existsSync(KEYWORDS_FILE) ? parseCsvRecords(readFileSync(KEYWORDS_FILE, 'utf8')) : null;

// Front matter of the problem files: the order, area and time of day the
// page should follow.
function frontMatter(slug) {
  const fm = readFileSync(`content/problems/${slug}.md`, 'utf8').match(/^---\n([\s\S]*?)\n---/)[1];
  const field = (name) => fm.match(new RegExp(`^${name}:\\s*"?([^"\\n]*)"?`, 'm'))?.[1].trim();
  return { slug, area: field('area'), time: field('time_of_day'), order: Number(field('order')), isNew: field('new') === 'true' };
}
const areaOrder = new Map(areas.map((a, i) => [a.area_id, i]));
const problems = handoffProblems
  .map((p) => ({ ...frontMatter(p.slug), title: p.shortTitle, statement: p.statement }))
  .sort((a, b) => areaOrder.get(a.area) - areaOrder.get(b.area) || a.order - b.order);

/** Every element with this class, each from its opening tag to its close. */
function allByClass(source, className, tagName) {
  const out = [];
  let rest = source;
  for (;;) {
    const el = elementByClass(rest, className, tagName);
    if (!el) return out;
    out.push(el);
    rest = rest.slice(rest.indexOf(el) + el.length);
  }
}

const areaSections = allByClass(main, 'area-list__area', 'section');
const toolbar = elementByClass(main, 'problems-tools', 'div');
const lanePanel = elementByClass(main, 'time-lanes', 'div');
const laneItems = allByClass(lanePanel, 'lane', 'li');
const slugsIn = (source) => tags(source, 'li').map((t) => attr(t, 'data-slug')).filter(Boolean);

describe('the Sleep problems page (built HTML, no JavaScript)', () => {
  it('has the band: eyebrow, the only h1 and the lede', () => {
    expect(text(elementByClass(main, 'band__eyebrow', 'p'))).toBe('Step 2');
    expect(tags(html, 'h1')).toHaveLength(1);
    expect(text(elementByClass(main, 'band__title', 'h1'))).toBe("What's keeping you up?");
    const lede = elementByClass(main, 'band__lede', 'p');
    expect(text(lede)).toBe('Open an area to see its topics, or search in your own words. Choose as many as sound like you.');
    // Without JavaScript there is no filter and no area button, so the
    // sentence about them is hidden until problems.js shows them.
    expect(lede).toContain('<span data-problems-hint hidden>Open an area to see its topics, or search in your own words. </span>Choose as many');
    expect(attr(tags(html, 'meta').find((t) => attr(t, 'name') === 'description'), 'content')).toBe(text(lede));
    expect(elementByClass(main, 'band', 'div')).toContain('class="band on-dark problems-band"');
  });

  it('lists the 10 areas in order, each open, with a heading but no button yet', () => {
    expect(areaSections.map((s) => attr(tags(s, 'section')[0], 'id'))).toEqual(areas.map((a) => a.area_id));
    areaSections.forEach((section, i) => {
      const h2 = elementByClass(section, 'area-list__heading', 'h2');
      expect(h2).toBeTruthy();
      expect(tags(h2, 'button')).toHaveLength(0);
      expect(text(elementByClass(h2, 'area-list__name', 'span'))).toBe(areas[i].name);
      expect(text(elementByClass(h2, 'area-list__description', 'span'))).toBe(areas[i].description);
      const list = tags(section, 'ul')[0];
      expect(attr(list, 'id')).toBe(`area-${areas[i].area_id}-problems`);
      expect(attr(list, 'hidden')).toBeUndefined();
      expect(attr(list, 'role')).toBe('list');
    });
    expect(main).not.toMatch(/aria-expanded/);
  });

  it('links every problem once under its area, in collection order', () => {
    const listed = areaSections.flatMap((section) => {
      const id = attr(tags(section, 'section')[0], 'id');
      return tags(section, 'li').map((li) => [id, attr(li, 'data-slug')]);
    });
    expect(listed).toEqual(problems.map((p) => [p.area, p.slug]));
    const links = areaSections.flatMap((s) => tags(s, 'a').map((a) => attr(a, 'href')));
    expect(links).toEqual(problems.map((p) => `/problems/${p.slug}/`));
  });

  it('shows each problem card with its short title, statement and arrow', () => {
    const cards = areaSections.flatMap((s) => allByClass(s, 'topic-card', 'a'));
    expect(cards).toHaveLength(problems.length);
    cards.forEach((card, i) => {
      expect(card).toContain('class="topic-card topic-card--row"');
      expect(text(elementByClass(card, 'topic-card__statement', 'span'))).toBe(problems[i].statement);
      expect(text(card).replace(/ New /, ' ')).toBe(`${problems[i].title} ${problems[i].statement}`);
      expect(card).toMatch(/class="icon topic-card__arrow"/);
    });
  });

  it('counts each area\'s topics ("6 topics", "1 topic")', () => {
    for (const section of areaSections) {
      const id = attr(tags(section, 'section')[0], 'id');
      const n = problems.filter((p) => p.area === id).length;
      const count = elementByClass(section, 'area-list__count', 'span');
      expect(text(count)).toBe(`${n} ${n === 1 ? 'topic' : 'topics'}`);
      expect(attr(tags(count, 'span').find((t) => attr(t, 'data-area-count') !== undefined), 'data-total')).toBe(String(n));
    }
    expect(text(elementByClass(main, 'area-list__count', 'span'))).toBe('6 topics');
  });

  it('hides the toolbar until JavaScript runs, with labelled controls', () => {
    expect(attr(tags(toolbar, 'div')[0], 'hidden')).toBe('');
    // Not the header search's "Search sleep problems": this field only
    // narrows the list on this page.
    expect(toolbar).toMatch(/<label class="problems-search__label" for="problem-filter">Find a sleep problem on this page<\/label>/);
    expect(html.match(/<label[^>]*>Find a sleep problem on this page</g)).toHaveLength(1);
    const input = tags(toolbar, 'input').find((t) => attr(t, 'id') === 'problem-filter');
    expect(attr(input, 'type')).toBe('search');
    expect(attr(input, 'autocomplete')).toBe('off');
    expect(attr(input, 'aria-describedby')).toBe('problem-filter-status');
    expect(attr(input, 'placeholder')).toBe('Try: night sweats, 3am, partner');
    expect(attr(input, 'name')).toBeUndefined();
    expect(tags(main, 'form')).toHaveLength(0);

    const fieldset = elementByClass(toolbar, 'view-toggle', 'fieldset');
    expect(text(fieldset.match(/<legend[^>]*>[\s\S]*?<\/legend>/)[0])).toBe('Group topics by');
    const radios = tags(fieldset, 'input');
    expect(radios.map((r) => [attr(r, 'type'), attr(r, 'id'), attr(r, 'value'), attr(r, 'checked')])).toEqual([
      ['radio', 'view-area', 'area', ''],
      ['radio', 'view-time', 'time', undefined],
    ]);
    expect(fieldset).toMatch(/<label class="view-toggle__label" for="view-area">By area<\/label>/);
    expect(fieldset).toMatch(/<label class="view-toggle__label" for="view-time">When it happens<\/label>/);
    expect(text(elementByClass(toolbar, 'problems-tools__all', 'button'))).toBe('Open all areas');
    expect(attr(tags(toolbar, 'button')[0], 'type')).toBe('button');
  });

  it('has a polite live result line outside the toolbar: "36 topics in 10 areas"', () => {
    const status = tags(main, 'p').find((t) => attr(t, 'id') === 'problem-filter-status');
    expect(attr(status, 'aria-live')).toBe('polite');
    expect(toolbar).not.toContain('id="problem-filter-status"');
    expect(text(elementByClass(main, 'problems-status', 'p'))).toBe(
      `${problems.length} topics in ${areas.length} areas`,
    );
  });

  it('hides the "When it happens" lanes without JavaScript', () => {
    expect(attr(tags(lanePanel, 'div')[0], 'hidden')).toBe('');
    expect(attr(tags(lanePanel, 'div')[0], 'data-view-panel')).toBe('time');
  });

  it('has six lanes in order, named as in the handoff, one per time_of_day value', () => {
    const labels = laneItems.map((li) => text(elementByClass(li, 'lane__header', 'h2')).replace(/ \d+ topics?$/, ''));
    expect(labels).toEqual(['In the evening', 'At bedtime', 'During the night', 'Early morning', 'During the day', 'Any time']);
    expect(laneItems.map((li) => attr(li.match(/^<li[^>]*>/)[0], 'class'))).toEqual(
      TIMES_OF_DAY.map((id) => `lane lane--${id}`),
    );
    // No ids on lanes: "day" is both an area and a time of day.
    for (const li of laneItems) expect(li.match(/^<li[^>]*>/)[0]).not.toMatch(/\sid=/);
  });

  it('puts every problem in exactly one lane, its time_of_day, in collection order', () => {
    laneItems.forEach((li, i) => {
      const expected = problems.filter((p) => p.time === TIMES_OF_DAY[i]).map((p) => p.slug);
      expect(slugsIn(li)).toEqual(expected);
      const n = expected.length;
      expect(text(elementByClass(li, 'lane__count', 'span'))).toBe(`${n} ${n === 1 ? 'topic' : 'topics'}`);
    });
    expect(laneItems.flatMap(slugsIn).sort()).toEqual(problems.map((p) => p.slug).sort());
    expect(lanePanel).not.toMatch(/topic-card__arrow/);
  });

  it('shows the "New" pill only on new problems, in both views', () => {
    const newSlugs = problems.filter((p) => p.isNew).map((p) => p.slug);
    expect(newSlugs).toEqual(['accepting-changes-to-my-sleep']);
    for (const panel of [elementByClass(main, 'area-list', 'div'), lanePanel]) {
      const withPill = [...panel.matchAll(/<li data-slug="([^"]+)"[^>]*>((?:(?!<\/li>)[\s\S])*)<\/li>/g)]
        .filter(([, , body]) => body.includes('topic-card__new'))
        .map(([, slug]) => slug);
      expect(withPill).toEqual(newSlugs);
    }
    expect(main.match(/<span class="topic-card__new">New<\/span>/g)).toHaveLength(2);
  });

  it('ends with the nudge to the introduction', () => {
    const nudge = elementByClass(main, 'problems-nudge', 'div');
    expect(text(nudge)).toBe(
      "Haven't watched the introduction yet? It explains the ideas the other videos build on. Go to the introduction",
    );
    expect(nudge).toMatch(/<a href="\/start\/">Go to the introduction<\/a>/);
  });

  it('loads problems.js as a module and its own stylesheet', () => {
    expect(html).toMatch(/<script type="module" src="\/js\/problems\.js"><\/script>/);
    expect(html).toMatch(/<link rel="stylesheet" href="\/css\/pages\/problems\.css">/);
    expect(html).not.toMatch(/players\.js|events\.js/);
  });

  it('says nothing about needing JavaScript, and has no draft notes', () => {
    expect(text(main)).not.toMatch(/javascript/i);
    expect(main).not.toMatch(/class="placeholder"/);
  });

  it('sends no page_view: track_page_view is not set (SPEC §10.2)', () => {
    expect(readFileSync('content/problems.njk', 'utf8')).not.toMatch(/^track_page_view:/m);
  });

  it.skipIf(!keywordRows)('writes each problem\'s keywords from data/keywords.csv', () => {
    const bySlug = new Map(keywordRows.map((r) => [r.page_id, r.keywords]));
    for (const li of tags(elementByClass(main, 'area-list', 'div'), 'li')) {
      const slug = attr(li, 'data-slug');
      const expected = bySlug.get(slug);
      const actual = attr(li, 'data-keywords');
      expect(actual === undefined ? undefined : text(actual), slug).toBe(expected?.trim() || undefined);
    }
  });

  it.skipIf(keywordRows)('writes no data-keywords while data/keywords.csv is absent', () => {
    expect(main).not.toMatch(/data-keywords/);
  });
});

describe('src/js/problems.js stays private (SPEC §8.1, §15.4)', () => {
  const source = readFileSync('src/js/problems.js', 'utf8');

  it('never logs, sends, stores or puts the query in the URL', () => {
    expect(source).not.toMatch(/console\.|fetch\(|sendBeacon|XMLHttpRequest|localStorage|sessionStorage|indexedDB|document\.cookie/);
    expect(source).not.toMatch(/history\.(push|replace)State|location\.(search|href)\s*=|\binnerHTML\b|insertAdjacentHTML/);
    expect(source).not.toMatch(/^import\b/m);
    expect(source).not.toMatch(/sleepsteps:event/);
  });
});

describe('the filter (src/js/problems.js)', () => {
  it('normalises case, accents, apostrophes and punctuation', () => {
    expect(normalise('Café')).toBe('cafe');
    expect(normalise('Can’t')).toBe('cant');
    expect(normalise("can't")).toBe('cant');
    expect(normalise('  Hot flushes; night-sweats!  ')).toBe('hot flushes night sweats');
    expect(normalise(undefined)).toBe('');
  });

  it('splits a query into OR groups of AND terms', () => {
    expect(parseQuery('night sweats, 3am')).toEqual([['night', 'sweats'], ['3am']]);
    expect(parseQuery('pain; Partner')).toEqual([['pain'], ['partner']]);
    expect(parseQuery('')).toEqual([]);
    expect(parseQuery('   ')).toEqual([]);
    expect(parseQuery(' , ;')).toEqual([]);
  });

  it('matches all terms of any group, as substrings', () => {
    const hay = normalise('Hot flushes and night sweats Hot flushes or night sweats wake me up Symptoms and treatment effects');
    expect(matches(hay, parseQuery('night sweats'))).toBe(true);
    expect(matches(hay, parseQuery('sweat'))).toBe(true);
    expect(matches(hay, parseQuery('night snoring'))).toBe(false);
    expect(matches(hay, parseQuery('snoring, flush'))).toBe(true);
    expect(matches(hay, [])).toBe(false);
  });

  // The page's haystack: short title, statement, area name and keywords.
  const areaName = new Map(areas.map((a) => [a.area_id, a.name]));
  const keywords = new Map((keywordRows ?? []).map((r) => [r.page_id, r.keywords]));
  const haystacks = problems.map((p) => ({
    slug: p.slug,
    hay: normalise([p.title, p.statement, areaName.get(p.area), keywords.get(p.slug)].join(' ')),
  }));
  const found = (query) => haystacks.filter((h) => matches(h.hay, parseQuery(query))).map((h) => h.slug);

  it('finds problems by area name: "partners" lists the three social topics', () => {
    expect(found('partners')).toEqual(problems.filter((p) => p.area === 'social').map((p) => p.slug));
  });

  it('finds "night" in titles, statements and area names', () => {
    expect(found('night').length).toBeGreaterThan(5);
    expect(found('night')).toContain('hot-flushes-and-night-sweats');
  });

  it('finds the placeholder examples that need no keywords', () => {
    expect(found('night sweats')).toEqual(['hot-flushes-and-night-sweats']);
    expect(found('partner')).toContain('sharing-a-bed');
  });

  it.skipIf(!keywordRows)('finds every example in the field placeholder once keywords exist', () => {
    for (const example of ['night sweats', '3am', 'partner']) expect(found(example), example).not.toEqual([]);
  });

  it('writes the result line', () => {
    const base = { total: 36, areaCount: 10, view: 'area' };
    expect(resultMessage({ ...base, query: '', matched: 0 })).toBe('36 topics in 10 areas');
    expect(resultMessage({ ...base, query: ' ;, ', matched: 0 })).toBe('36 topics in 10 areas');
    expect(resultMessage({ ...base, query: '  night  ', matched: 4 })).toBe('4 topics match “night”');
    expect(resultMessage({ ...base, query: 'night   sweats', matched: 1 })).toBe('1 topic matches “night sweats”');
    expect(resultMessage({ ...base, query: 'xyz', matched: 0 })).toBe(NO_MATCH.area);
    expect(resultMessage({ ...base, query: 'xyz', matched: 0, view: 'time' })).toBe(NO_MATCH.time);
    expect(NO_MATCH.area).toBe('Nothing matches yet. Try a different word, or open an area below.');
    expect(resultMessage({ total: 1, areaCount: 1, view: 'area', query: '', matched: 0 })).toBe('1 topic in 1 area');
    expect(displayQuery('  a \n b ')).toBe('a b');
  });

  it('writes the area and lane counts', () => {
    expect(countText(2, 6, true)).toBe('2 of 6');
    expect(countText(6, 6, false)).toBe('6');
    expect(laneCountText(0)).toBe('0 topics');
    expect(laneCountText(1)).toBe('1 topic');
    expect(laneCountText(9)).toBe('9 topics');
  });
});
