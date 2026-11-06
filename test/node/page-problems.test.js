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

// The two views, By area and "When it happens": the same accordion markup.
const [areaPanel, timePanel, ...otherPanels] = allByClass(main, 'group-list', 'div');
const areaSections = allByClass(areaPanel, 'group-list__group', 'section');
const timeSections = allByClass(timePanel, 'group-list__group', 'section');
const toolbar = elementByClass(main, 'problems-tools', 'div');
const slugsIn = (source) => tags(source, 'li').map((t) => attr(t, 'data-slug')).filter(Boolean);
const TIME_NAMES = ['In the evening', 'At bedtime', 'During the night', 'Early morning', 'During the day', 'Any time'];

/** A group's markup as a list of "tag.class [data-*]" for its opening tags,
    without the area description (times of day have none) or the cards. */
function shape(section) {
  const header = elementByClass(section, 'group-list__heading', 'h2');
  return (header.match(/<[a-z0-9]+(?=[\s>/])[^>]*>/gi) ?? [])
    .filter((tag) => attr(tag, 'class') !== 'group-list__description')
    .map((tag) => {
      const data = [...tag.matchAll(/\s(data-[a-z-]+)/g)].map((m) => m[1]).join(' ');
      return `${tag.match(/^<([a-z0-9]+)/i)[1]}.${attr(tag, 'class') ?? ''} ${data}`.trim();
    });
}

