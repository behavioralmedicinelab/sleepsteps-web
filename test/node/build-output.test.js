// Checks every built HTML page for the document shell and for what the CSP
// in SPEC §16.1 enforces (src/_headers; deploy-config.test.js checks the
// policy itself). The site is built fresh by global-setup.js, with every
// feature on whatever site.config.json says, so no check here changes while a
// switch is off (SPEC §11). features-off.test.js checks the shell and the CSP
// rules on the site built with each combination of switches, and that the
// real build matches the one with the same switches.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import { attr, pageAt, readHtmlPages, tags, text } from './helpers.js';

const site = inject('builtSiteOn');
const pages = readHtmlPages(site);

// A URL with a scheme, or protocol-relative: anything not on our own origin.
const EXTERNAL_URL = /^\s*(?:[a-z][a-z0-9+.-]*:|\/\/|\\\\)/i;

// Sites a page may link to (SPEC §16.1). Links load nothing, so the CSP
// doesn't cover them; this list keeps them deliberate. YouTube: the "Watch on
// YouTube" fallback (§9.1) and YouTube's Terms of Service on /privacy/ (§15.2).
// Google: its privacy policy, on /privacy/ (§15.2). Creative Commons: the
// content licence in the footer (§22). Cancer Council: its website, on
// Getting urgent help and Referral info (§7.4).
const OUTBOUND_HOSTS = ['www.youtube.com', 'policies.google.com', 'creativecommons.org', 'www.cancer.org.au'];

describe('build output', () => {
  it('builds every expected page', () => {
    const files = pages.map((p) => p.file);
    const expected = [
      'index.html',
      '404.html',
      'start/index.html',
      'search/index.html',
      'help/index.html',
      'about/index.html',
      'contact/index.html',
      'privacy/index.html',
      'urgent-help/index.html',
    ];
    for (const file of expected) {
      expect(files).toContain(file);
    }
    const problemPages = files.filter((f) => /^problems\/[^/]+\/index\.html$/.test(f));
    expect(problemPages).toHaveLength(36);
    // And no other page: 9 pages and the 36 problems.
    expect(files).toHaveLength(expected.length + problemPages.length);
  });
});

