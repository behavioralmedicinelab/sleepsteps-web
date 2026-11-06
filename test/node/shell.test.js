// Site shell (SPEC §20 M1a): header, phone menu, TopicNav, footer, info
// layout and the urgent-help page, checked on the built HTML.
import { readFileSync } from 'node:fs';
import { describe, expect, inject, it } from 'vitest';
import { parseCsvRecords } from '../../scripts/lib/csv.js';
import { attr, currentLinks, elementByClass, listFiles, pageAt, readHtmlPages, tags, text } from './helpers.js';

const site = inject('builtSite');
const config = JSON.parse(readFileSync('site.config.json', 'utf8'));
const handoffProblems = JSON.parse(
  readFileSync('docs/design/HANDOFF.md', 'utf8').match(/```json\n([\s\S]*?)\n```/)[1],
);
const areaNames = Object.fromEntries(
  parseCsvRecords(readFileSync('data/areas.csv', 'utf8')).map((a) => [a.area_id, a.name]),
);
const linkTexts = (html) => [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((m) => text(m[1]));

// Page URL -> expected current item in the main nav ([label, aria-current]).
const NAV_CURRENT = {
  '/': null,
  '/start/': ['Start here', 'page'],
  '/problems/': ['Sleep problems', 'page'],
  '/problems/tired-but-wired/': ['Sleep problems', 'true'],
  '/problems/restless-legs/': ['Sleep problems', 'true'],
  '/about/': ['About', 'page'],
  '/contact/': ['Contact', 'page'],
  '/help/': null,
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

  it('has the nav items, search forms and urgent link in the handoff order', () => {
    const html = pageAt(site, '/');
    const desktop = elementByClass(html, 'site-header__desktop', 'div');
    expect(tags(desktop, 'a').map((t) => attr(t, 'href'))).toEqual([
      '/', '/start/', '/problems/', '/about/', '/contact/', '/urgent-help/',
    ]);
    const grid = elementByClass(html, 'mobile-nav', 'nav');
    expect(tags(grid, 'a').map((t) => attr(t, 'href'))).toEqual(['/problems/', '/start/', '/about/', '/contact/']);

    const forms = tags(html, 'form');
    expect(forms).toHaveLength(2);
    for (const form of forms) {
      expect(attr(form, 'role')).toBe('search');
      expect(attr(form, 'action')).toBe('/search/');
      expect(attr(form, 'method')).toBe('get');
    }
    for (const input of tags(html, 'input')) {
      expect(attr(input, 'name')).toBe('q');
      expect(attr(input, 'type')).toBe('search');
      expect(attr(input, 'autocomplete')).toBe('off');
    }
    expect(text(elementByClass(html, 'header-search__submit', 'button'))).toBe('Search');
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
      expect(tags(chapters, 'a').map((t) => attr(t, 'href'))).toEqual(['#v1', '#v2', '#v3']);
      expect(tags(nav, 'details').filter((t) => attr(t, 'open') !== undefined)).toHaveLength(0);
    }
    for (const id of ['v1', 'v2', 'v3']) expect(html).toContain(`id="${id}"`);
  });

  it.each(['/', '/problems/', '/help/', '/about/', '/contact/', '/privacy/', '/search/', '/404.html'])(
    'on %s is only in the menu panel, with all areas closed',
    (url) => {
      const html = pageAt(site, url);
      expect(sidebarNav(html)).toBeUndefined();
      expect(tags(html, 'nav').filter((t) => attr(t, 'aria-label') === 'All topics')).toHaveLength(1);
      const nav = panelNav(html);
      expect(tags(nav, 'details').filter((t) => attr(t, 'open') !== undefined)).toHaveLength(0);
      const expected = ['/help/', '/about/', '/contact/'].includes(url) ? [url] : [];
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

describe('problem pages and the Sleep problems page', () => {
  it.each(handoffProblems.map((p) => [p.slug, p]))('/problems/%s/ shows the breadcrumb, title and statement', (slug, p) => {
    const html = pageAt(site, `/problems/${slug}/`);
    expect(html).toContain(`data-page-id="${slug}"`);
    expect(html).toContain('class="page--wide"');
    expect(text(html.match(/<h1[^>]*>[\s\S]*?<\/h1>/)[0])).toBe(p.shortTitle);
    const statement = text(elementByClass(html, 'problem__statement', 'p'));
    expect(statement).toBe(`“${/[.?!]$/.test(p.statement) ? p.statement : `${p.statement}.`}”`);
    const crumbs = elementByClass(html, 'breadcrumb', 'nav');
    expect(tags(crumbs, 'a').map((t) => attr(t, 'href'))).toEqual(['/problems/', `/problems/#${p.areaId}`]);
    expect(linkTexts(crumbs)).toEqual(['Sleep problems', areaNames[p.areaId]]);
    expect(crumbs).toContain(`<span aria-current="page">`);
  });

  it('lists every problem under its area, in order, with area anchors', () => {
    const html = pageAt(site, '/problems/');
    const sections = [...html.matchAll(/<section class="area-list__area" id="([a-z]+)">([\s\S]*?)<\/section>/g)];
    expect(sections.map((m) => m[1])).toEqual(['core', 'day', 'clock', 'mind', 'med', 'env', 'social', 'hard', 'relapse', 'dis']);
    const listed = sections.flatMap(([, area, body]) =>
      tags(body, 'a').map((t) => [area, attr(t, 'href')]),
    );
    expect(listed).toEqual(handoffProblems.map((p) => [p.areaId, `/problems/${p.slug}/`]));
  });
});

describe('information pages', () => {
  const INFO = {
    '/help/': 'Getting more help',
    '/about/': 'About us',
    '/contact/': 'Contact us',
    '/privacy/': 'Privacy and your data',
  };

  it.each(Object.entries(INFO))('%s has the title band, the side menu and its page_id', (url, label) => {
    const html = pageAt(site, url);
    expect(html).toContain(`data-page-id="${url.slice(1, -1)}"`);
    const band = elementByClass(html, 'band', 'div');
    expect(band).toMatch(/<h1 class="band__title">/);
    expect(band).toMatch(/<p class="band__lede">|<p class="band__lede band__aside">/);
    const nav = elementByClass(html, 'info-nav', 'nav');
    expect(tags(nav, 'a').map((t) => attr(t, 'href'))).toEqual(['/help/', '/about/', '/contact/', '/privacy/', '/urgent-help/']);
    expect(currentLinks(nav)).toEqual([{ href: url, value: 'page', label }]);
    expect(html).toContain(`class="info-body info-body--${url.slice(1, -1)}"`);
    // The band and side menu are inside <main>, so the skip link lands on the H1.
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    expect(main).toMatch(/<h1/);
    expect(main).toMatch(/aria-label="Information pages"/);
  });

  it('says on Privacy and Contact that emailing or phoning the team is not anonymous', () => {
    // "Send feedback" leads to Contact until M5 and without JavaScript (SPEC §13, §15.2).
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

  it('starts "Other support" on Getting more help with Cancer Council, its number, hours and website (SPEC §7.4)', () => {
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

  it('calls About "About us", with "Why we made this program" (SPEC §7.5)', () => {
    const html = pageAt(site, '/about/');
    expect(html).toContain('<title>About us</title>');
    expect(html).toContain('<p class="band__eyebrow">About us</p>');
    expect(html).toContain('<h2>Why we made this program</h2>');
  });

  it('lists the team in "Who we are" as one row per person, no photos (SPEC §7.5)', () => {
    const html = pageAt(site, '/about/');
    const list = elementByClass(html, 'about-team', 'ul');
    const rows = list.match(/<li class="about-person">[\s\S]*?<\/li>/g).map(text);
    expect(rows).toHaveLength(17);
    expect(rows[0]).toBe('Joshua Wiley Coordinating principal investigator, Monash University');
    expect(rows[1]).toBe('Alix Mellor Trial coordinator, Monash University');
    expect(rows).toContain('Alysia Kepert Lived experience expert');
    expect(rows).toContain('Oxana Palesh Researcher, Virginia Commonwealth University (USA)');
    expect(list).not.toMatch(/<h3|\[Photo\]|\[Name\]/);
  });

  it("links Privacy to Google's privacy policy", () => {
    expect(pageAt(site, '/privacy/')).toContain(
      '<p class="link-standalone"><a href="https://policies.google.com/privacy" rel="noreferrer">Google privacy policy</a></p>',
    );
  });

  it('offers no GP summary or sleep diary on Getting more help (SPEC §7.5, §21: not for now)', () => {
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
  const pages = readHtmlPages(site).filter((p) => p.file !== 'urgent-help/index.html');
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
    expect(feedback.map((t) => attr(t, 'href'))).toEqual(config.features.feedback ? ['/contact/'] : []);
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
  const html = pageAt(site, '/urgent-help/');

  it('has the minimal header and no footer, search, menu or script', () => {
    const header = elementByClass(html, 'minimal-header', 'header');
    expect(tags(header, 'a').map((t) => attr(t, 'href'))).toEqual(['/', '/']);
    expect(linkTexts(header)).toEqual(['', 'Back to home']);
    expect(tags(header, 'img').map((t) => attr(t, 'alt'))).toEqual(['SleepSteps home']);
    expect(html).not.toMatch(/<footer|<form|<nav|<details|<script/);
    expect(html).toContain('data-page-id="urgent-help"');
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
    ['/problems/', 'problems'],
    ['/search/', 'search'],
  ])('%s has page_id %s', (url, id) => {
    expect(pageAt(site, url)).toContain(`data-page-id="${id}"`);
  });

  it('serves the 404 page at /404.html with no page_id', () => {
    const html = pageAt(site, '/404.html');
    expect(html).not.toContain('data-page-id');
    expect(html).toMatch(/<title>Page not found<\/title>/);
  });

  it('gives the search page a no-JavaScript route to the Sleep problems page', () => {
    const fallback = elementByClass(pageAt(site, '/search/'), 'search-fallback', 'div');
    expect(fallback).toMatch(/<a href="\/problems\/">Sleep problems<\/a>/);
  });
});

// Device storage must be disclosed (SPEC §2, §15.4): every item in the §15.4
// inventory appears in the privacy page's table, and any sessionStorage or
// localStorage key used in src/js/ is named on the privacy page.
describe('Privacy: cookies and browser storage', () => {
  const privacyHtml = pageAt(site, '/privacy/');
  const table = elementByClass(privacyHtml, 'storage-table', 'table');
  const spec = readFileSync('SPEC.md', 'utf8');
  const inventory = spec.slice(spec.indexOf('### 15.4'), spec.indexOf('## 16.'));

  it('has a storage table with a caption and header cells', () => {
    expect(table).toMatch(/<caption[^>]*>What may be stored in your browser<\/caption>/);
    expect(tags(table, 'th').filter((t) => attr(t, 'scope') === 'col')).toHaveLength(4);
  });

  it.each(['sleepsteps-visit', 'sleepsteps-stats-off', 'cf_clearance', 'cf.turnstile.u', 'YSC', '__Secure-YNID'])(
    'lists %s in the table and in SPEC §15.4',
    (name) => {
      expect(table).toContain(`<code>${name}</code>`);
      expect(inventory).toContain(`\`${name}\``);
    },
  );

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

  it('mentions the Cloudflare Access sign-in cookies research staff get (SPEC §15.2, §15.4)', () => {
    expect(text(privacyHtml)).toContain("Research staff who sign in to the site's admin area also get sign-in cookies from Cloudflare Access. Visitors never see that area.");
  });

  it('carries the YouTube API Services statement and links', () => {
    expect(text(privacyHtml)).toContain('This site uses YouTube API Services to play videos.');
    expect(privacyHtml).toContain('href="https://www.youtube.com/t/terms" rel="noreferrer"');
  });
});
