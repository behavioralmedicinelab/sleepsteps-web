// Sleep problems page (/problems/): SPEC §7.2, §8.1, §10.2; HANDOFF §6.3.
// Checks the built HTML (the no-JavaScript page) and the filter's pure
// functions in src/js/problems.js. What the module does to the page is in
// browser-modules.test.js.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, inject, it } from 'vitest';
import { parseCsvRecords } from '../../scripts/lib/csv.js';
import {
  countText,
  displayQuery,
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

// Front matter of the problem files: the order and area the page should
// follow.
function frontMatter(slug) {
  const fm = readFileSync(`content/problems/${slug}.md`, 'utf8').match(/^---\n([\s\S]*?)\n---/)[1];
  const field = (name) => fm.match(new RegExp(`^${name}:\\s*"?([^"\\n]*)"?`, 'm'))?.[1].trim();
  return { slug, area: field('area'), order: Number(field('order')), isNew: field('new') === 'true' };
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

// The accordion: one list of groups, one group per area.
const [groupList, ...otherLists] = allByClass(main, 'group-list', 'div');
const areaSections = allByClass(groupList, 'group-list__group', 'section');
const toolbar = elementByClass(main, 'problems-tools', 'div');

describe('the Sleep problems page (built HTML, no JavaScript)', () => {
  it('has the band: eyebrow, the only h1 and the lede', () => {
    expect(text(elementByClass(main, 'band__eyebrow', 'p'))).toBe('Step 2');
    expect(tags(html, 'h1')).toHaveLength(1);
    expect(text(elementByClass(main, 'band__title', 'h1'))).toBe("What's keeping you up?");
    const lede = elementByClass(main, 'band__lede', 'p');
    // The sentence about the controls, as on Problems-A.
    const tools = 'Open an area to see its topics, or search in your own words.';
    expect(text(lede)).toBe(`${tools} Choose as many as sound like you.`);
    // Without JavaScript there is no filter and no group button, so the
    // sentence about them is hidden until problems.js shows them.
    expect(lede).toContain(`<span data-problems-hint hidden>${tools} </span>Choose as many`);
    expect(attr(tags(html, 'meta').find((t) => attr(t, 'name') === 'description'), 'content')).toBe(text(lede));
    expect(elementByClass(main, 'band', 'div')).toContain('class="band on-dark problems-band"');
  });

  it('lists the problems by area only: one list, shown, with no "When it happens" view (project lead, 2026-11-13)', () => {
    expect(otherLists).toEqual([]);
    expect(tags(groupList, 'div')[0]).toBe('<div class="group-list">');
    expect(main).not.toMatch(/data-view-panel|data-view-choice|When it happens|By area|time of day|times of day/i);
    expect(main).not.toMatch(/id="time-[a-z-]+-problems"/);
    // Every group is an area: a section with the area's id.
    expect(tags(main, 'section').map((t) => attr(t, 'id'))).toEqual(areas.map((a) => a.area_id));
  });

  it('lists the 10 areas in order, each open, with a heading but no button yet', () => {
    expect(areaSections.map((s) => attr(tags(s, 'section')[0], 'id'))).toEqual(areas.map((a) => a.area_id));
    areaSections.forEach((section, i) => {
      const h2 = elementByClass(section, 'group-list__heading', 'h2');
      expect(h2).toBeTruthy();
      expect(tags(h2, 'button')).toHaveLength(0);
      expect(text(elementByClass(h2, 'group-list__name', 'span'))).toBe(areas[i].name);
      expect(text(elementByClass(h2, 'group-list__description', 'span'))).toBe(areas[i].description);
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
      const count = elementByClass(section, 'group-list__count', 'span');
      expect(text(count)).toBe(`${n} ${n === 1 ? 'topic' : 'topics'}`);
      expect(attr(tags(count, 'span').find((t) => attr(t, 'data-group-count') !== undefined), 'data-total')).toBe(String(n));
    }
    expect(text(elementByClass(main, 'group-list__count', 'span'))).toBe('6 topics');
  });

  it('hides the toolbar until JavaScript runs: the filter alone, with no view toggle and no "Open all areas"', () => {
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

    // No view toggle (SPEC §7.2, §22): the filter is the toolbar's only
    // control, and the page's only field outside the header and dialog.
    expect(tags(toolbar, 'input')).toEqual([input]);
    expect(tags(toolbar, 'label')).toHaveLength(1);
    expect(tags(main, 'input')).toEqual([input]);
    expect(tags(main, 'fieldset')).toHaveLength(0);
    expect(main).not.toMatch(/view-toggle|problems-view|type="radio"|Group topics by/);

    // No "Open all areas" / "Close all areas" button (SPEC §7.2, §22).
    expect(tags(toolbar, 'button')).toHaveLength(0);
    expect(main).not.toMatch(/data-toggle-all|problems-tools__all|Open all|Close all/);
  });

  it('has a polite live result line outside the toolbar: "36 topics in 10 areas"', () => {
    const status = tags(main, 'p').find((t) => attr(t, 'id') === 'problem-filter-status');
    expect(attr(status, 'aria-live')).toBe('polite');
    expect(toolbar).not.toContain('id="problem-filter-status"');
    expect(text(elementByClass(main, 'problems-status', 'p'))).toBe(
      `${problems.length} topics in ${areas.length} areas`,
    );
  });

  it('leaves no time-lane markup behind', () => {
    expect(html).not.toMatch(/\blane\b|lane--|time-lanes|topic-card--lane|data-lane/);
  });

  it('shows the "New" pill only on new problems', () => {
    const newSlugs = problems.filter((p) => p.isNew).map((p) => p.slug);
    expect(newSlugs).toEqual(['accepting-changes-to-my-sleep']);
    const withPill = [...groupList.matchAll(/<li data-slug="([^"]+)"[^>]*>((?:(?!<\/li>)[\s\S])*)<\/li>/g)]
      .filter(([, , body]) => body.includes('topic-card__new'))
      .map(([, slug]) => slug);
    expect(withPill).toEqual(newSlugs);
    expect(main.match(/<span class="topic-card__new">New<\/span>/g)).toHaveLength(1);
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
    for (const li of tags(groupList, 'li')) {
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

describe('the Sleep problems stylesheet (src/css/pages/problems.css)', () => {
  const css = readFileSync('src/css/pages/problems.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const block = (atRule) => {
    const at = css.indexOf(atRule);
    expect(at, atRule).toBeGreaterThan(-1);
    let depth = 0;
    for (let i = css.indexOf('{', at); i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      if (css[i] === '}' && (depth -= 1) === 0) return css.slice(at, i);
    }
    return '';
  };

  it('turns the chevron only when motion is allowed: the one transform transition', () => {
    const transitions = [...css.matchAll(/transition:[^;]*transform/g)];
    expect(transitions).toHaveLength(1);
    expect(block('@media (prefers-reduced-motion: no-preference)')).toMatch(/\.group-list__chevron \.icon \{\s*transition: transform/);
  });

  it('drops the view toggle\'s styles, the lane styles and the "Open all areas" button\'s', () => {
    expect(css).not.toMatch(/view-toggle/);
    expect(css).not.toMatch(/\.lane|time-lanes|topic-card--lane|problems-tools__all|--fs-topic-lane/);
    expect(readFileSync('src/css/tokens.css', 'utf8')).not.toMatch(/radius-lane/);
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
    const base = { total: 36, groupCount: 10 };
    expect(resultMessage({ ...base, query: '', matched: 0 })).toBe('36 topics in 10 areas');
    expect(resultMessage({ ...base, query: ' ;, ', matched: 0 })).toBe('36 topics in 10 areas');
    expect(resultMessage({ ...base, query: '  night  ', matched: 4 })).toBe('4 topics match “night”');
    expect(resultMessage({ ...base, query: 'night   sweats', matched: 1 })).toBe('1 topic matches “night sweats”');
    expect(resultMessage({ ...base, query: 'xyz', matched: 0 })).toBe(NO_MATCH);
    expect(NO_MATCH).toBe('Nothing matches yet. Try a different word, or open an area below.');
    expect(resultMessage({ total: 1, groupCount: 1, query: '', matched: 0 })).toBe('1 topic in 1 area');
    expect(displayQuery('  a \n b ')).toBe('a b');
  });

  it('writes an area\'s count', () => {
    expect(countText(2, 6, true)).toBe('2 of 6');
    expect(countText(0, 6, true)).toBe('0 of 6');
    expect(countText(6, 6, false)).toBe('6');
  });
});