// The Sleep problems page is part of Home (project lead, 2026-11-13; SPEC
// §7.2, §22). Its old address, /problems/, redirects to Home (dist/_redirects,
// checked in deploy-config.test.js), so nothing may be built there and no
// page may still link to it; each problem keeps /problems/<slug>/.
describe('the old Sleep problems page (/problems/)', () => {
  /** Every href on every built page: [file, href]. */
  const hrefs = pages.flatMap(({ file, html }) => tags(html, 'a').map((tag) => [file, attr(tag, 'href') ?? '']));

  it('is not built: no dist/problems/index.html, though every problem page is', () => {
    expect(existsSync(path.join(site, 'problems/index.html'))).toBe(false);
    expect(pages.map((p) => p.file)).not.toContain('problems/index.html');
    expect(statSync(path.join(site, 'problems')).isDirectory()).toBe(true);
    expect(statSync(path.join(site, 'problems/pain/index.html')).isFile()).toBe(true);
  });

  it('is linked from no built page, with or without a fragment or the final slash', () => {
    const old = hrefs.filter(([, href]) => /^\/problems\/?(?:[?#].*)?$/.test(href));
    expect(old).toEqual([]);
    // No page names it in any other attribute or in a script's address either.
    for (const { file, html } of pages) expect(html, file).not.toMatch(/["'=]\/problems\/?["'#?]/);
  });

  it("links to Home's list as /#sleep-problems and to an area as /#<area_id>, each an id on Home", () => {
    const home = pageAt(site, '/');
    const ids = new Set([...home.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const toHome = hrefs.filter(([, href]) => href.startsWith('/#'));
    expect(toHome.length).toBeGreaterThan(0);
    for (const [file, href] of toHome) expect(ids.has(href.slice(2)), `${file}: ${href}`).toBe(true);
    const targets = new Set(toHome.map(([, href]) => href));
    expect(targets.has('/#sleep-problems')).toBe(true);
    // Every page reaches the list: the footer's "Sleep problems" link.
    for (const { file } of pages) expect(toHome.some(([f, href]) => f === file && href === '/#sleep-problems'), file).toBe(true);
    // Each problem page links to its own area on Home (breadcrumb and back link).
    const areaLinks = [...targets].filter((href) => href !== '/#sleep-problems');
    expect(areaLinks.length).toBe(10);
  });
});

// The staff pages (SPEC §14.4) are rendered by the Worker, never built: the
// build only copies their stylesheet and the download page's script, which
// no public page loads.
describe('the admin assets', () => {
  it('builds nothing under admin/, and copies admin.css and admin-export.js', () => {
    expect(existsSync(path.join(site, 'admin'))).toBe(false);
    expect(pages.filter((p) => p.file.startsWith('admin'))).toEqual([]);
    expect(statSync(path.join(site, 'css/admin.css')).isFile()).toBe(true);
    expect(statSync(path.join(site, 'js/admin-export.js')).isFile()).toBe(true);
  });

  it('loads neither on any public page', () => {
    for (const { file, html } of pages) expect(html, file).not.toMatch(/admin\.css|admin-export\.js/);
  });
});

// The site icons (SPEC §7.5), copied from src/ to the site root. Each
// page links all three, so no browser asks for a missing one; /favicon.ico is
// also where a browser looks when nothing names an icon (the PDF viewer).
const ICON_LINKS = [
  '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
  '<link rel="icon" href="/favicon.ico" sizes="32x32">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
];

describe('the site icons (SPEC §7.5)', () => {
  const read = (name) => readFileSync(path.join(site, name));

  it('copies favicon.svg: an SVG drawn with presentation attributes only, loading nothing', () => {
    const svg = read('favicon.svg').toString('utf8');
    const root = svg.match(/^(?:<\?xml[^>]*\?>\s*)?(<svg\b[^>]*>)/)?.[1] ?? '';
    expect(root).toMatch(/\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(root).toMatch(/\sviewBox="[^"]+"/);
    expect(svg.trim()).toMatch(/<\/svg>$/);
    // Like the logo: no <style>, style attribute, script, event handler or link.
    expect(svg).not.toMatch(/<style|\sstyle\s*=|<script|\son[a-z]+\s*=|href\s*=|url\(/i);
  });

  it('copies favicon.ico: an icon file holding 16 and 32px images', () => {
    const ico = read('favicon.ico');
    expect([...ico.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => ico[6 + 16 * i] || 256);
    expect(sizes).toEqual(expect.arrayContaining([16, 32]));
    expect(ico.length).toBeLessThan(10 * 1024);
  });

  it('copies apple-touch-icon.png: a 180 by 180 PNG', () => {
    const png = read('apple-touch-icon.png');
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.subarray(12, 16).toString('latin1')).toBe('IHDR');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([180, 180]);
  });

  it('serves the files in src/, the only copy (none left in docs/design/)', () => {
    for (const name of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png']) {
      expect(read(name).equals(readFileSync(path.join('src', name))), name).toBe(true);
      expect(existsSync(path.join('docs/design', name)), `docs/design/${name}`).toBe(false);
    }
  });
});

// Browser tab titles are the page title alone, with no site name after it
// (SPEC §7.5, §22, 2026-11-06); Home's is "Sleep during and after cancer".
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref) => {
    if (ref[0] !== '#') return ENTITIES[ref.toLowerCase()] ?? whole;
    return String.fromCodePoint(/^#x/i.test(ref) ? parseInt(ref.slice(2), 16) : Number(ref.slice(1)));
  });

/** The `title` in the front matter of the file a built page comes from. */
function pageTitle(file) {
  const sources = {
    'index.html': 'content/index.njk',
    '404.html': 'content/404.njk',
    'start/index.html': 'content/start.md',
    'search/index.html': 'content/search.njk',
  };
  const problem = file.match(/^problems\/([^/]+)\/index\.html$/);
  const page = file.match(/^([a-z-]+)\/index\.html$/);
  const source = sources[file] ?? (problem ? `content/problems/${problem[1]}.md` : page ? `content/pages/${page[1]}.md` : undefined);
  expect(source, `source of ${file}`).toBeTruthy();
  const front = readFileSync(source, 'utf8').match(/^---\n([\s\S]*?)\n---\n/)[1];
  const raw = front.match(/^title: (.+)$/m)?.[1].trim();
  expect(raw, `title in ${source}`).toBeTruthy();
  if (raw.startsWith('"')) return JSON.parse(raw);
  if (raw.startsWith("'")) return raw.slice(1, -1).replaceAll("''", "'");
  return raw;
}

describe('browser tab titles', () => {
  it('give Home the title "Sleep during and after cancer"', () => {
    expect(pages.find((p) => p.file === 'index.html').html).toContain('<title>Sleep during and after cancer</title>');
  });

  it.each(pages.map((p) => [p.file, p.html]))('%s: the page title alone', (file, html) => {
    expect(decode(html.match(/<title>([^<]*)<\/title>/)[1])).toBe(pageTitle(file));
  });
});

describe.each(pages.map((p) => [p.file, p.html]))('%s', (file, html) => {
  it('has <html lang="en-AU">', () => {
    expect(html).toMatch(/<html lang="en-AU">/);
  });

  it('has a non-empty <title>', () => {
    const m = html.match(/<title>([^<]*)<\/title>/);
    expect(m?.[1].trim()).toBeTruthy();
  });

  it('has exactly one <h1>', () => {
    expect(tags(html, 'h1')).toHaveLength(1);
  });

  it('starts the body with the skip link and has <main id="main">', () => {
    expect(html).toMatch(/<body[^>]*>\s*<a class="skip-link" href="#main">Skip to content<\/a>/);
    expect(tags(html, 'main').filter((t) => attr(t, 'id') === 'main')).toHaveLength(1);
  });

  it('has no inline styles, inline scripts or event-handler attributes', () => {
    expect(html).not.toMatch(/\sstyle\s*=/i);
    expect(html).not.toMatch(/<style[\s>]/i);
    for (const tag of tags(html, 'script')) {
      expect(attr(tag, 'src'), tag).toBeTruthy();
    }
    expect(html).not.toMatch(/<[^>]+\son[a-z]+\s*=/i);
  });

  it('links the site icons in its <head>, once each', () => {
    const head = html.slice(0, html.indexOf('</head>'));
    for (const link of ICON_LINKS) {
      expect(head.split(link).length - 1, link).toBe(1);
      expect(html.split(link).length - 1, link).toBe(1);
    }
  });

  it('sets no policy in a meta tag: the CSP comes from the header alone (a second policy would also enforce)', () => {
    expect(html).not.toMatch(/<meta[^>]+http-equiv\s*=\s*["']?content-security-policy/i);
  });

  it('loads nothing from another origin', () => {
    for (const tag of html.match(/<[a-z][a-z0-9-]*\b[^>]*>/gi) ?? []) {
      const name = tag.match(/^<([a-z0-9-]+)/i)[1].toLowerCase();
      // Every URL-bearing attribute except a navigation link's href.
      const names = ['src', 'srcset', 'poster', 'data', 'action', 'formaction', 'xlink:href'];
      if (name !== 'a' && name !== 'area') names.push('href');
      for (const attrName of names) {
        const value = attr(tag, attrName);
        if (value === undefined) continue;
        const urls = attrName === 'srcset' ? value.split(',').map((c) => c.trim().split(/\s+/)[0]) : [value];
        for (const url of urls) expect(url, tag).not.toMatch(EXTERNAL_URL);
      }
    }
  });

  // Turnstile loads only when the feedback dialog first opens (SPEC §13,
  // §16.2): its address is in src/js/feedback.js alone, never in a page.
  it('never names Turnstile\'s host, and loads feedback.js exactly when it has the feedback dialog', () => {
    expect(html).not.toMatch(/challenges\.cloudflare\.com/i);
    const footer = html.indexOf('</footer>');
    const hasDialog = footer > -1 && attr(tags(html, 'body')[0], 'data-page-id') !== undefined;
    const dialogs = tags(html, 'dialog');
    expect(dialogs).toHaveLength(hasDialog ? 1 : 0);
    expect(tags(html, 'script').filter((t) => attr(t, 'src') === '/js/feedback.js')).toHaveLength(hasDialog ? 1 : 0);
    if (!hasDialog) return;
    // After the footer and outside <main>, shipped hidden and closed.
    expect(html.indexOf('<dialog')).toBeGreaterThan(footer);
    expect(html.indexOf('<dialog')).toBeGreaterThan(html.indexOf('</main>'));
    expect([attr(dialogs[0], 'hidden'), attr(dialogs[0], 'open')]).toEqual(['', undefined]);
  });

  it('links out only over https to allowed sites, with rel="noreferrer"', () => {
    for (const tag of [...tags(html, 'a'), ...tags(html, 'area')]) {
      const href = attr(tag, 'href');
      if (!href || !EXTERNAL_URL.test(href)) continue;
      const url = new URL(href, 'https://sleepsteps.invalid/');
      if (url.protocol === 'tel:' || url.protocol === 'mailto:') continue;
      expect(url.protocol, tag).toBe('https:');
      expect(OUTBOUND_HOSTS, tag).toContain(url.hostname);
      expect(attr(tag, 'rel')?.split(/\s+/), tag).toContain('noreferrer');
    }
  });

  it('never puts a link inside another link', () => {
    // A card that holds a phone number and a website gives each its own link
    // instead (SPEC §7.4).
    let depth = 0;
    for (const [tag, closing] of html.matchAll(/<(\/?)a\b[^>]*>/gi)) {
      depth += closing ? -1 : 1;
      expect(depth, tag).toBeLessThanOrEqual(1);
    }
    expect(depth).toBe(0);
  });

  it('has no empty tel: or mailto: links', () => {
    for (const tag of tags(html, 'a')) {
      expect(attr(tag, 'href') ?? '', tag).not.toMatch(/^(tel|mailto):\+?$/i);
    }
  });

  it('has unique ids', () => {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('resolves every root-relative href, src and form action to a built file', () => {
    const urls = [];
    for (const tag of html.match(/<[a-z]+\b[^>]*>/gi) ?? []) {
      for (const name of ['href', 'src', 'action']) {
        const value = attr(tag, name);
        if (value && value.startsWith('/')) urls.push(value);
      }
    }
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      const pathname = decodeURI(url.split(/[?#]/)[0]);
      const target = path.join(site, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
      expect(existsSync(target) && statSync(target).isFile(), `${url} -> ${target}`).toBe(true);
    }
  });

  it('labels every text input and textarea', () => {
    for (const input of [...tags(html, 'input'), ...tags(html, 'textarea')]) {
      const id = attr(input, 'id');
      expect(id, input).toBeTruthy();
      expect(html, `label for ${id}`).toMatch(new RegExp(`<label\\b[^>]*\\sfor="${id}"`));
    }
  });

  it('labels every nav landmark', () => {
    for (const nav of tags(html, 'nav')) {
      expect(attr(nav, 'aria-label'), nav).toBeTruthy();
    }
  });

  // The project lead's decisions of 2026-11-06 (SPEC §9.3, §12, §15.1, §22).
  it('offers or mentions no transcript: no disclosure, print button, link or visible text', () => {
    const visible = text(
      html
        .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ' ')
        .replace(/<p class="rating__sizer"[\s\S]*?<\/p>/g, ' ')
        .replace(/<span class="visually-hidden">[\s\S]*?<\/span>/g, ' '),
    );
    expect(visible).not.toMatch(/transcript/i);
    const description = attr(tags(html, 'meta').find((t) => attr(t, 'name') === 'description') ?? '<meta>', 'content') ?? '';
    expect(description).not.toMatch(/transcript/i);
    expect(html).not.toMatch(/\sdata-transcript=|\sid="transcript-|href="#transcript-|class="transcript|transcript__print|print-sheet|solution__quick-transcript/);
  });

  // The project lead's decision of 2026-11-07 (SPEC §15.1, §22): the YouTube
  // note is once per page with a video, after its last video, and every play
  // control names it, so it is heard before pressing play.
  it('has the YouTube note once, after the last video, if it has a video; every play control describes itself by it', () => {
    const videoAt = [...html.matchAll(/<div class="video video--/g)].map((m) => m.index);
    const notes = [...html.matchAll(/<p class="notice-text youtube-note">/g)].map((m) => m.index);
    expect(html).not.toMatch(/video__notice|id="video-notice-/);
    if (videoAt.length === 0) {
      expect(notes).toEqual([]);
      expect(html).not.toMatch(/youtube-note-text/);
      return;
    }
    expect(notes).toHaveLength(1);
    expect(notes[0]).toBeGreaterThan(videoAt.at(-1));
    expect(notes[0]).toBeLessThan(html.indexOf('</main>'));
    expect(html.match(/ id="youtube-note-text"/g)).toHaveLength(1);
    for (const facade of tags(html, 'a').filter((a) => attr(a, 'class') === 'video__facade')) {
      expect(attr(facade, 'aria-describedby'), facade).toBe('youtube-note-text');
    }
  });

  it('has no ratings notice and no closed-card rating summary', () => {
    expect(html).not.toMatch(/Ratings are anonymous|We use them to improve these resources|About the information we collect/);
    expect(html).not.toMatch(/data-rating-summary|class="solution__rating"/);
  });
});
