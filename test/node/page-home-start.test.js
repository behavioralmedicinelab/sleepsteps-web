// Home (/), which is also the Sleep problems page (project lead,
// 2026-11-13), and Start here (/start/), checked on the fresh build (SPEC
// §7.2, §7.3, §8.1, §9.1-§9.3, §10.2, §12, §13, §15.1, §20 M1b; HANDOFF
// §6.1-§6.3). Expected values come from the content files, so the checks
// follow content edits.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, inject, it } from 'vitest';
import { parseCsvRecords } from '../../scripts/lib/csv.js';
import { parseFrontMatter, validateContent } from '../../scripts/validate-content.js';
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

// The site built with every feature on, whatever site.config.json says, so
// none of these checks changes or is skipped while features.ratings is off
// (SPEC §11). The pages with the switch off are checked in
// features-off.test.js.
const site = inject('builtSiteOn');
const { model } = validateContent();
const areas = parseCsvRecords(readFileSync('data/areas.csv', 'utf8')).sort((a, b) => Number(a.order) - Number(b.order));
const problems = [...model.problems.values()];

// The list of sleep problems: the handoff's short titles and statements, in
// the order and area the problem files give (their front matter).
const handoffProblems = JSON.parse(readFileSync('docs/design/HANDOFF.md', 'utf8').match(/```json\n([\s\S]*?)\n```/)[1]);
const KEYWORDS_FILE = 'data/keywords.csv';
const keywordRows = existsSync(KEYWORDS_FILE) ? parseCsvRecords(readFileSync(KEYWORDS_FILE, 'utf8')) : null;
function frontMatter(slug) {
  const fm = readFileSync(`content/problems/${slug}.md`, 'utf8').match(/^---\n([\s\S]*?)\n---/)[1];
  const field = (name) => fm.match(new RegExp(`^${name}:\\s*"?([^"\\n]*)"?`, 'm'))?.[1].trim();
  return { slug, area: field('area'), order: Number(field('order')) };
}
const areaOrder = new Map(areas.map((a, i) => [a.area_id, i]));
const topics = handoffProblems
  .map((p) => ({ ...frontMatter(p.slug), title: p.shortTitle, statement: p.statement }))
  .sort((a, b) => areaOrder.get(a.area) - areaOrder.get(b.area) || a.order - b.order);

/** Visible text: tags, visually hidden spans and the rating's invisible sizers left out. */
const visibleText = (html) =>
  text(
    html
      .replace(/<p class="rating__sizer"[\s\S]*?<\/p>/g, ' ')
      .replace(/<span class="visually-hidden">[\s\S]*?<\/span>/g, ' ')
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ' '),
  );

/** The <main> element. */
const mainOf = (html) => html.slice(html.indexOf('<main'), html.indexOf('</main>') + '</main>'.length);

/** Links in `html`: href, class and the text a screen reader reads (tags
    removed without adding spaces, so "1<span>.</span>" reads "1."). */
const links = (html) =>
  [...(html ?? '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs, inner]) => ({
    href: attr(`<a${attrs}>`, 'href'),
    cls: attr(`<a${attrs}>`, 'class'),
    name: text(inner.replace(/<[^>]+>/g, '')),
  }));

/** Headings in order, as "level text". */
const headings = (html) => [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => `${m[1]} ${text(m[2])}`);

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

/** The opening tags of an element's children, in order. */
function childTags(element) {
  const VOID = new Set(['input', 'img', 'br', 'hr']);
  const out = [];
  let depth = 0;
  for (const [tag, closing, name, selfClosing] of element.matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*?(\/?)>/gi)) {
    if (closing) {
      depth -= 1;
      continue;
    }
    if (depth === 1) out.push(tag);
    if (!selfClosing && !VOID.has(name.toLowerCase())) depth += 1;
  }
  return out;
}