describe('the Sleep problems page (built HTML, no JavaScript)', () => {
  it('has the band: eyebrow, the only h1 and the lede', () => {
    expect(text(elementByClass(main, 'band__eyebrow', 'p'))).toBe('Step 2');
    expect(tags(html, 'h1')).toHaveLength(1);
    expect(text(elementByClass(main, 'band__title', 'h1'))).toBe("What's keeping you up?");
    const lede = elementByClass(main, 'band__lede', 'p');
    // The sentence about the controls names both views' groups, since it
    // shows in either (Problems-A: "Open an area to see its topics, ...").
    const tools = 'Open an area or a time of day to see its topics, or search in your own words.';
    expect(text(lede)).toBe(`${tools} Choose as many as sound like you.`);
    // Without JavaScript there is no filter and no group button, so the
    // sentence about them is hidden until problems.js shows them.
    expect(lede).toContain(`<span data-problems-hint hidden>${tools} </span>Choose as many`);
    expect(attr(tags(html, 'meta').find((t) => attr(t, 'name') === 'description'), 'content')).toBe(text(lede));
    expect(elementByClass(main, 'band', 'div')).toContain('class="band on-dark problems-band"');
  });

  it('has two view panels, By area shown and "When it happens" hidden', () => {
    expect(otherPanels).toEqual([]);
    expect(attr(tags(areaPanel, 'div')[0], 'data-view-panel')).toBe('area');
    expect(attr(tags(areaPanel, 'div')[0], 'hidden')).toBeUndefined();
    // Without JavaScript nothing can choose it, and the areas already list
    // every problem, so no link is listed twice.
    expect(attr(tags(timePanel, 'div')[0], 'data-view-panel')).toBe('time');
    expect(attr(tags(timePanel, 'div')[0], 'hidden')).toBe('');
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

  it('hides the toolbar until JavaScript runs: the filter and the view toggle, with no "Open all areas"', () => {
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

    // No "Open all areas" / "Close all areas" button (SPEC §7.2, §22).
    expect(tags(toolbar, 'button')).toHaveLength(0);
    expect(main).not.toMatch(/data-toggle-all|problems-tools__all|Open all|Close all/);
  });

  it('makes the view toggle a fieldset with a legend and two radios, drawn as a slider', () => {
    const fieldset = elementByClass(toolbar, 'view-toggle', 'fieldset');
    expect(tags(toolbar, 'fieldset')).toHaveLength(1);
    expect(text(fieldset.match(/<legend[^>]*>[\s\S]*?<\/legend>/)[0])).toBe('Group topics by');
    const radios = tags(fieldset, 'input');
    expect(radios.map((r) => [attr(r, 'type'), attr(r, 'name'), attr(r, 'id'), attr(r, 'value'), attr(r, 'checked')])).toEqual([
      ['radio', 'problems-view', 'view-area', 'area', ''],
      ['radio', 'problems-view', 'view-time', 'time', undefined],
    ]);
    expect(fieldset).toMatch(/<label class="view-toggle__label" for="view-area">By area<\/label>/);
    expect(fieldset).toMatch(/<label class="view-toggle__label" for="view-time">When it happens<\/label>/);
    // The slider's track and thumb: empty spans after both radios and their
    // labels, in this order, since the CSS follows the radios with sibling
    // selectors (problems.css).
    const options = elementByClass(fieldset, 'view-toggle__options', 'div');
    const order = options.match(/<(input|label|span)\b[^>]*>/g).map((t) => attr(t, 'id') ?? attr(t, 'for') ?? attr(t, 'class'));
    expect(order).toEqual(['view-area', 'view-area', 'view-time', 'view-time', 'view-toggle__track', 'view-toggle__thumb']);
    expect(options).toMatch(/<span class="view-toggle__track"><\/span>\s*<span class="view-toggle__thumb"><\/span>/);
  });

  it('has a polite live result line outside the toolbar: "36 topics in 10 areas"', () => {
    const status = tags(main, 'p').find((t) => attr(t, 'id') === 'problem-filter-status');
    expect(attr(status, 'aria-live')).toBe('polite');
    expect(toolbar).not.toContain('id="problem-filter-status"');
    expect(text(elementByClass(main, 'problems-status', 'p'))).toBe(
      `${problems.length} topics in ${areas.length} areas`,
    );
  });

  it('builds "When it happens" like By area: one group per time of day, in order, open, with a heading but no button yet', () => {
    expect(timeSections).toHaveLength(TIMES_OF_DAY.length);
    timeSections.forEach((section, i) => {
      // No section id: "day" is both an area and a time of day, and
      // /problems/#<id> opens areas.
      expect(tags(section, 'section')[0]).toBe('<section class="group-list__group">');
      const h2 = elementByClass(section, 'group-list__heading', 'h2');
      expect(tags(h2, 'button')).toHaveLength(0);
      expect(text(elementByClass(h2, 'group-list__name', 'span'))).toBe(TIME_NAMES[i]);
      expect(h2).not.toContain('group-list__description');
      // The same heading markup as an area, hooks included.
      expect(shape(section)).toEqual(shape(areaSections[0]));
      const list = tags(section, 'ul')[0];
      expect(attr(list, 'id')).toBe(`time-${TIMES_OF_DAY[i]}-problems`);
      expect(attr(list, 'class')).toBe('group-list__problems');
      expect(attr(list, 'hidden')).toBeUndefined();
      expect(attr(list, 'role')).toBe('list');
    });
  });

  // A time of day with no problems still renders, with "0 topics";
  // browser-modules.test.js checks the filter keeps such a group in view.
  it('puts every problem in exactly one time of day, its time_of_day, in collection order, with counts', () => {
    timeSections.forEach((section, i) => {
      const expected = problems.filter((p) => p.time === TIMES_OF_DAY[i]).map((p) => p.slug);
      expect(slugsIn(section)).toEqual(expected);
      const n = expected.length;
      const count = elementByClass(section, 'group-list__count', 'span');
      expect(text(count)).toBe(`${n} ${n === 1 ? 'topic' : 'topics'}`);
      expect(attr(tags(count, 'span').find((t) => attr(t, 'data-group-count') !== undefined), 'data-total')).toBe(String(n));
    });
    expect(timeSections.flatMap(slugsIn).sort()).toEqual(problems.map((p) => p.slug).sort());
  });

  it('uses the same row cards in both views, with keywords written once (By area)', () => {
    const cards = (panel) => allByClass(panel, 'topic-card', 'a');
    const bySlug = new Map(cards(areaPanel).map((card) => [attr(card, 'href'), card]));
    expect(cards(timePanel)).toHaveLength(problems.length);
    for (const card of cards(timePanel)) expect(card).toBe(bySlug.get(attr(card, 'href')));
    expect(timePanel).not.toMatch(/data-keywords/);
  });

  it('leaves no time-lane markup behind', () => {
    expect(html).not.toMatch(/\blane\b|lane--|time-lanes|topic-card--lane|data-lane/);
  });

  it('shows the "New" pill only on new problems, in both views', () => {
    const newSlugs = problems.filter((p) => p.isNew).map((p) => p.slug);
    expect(newSlugs).toEqual(['accepting-changes-to-my-sleep']);
    for (const panel of [areaPanel, timePanel]) {
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
    for (const li of tags(areaPanel, 'li')) {
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

describe('the view toggle\'s slider (src/css/pages/problems.css)', () => {
  const css = readFileSync('src/css/pages/problems.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector) => {
    const at = css.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  };
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

  it('draws a pill-shaped track with a thumb that moves to the second radio\'s side', () => {
    expect(rule('.view-toggle__track')).toMatch(/border-radius: var\(--radius-pill\)/);
    expect(rule('.view-toggle__track')).toMatch(/border: var\(--border-width\) solid var\(--paper\)/);
    expect(rule('.view-toggle__thumb')).toMatch(/border-radius: var\(--radius-pill\)/);
    expect(rule('.view-toggle__thumb')).toMatch(/background: var\(--paper\)/);
    expect(rule('.view-toggle__input:checked + .view-toggle__label + .view-toggle__track + .view-toggle__thumb')).toMatch(
      /transform: translateX\(/,
    );
    expect(rule('.view-toggle__options')).toMatch(/grid-template-columns: 1fr 1fr/);
    expect(rule('.view-toggle__label')).toMatch(/min-height: var\(--target-xl\)/);
  });

  it('slides only when motion is allowed, rings the whole track on focus, and keeps an edge in forced colours', () => {
    const transitions = [...css.matchAll(/transition:[^;]*transform/g)];
    expect(transitions).toHaveLength(1);
    expect(block('@media (prefers-reduced-motion: no-preference)')).toMatch(/\.view-toggle__thumb \{\s*transition: transform/);
    expect(rule('.view-toggle__input:focus-visible ~ .view-toggle__track')).toMatch(/outline: var\(--focus-width\) solid var\(--focus-colour\)/);
    expect(rule('.view-toggle__thumb')).toMatch(/border: var\(--border-width\) solid transparent/);
    expect(block('@media (forced-colors: active)')).toMatch(/\.view-toggle__input:checked \+ \.view-toggle__label \{\s*text-decoration: underline/);
  });

  it('drops the lane styles and the "Open all areas" button\'s', () => {
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

  it('writes the result line for either view', () => {
    const base = { total: 36, groupCount: 10, view: 'area' };
    expect(resultMessage({ ...base, query: '', matched: 0 })).toBe('36 topics in 10 areas');
    expect(resultMessage({ ...base, query: ' ;, ', matched: 0 })).toBe('36 topics in 10 areas');
    expect(resultMessage({ ...base, query: '', matched: 0, groupCount: 6, view: 'time' })).toBe('36 topics across 6 times of day');
    expect(resultMessage({ ...base, query: '  night  ', matched: 4 })).toBe('4 topics match “night”');
    expect(resultMessage({ ...base, query: '  night  ', matched: 4, view: 'time' })).toBe('4 topics match “night”');
    expect(resultMessage({ ...base, query: 'night   sweats', matched: 1 })).toBe('1 topic matches “night sweats”');
    expect(resultMessage({ ...base, query: 'xyz', matched: 0 })).toBe(NO_MATCH.area);
    expect(resultMessage({ ...base, query: 'xyz', matched: 0, view: 'time' })).toBe(NO_MATCH.time);
    expect(NO_MATCH.area).toBe('Nothing matches yet. Try a different word, or open an area below.');
    expect(NO_MATCH.time).toBe('Nothing matches yet. Try a different word, or open a time of day below.');
    expect(resultMessage({ total: 1, groupCount: 1, view: 'area', query: '', matched: 0 })).toBe('1 topic in 1 area');
    expect(resultMessage({ total: 1, groupCount: 1, view: 'time', query: '', matched: 0 })).toBe('1 topic across 1 time of day');
    expect(displayQuery('  a \n b ')).toBe('a b');
  });

  it('writes a group\'s count, in either view', () => {
    expect(countText(2, 6, true)).toBe('2 of 6');
    expect(countText(0, 6, true)).toBe('0 of 6');
    expect(countText(6, 6, false)).toBe('6');
  });
});
