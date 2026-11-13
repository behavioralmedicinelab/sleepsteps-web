// Site shell (SPEC §20 M1a): header, phone menu, TopicNav, footer, info
// layout and the urgent-help page, checked on the built HTML.
import { readFileSync } from 'node:fs';
import { describe, expect, inject, it } from 'vitest';
import { byLastName } from '../../eleventy.config.js';
import { parseCsvRecords } from '../../scripts/lib/csv.js';
import { attr, currentLinks, elementByClass, listFiles, pageAt, readHtmlPages, tags, text } from './helpers.js';

const site = inject('builtSite');
// Checks of what a switchable feature adds (the footer's "Send feedback",
// the scripts, the privacy page's storage rows) read the site built with
// every feature on, so none of them changes or is skipped while a switch is
// off (SPEC §11). features-off.test.js checks the pages with each switch off.
const siteOn = inject('builtSiteOn');
const config = JSON.parse(readFileSync('site.config.json', 'utf8'));
const handoffProblems = JSON.parse(
  readFileSync('docs/design/HANDOFF.md', 'utf8').match(/```json\n([\s\S]*?)\n```/)[1],
);
const areaNames = Object.fromEntries(
  parseCsvRecords(readFileSync('data/areas.csv', 'utf8')).map((a) => [a.area_id, a.name]),
);
const linkTexts = (html) => [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((m) => text(m[1]));

// Page URL -> expected current item in the main nav ([label, aria-current]).
// The nav has no "Sleep problems" item (project lead, 2026-11-13), so no
// item is current on Home or on a problem page.
const NAV_CURRENT = {
  '/': null,
  '/start/': ['Start here', 'page'],
  '/problems/tired-but-wired/': null,
  '/problems/restless-legs/': null,
  '/about/': null,
  '/contact/': ['Contact', 'page'],
  '/help/': ['Referral info', 'page'],
  '/privacy/': null,
  '/search/': null,
  '/404.html': null,
};

const menuPanel = (html) => elementByClass(html, 'mobile-menu__panel', 'div');
// The two TopicNav copies: the sidebar and the one in the phone menu panel.
const sidebarNav = (html) => elementByClass(html, 'with-sidebar__side', 'div');
const panelNav = (html) => elementByClass(menuPanel(html), 'topic-nav', 'nav');

describe('SiteHeader and MobileHeader', () => {
  it.each(Object.entries(NAV_CURRENT))('marks the current item on %s', (url, expected) => {
    const html = pageAt(site, url);
    for (const nav of [elementByClass(html, 'site-nav', 'nav'), elementByClass(html, 'mobile-nav', 'nav')]) {
      const current = currentLinks(nav).map((l) => [l.label, l.value]);
      expect(current).toEqual(expected ? [expected] : []);
    }
  });

  it('has the logo, the three nav items, the search forms and the urgent link, in order', () => {
    const html = pageAt(site, '/');
    const desktop = elementByClass(html, 'site-header__desktop', 'div');
    expect(tags(desktop, 'a').map((t) => attr(t, 'href'))).toEqual(['/', '/start/', '/help/', '/contact/', '/urgent-help/']);
    expect(linkTexts(elementByClass(desktop, 'site-nav', 'nav'))).toEqual(['Start here', 'Referral info', 'Contact']);
    const grid = elementByClass(html, 'mobile-nav', 'nav');
    expect(tags(grid, 'a').map((t) => attr(t, 'href'))).toEqual(['/start/', '/help/', '/contact/']);
    expect(linkTexts(grid)).toEqual(['Start here', 'Referral info', 'Contact']);

    // The header's two search forms (the feedback dialog's form is in feedback.test.js).
    const forms = tags(html, 'form').filter((t) => attr(t, 'method') !== 'dialog');
    expect(forms).toHaveLength(2);
    for (const form of forms) {
      expect(attr(form, 'role')).toBe('search');
      expect(attr(form, 'action')).toBe('/search/');
      expect(attr(form, 'method')).toBe('get');
    }
    // The header's two fields (Home's other field, the sleep problems
    // filter, has no name: it submits nothing, page-home-start.test.js).
    const inputs = tags(elementByClass(html, 'site-header', 'header'), 'input');
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(attr(input, 'name')).toBe('q');
      expect(attr(input, 'type')).toBe('search');
      expect(attr(input, 'autocomplete')).toBe('off');
    }
    expect(text(elementByClass(html, 'header-search__submit', 'button'))).toBe('Search');
  });

  // Project lead, 2026-11-13 (SPEC §7.5, §8.1, §22): the site search is
  // "Search this website" (the boards: "Search sleep problems"), so it isn't
  // taken for the filter over Home's list of sleep problems.
  it('labels both header search boxes "Search this website", on every page with the site header', () => {
    for (const { file, html } of readHtmlPages(site)) {
      const header = elementByClass(html, 'site-header', 'header');
      if (file === 'urgent-help/index.html') {
        expect(header, file).toBeUndefined();
        continue;
      }
      // Desktop: a visually hidden label, and the same words as the placeholder.
      expect(header, file).toContain('<label class="visually-hidden" for="site-q">Search this website</label>');
      const desktop = tags(header, 'input').find((t) => attr(t, 'id') === 'site-q');
      expect(attr(desktop, 'placeholder'), file).toBe('Search this website');
      // Phone menu: a visible label, and the board's example as the placeholder.
      expect(header, file).toContain('<label class="mobile-search__label" for="ph-q">Search this website</label>');
      const phone = tags(header, 'input').find((t) => attr(t, 'id') === 'ph-q');
      expect(attr(phone, 'placeholder'), file).toBe('e.g. waking too early');
      expect(tags(header, 'label'), file).toHaveLength(2);
      // The old name is nowhere on the page, in text or in an attribute.
      expect(html, file).not.toMatch(/Search sleep problems/i);
    }
  });

  it('gives the header search the name of the search page\'s own form', () => {
    expect(pageAt(site, '/search/')).toContain('<label class="search-form__label" id="search-q-label" for="search-q">Search this website</label>');
  });

  // Project lead, 2026-11-13 (SPEC §7.5, §22): Sleep problems is part of
  // Home, so the nav has no item for it, and the logo is the way home.
  it.each(['/', '/start/', '/problems/pain/', '/help/', '/search/', '/404.html'])('has no "Sleep problems" item in either nav on %s, and the logo links home', (url) => {
    const html = pageAt(site, url);
    for (const nav of [elementByClass(html, 'site-nav', 'nav'), elementByClass(html, 'mobile-nav', 'nav')]) {
      expect(linkTexts(nav)).not.toContain('Sleep problems');
      expect(tags(nav, 'a').map((t) => attr(t, 'href')).filter((href) => /problems/.test(href))).toEqual([]);
    }
    const logos = [...html.matchAll(/<a class="site-logo[^"]*" href="([^"]*)">/g)].map((m) => m[1]);
    expect(logos).toEqual(['/', '/']);
  });

  // The phone menu's grid had four items in two rows, "Sleep problems"
  // filled. Now "Start here" has the first row to itself, filled, and the
  // other two share the second (SPEC §7.5).
  it('gives "Start here" the first row of the phone menu\'s grid, filled, with the other two under it', () => {
    const grid = elementByClass(pageAt(site, '/'), 'mobile-nav__grid', 'ul');
    const items = [...grid.matchAll(/<li([^>]*)>\s*(<a\b[^>]*>)/g)].map(([, li, a]) => [attr(`<li${li}>`, 'class'), attr(a, 'class'), attr(a, 'href')]);
    expect(items).toEqual([
      ['mobile-nav__item--primary', 'mobile-nav__link mobile-nav__link--primary', '/start/'],
      [undefined, 'mobile-nav__link', '/help/'],
      [undefined, 'mobile-nav__link', '/contact/'],
    ]);
    const css = readFileSync('src/css/site.css', 'utf8');
    expect(css).toMatch(/\n\.mobile-nav__grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\n\.mobile-nav__item--primary \{\s*grid-column: 1 \/ -1;\s*\}/);
  });

  it('has one banner, with one "Main" nav per header variant', () => {
    const html = pageAt(site, '/');
    expect(tags(html, 'header')).toHaveLength(1);
    expect(elementByClass(elementByClass(html, 'site-header__desktop', 'div'), 'site-nav', 'nav')).toBeTruthy();
    expect(elementByClass(elementByClass(html, 'mobile-header', 'div'), 'mobile-nav', 'nav')).toBeTruthy();
    expect(tags(html, 'nav').filter((t) => attr(t, 'aria-label') === 'Main')).toHaveLength(2);
  });

  it('renders the phone menu as a closed native <details>, so it opens without JavaScript', () => {
    const html = pageAt(site, '/problems/tired-but-wired/');
    const details = tags(html, 'details').find((t) => attr(t, 'class') === 'mobile-menu');
    expect(details).toBeTruthy();
    expect(attr(details, 'open')).toBeUndefined();
    const summary = elementByClass(html, 'mobile-menu__toggle', 'summary');
    expect(text(summary)).toBe('Menu Close');
    expect(summary).not.toMatch(/aria-expanded|aria-label/);
    const panel = menuPanel(html);
    expect(panel).toMatch(/<form class="mobile-search"/);
    expect(panel).toMatch(/aria-label="All topics"/);
    expect(panel).toMatch(/<a class="mobile-menu__urgent" href="\/urgent-help\/">Get urgent help<\/a>/);
    expect(html).toMatch(/<script type="module" src="\/js\/menu\.js"><\/script>/);
  });

  it('uses the logo at the handoff sizes', () => {
    const html = pageAt(site, '/');
    const logos = tags(html, 'img').filter((t) => attr(t, 'src') === '/img/sleepsteps-logo.svg');
    expect(logos.map((t) => [attr(t, 'alt'), attr(t, 'height')])).toEqual([
      ['SleepSteps home', '68'],
      ['SleepSteps home', '56'],
    ]);
  });
});

describe('TopicNav', () => {
  it.each(handoffProblems.map((p) => [p.slug, p]))('on /problems/%s/ highlights the problem and opens its area', (slug, p) => {
    const html = pageAt(site, `/problems/${slug}/`);
    for (const nav of [sidebarNav(html), panelNav(html)]) {
      const open = tags(nav, 'details').filter((t) => attr(t, 'open') !== undefined);
      expect(open).toHaveLength(1);
      const openArea = elementByClass(nav.slice(nav.indexOf(open[0])), 'topic-nav__area', 'details');
      expect(currentLinks(openArea)).toEqual([{ href: `/problems/${slug}/`, value: 'page', label: p.shortTitle }]);
      expect(text(elementByClass(openArea, 'topic-nav__area-name'))).toBe(areaNames[p.areaId]);
      expect(currentLinks(nav)).toHaveLength(1);
      expect(nav).not.toMatch(/topic-nav__chapters/);
    }
  });

  it('lists 10 areas and 36 problems, with counts', () => {
    const nav = panelNav(pageAt(site, '/'));
    const counts = [...nav.matchAll(/<span class="topic-nav__count">(\d+)<span class="visually-hidden"> (topics?)<\/span>/g)];
    expect(counts).toHaveLength(10);
    expect(counts.reduce((sum, m) => sum + Number(m[1]), 0)).toBe(36);
    for (const [, n, unit] of counts) expect(unit).toBe(n === '1' ? 'topic' : 'topics');
    expect(tags(nav, 'a').filter((t) => attr(t, 'class') === 'topic-nav__link')).toHaveLength(36);
  });

  it('on /start/ marks "Introduction videos" current and shows the chapter links', () => {
    const html = pageAt(site, '/start/');
    for (const nav of [sidebarNav(html), panelNav(html)]) {
      expect(currentLinks(nav)).toEqual([{ href: '/start/', value: 'page', label: 'Introduction videos' }]);
      const chapters = elementByClass(nav, 'topic-nav__chapters', 'ol');
      expect(tags(chapters, 'a').map((t) => attr(t, 'href'))).toEqual(['#v1', '#v2']);
      expect(tags(nav, 'details').filter((t) => attr(t, 'open') !== undefined)).toHaveLength(0);
    }
    for (const id of ['v1', 'v2']) expect(html).toContain(`id="${id}"`);
    // Two intro videos, not three (project lead, 2026-11-13, SPEC §7.3).
    expect(html).not.toContain('id="v3"');
  });

  // Only Start here has chapters (its `chapters` front matter, SPEC §7.3),
  // so a problem page's layout doesn't work them out for its sidebar.
  it('shows the chapter links on Start here only: a problem page has none, and its layout asks for none', () => {
    const html = pageAt(site, '/problems/pain/');
    for (const nav of [sidebarNav(html), panelNav(html)]) expect(elementByClass(nav, 'topic-nav__chapters', 'ol')).toBeUndefined();
    expect(readFileSync('src/_includes/layouts/topics.njk', 'utf8')).not.toMatch(/introChapters|[cC]hapters/);
  });

  it.each(['/', '/help/', '/about/', '/contact/', '/privacy/', '/search/', '/404.html'])(
    'on %s is only in the menu panel, with all areas closed',
    (url) => {
      const html = pageAt(site, url);
      expect(sidebarNav(html)).toBeUndefined();
      expect(tags(html, 'nav').filter((t) => attr(t, 'aria-label') === 'All topics')).toHaveLength(1);
      const nav = panelNav(html);
      expect(tags(nav, 'details').filter((t) => attr(t, 'open') !== undefined)).toHaveLength(0);
      const expected = ['/help/', '/contact/'].includes(url) ? [url] : [];
      expect(currentLinks(nav).map((l) => l.href)).toEqual(expected);
    },
  );

  it('keeps TopicNav outside <main> on problem pages, so the skip link passes it', () => {
    const html = pageAt(site, '/problems/pain/');
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    expect(main).not.toMatch(/aria-label="All topics"/);
    expect(main).toMatch(/<h1 class="problem__title">Pain<\/h1>/);
  });
});

describe("problem pages and Home's list of sleep problems", () => {
  it.each(handoffProblems.map((p) => [p.slug, p]))('/problems/%s/ shows the breadcrumb, title and statement', (slug, p) => {
    const html = pageAt(site, `/problems/${slug}/`);
    expect(html).toContain(`data-page-id="${slug}"`);
    expect(html).toContain('class="page--wide"');
    expect(text(html.match(/<h1[^>]*>[\s\S]*?<\/h1>/)[0])).toBe(p.shortTitle);
    const statement = text(elementByClass(html, 'problem__statement', 'p'));
    expect(statement).toBe(`“${/[.?!]$/.test(p.statement) ? p.statement : `${p.statement}.`}”`);
    const crumbs = elementByClass(html, 'breadcrumb', 'nav');
    // To Home's list of sleep problems, and to the problem's area there.
    expect(tags(crumbs, 'a').map((t) => attr(t, 'href'))).toEqual(['/#sleep-problems', `/#${p.areaId}`]);
    expect(linkTexts(crumbs)).toEqual(['Sleep problems', areaNames[p.areaId]]);
    expect(crumbs).toContain(`<span aria-current="page">`);
  });

  it('lists every problem under its area on Home, in order, with area anchors', () => {
    const html = pageAt(site, '/');
    const sections = [...html.matchAll(/<section class="group-list__group" id="([a-z]+)">([\s\S]*?)<\/section>/g)];
    expect(sections.map((m) => m[1])).toEqual(['core', 'day', 'clock', 'mind', 'med', 'env', 'social', 'hard', 'relapse', 'dis']);
    const listed = sections.flatMap(([, area, body]) =>
      tags(body, 'a').map((t) => [area, attr(t, 'href')]),
    );
    expect(listed).toEqual(handoffProblems.map((p) => [p.areaId, `/problems/${p.slug}/`]));
  });
});

describe('information pages', () => {
  const INFO = {
    '/help/': 'Referral info',
    '/about/': 'About us',
    '/contact/': 'Contact us',
    '/privacy/': 'Privacy and your data',
  };

  it.each(Object.keys(INFO))('%s has the title band, its page_id and no side menu (SPEC §7.4, §22)', (url) => {
    const html = pageAt(site, url);
    expect(html).toContain(`data-page-id="${url.slice(1, -1)}"`);
    const band = elementByClass(html, 'band', 'div');
    expect(band).toMatch(/<h1 class="band__title">/);
    expect(band).toMatch(/<p class="band__lede">|<p class="band__lede band__aside">/);
    expect(html).toContain(`class="info-body info-body--${url.slice(1, -1)}"`);
    // One main, holding the band, so the skip link lands on the H1. It has
    // no nav of its own: the "Information pages" side menu is gone.
    expect(tags(html, 'main')).toHaveLength(1);
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    expect(main.match(/<h[1-6]\b/)[0]).toBe('<h1');
    expect(tags(main, 'nav')).toEqual([]);
    expect(html).not.toMatch(/info-nav|Information pages/);
    // Headings after the H1 never skip a level on the way down.
    const levels = [...main.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    levels.slice(1).forEach((level, i) => expect(level, `heading ${i + 2} on ${url}`).toBeLessThanOrEqual(levels[i] + 1));
  });

  it('reaches every information page from the header or the footer, whose navs keep their labels', () => {
    const hrefs = (html) => tags(html, 'a').map((t) => attr(t, 'href'));
    for (const url of [...Object.keys(INFO), '/']) {
      const html = pageAt(site, url);
      const siteNav = elementByClass(html, 'site-nav', 'nav');
      expect(attr(tags(siteNav, 'nav')[0], 'aria-label')).toBe('Main');
      expect(hrefs(siteNav)).toEqual(['/start/', '/help/', '/contact/']);
      expect(hrefs(elementByClass(html, 'site-header__desktop', 'div'))).toContain('/urgent-help/');
      expect(hrefs(menuPanel(html))).toEqual(expect.arrayContaining(['/help/', '/contact/', '/urgent-help/']));
      // About is in the footer only (project lead, 2026-11-07).
      expect(hrefs(elementByClass(html, 'site-header', 'header'))).not.toContain('/about/');
      const footer = elementByClass(html, 'site-footer', 'footer');
      expect(tags(footer, 'nav').map((t) => attr(t, 'aria-label'))).toEqual(['Footer', 'Help and policies']);
      expect(hrefs(footer)).toEqual(expect.arrayContaining(['/about/', '/contact/', '/help/', '/privacy/', '/urgent-help/']));
    }
  });

  it.each(Object.entries(INFO))('marks %s as the current page in the header and footer menus', (url, label) => {
    const html = pageAt(site, url);
    // Referral info and Contact are in the header too, Contact as
    // "Contact"; About ("About" in the footer) and Privacy and your data are
    // in the footer only.
    const header = { '/help/': 'Referral info', '/contact/': 'Contact' }[url];
    const short = { '/about/': 'About', '/contact/': 'Contact' }[url];
    expect(currentLinks(elementByClass(html, 'site-nav', 'nav'))).toEqual(header ? [{ href: url, value: 'page', label: header }] : []);
    expect(currentLinks(elementByClass(html, 'site-footer', 'footer'))).toEqual([{ href: url, value: 'page', label: short ?? label }]);
  });

  it('has no "Information pages" nav on any page', () => {
    for (const { file, html } of readHtmlPages(site)) {
      expect(html, file).not.toMatch(/aria-label="Information pages"|class="info-nav/);
    }
  });

  it('says on Privacy and Contact that emailing or phoning the team is not anonymous', () => {
    // "Send feedback" leads to Contact without JavaScript and on pages without the dialog (SPEC §13, §15.2).
    const privacy = text(pageAt(site, '/privacy/'));
    expect(privacy).toContain('Your name, email or other contact details, unless you email or phone us (see below)');
    expect(privacy).toMatch(/If you email or phone us Emails and phone calls are not anonymous\./);
    expect(text(pageAt(site, '/contact/'))).toContain("Emails and phone calls aren't anonymous");
  });

  it.each(['/contact/', '/privacy/'])('%s gives the project email as a mailto link (SPEC §7.4, §15.2)', (url) => {
    const html = pageAt(site, url);
    const mail = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].filter(([tag]) => /^mailto:/i.test(attr(tag, 'href') ?? ''));
    expect(mail.map(([tag, , inner]) => [attr(tag, 'href'), text(inner)])).toEqual([
      ['mailto:psych.sleepsteps@monash.edu', 'psych.sleepsteps@monash.edu'],
    ]);
    expect(text(html)).not.toMatch(/\[[^\]]*e-?mail( address)?\]/i);
    if (url === '/privacy/') expect(text(html).replace(/ ([,.])/g, '$1')).toContain('Contact the team at psych.sleepsteps@monash.edu,');
  });

  it('starts "Other support" on Referral info with Cancer Council, its number, hours and website (SPEC §7.4)', () => {
    const services = elementByClass(pageAt(site, '/help/'), 'help-services', 'ul');
    const first = services.match(/<li\b[^>]*>([\s\S]*?)<\/li>/)[1];
    expect(first).toMatch(/^<h3 class="help-service__name">Cancer Council<\/h3>/);
    expect(text(elementByClass(first, 'help-service__details', 'p'))).toBe(
      '13 11 20 · Free, confidential cancer information and support. Monday to Friday, 9am to 5pm (longer in some states).',
    );
    const web = tags(first, 'a').filter((t) => /^https:/.test(attr(t, 'href')));
    expect(web.map((t) => [attr(t, 'href'), attr(t, 'rel')])).toEqual([['https://www.cancer.org.au/', 'noreferrer']]);
    expect(linkTexts(first)).toContain('Cancer Council website');
  });

  it('names the SleepSteps Trial Research Team in "Who runs it", linked to "Who we are" (SPEC §7.4, §22)', () => {
    const html = pageAt(site, '/about/');
    expect(html).toContain('<h2 id="who-we-are">Who we are</h2>');
    expect(html).toContain('<dt>Who runs it</dt><dd><a href="#who-we-are">The SleepSteps Trial Research Team</a></dd>');
  });

  it('gives the SleepSteps Trial Research Team as copyright holder in both licences', () => {
    expect(readFileSync('LICENSE', 'utf8')).toContain('Copyright (c) 2026 SleepSteps Trial Research Team');
    const content = readFileSync('LICENSE-CONTENT.md', 'utf8');
    expect(content).toContain('© 2026 the SleepSteps Trial Research Team');
    expect(content).not.toMatch(/Sleep Steps|Behavioural Medicine Lab/);
  });

  it('calls About "About us", with "Why we made this program" (SPEC §7.5)', () => {
    const html = pageAt(site, '/about/');
    expect(html).toContain('<title>About us</title>');
    expect(html).toContain('<p class="band__eyebrow">About us</p>');
    expect(html).toContain('<h2>Why we made this program</h2>');
  });

  it('lists the team from data/team.csv in "Who we are", one row per person by last name, no photos (SPEC §7.4, §7.5)', () => {
    const html = pageAt(site, '/about/');
    const list = elementByClass(html, 'about-team', 'ul');
    const rows = list.match(/<li class="about-person">[\s\S]*?<\/li>/g).map(text);
    const team = parseCsvRecords(readFileSync('data/team.csv', 'utf8'));
    expect(team.length).toBeGreaterThan(0);
    // Sorted here independently of byLastName: last word of the name, then the whole name.
    const last = (p) => p.name.trim().split(/\s+/).at(-1).toLowerCase();
    const sorted = [...team].sort((a, b) => last(a).localeCompare(last(b)) || a.name.localeCompare(b.name));
    expect(rows).toEqual(sorted.map((p) => `${p.name} ${p.role}${p.organisation ? `, ${p.organisation}` : ''}`));
    expect(rows[0]).toMatch(/^Lisa Beatty /);
    expect(rows.at(-1)).toMatch(/^Joshua Wiley /);
    expect(list).not.toMatch(/<h3|\[Photo\]/);
  });

  it('sorts people by the last word of their name, then the whole name, ignoring case and accents', () => {
    const names = (people) => byLastName(people).map((p) => p.name);
    expect(names([{ name: 'Joshua Wiley' }, { name: 'Bei Bei' }, { name: 'Lisa Beatty' }, { name: 'Alix Mellor' }])).toEqual([
      'Lisa Beatty', 'Bei Bei', 'Alix Mellor', 'Joshua Wiley',
    ]);
    expect(names([{ name: 'Zoe Smith' }, { name: 'Anna Smith' }, { name: 'émile zola' }, { name: 'Ada Young' }])).toEqual([
      'Anna Smith', 'Zoe Smith', 'Ada Young', 'émile zola',
    ]);
    // Only a case- and accent-insensitive comparison gets these right: code
    // points put 'Z' before 'a', and 'É' after 'z'.
    expect(names([{ name: 'Bob Zed' }, { name: 'Ann abel' }, { name: 'Cy Éclair' }])).toEqual(['Ann abel', 'Cy Éclair', 'Bob Zed']);
    expect(names([{ name: 'Fay Smith' }, { name: 'Émile Smith' }, { name: 'Dan Smith' }])).toEqual(['Dan Smith', 'Émile Smith', 'Fay Smith']);
    expect(names([{ name: '  Ann   Zed  ' }, { name: 'Bo Abel' }])).toEqual(['Bo Abel', '  Ann   Zed  ']);
    const team = [{ name: 'B A' }, { name: 'A B' }];
    byLastName(team);
    expect(team.map((p) => p.name)).toEqual(['B A', 'A B']); // the input is left as it was
  });

  it("links Privacy to Google's privacy policy", () => {
    expect(pageAt(site, '/privacy/')).toContain(
      '<p class="link-standalone"><a href="https://policies.google.com/privacy" rel="noreferrer">Google privacy policy</a></p>',
    );
  });

  it('offers no GP summary or sleep diary on Referral info (SPEC §7.5, §21: not for now)', () => {
    const page = pageAt(site, '/help/');
    expect(text(page)).not.toMatch(/GP summary|summary for your GP|diary/i);
    expect(page).not.toMatch(/help-print/);
  });

  it('gives About the hero band with the settling arc', () => {
    const html = pageAt(site, '/about/');
    expect(html).toMatch(/<div class="band band--hero on-dark">/);
    expect(html).toMatch(/<svg class="arc" viewBox="0 0 1440 90" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="[^"]+"\/><\/svg>/);
  });
});

describe('footer', () => {
  const pages = readHtmlPages(siteOn).filter((p) => p.file !== 'urgent-help/index.html');
  // The footer's wording is `footer` in site.config.json (SPEC §11).
  // components.test.js renders the partial with stand-in values to show that
  // each field comes from there.
  const copy = config.footer;
  const paragraphs = (html) =>
    [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => text(m[1]).replace(/ ([,.])/g, '$1'));

  it.each(pages.map((p) => [p.file, p.html]))('%s has the footer with "Send feedback" and the text from site.config.json', (file, html) => {
    const footer = elementByClass(html, 'site-footer', 'footer');
    expect(footer).toBeTruthy();
    expect(tags(footer, 'nav').map((t) => attr(t, 'aria-label'))).toEqual(['Footer', 'Help and policies']);
    const feedback = tags(footer, 'a').filter((t) => attr(t, 'class') === 'site-footer__feedback');
    expect(feedback.map((t) => attr(t, 'href'))).toEqual(['/contact/']);
    expect(text(elementByClass(footer, 'site-footer__tagline', 'p'))).toBe(copy.tagline);
    // An empty acknowledgement, registration or ethics value is left out.
    expect(paragraphs(elementByClass(footer, 'site-footer__meta', 'div'))).toEqual(
      [
        copy.acknowledgement,
        [copy.trialRegistration, copy.ethicsApproval].filter(Boolean).join(' · '),
        `Content is licensed under CC BY 4.0, ${copy.licenceExceptions}.`,
      ].filter(Boolean),
    );
  });

  it("links Start here, Home's list of sleep problems, About and Contact in its first nav, then \"Send feedback\"", () => {
    for (const url of ['/', '/about/', '/problems/pain/']) {
      const nav = elementByClass(elementByClass(pageAt(siteOn, url), 'site-footer', 'footer'), 'site-footer__col', 'nav');
      expect([...nav.matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)].map(([, attrs, label]) => [attr(`<a${attrs}>`, 'href'), label]), url).toEqual([
        ['/start/', 'Start here'],
        ['/#sleep-problems', 'Sleep problems'],
        ['/about/', 'About'],
        ['/contact/', 'Contact'],
        ['/contact/', 'Send feedback'],
      ]);
    }
    // A link to a part of Home is never "the current page", even on Home.
    expect(currentLinks(elementByClass(pageAt(siteOn, '/'), 'site-footer', 'footer'))).toEqual([]);
  });

  it('has its wording in site.config.json, as text, and none of it in the template', () => {
    expect(Object.keys(copy).sort()).toEqual(['acknowledgement', 'ethicsApproval', 'licenceExceptions', 'tagline', 'trialRegistration']);
    const partial = readFileSync('src/_includes/partials/site-footer.njk', 'utf8');
    for (const [key, value] of Object.entries(copy)) {
      expect(typeof value, key).toBe('string');
      if (value) expect(partial, key).not.toContain(value);
    }
  });

  it('has an Acknowledgement of Country, not a placeholder', () => {
    expect(copy.acknowledgement).toMatch(/\backnowledge\b.*\bTraditional Owners\b/i);
    expect(copy.acknowledgement).not.toContain('[');
  });

  it('names what LICENSE-CONTENT.md leaves out, with no full stop of its own (the template adds it)', () => {
    expect(copy.licenceExceptions).toMatch(/^except .*name and logo.*third-party material$/);
  });
});