describe('Home (/)', () => {
  const html = pageAt(site, '/');
  const main = mainOf(html);

  it('has the hero H1 and no title band', () => {
    expect(tags(html, 'h1')).toHaveLength(1);
    expect(text(elementByClass(html, 'home-hero__title', 'h1'))).toBe('Sleep can be hard after cancer. It can also get better.');
    expect(text(elementByClass(html, 'home-hero__eyebrow', 'p'))).toBe('Free · Short videos · At your own pace');
    expect(main).toMatch(/^<main id="main" class="home">/);
    expect(html).not.toMatch(/class="band[ "]/);
    expect(html).toContain('<link rel="stylesheet" href="/css/pages/home.css">');
  });

  it('is, in order, the hero, the sleep problems, the trial band and the disclaimer, and nothing else (project lead, 2026-11-13)', () => {
    expect(childTags(main)).toEqual([
      '<section class="home-hero on-dark">',
      '<section class="problems-section container" id="sleep-problems" aria-labelledby="sleep-problems-title">',
      '<div class="home-trial">',
      '<div class="home-disclaimer container">',
    ]);
  });

  it('has one hero button, to Start here', () => {
    const actions = elementByClass(html, 'home-hero__actions', 'div');
    expect(links(actions).map((l) => [l.href, l.cls, l.name])).toEqual([['/start/', 'button button--light', 'Start with the introduction']]);
    expect(links(elementByClass(html, 'home-hero', 'section'))).toHaveLength(1);
    expect(html).not.toMatch(/button--ghost|Browse sleep problems/);
  });

  it('ends the hero with the settling arc, and its photo frame is decorative and loads nothing from elsewhere', () => {
    const hero = elementByClass(html, 'home-hero', 'section');
    expect(hero).toMatch(/<svg class="arc"[^>]*>[\s\S]*?<\/svg>\s*<\/section>$/);
    const photo = elementByClass(hero, 'home-hero__photo', 'div');
    expect(attr(tags(photo, 'div')[0], 'aria-hidden')).toBe('true');
    const imgs = tags(photo, 'img');
    if (imgs.length) {
      for (const img of imgs) expect([attr(img, 'alt'), attr(img, 'src')?.startsWith('/img/')]).toEqual(['', true]);
    } else {
      expect(text(photo)).toMatch(/^\[Photo: .+\]$/);
    }
  });

  // Removed on 2026-11-13 (SPEC §7.5, §22): "Three small steps" with step
  // 3's ratings note, the list of area links and the "Watch, listen or read"
  // panel.
  it('has no step cards, no list of area links and no format tiles', () => {
    expect(main).not.toMatch(/home-steps|home-step|step-chip|home-areas|home-area|home-formats|home-format|home-section__eyebrow/);
    const words = visibleText(main);
    expect(words).not.toMatch(/Three small steps|How it works|Step [123]\b|Go to the introduction|See sleep problems|See all \d+ sleep problems/);
    expect(words).not.toMatch(/What's getting in the way of your sleep|Rate each video|Listen without watching|Read, print or keep|every video also has/);
    // "Watch, listen or read" is now only the end of the hero line.
    expect(words.match(/Watch, listen or read/g)).toHaveLength(1);
    expect(main).not.toMatch(/data-rating|Was this helpful|<fieldset|data-js-only/);
  });

  it('promises no transcript anywhere: hero line, meta description, headings or text (project lead, 2026-11-06)', () => {
    expect(text(elementByClass(html, 'home-hero__lede', 'p'))).toMatch(/Watch, listen or read, whichever suits you\.$/);
    const description = attr(tags(html, 'meta').find((t) => attr(t, 'name') === 'description'), 'content');
    expect(description).toMatch(/Watch, listen or read, whichever suits you\.$/);
    // The meta description is the hero line, not the list's lede.
    expect(text(description)).toBe(text(elementByClass(html, 'home-hero__lede', 'p')));
    expect(`${description} ${visibleText(html)}`).not.toMatch(/transcript|Watch, listen, read or print/i);
  });

  it('has the trial band and a "Need more help?" card', () => {
    const trial = elementByClass(html, 'home-trial', 'div');
    expect(links(trial).map((l) => [l.href, l.name])).toEqual([
      ['/about/', 'More about us and the trial'],
      ['/help/', 'Referral info'],
    ]);
    const { trial_text } = parseFrontMatter(readFileSync('content/index.njk', 'utf8')).data;
    expect(text(elementByClass(trial, 'home-trial__main', 'section'))).toBe(`About the trial Part of a research study ${trial_text} More about us and the trial`);
  });

  it('ends with the disclaimer, linking to Getting urgent help', () => {
    const disclaimer = elementByClass(html, 'home-disclaimer__text', 'p');
    expect(text(disclaimer)).toMatch(/^These videos and ideas don't replace care from your treating team\./);
    expect(links(disclaimer).map((l) => [l.href, l.name])).toEqual([['/urgent-help/', 'Getting urgent help']]);
  });

  it('has one H1, then H2 sections, with an H3 for each area of sleep problems', () => {
    const count = (a) => problems.filter((p) => p.data.area === a.area_id).length;
    expect(headings(main)).toEqual([
      '1 Sleep can be hard after cancer. It can also get better.',
      "2 What's keeping you up?",
      ...areas.map((a) => `3 ${a.name} ${a.description} ${count(a)} ${count(a) === 1 ? 'topic' : 'topics'}`),
      '2 Part of a research study',
      '2 Need more help?',
    ]);
  });

  it('loads menu.js and problems.js, both stylesheets, and embeds no video', () => {
    // feedback.js comes with the footer's dialog (feedback.test.js).
    expect(tags(html, 'script').map((t) => attr(t, 'src')).filter((src) => src !== '/js/feedback.js')).toEqual(['/js/menu.js', '/js/problems.js']);
    expect(html).toMatch(/<script type="module" src="\/js\/problems\.js"><\/script>/);
    expect(tags(html, 'link').filter((t) => attr(t, 'rel') === 'stylesheet').map((t) => attr(t, 'href'))).toEqual([
      '/css/tokens.css',
      '/css/site.css',
      '/css/components.css',
      '/css/pages/home.css',
      '/css/pages/problems.css',
    ]);
    expect(html).not.toMatch(/players\.js|events\.js|rating\.js/);
    expect(html).not.toMatch(/class="video[ "]/);
  });

  it('sends no page_view: track_page_view is not set (SPEC §10.2)', () => {
    expect(readFileSync('content/index.njk', 'utf8')).not.toMatch(/^track_page_view:/m);
    expect(attr(tags(html, 'body')[0], 'data-page-view')).toBeUndefined();
  });
});

