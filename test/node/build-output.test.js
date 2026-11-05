// Checks every built HTML page for the document shell and for what the CSP
// in SPEC §16.1 will enforce. The site is built fresh by global-setup.js.
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import { attr, readHtmlPages, tags } from './helpers.js';

const site = inject('builtSite');
const pages = readHtmlPages(site);

// A URL with a scheme, or protocol-relative: anything not on our own origin.
const EXTERNAL_URL = /^\s*(?:[a-z][a-z0-9+.-]*:|\/\/|\\\\)/i;

// Sites a page may link to (SPEC §16.1). Links load nothing, so the CSP
// doesn't cover them; this list keeps them deliberate. YouTube: the "Watch on
// YouTube" fallback (§9.1). Google: its privacy policy, on /privacy/ (§15.2).
const OUTBOUND_HOSTS = ['www.youtube.com', 'policies.google.com'];

describe('build output', () => {
  it('builds every expected page', () => {
    const files = pages.map((p) => p.file);
    for (const file of [
      'index.html',
      '404.html',
      'start/index.html',
      'problems/index.html',
      'search/index.html',
      'help/index.html',
      'about/index.html',
      'contact/index.html',
      'privacy/index.html',
      'urgent-help/index.html',
    ]) {
      expect(files).toContain(file);
    }
    expect(files.filter((f) => /^problems\/[^/]+\/index\.html$/.test(f))).toHaveLength(36);
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

  it('labels every text input', () => {
    for (const input of tags(html, 'input')) {
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
});