describe('Getting urgent help', () => {
  const html = pageAt(siteOn, '/urgent-help/');

  it('has the minimal header, no search or menu, and the site footer like every page; its scripts send its page view and run "Send feedback"', () => {
    const header = elementByClass(html, 'minimal-header', 'header');
    expect(tags(header, 'a').map((t) => attr(t, 'href'))).toEqual(['/', '/']);
    expect(linkTexts(header)).toEqual(['', 'Back to home']);
    expect(tags(header, 'img').map((t) => attr(t, 'alt'))).toEqual(['SleepSteps home']);
    expect(html).not.toMatch(/<details|role="search"|class="site-header"/);
    // The footer (project lead, 2026-11-07), with its two navs, marking this page in it.
    const footer = elementByClass(html, 'site-footer', 'footer');
    expect(tags(footer, 'nav').map((t) => attr(t, 'aria-label'))).toEqual(['Footer', 'Help and policies']);
    expect(currentLinks(footer)).toEqual([{ href: '/urgent-help/', value: 'page', label: 'Get urgent help' }]);
    // events.js (SPEC §10.1, §10.2) while features.events is on, and feedback.js
    // while features.feedback is (SPEC §13); no menu.js. With either off,
    // features-off.test.js.
    expect(tags(html, 'script').map((t) => attr(t, 'src'))).toEqual(['/js/events.js', '/js/feedback.js']);
    expect(html).toMatch(/<body[^>]* data-page-id="urgent-help" data-page-view>/);
  });

  it('every built page has the site footer exactly once (project lead, 2026-11-07)', () => {
    for (const { file, html: page } of readHtmlPages(site)) {
      expect(page.match(/<footer class="site-footer">/g), file).toHaveLength(1);
    }
  });

  it('shows each crisis contact from site.config.json as a tel: link', () => {
    const links = [...html.matchAll(/<a href="(tel:[^"]+)">([\s\S]*?)<\/a>/g)].map((m) => [m[1], text(m[2])]);
    expect(links).toEqual(
      config.crisisContacts.map((c) => [
        `tel:${c.value.replace(/[^0-9]/g, '')}`,
        `${c.heading} ${c.description} Call ${c.value}`,
      ]),
    );
    expect(text(html)).toContain(`Numbers shown are for ${config.crisisRegion};`);
  });

  const moreCards = () => [...elementByClass(html, 'urgent-help__more', 'ul').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);

  it('shows the smaller cards, linking only those with a confirmed number', () => {
    // A card with a confirmed number is one whole-card tel: link, unless it
    // also links to a website: then only the number is a tel: link, because
    // one link can't hold another (SPEC §7.4).
    const cards = moreCards();
    expect(text(cards[0])).toMatch(/^Your treating team /);
    expect(cards[0]).toMatch(/^<div class="contact-card">/);
    for (const card of cards) {
      const number = elementByClass(card, 'contact-card__number');
      const web = elementByClass(card, 'contact-card__web', 'p');
      const links = tags(card, 'a').map((t) => [attr(t, 'class'), attr(t, 'href')]);
      const webLinks = web ? tags(web, 'a').map((t) => [attr(t, 'class'), attr(t, 'href')]) : [];
      if (!number || text(number).startsWith('[')) {
        expect(links).toEqual(webLinks);
        continue;
      }
      const tel = `tel:${text(number).replace(/^Call /, '').replace(/[^0-9+]/g, '')}`;
      if (web) {
        expect(card).toMatch(/^<div class="contact-card">/);
        expect(webLinks).toHaveLength(1);
        expect(links).toEqual([['contact-card__number', tel], ...webLinks]);
      } else {
        expect(links).toEqual([['contact-card contact-card--link', tel]]);
      }
    }
  });

  it('lists Cancer Council 13 11 20 with its hours and website, with the smaller cards, not the crisis ones (SPEC §7.4)', () => {
    const card = moreCards().find((c) => text(c).startsWith('Cancer Council '));
    expect(card).toBeTruthy();
    expect(card).toContain('<h2 class="contact-card__title">Cancer Council</h2>');
    expect(tags(card, 'a').map((t) => [attr(t, 'href'), attr(t, 'rel')])).toEqual([
      ['tel:131120', undefined],
      ['https://www.cancer.org.au/', 'noreferrer'],
    ]);
    expect(linkTexts(card)).toEqual(['Call 13 11 20', 'Cancer Council website']);
    expect(text(card)).toContain('Free, confidential cancer information and support. Monday to Friday, 9am to 5pm (longer in some states).');
    expect(text(elementByClass(html, 'urgent-help__calls', 'ul'))).not.toContain('Cancer Council');
  });

  it('stays minimal: no draft or developer notes', () => {
    expect(html).not.toMatch(/class="placeholder"/);
  });
});