// The list of sleep problems, which was the Sleep problems page (/problems/)
// until 2026-11-13 (SPEC §7.2, §8.1, §22; HANDOFF §6.3). These check the
// built HTML (the page without JavaScript) and the filter's pure functions
// in src/js/problems.js. What the module does to the page is in
// browser-modules.test.js.
describe('Home: the list of sleep problems (built HTML, no JavaScript)', () => {
  const html = pageAt(site, '/');
  const main = mainOf(html);
  const section = elementByClass(main, 'problems-section', 'section');
  // The accordion: one list of groups, one group per area.
  const [groupList, ...otherLists] = allByClass(section, 'group-list', 'div');
  const areaSections = allByClass(groupList, 'group-list__group', 'section');
  const toolbar = elementByClass(section, 'problems-tools', 'div');

  it('is a section named by its h2, with an eyebrow and the lede, where /#sleep-problems leads', () => {
    expect(tags(section, 'section')[0]).toBe('<section class="problems-section container" id="sleep-problems" aria-labelledby="sleep-problems-title">');
    expect(text(elementByClass(section, 'problems-section__eyebrow', 'p'))).toBe('Sleep problems');
    const h2s = [...section.matchAll(/<h2\b[^>]*>[\s\S]*?<\/h2>/g)].map((m) => m[0]);
    expect(h2s).toHaveLength(1);
    expect(tags(h2s[0], 'h2')[0]).toBe('<h2 class="section-heading" id="sleep-problems-title">');
    expect(text(h2s[0])).toBe("What's keeping you up?");
    const lede = elementByClass(section, 'problems-section__lede', 'p');
    // The sentence about the controls, as on Problems-A.
    const tools = 'Open an area to see its topics, or search in your own words.';
    expect(text(lede)).toBe(`${tools} Choose as many as sound like you.`);
    // Without JavaScript there is no filter and no group button, so the
    // sentence about them is hidden until problems.js shows them.
    expect(lede).toContain(`<span data-problems-hint hidden>${tools} </span>Choose as many`);
    // The whole list is inside the section: nothing of it sits elsewhere.
    expect(main.split('data-problems').length).toBe(section.split('data-problems').length);
    expect(tags(main, 'section').filter((t) => /group-list__group/.test(t))).toHaveLength(areaSections.length);
  });

  it("sits on the page's ground: no teal band, no \"Step 2\" eyebrow and no nudge to the introduction", () => {
    expect(tags(section, 'section')[0]).not.toMatch(/on-dark|band/);
    expect(main).not.toMatch(/class="band[ "]|band__|problems-band|problems-page|problems-nudge/);
    expect(text(main)).not.toMatch(/Step 2|Haven't watched the introduction|It explains the ideas the other videos build on/);
  });

  it('lists the problems by area only: one list, shown, with no "When it happens" view (project lead, 2026-11-13)', () => {
    expect(otherLists).toEqual([]);
    expect(tags(groupList, 'div')[0]).toBe('<div class="group-list">');
    expect(section).not.toMatch(/data-view-panel|data-view-choice|When it happens|By area|time of day|times of day/i);
    expect(section).not.toMatch(/id="time-[a-z-]+-problems"/);
    // Every group is an area: a section with the area's id, so /#core
    // leads to it.
    expect(tags(section, 'section').slice(1).map((t) => attr(t, 'id'))).toEqual(areas.map((a) => a.area_id));
  });

  it('lists the 10 areas in order, each open, with an h3 heading but no button yet', () => {
    expect(areaSections.map((s) => attr(tags(s, 'section')[0], 'id'))).toEqual(areas.map((a) => a.area_id));
    areaSections.forEach((group, i) => {
      // Under the section's h2 (Home's h1 is the hero's).
      const h3 = elementByClass(group, 'group-list__heading', 'h3');
      expect(h3).toBeTruthy();
      expect(tags(group, 'h2')).toHaveLength(0);
      expect(tags(h3, 'button')).toHaveLength(0);
      expect(text(elementByClass(h3, 'group-list__name', 'span'))).toBe(areas[i].name);
      expect(text(elementByClass(h3, 'group-list__description', 'span'))).toBe(areas[i].description);
      const list = tags(group, 'ul')[0];
      expect(attr(list, 'id')).toBe(`area-${areas[i].area_id}-problems`);
      expect(attr(list, 'hidden')).toBeUndefined();
      expect(attr(list, 'role')).toBe('list');
    });
    expect(main).not.toMatch(/aria-expanded/);
  });

  it('links every problem once under its area, in collection order', () => {
    const listed = areaSections.flatMap((group) => {
      const id = attr(tags(group, 'section')[0], 'id');
      return tags(group, 'li').map((li) => [id, attr(li, 'data-slug')]);
    });
    expect(listed).toEqual(topics.map((p) => [p.area, p.slug]));
    const hrefs = areaSections.flatMap((s) => tags(s, 'a').map((a) => attr(a, 'href')));
    expect(hrefs).toEqual(topics.map((p) => `/problems/${p.slug}/`));
  });

  it('shows each problem card with its short title, statement and arrow', () => {
    const cards = areaSections.flatMap((s) => allByClass(s, 'topic-card', 'a'));
    expect(cards).toHaveLength(topics.length);
    cards.forEach((card, i) => {
      expect(card).toContain('class="topic-card topic-card--row"');
      expect(text(elementByClass(card, 'topic-card__title', 'span'))).toBe(topics[i].title);
      expect(text(elementByClass(card, 'topic-card__statement', 'span'))).toBe(topics[i].statement);
      expect(text(card)).toBe(`${topics[i].title} ${topics[i].statement}`);
      expect(card).toMatch(/class="icon topic-card__arrow"/);
    });
  });

  it('counts each area\'s topics ("6 topics", "1 topic")', () => {
    for (const group of areaSections) {
      const id = attr(tags(group, 'section')[0], 'id');
      const n = topics.filter((p) => p.area === id).length;
      const count = elementByClass(group, 'group-list__count', 'span');
      expect(text(count)).toBe(`${n} ${n === 1 ? 'topic' : 'topics'}`);
      expect(attr(tags(count, 'span').find((t) => attr(t, 'data-group-count') !== undefined), 'data-total')).toBe(String(n));
    }
    expect(text(elementByClass(section, 'group-list__count', 'span'))).toBe('6 topics');
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
    const status = tags(section, 'p').find((t) => attr(t, 'id') === 'problem-filter-status');
    expect(attr(status, 'aria-live')).toBe('polite');
    expect(toolbar).not.toContain('id="problem-filter-status"');
    expect(text(elementByClass(section, 'problems-status', 'p'))).toBe(`${topics.length} topics in ${areas.length} areas`);
    // In the page's order: the toolbar, the result line, then the list.
    expect(section.indexOf(toolbar)).toBeLessThan(section.indexOf(status));
    expect(section.indexOf(status)).toBeLessThan(section.indexOf(groupList));
  });

  it('leaves no time-lane markup behind', () => {
    expect(html).not.toMatch(/\blane\b|lane--|time-lanes|topic-card--lane|data-lane/);
  });

  // Project lead, 2026-11-13 (SPEC §7.5, §22): no "New" pill, though the
  // handoff marks one problem as new (HANDOFF §6.3).
  it('makes every topic card the same, with no "New" pill', () => {
    expect(handoffProblems.filter((p) => p.isNew).map((p) => p.slug)).toEqual(['accepting-changes-to-my-sleep']);
    expect(main).not.toMatch(/topic-card__new|>\s*New\s*</);
    // The same elements, classes and hooks in every card: only the address
    // and the words differ.
    const shape = (card) => (card.match(/<[a-z][^>]*>/gi) ?? []).map((tag) => tag.replace(/ href="[^"]*"/, ''));
    const cards = allByClass(groupList, 'topic-card', 'a');
    expect(cards).toHaveLength(topics.length);
    expect(shape(cards[0]).slice(0, 4)).toEqual([
      '<a class="topic-card topic-card--row">',
      '<span class="topic-card__text">',
      '<span class="topic-card__title" data-topic-title>',
      '<span class="topic-card__statement" data-topic-statement>',
    ]);
    for (const card of cards) expect(shape(card), attr(card, 'href')).toEqual(shape(cards[0]));
  });

  it('says nothing about needing JavaScript, and has no draft notes', () => {
    expect(text(main)).not.toMatch(/javascript/i);
    expect(main).not.toMatch(/class="placeholder"/);
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

describe("the list's stylesheet (src/css/pages/problems.css)", () => {
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
  /** The declarations of the first top-level rule with exactly this selector. */
  const rule = (selector) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? '';

  it('turns the chevron only when motion is allowed: the one transform transition', () => {
    const transitions = [...css.matchAll(/transition:[^;]*transform/g)];
    expect(transitions).toHaveLength(1);
    expect(block('@media (prefers-reduced-motion: no-preference)')).toMatch(/\.group-list__chevron \.icon \{\s*transition: transform/);
  });

  it('drops the view toggle\'s styles, the "New" pill\'s, the lane styles and the "Open all areas" button\'s', () => {
    expect(css).not.toMatch(/view-toggle|topic-card__new/);
    expect(css).not.toMatch(/\.lane|time-lanes|topic-card--lane|problems-tools__all|--fs-topic-lane/);
    expect(readFileSync('src/css/tokens.css', 'utf8')).not.toMatch(/radius-lane/);
  });

  // The filter was on the old page's deep-teal band; on Home it is on paper
  // (SPEC §7.5): a white field with a slate-grey edge, as the site's other
  // fields on light grounds, at least 44px tall, with the page's deep-teal
  // focus ring (site.css), in the section's 1000px column.
  it("styles the filter for the page's light ground, in the 1000px column, and leaves no band or nudge styles", () => {
    expect(rule('.problems-section')).toMatch(/--content-max: 1000px;/);
    const input = rule('.problems-search__input');
    expect(input).toMatch(/min-height: var\(--target-xl\);/);
    expect(input).toMatch(/border: var\(--border-width\) solid var\(--slate-grey\);/);
    expect(input).toMatch(/background: var\(--white\);/);
    expect(input).toMatch(/color: var\(--ink\);/);
    expect(readFileSync('src/css/tokens.css', 'utf8')).toMatch(/--target-xl: 52px;/);
    // No ground or text colour of its own, so the label, lede and result
    // line are the page's ink on paper, and the ring stays deep-teal.
    for (const selector of ['.problems-section', '.problems-section__lede', '.problems-search__label', '.problems-status', '.problems-tools']) {
      expect(rule(selector), selector).not.toMatch(/(?:^|\s)(?:color|background|--focus-colour):/);
    }
    expect(css).not.toMatch(/on-dark|problems-band|problems-page|problems-nudge|--problems-column|band__/);
    expect(css).not.toMatch(/focus-colour|outline/);
  });
});

describe('Home\'s other styles (src/css/pages/home.css, components.css)', () => {
  it('styles no step cards, area links, format tiles or ghost button any more', () => {
    const home = readFileSync('src/css/pages/home.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(home).not.toMatch(/home-step|home-area|home-format|home-section|step-chip|@container|--home-step-rule/);
    expect(readFileSync('src/css/components.css', 'utf8')).not.toMatch(/button--ghost/);
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

  // The list's haystack: short title, statement, area name and keywords.
  const areaName = new Map(areas.map((a) => [a.area_id, a.name]));
  const keywords = new Map((keywordRows ?? []).map((r) => [r.page_id, r.keywords]));
  const haystacks = topics.map((p) => ({
    slug: p.slug,
    hay: normalise([p.title, p.statement, areaName.get(p.area), keywords.get(p.slug)].join(' ')),
  }));
  const found = (query) => haystacks.filter((h) => matches(h.hay, parseQuery(query))).map((h) => h.slug);

  it('finds problems by area name: "partners" lists the three social topics', () => {
    expect(found('partners')).toEqual(topics.filter((p) => p.area === 'social').map((p) => p.slug));
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

describe('Start here (/start/)', () => {
  const html = pageAt(site, '/start/');
  const main = mainOf(html);
  const chapters = model.start.data.chapters.map((c, i) => {
    const v = model.videos.get(c.video);
    return {
      n: i + 1,
      id: `v${i + 1}`,
      video: c.video,
      // From the video's row in data/videos.csv (SPEC §7.3).
      description: v.data.description,
      title: v.data.title,
      duration: v.data.duration,
      youtubeId: v.data.youtube_id,
      placeholder: v.data.placeholder === true,
      handout: v.data.handout ?? '',
      audio: v.data.audio ?? '',
    };
  });
  const article = (id) => {
    const start = main.indexOf(`<article class="start-chapter" id="${id}"`);
    return start < 0 ? undefined : main.slice(start, main.indexOf('</article>', start) + '</article>'.length);
  };

  it('has the band with the H1, lede and the "On this page" chapter pills', () => {
    const band = elementByClass(main, 'band', 'div');
    expect(text(elementByClass(band, 'band__eyebrow', 'p'))).toBe('Start here');
    expect(tags(html, 'h1')).toHaveLength(1);
    expect(text(elementByClass(band, 'band__title', 'h1'))).toBe('The introduction');
    expect(text(elementByClass(band, 'band__lede', 'p'))).toBe(model.start.data.summary);
    const nav = elementByClass(band, 'chapter-pills', 'nav');
    expect(attr(tags(nav, 'nav')[0], 'aria-label')).toBe('On this page');
    expect(attr(tags(nav, 'ol')[0], 'role')).toBe('list');
    expect(links(nav).map((l) => [l.href, l.name, l.cls])).toEqual(
      chapters.map((c) => [`#${c.id}`, `${c.n}. ${c.title}`, c.n === 1 ? 'chapter-pill chapter-pill--lead' : 'chapter-pill']),
    );
    // The filled first pill is emphasis, not a "you are here" marker.
    expect(nav).not.toMatch(/aria-current/);
  });

  it('keeps the band, TopicNav and chapters inside <main> and loads its stylesheet', () => {
    expect(main).toMatch(/<h1 class="band__title">/);
    expect(main).toMatch(/aria-label="All topics"/);
    expect(html).toContain('<link rel="stylesheet" href="/css/pages/start.css">');
  });

  it('has an H2 per chapter, in order, then the end card', () => {
    expect(headings(main)).toEqual([
      '1 The introduction',
      ...chapters.map((c) => `2 ${c.title}`),
      "2 Choose what's keeping you up",
    ]);
  });

  describe.each(chapters.map((c) => [c.id, c]))('chapter #%s', (id, c) => {
    const html = article(id);

    it('is an article named by its title: the video template with the label "n of N", the title and the description', () => {
      expect(html).toMatch(new RegExp(`^<article class="start-chapter" id="${id}" aria-labelledby="video-${c.video}-title">\\s*<div class="video-block">`));
      expect(tags(html, 'h2').map((t) => attr(t, 'id'))).toEqual([`video-${c.video}-title`]);
      expect(text(elementByClass(html, 'video-block__title', 'h2'))).toBe(text(c.title));
      // Intro-B's "Video n of N · duration" becomes the template's label, in
      // the solution cards' pill: the frame beside it shows the duration
      // (project lead, 2026-11-09). No large faint number, no eyebrow.
      expect(elementByClass(html, 'video-block__top', 'div')).toMatch(
        new RegExp(`^<div class="video-block__top">\\s*<span class="step-chip step-chip--sm"><span class="step-chip__num">${c.n}</span> <span class="step-chip__label">of ${chapters.length}</span></span>\\s*</div>$`),
      );
      expect(html).not.toMatch(/start-chapter__(num|eyebrow|desc|head)|video-block__close/);
      expect(tags(html, 'div').find((t) => /video-block__header/.test(t))).toBe('<div class="video-block__header">');
      expect(text(elementByClass(html, 'video-block__desc', 'p'))).toBe(c.description);
    });

    it("embeds the video, with no notice of its own (the page's YouTube note is last, SPEC §15.1)", () => {
      const video = elementByClass(html, 'video', 'div');
      const wrapper = tags(video, 'div')[0];
      expect(attr(wrapper, 'data-video')).toBe(c.video);
      expect(attr(wrapper, 'class').split(' ')).toEqual(expect.arrayContaining(['video', 'video--page']));
      expect(attr(wrapper, 'class')).not.toMatch(/video--lg/);
      expect(video).not.toMatch(/notice-text|video__notice|Pressing play/);
      expect(html).not.toMatch(/transcript/i);
      const facades = tags(video, 'a').filter((t) => attr(t, 'class') === 'video__facade');
      if (c.placeholder) {
        expect(facades).toEqual([]);
        expect(text(video)).toContain('[Video coming soon]');
      } else {
        expect(facades.map((t) => attr(t, 'href'))).toEqual([`https://www.youtube.com/watch?v=${c.youtubeId}`]);
      }
    });

    it('ends with one row of controls under the video: "Audio only", the handout, then the rating', () => {
      const row = elementByClass(html, 'video-controls', 'div');
      // The board's white bar is gone: the row sits right after the video.
      expect(html).not.toMatch(/start-chapter__bar/);
      expect(row).toBeTruthy();
      // The video's column ends right before the row, and the row ends the template.
      expect(html).toMatch(/<\/div>\s*<\/div>\s*<\/div>\s*<div class="video-controls">/);
      expect(html.slice(html.indexOf(row) + row.length).replace(/<\/div>/g, '').trim()).toBe('</article>');
      expect(tags(row, 'div')[0]).toBe('<div class="video-controls">');
      // "Audio only" first, so opening it never moves its button (SPEC §7.5).
      expect(row.indexOf('<details')).toBeLessThan(row.indexOf('<a class="format-button"'));
      const widget = elementByClass(row, 'rating', 'div');
      expect(tags(widget, 'div')[0]).toBe(`<div class="rating" data-rating="${c.video}" hidden>`);
      expect(text(elementByClass(widget, 'rating__legend', 'legend'))).toBe(`Was this helpful? ${text(c.title)}`);
      for (const before of ['<a class="format-button"', '<details']) expect(row.indexOf(before)).toBeLessThan(row.indexOf(widget));
      expect(widget).not.toMatch(/notice-text|anonymous|About the information/);
      expect(tags(row, 'a').filter((t) => attr(t, 'class') === 'format-button').map((t) => attr(t, 'href'))).toEqual([`/media/pdf/${c.handout}`]);
      expect(tags(row, 'audio').map((t) => attr(t, 'src'))).toEqual([`/media/audio/${c.audio}`]);
    });
  });

  it('has no transcript and no ratings notice anywhere (project lead, 2026-11-06)', () => {
    expect(visibleText(html)).not.toMatch(/transcript|Ratings are anonymous|About the information we collect/i);
    expect(main).not.toMatch(/data-transcript|transcript__|notice-text">Ratings/);
  });

  it('has one ratings widget per chapter while ratings are on, and no per-video feedback', () => {
    const content = elementByClass(main, 'start-flow', 'div');
    expect(links(content).filter((l) => /feedback/i.test(l.name))).toEqual([]);
    expect(content).not.toMatch(/<textarea|<form\b/);
    expect(tags(content, 'fieldset')).toHaveLength(chapters.length);
    expect([...content.matchAll(/\sdata-rating="([^"]+)"/g)].map((m) => m[1])).toEqual(chapters.map((c) => c.video));
  });

  it("ends with the card to Home's list of sleep problems, then the YouTube note, once, last (SPEC §15.1)", () => {
    const card = elementByClass(main, 'start-next', 'section');
    expect(text(elementByClass(card, 'start-next__body', 'p'))).toBe(
      `${problems.length} sleep problems, grouped into ten areas. Pick as many as sound like you.`,
    );
    expect(links(card).map((l) => [l.href, l.cls, l.name])).toEqual([
      ['/#sleep-problems', 'button button--light start-next__action', 'See sleep problems'],
    ]);
    const notes = [...main.matchAll(/<p class="notice-text youtube-note">[\s\S]*?<\/p>/g)].map((m) => m[0]);
    expect(notes).toHaveLength(1);
    const after = main.indexOf(card) + card.length;
    expect(main.indexOf(notes[0])).toBeGreaterThan(after);
    // Nothing but closing tags between the card and the note, and after the note.
    expect(main.slice(after, main.indexOf(notes[0]))).toMatch(/^\s*$/);
    expect(main.slice(main.indexOf(notes[0]) + notes[0].length)).toMatch(/^(\s*<\/div>)*\s*(<\/main>)?\s*$/);
  });

  it('contacts nothing before play: no resource hints, iframes or YouTube scripts', () => {
    // Only this site's stylesheets and icons (SPEC §7.5): no preconnect, preload or other hint.
    for (const link of tags(html, 'link')) {
      expect(['stylesheet', 'icon', 'apple-touch-icon'], link).toContain(attr(link, 'rel'));
      expect(attr(link, 'href'), link).toMatch(/^\/(?!\/)/);
    }
    expect(html).not.toMatch(/<iframe|iframe_api|youtube-nocookie|ytimg/);
  });
});