describe('other pages', () => {
  it.each([
    ['/', 'home'],
    ['/start/', 'start'],
    ['/search/', 'search'],
  ])('%s has page_id %s', (url, id) => {
    expect(pageAt(site, url)).toContain(`data-page-id="${id}"`);
  });

  // The Sleep problems page is part of Home (project lead, 2026-11-13):
  // its page_id is gone, and its address redirects (deploy-config.test.js).
  it('has no page with the page_id "problems"', () => {
    for (const { file, html } of readHtmlPages(site)) expect(html, file).not.toContain('data-page-id="problems"');
  });

  it('serves the 404 page at /404.html with no page_id', () => {
    const html = pageAt(site, '/404.html');
    expect(html).not.toContain('data-page-id');
    expect(html).toMatch(/<title>Page not found<\/title>/);
  });

  // layouts/page.njk has two users, the search page and the 404 page, and
  // both have the title band, so the layout has no band-less variant. The
  // site search indexes only content/pages/ (SPEC §8.3), so neither needs
  // `search: false`.
  it('gives the search page and the 404 page the title band, from a layout with no other variant', () => {
    for (const url of ['/search/', '/404.html']) {
      const main = elementByClass(pageAt(site, url), 'page-body', 'div');
      expect(main, url).toBeDefined();
      expect(elementByClass(pageAt(site, url), 'band', 'div'), url).toMatch(/<h1 class="band__title">/);
    }
    const users = listFiles('content', (f) => /\.(njk|md)$/.test(f)).filter((f) => /^layout: layouts\/page\.njk$/m.test(readFileSync(`content/${f}`, 'utf8')));
    expect(users.sort()).toEqual(['404.njk', 'search.njk']);
    expect(readFileSync('src/_includes/layouts/page.njk', 'utf8')).not.toMatch(/\bif band\b|'none'/);
    for (const f of users) expect(readFileSync(`content/${f}`, 'utf8'), f).not.toMatch(/^search:/m);
  });

  it("gives the search page a no-JavaScript route to Home's list of sleep problems", () => {
    const fallback = elementByClass(pageAt(site, '/search/'), 'search-fallback', 'div');
    expect(fallback).toMatch(/<a href="\/#sleep-problems">Sleep problems<\/a>/);
  });

  it('links the 404 page to the home page, the list of sleep problems and the introduction', () => {
    const list = elementByClass(pageAt(site, '/404.html'), 'link-list', 'ul');
    expect([...list.matchAll(/<a href="([^"]*)">([^<]*)<\/a>/g)].map((m) => [m[1], m[2]])).toEqual([
      ['/', 'Go to the home page'],
      ['/#sleep-problems', 'Browse sleep problems'],
      ['/start/', 'Watch the introduction'],
    ]);
  });
});

// Device storage must be disclosed (SPEC §2, §15.4): every item in the §15.4
// inventory appears in the privacy page's table, and any sessionStorage or
// localStorage key used in src/js/ is named on the privacy page, here as
// built with every feature on. With a switch off, the rows and keys of the
// modules it leaves out go too (SPEC §15.2; features-off.test.js).
describe('Privacy: cookies and browser storage', () => {
  const privacyHtml = pageAt(siteOn, '/privacy/');
  const table = elementByClass(privacyHtml, 'storage-table', 'table');
  const spec = readFileSync('SPEC.md', 'utf8');
  const inventory = spec.slice(spec.indexOf('### 15.4'), spec.indexOf('## 16.'));
  const rows = () => [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);

  it('has a storage table with a caption and header cells', () => {
    expect(table).toMatch(/<caption[^>]*>What may be stored in your browser<\/caption>/);
    expect(tags(table, 'th').filter((t) => attr(t, 'scope') === 'col')).toHaveLength(4);
  });

  it.each(['sleepsteps-visit', 'sleepsteps-stats-off', 'cf_clearance', 'cf.turnstile.u', 'cf-nel', 'YSC', '__Secure-YNID'])(
    'lists %s in SPEC §15.4 and in the table',
    (name) => {
      expect(table).toContain(`<code>${name}</code>`);
      expect(inventory).toContain(`\`${name}\``);
    },
  );

  // The browser keeps an HSTS record for the site (SPEC §15.4, §16.1, M7).
  it('lists the HTTPS-only setting while the site sends Strict-Transport-Security', () => {
    expect(readFileSync('src/_headers', 'utf8')).toMatch(/^ {2}Strict-Transport-Security: max-age=31536000$/m);
    const row = rows().find((tr) => text(tr).trim().startsWith('HTTPS-only setting (HSTS)'));
    expect(text(row ?? '').trim()).toBe(
      'HTTPS-only setting (HSTS) This website Tells your browser to always use a secure (HTTPS) connection to this website. It holds no code and nothing about you. One year after your last visit',
    );
    expect(inventory).toMatch(/\| HSTS record for the site's address \|/);
  });

  // Cloudflare adds Network Error Logging headers to production's responses;
  // the project lead chose to disclose them, not to override them (C4,
  // SPEC §15.4, §16.1).
  it("lists Cloudflare's network error reports, which can carry a search page's address", () => {
    const row = text(rows().find((tr) => tr.includes('<code>cf-nel</code>')) ?? '').trim();
    expect(row).toMatch(/^Network error reporting \( ?cf-nel ?\) Cloudflare, our hosting provider In Chrome, Edge and other browsers built on Chromium: /);
    expect(row).toContain('If that address was a search results page, it includes what you searched for.');
    expect(row).toMatch(/7 days after your last visit$/);
  });

  it('does not list the reserve-only __cf_bm cookie while Bot Fight Mode is off', () => {
    expect(inventory).toMatch(/`__cf_bm` \*\(reserve only\)\*/);
    expect(privacyHtml).not.toContain('__cf_bm');
  });

  it('names every storage key used in src/js/ on the privacy page', () => {
    // Keys passed straight to a storage call, plus any quoted `sleepsteps-…`
    // string (SleepSteps' own keys use that prefix, §15.4), which also
    // catches keys held in constants or passed through helpers.
    const keyPatterns = [
      /(?:local|session)Storage\s*(?:\.\s*(?:getItem|setItem|removeItem)\(\s*|\[\s*)['"`]([^'"`]+)['"`]/g,
      /['"`](sleepsteps-[a-z0-9-]+)['"`]/g,
    ];
    for (const rel of listFiles('src/js', (f) => f.endsWith('.js'))) {
      const file = `src/js/${rel}`;
      const source = readFileSync(file, 'utf8');
      for (const [, key] of keyPatterns.flatMap((p) => [...source.matchAll(p)])) {
        expect(text(privacyHtml), `${file} uses storage key "${key}"`).toContain(key);
      }
    }
  });

  it("uses the project lead's wording for accounts and cookies (SPEC §7.5, 2026-11-06)", () => {
    expect(text(privacyHtml)).toContain("You don't need an account to use this program.");
    expect(text(privacyHtml)).toContain('Advertising or tracking cookies from us');
  });

  it('no longer claims the site sets no cookies at all', () => {
    expect(text(privacyHtml)).not.toMatch(/\bCookies, or anything else that tracks you\b/);
    expect(text(privacyHtml)).toContain("We don't use cookies to track you or show you ads, and we don't set any cookies ourselves.");
  });

  // Cloudflare Access sets CF_AppSession on the site and CF_Session on the
  // team's sign-in page for anyone it sends to the sign-in, so they are
  // listed; the cookies set after signing in reach only the team and aren't
  // (project lead, 2026-11-10; SPEC §15.2, §15.4).
  it('lists the cookies of the staff sign-in page, and none of those set after signing in', () => {
    const row = text(rows().find((tr) => tr.includes('<code>CF_AppSession</code>')) ?? '').trim();
    expect(row).toBe(
      'CF_AppSession and CF_Session Cloudflare, our hosting provider Only if you open the sign-in page for our research staff. Cloudflare sets them, on this website and on its own sign-in page, so the sign-in works. 24 hours on this website; 4 hours on the sign-in page',
    );
    expect(inventory).toContain('`CF_AppSession`');
    expect(inventory).toContain('`CF_Session`');
    expect(text(privacyHtml)).not.toMatch(/CF_Authorization|CF_Binding|CF_Device|test copy of the site/);
  });

  it('carries the YouTube API Services statement and links', () => {
    expect(text(privacyHtml)).toContain('This site uses YouTube API Services to play videos.');
    expect(privacyHtml).toContain('href="https://www.youtube.com/t/terms" rel="noreferrer"');
  });
});
