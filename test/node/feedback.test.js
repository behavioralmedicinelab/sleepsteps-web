// The feedback dialog (SPEC §11, §13, §15.1, §16.2; M5): what the built site
// ships, where base.njk renders it and loads src/js/feedback.js, the module's
// source, and the module run on built pages in the small test DOM
// (mini-dom.js) with a stand-in for Cloudflare's Turnstile API: opened from
// the footer's "Send feedback" and from each video's "Feedback" button
// (project lead, 2026-11-13), which makes the dialog about that video. Every
// request body is also run through the Worker's own check
// (worker/routes/feedback.js) against the built pages.json, so the browser
// sends exactly what the Worker accepts. The Worker's side is tested in
// test/worker/feedback.test.js.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import configure from '../../eleventy.config.js';
import { SEND_FAILED, TIMEOUT_MS } from '../../src/js/api.js';
// Its exports only: with no document here, the module itself does nothing.
import {
  FIT_MARGIN,
  FIT_PROPERTIES,
  LOAD_TIMEOUT_MS,
  MAX_LENGTH,
  MESSAGES,
  NORMAL_WIDTH,
  REANNOUNCE_MS,
  TEST_SITEKEY,
  TURNSTILE_URL,
  chooseSitekey,
  renderOptions,
} from '../../src/js/feedback.js';
import { pageIndex } from '../../worker/lib/pages.js';
import { FEEDBACK_KEYS, FEEDBACK_VIDEO_KEY, MAX_MESSAGE_LENGTH, cleanMessage, validateFeedback } from '../../worker/routes/feedback.js';
import { attr, elementByClass, listFiles, pageAt, readHtmlPages, tags, text } from './helpers.js';
import { MemoryStorage, VisualViewport, installDom, pressEscape } from './mini-dom.js';

// The site built with every feature on, whatever site.config.json says, so
// none of these checks is skipped while features.feedback is off (SPEC §11).
// The pages with the switch off are checked in features-off.test.js.
const site = inject('builtSiteOn');
const config = JSON.parse(readFileSync('site.config.json', 'utf8'));
const pagesJson = JSON.parse(readFileSync('worker/generated/pages.json', 'utf8'));
const index = pageIndex(pagesJson);
const spec = readFileSync('SPEC.md', 'utf8');

const PROBLEM = '/problems/tired-but-wired/';
const CONSOLE = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
const CONTACT_LINE = "You can also contact the team by email or phone, but that isn't anonymous.";
const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const REAL_KEY = '0x4AAAAAAAexampleKEY_-9';

/** The §15.1 notice for the dialog, from SPEC.md: its two paragraphs. */
const NOTICE = spec
  .match(/In the feedback dialog:\n((?:>.*\n)+)/)[1]
  .split(/\n>\n/)
  .map((p) => p.replace(/^> ?/gm, '').trim());

const pageIdOf = (html) => attr(tags(html, 'body')[0], 'data-page-id');
/** The page's videos, in page order (each facade names its video once). */
const videosOf = (html) => [...html.matchAll(/\sdata-video="([^"]*)"/g)].map((m) => m[1]);
/** The videos the page's "Feedback" buttons name, in page order. */
const feedbackVideosOf = (html) => [...html.matchAll(/\sdata-feedback-video="([^"]*)"/g)].map((m) => m[1]);
const scriptsOf = (html) => tags(html, 'script').map((t) => attr(t, 'src'));
const dialogOf = (html) => elementByClass(html, 'feedback-dialog', 'dialog');

// ---- The built site ----------------------------------------------------------

describe('built pages and the feedback dialog (SPEC §13)', () => {
  const pages = readHtmlPages(site);
  const withDialog = pages.filter((p) => p.file !== '404.html');

  it('renders the dialog on every page but the 404 page (no page_id), Getting urgent help included (project lead, 2026-11-07)', () => {
    expect(pages.filter((p) => dialogOf(p.html)).map((p) => p.file)).toEqual(withDialog.map((p) => p.file));
    expect(withDialog.length).toBe(pages.length - 1);
    expect(withDialog.map((p) => p.file)).toContain('urgent-help/index.html');
    expect(pageIdOf(pageAt(site, '/404.html'))).toBeUndefined();
    expect(pageAt(site, '/urgent-help/')).toMatch(/<footer class="site-footer">/);
  });

  it.each(withDialog.map((p) => [p.file, p.html]))('%s: a page_id, the footer link, the dialog after the footer, and feedback.js last', (file, html) => {
    expect(pagesJson[pageIdOf(html)], file).toBeTruthy();
    const footer = elementByClass(html, 'site-footer', 'footer');
    expect(tags(footer, 'a').filter((t) => attr(t, 'data-feedback-trigger') !== undefined)).toEqual([
      '<a class="site-footer__feedback" href="/contact/" data-feedback-trigger>',
    ]);
    expect(html.indexOf('<dialog')).toBeGreaterThan(html.indexOf('</footer>'));
    expect(scriptsOf(html).at(-1)).toBe('/js/feedback.js');
  });

  it('keeps the plain Contact link on the 404 page, which has no dialog and no feedback.js', () => {
    const html = pageAt(site, '/404.html');
    expect(tags(html, 'a').filter((t) => attr(t, 'data-feedback-trigger') !== undefined)).toEqual([
      '<a class="site-footer__feedback" href="/contact/" data-feedback-trigger>',
    ]);
    expect(dialogOf(html)).toBeUndefined();
    expect(scriptsOf(html)).not.toContain('/js/feedback.js');
  });

  it('ships the same dialog on every page', () => {
    const first = dialogOf(withDialog[0].html);
    for (const { file, html } of withDialog) expect(dialogOf(html), file).toBe(first);
  });

  // A video's "Feedback" button (partials/video-block.njk; SPEC §7.5, §13).
  // video-template.test.js checks its markup and place in every row, in
  // every combination of the switches.
  describe('each video\'s "Feedback" button', () => {
    const withVideos = pages.filter((p) => videosOf(p.html).length);

    it('is on every page with a video, one per video in page order, and on no other page', () => {
      expect(withVideos).toHaveLength(37);
      for (const { file, html } of pages) expect(feedbackVideosOf(html), file).toEqual(videosOf(html));
      expect(pages.filter((p) => feedbackVideosOf(p.html).length).map((p) => p.file)).toEqual(withVideos.map((p) => p.file));
    });

    it('is a hidden button of the handout\'s look, outside the footer and the dialog, on a page that has the dialog and feedback.js', () => {
      for (const { file, html } of withVideos) {
        const buttons = tags(html, 'button').filter((b) => attr(b, 'data-feedback-video') !== undefined);
        expect(buttons, file).toEqual(videosOf(html).map((id) => `<button type="button" class="format-button" data-feedback-trigger data-feedback-video="${id}" hidden>`));
        expect(elementByClass(html, 'site-footer', 'footer'), file).not.toMatch(/data-feedback-video/);
        expect(dialogOf(html), file).not.toMatch(/data-feedback-video/);
        expect(html.lastIndexOf('data-feedback-video'), file).toBeLessThan(html.indexOf('<footer'));
        expect(dialogOf(html), file).toBeDefined();
        expect(scriptsOf(html).at(-1), file).toBe('/js/feedback.js');
      }
    });

    it('names only videos pages.json lets that page send, and its title heading is on the page', () => {
      for (const { file, html } of withVideos) {
        const page = pageIdOf(html);
        for (const id of feedbackVideosOf(html)) {
          expect(pagesJson[page]?.videos, `${file}: ${id}`).toContain(id);
          expect(html.match(new RegExp(`<h[23] class="video-block__title" id="video-${id}-title"`, 'g')), `${file}: ${id}`).toHaveLength(1);
        }
        // And every video the page may send has its button.
        expect([...feedbackVideosOf(html)].sort(), file).toEqual(pagesJson[page].videos);
      }
    });

    it('is the only other control that opens the dialog: a page has its videos\' buttons and the footer link, and nothing else', () => {
      for (const { file, html } of pages) {
        const triggers = html.match(/<[a-z0-9]+\b[^>]*\sdata-feedback-trigger\b[^>]*>/g) ?? [];
        expect(triggers, file).toHaveLength(videosOf(html).length + 1);
        expect(triggers.at(-1), file).toBe('<a class="site-footer__feedback" href="/contact/" data-feedback-trigger>');
        for (const tag of triggers.slice(0, -1)) expect(tag, file).toMatch(/^<button type="button" class="format-button" data-feedback-trigger data-feedback-video="[a-z0-9-]+" hidden>$/);
      }
    });
  });

  describe('the dialog', () => {
    const html = dialogOf(pageAt(site, PROBLEM));
    const open = tags(html, 'dialog')[0];
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

    it('ships hidden and closed, named by its heading and described by the line for a video, then the notice', () => {
      expect([attr(open, 'hidden'), attr(open, 'open'), attr(open, 'data-feedback-dialog')]).toEqual(['', undefined, '']);
      expect([attr(open, 'aria-labelledby'), attr(open, 'aria-describedby')]).toEqual(['feedback-title', 'feedback-about feedback-notice']);
      for (const id of [attr(open, 'aria-labelledby'), ...attr(open, 'aria-describedby').split(' ')]) expect(ids.filter((x) => x === id), id).toHaveLength(1);
      expect(attr(open, 'role')).toBeUndefined();
      expect(attr(open, 'tabindex')).toBeUndefined();
      expect(tags(html, 'h2')).toEqual(['<h2 class="feedback__title" id="feedback-title" tabindex="-1">']);
      expect(text(elementByClass(html, 'feedback__title', 'h2'))).toBe('Send feedback');
    });

    it('ships the line for a video empty and hidden, directly under the heading and before the notice', () => {
      // Empty as well as hidden: it is part of the dialog's description,
      // and a description is read even from a hidden element.
      expect(elementByClass(html, 'feedback__about', 'p')).toBe('<p class="feedback__about" id="feedback-about" data-feedback-about hidden></p>');
      expect(html).toMatch(/<\/h2>\s*<p class="feedback__about" id="feedback-about" data-feedback-about hidden><\/p>\s*<div class="feedback__notice" id="feedback-notice">/);
      expect(html.match(/data-feedback-about/g)).toHaveLength(1);
    });

    it('holds the site key from site.config.json, for feedback.js to use only where it is a real one', () => {
      expect(attr(open, 'data-sitekey')).toBe(config.turnstileSiteKey.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    });

    it('gives the SPEC §15.1 notice word for word, with the crisis numbers of site.config.json', () => {
      const notice = elementByClass(html, 'feedback__notice', 'div');
      expect(attr(tags(notice, 'div')[0], 'id')).toBe('feedback-notice');
      const paragraphs = [...notice.matchAll(/<p class="notice-text">([\s\S]*?)<\/p>/g)].map((m) => text(m[1]));
      expect(NOTICE).toHaveLength(2);
      expect(paragraphs).toEqual(NOTICE);
      const numbers = Object.fromEntries(config.crisisContacts.map((c) => [c.label, c.value]));
      expect(paragraphs[0]).toContain(`call Lifeline on ${numbers.Lifeline}, or call ${numbers.Emergency} in an emergency`);
    });

    it('is a form that never goes anywhere: method="dialog", novalidate, no action and an unnamed textarea', () => {
      const form = tags(html, 'form');
      expect(form).toEqual(['<form class="feedback" method="dialog" novalidate>']);
      const textarea = tags(html, 'textarea');
      expect(textarea).toHaveLength(1);
      expect(attr(textarea[0], 'name')).toBeUndefined();
      expect([attr(textarea[0], 'maxlength'), attr(textarea[0], 'autocomplete'), attr(textarea[0], 'rows')]).toEqual([String(MAX_LENGTH), 'off', '6']);
      expect(MAX_LENGTH).toBe(MAX_MESSAGE_LENGTH);
      expect(html).toMatch(/<textarea [^>]*><\/textarea>/);
      expect(tags(html, 'input')).toEqual([]);
    });

    it('labels the textarea and describes it by the hint', () => {
      const textarea = tags(html, 'textarea')[0];
      expect(html).toContain(`<label class="feedback__label" for="${attr(textarea, 'id')}">Your message</label>`);
      expect(attr(textarea, 'aria-describedby')).toBe('feedback-hint');
      expect(text(elementByClass(html, 'feedback__hint', 'p'))).toBe('Up to 2,000 characters.');
    });

    it('puts the parts in order: heading, the line for a video, notice, field, hint, Turnstile box, Send and Cancel, status line', () => {
      const order = ['feedback__title', 'feedback__about', 'feedback__notice', 'feedback__field', 'feedback__label', 'feedback__message', 'feedback__hint', 'feedback__check', 'feedback__actions', 'feedback__status'];
      const at = order.map((name) => html.indexOf(`class="${name}"`));
      expect(at.every((i) => i > -1)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      expect(tags(html, 'button')).toEqual([
        '<button class="button button--primary" type="submit" data-feedback-send>',
        '<button class="button button--outline" type="button" data-feedback-cancel>',
      ]);
      expect(tags(html, 'button').length).toBe(2);
      expect(elementByClass(html, 'feedback__check', 'div')).toBe('<div class="feedback__check" data-feedback-check></div>');
      // The label, field and hint are wrapped, so that feedback.js can hide them together (decision A1).
      const field = elementByClass(html, 'feedback__field', 'div');
      expect(tags(field, 'div')[0]).toBe('<div class="feedback__field" data-feedback-field>');
      expect([tags(field, 'label'), tags(field, 'textarea'), tags(field, 'p')].map((t) => t.length)).toEqual([1, 1, 1]);
    });

    it('has an empty status line that is not yet a live region', () => {
      expect(elementByClass(html, 'feedback__status', 'div')).toBe('<div class="feedback__status" id="feedback-status" data-feedback-status></div>');
    });

    it('loads nothing: no script, iframe or Cloudflare address', () => {
      expect(html).not.toMatch(/<script|<iframe|cloudflare\.com|turnstile\/v0/i);
    });
  });
});

describe('site.config.json turnstileSiteKey (SPEC §11, §18.4)', () => {
  it('is the placeholder or a real site key, never one of Cloudflare\'s test keys', () => {
    expect(config.turnstileSiteKey).toMatch(/^(?:<PUBLIC_SITE_KEY>|0x[A-Za-z0-9_-]+)$/);
    expect(config.turnstileSiteKey).not.toMatch(/^[123]x/);
  });
});

// ---- base.njk and the switches ---------------------------------------------------

describe('base.njk and features.feedback', () => {
  const require = createRequire(import.meta.url);
  const nunjucks = createRequire(require.resolve('@11ty/eleventy'))('nunjucks');
  const filters = {};
  configure({
    on: () => {},
    addGlobalData: () => {},
    addDataExtension: () => {},
    addPassthroughCopy: () => {},
    addCollection: () => {},
    addFilter: (name, fn) => (filters[name] = fn),
  });
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader('src/_includes'), { autoescape: true });
  for (const [name, fn] of Object.entries(filters)) env.addFilter(name, fn);
  // The minimal header, so no collections are needed; the footer is the real one.
  const render = (feedback, data = {}) =>
    env.render('layouts/base.njk', {
      site: { ...config, features: { ratings: true, feedback, events: false } },
      page: { url: '/a-page/' },
      title: 'A page',
      page_id: 'a-page',
      header: 'minimal',
      content: '<main id="main"></main>',
      ...data,
    });
  const triggers = (html) => tags(html, 'a').filter((t) => attr(t, 'data-feedback-trigger') !== undefined);

  it('renders the link, the dialog and feedback.js only while features.feedback is exactly true', () => {
    const on = render(true);
    expect(triggers(on)).toHaveLength(1);
    expect(tags(on, 'dialog')).toHaveLength(1);
    expect(scriptsOf(on)).toEqual(['/js/feedback.js']);
    for (const off of [false, 'true', 1, undefined]) {
      const html = render(off);
      expect(triggers(html), String(off)).toEqual([]);
      expect(tags(html, 'dialog')).toEqual([]);
      expect(scriptsOf(html)).toEqual([]);
    }
  });

  it('always renders the footer, and leaves out the dialog and feedback.js without a page_id, keeping the link', () => {
    // There is no `footer` option any more: the footer is on every page.
    const old = render(true, { footer: false });
    expect([triggers(old).length, tags(old, 'dialog').length, scriptsOf(old)]).toEqual([1, 1, ['/js/feedback.js']]);
    const noId = render(true, { page_id: undefined });
    expect(triggers(noId)).toHaveLength(1);
    expect([tags(noId, 'dialog'), scriptsOf(noId)]).toEqual([[], []]);
  });

  it('loads feedback.js after the page\'s own modules', () => {
    expect(scriptsOf(render(true, { scripts: ['problems.js'] }))).toEqual(['/js/problems.js', '/js/feedback.js']);
  });

  it('refuses feedback.js in front matter, as base.njk adds it', () => {
    expect(() => filters.moduleScripts(['feedback.js'])).toThrow(/leave out "feedback\.js"/);
    expect(() => render(true, { scripts: ['feedback.js'] })).toThrow(/leave out "feedback\.js"/);
  });
});

// ---- The privacy page -------------------------------------------------------------

// What the privacy page says about feedback and its spam check (SPEC §15.2,
// §15.4; decisions A3 and A4) follows features.feedback, as the events rows
// follow features.events. The page's source is rendered here with the
// switch's other values too; features-off.test.js checks the built pages.
describe('the privacy page and features.feedback (SPEC §15.2, §15.4)', () => {
  const require = createRequire(import.meta.url);
  const eleventyRequire = createRequire(require.resolve('@11ty/eleventy'));
  const nunjucks = eleventyRequire('nunjucks');
  const yaml = eleventyRequire('js-yaml');
  const [, front, body] = readFileSync('content/pages/privacy.md', 'utf8').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const data = yaml.load(front);
  const render = (feedback) =>
    new nunjucks.Environment(null, { autoescape: true }).renderString(body, {
      ...data,
      site: { features: { ratings: true, events: true, feedback } },
    });

  // With the video, when sent from a video's "Feedback" button (2026-11-13; draft wording, SPEC §15.2).
  const ITEM = 'Written feedback, if you choose to send it, and the page you sent it from. If you use the Feedback button under a video, we also store which video it is about';
  // Every time is stored rounded down to the hour (SPEC §14.1), so the note
  // under the list says it once for all of them, feedback on or off.
  const NOTE = '<p>Each of these is stored with the page it came from and the date and hour, never the exact time.</p>';
  const CHECK = "The check receives technical details such as your IP address and browser, and the address of the page you're on, which on the search page includes your search.";
  const ROW = '<code>cf.turnstile.u</code>';
  // The sentence on blocking storage names the spam check only while the switch is on.
  const STORAGE_ON = 'YouTube videos and the spam check on the feedback form come from other services and may not work if you block their storage.';
  const STORAGE_OFF = 'YouTube videos come from another service and may not work if you block its storage.';
  const shown = (html) => [html.includes(`<li>${ITEM}</li>`), text(html).includes(CHECK), html.includes(ROW), text(html).includes(STORAGE_ON)];

  it('lists the feedback item, what the check receives, cf.turnstile.u and the check in the blocking sentence while the switch is on', () => {
    expect(shown(render(true))).toEqual([true, true, true, true]);
    expect(text(render(true))).not.toContain(STORAGE_OFF);
    expect(render(true)).toContain(NOTE);
  });

  it.each([false, 'true', undefined])('leaves all four out with features.feedback %s, and keeps the rest', (feedback) => {
    const html = render(feedback);
    expect(shown(html)).toEqual([false, false, false, false]);
    expect(text(html)).toContain(STORAGE_OFF);
    expect(html).toContain('<li>Star ratings you give a video</li>');
    expect(html).toContain(NOTE);
    expect(html).toContain('<code>cf_clearance</code>');
    expect(text(html)).toContain('It also protects the site from spam and automated attacks.');
  });

  it('says all four on the page built with the switch on', () => {
    expect(shown(pageAt(site, '/privacy/'))).toEqual([true, true, true, true]);
  });
});

// ---- Sources -------------------------------------------------------------------

describe('feedback.js source (SPEC §13, §15.4, §16.2)', () => {
  const raw = readFileSync('src/js/feedback.js', 'utf8');
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('is the only file in src/js/ that names Turnstile\'s host, and only as the exact api.js address', () => {
    for (const rel of listFiles('src/js', (f) => f.endsWith('.js'))) {
      const source = readFileSync(`src/js/${rel}`, 'utf8');
      const found = source.match(/challenges\.cloudflare\.com[^'"`\s]*/g) ?? [];
      if (rel === 'feedback.js') expect(found).toEqual(['challenges.cloudflare.com/turnstile/v0/api.js?render=explicit']);
      else expect(found, rel).toEqual([]);
    }
    expect(TURNSTILE_URL).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
    expect(code.match(/https?:\/\/[^'"`\s]+/g)).toEqual([TURNSTILE_URL]);
  });

  it('imports only api.js, and sends only to /api/feedback, exactly the keys the Worker requires', () => {
    expect([...code.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1])).toEqual(['./api.js']);
    expect(code.match(/['"`]\/api\/[^'"`]*['"`]/g)).toEqual(["'/api/feedback'"]);
    // One call, with one of two bodies: the three keys, or, about a video, those and video_id.
    expect(code.match(/postJson\(/g)).toHaveLength(1);
    expect(code).toMatch(
      /postJson\(\s*ENDPOINT,\s*video === null \? \{ page_id: pageId, message, turnstile_token: token \} : \{ page_id: pageId, video_id: video, message, turnstile_token: token \},?\s*\)/,
    );
    expect(FEEDBACK_KEYS).toEqual(['page_id', 'message', 'turnstile_token']);
    expect(FEEDBACK_VIDEO_KEY).toBe('video_id');
    expect([...new Set(code.match(/\b[a-z_]+_id\b/g))].sort()).toEqual(['page_id', 'video_id']);
  });

  it('writes the line for a video, and everything else it shows, as text', () => {
    expect(code).toMatch(/about\.textContent = video \? `\$\{MESSAGES\.ABOUT\}\$\{video\.title\}` : '';/);
    expect(code).toMatch(/about\.hidden = !video;/);
    expect(MESSAGES.ABOUT).toBe('About the video: ');
    // Never markup built from a title (the next test forbids innerHTML and its kin).
    expect(code.match(/\babout\.[a-zA-Z]+/g)).toEqual(['about.textContent', 'about.hidden']);
  });

  it('stores nothing, reports no usage event, logs nothing and styles nothing but the dialog\'s two fit properties', () => {
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|caches\./);
    expect(code).not.toMatch(/sendBeacon|XMLHttpRequest|sleepsteps:event|sleepsteps-|session_id|usage-prefs/);
    expect(code).not.toMatch(/console\./);
    // No style attribute (blocked by style-src 'self', SPEC §16.1), style
    // sheet or markup.
    expect(code).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|setAttribute\(\s*['"`]style|\[\s*['"`]style['"`]\s*\]|cssText|insertRule|adoptedStyleSheets|CSSStyleSheet|\.sheet\b|createElement\(\s*['"`](?:style|link)\b/);
    // The CSSOM only to set and remove the dialog's own two custom
    // properties, which style-src allows (SPEC §13, §16.1).
    expect(FIT_PROPERTIES).toEqual({ top: '--feedback-visible-top', height: '--feedback-visible-height' });
    expect(code.match(/--[a-z][\w-]*/g)).toEqual(['--feedback-visible-top', '--feedback-visible-height']);
    const uses = code.match(/[\w$.?]*\.style\b[^;\n]*/g) ?? [];
    expect(uses.map((use) => use.match(/^dialog\.style\.(setProperty|removeProperty)\(FIT_PROPERTIES\.(top|height)\b/)?.slice(1).join(' ') ?? use)).toEqual([
      'setProperty top',
      'setProperty height',
      'removeProperty top',
      'removeProperty height',
    ]);
  });

  it('never reads the address or puts the message anywhere but the request', () => {
    expect(code).not.toMatch(/location\.(search|href\b(?!\s*=)|hash|pathname)|URLSearchParams|history\./);
    expect(code).not.toMatch(/setAttribute\([^)]*message|dataset\.[a-z]+\s*=\s*message/i);
    expect(code).not.toMatch(/keepalive/);
  });

  it('uses no turnstile.ready(), global onload callback, cData or session-continuity-persist', () => {
    expect(code).not.toMatch(/\.ready\(|onloadTurnstile|window\.on[a-z]+\s*=|cData|session-continuity|preconnect|integrity/);
    expect(code).toMatch(/script\.async = true;/);
  });
});

describe('the dialog in print (SPEC §13 "Look")', () => {
  it('is hidden, with the header and footer, by site.css\'s print rule', () => {
    const css = readFileSync('src/css/site.css', 'utf8');
    const print = css.match(/@media print \{\n([\s\S]*?)\{\n\s*display: none;/)?.[1] ?? '';
    const selectors = print.split(',').map((s) => s.trim());
    for (const selector of ['.site-footer', '.feedback-dialog']) expect(selectors).toContain(selector);
  });
});

describe('the dialog above an on-screen keyboard (SPEC §13 "Look"; site.css)', () => {
  const css = readFileSync('src/css/site.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const [base, wide] = [...css.matchAll(/\n\s*\.feedback-dialog \{([^}]*)\}/g)].map((m) => m[1]);
  const { top, height } = FIT_PROPERTIES;

  it('fits the visible area from feedback.js\'s two properties, a gutter inside it, at every width', () => {
    expect(base).toContain(`--feedback-fit-top: calc(var(${top}) + var(--gutter));`);
    expect(base).toContain(`--feedback-fit-height: calc(var(${height}) - 2 * var(--gutter));`);
    expect(base).toContain('max-height: var(--feedback-fit-height, calc(100% - 2 * var(--gutter)));');
    expect(base).toContain('margin: var(--feedback-fit-top, var(--gutter)) auto auto;');
    expect(wide).toContain('max-height: var(--feedback-fit-height, calc(100% - 2 * var(--space-9)));');
    expect(wide).toContain('margin-top: var(--feedback-fit-top, var(--space-9));');
  });

  it('keeps a scroll that starts in the dialog inside it, and locks no scrolling (no scroll lock)', () => {
    expect(base).toMatch(/overflow-y: auto;[\s\S]*overscroll-behavior: contain;/);
    // A scroll lock in CSS would hide the page's overflow while a dialog is open.
    expect(css).not.toMatch(/:has\([^)]*(?:dialog|:modal)/);
  });

  it('puts Send and Cancel side by side on phones, each from 7rem, and at their own width from 600px', () => {
    const rules = [...css.matchAll(/\.feedback__actions \.button \{([^}]*)\}/g)].map((m) => m[1].replace(/\s+/g, ' ').trim());
    expect(rules).toEqual(['flex: 1 1 7rem; width: auto;', 'flex: 0 0 auto;']);
    expect(css).toMatch(/@media \(min-width: 37\.5em\) \{\s*\.feedback__actions \.button \{\s*flex: 0 0 auto;\s*\}\s*\}/);
  });

  it('is the only stylesheet that uses the two properties', () => {
    for (const rel of listFiles('src/css', (f) => f.endsWith('.css'))) {
      const found = new Set(readFileSync(`src/css/${rel}`, 'utf8').match(/--feedback-visible-[a-z]+/g));
      expect([...found].sort(), rel).toEqual(rel === 'site.css' ? [height, top] : []);
    }
  });
});

// ---- The site key and the render options -----------------------------------------

describe('the dialog\'s messages and the SPEC §13 table (decision A5)', () => {
  const section = spec.match(/\n## 13\. [\s\S]*?\n## 14\. /)[0];
  /** The §13 status-line table's row for `state`. */
  const row = (state) => {
    const line = section.split('\n').find((l) => l.trimStart().startsWith(`| ${state}`));
    expect(line, `the "${state}" row`).toBeTruthy();
    return line;
  };

  it.each([
    ['EMPTY', 'Blank message'],
    ['LIMIT', 'The text reaches 2,000 characters'],
    ['WAITING', 'No token yet'],
    ['SENDING', 'Sending'],
    ['THANKS', 'Success'],
    ['SEND_FAILED', 'Any other answer'],
    ['CHECK_FAILED', "The spam check isn't working"],
  ])('MESSAGES.%s is the wording in the "%s" row, word for word', (key, state) => {
    expect(row(state)).toContain(`"${MESSAGES[key]}"`);
  });

  it('gives the line for a video as §13 does: "About the video: " and the video\'s title', () => {
    expect(section).toContain(`"${MESSAGES.ABOUT}<title>"`);
    expect(MESSAGES.ABOUT.endsWith(': ')).toBe(true);
  });

  it('gives the Contact line and its link, and Close, as §13 does', () => {
    const [, label] = MESSAGES.CONTACT;
    expect(row('Any other answer')).toContain(`"${MESSAGES.CONTACT.join('')}", with "${label}" linking to \`/contact/\``);
    expect(row('Success')).toContain(`Cancel becomes "${MESSAGES.CLOSE}"`);
    expect(MESSAGES.CANCEL).toBe('Cancel');
  });
});

describe('chooseSitekey (decision A1; SPEC §11)', () => {
  it.each(['localhost', '127.0.0.1', '[::1]', 'LOCALHOST', 'feature-x-sleepsteps.team.workers.dev', 'a1b2c3d4-sleepsteps.team.workers.dev'])(
    'gives %s Cloudflare\'s always-pass test key, whatever is configured',
    (host) => {
      for (const configured of ['<PUBLIC_SITE_KEY>', REAL_KEY, undefined, '']) expect(chooseSitekey(host, configured)).toBe(TEST_SITEKEY);
    },
  );

  it.each(['sleepsteps.team.workers.dev', 'sleepsteps.example.org', 'www.example.org', 'x-sleepsteps.team.workers.dev.example.org', 'localhost.example.org', 'sleepsteps.test'])(
    'gives %s the configured key only when it is a real one',
    (host) => {
      expect(chooseSitekey(host, REAL_KEY)).toBe(REAL_KEY);
      for (const configured of ['<PUBLIC_SITE_KEY>', '', undefined, null, TEST_SITEKEY, '0x', '0x<b>', ' 0xabc']) {
        expect(chooseSitekey(host, configured), String(configured)).toBeNull();
      }
    },
  );

  it('uses Cloudflare\'s published always-pass, visible test key', () => {
    expect(TEST_SITEKEY).toBe('1x00000000000000000000AA');
  });
});

describe('renderOptions', () => {
  const calls = [];
  const on = Object.fromEntries(['token', 'expired', 'timeout', 'error', 'unsupported'].map((name) => [name, (...args) => calls.push([name, ...args])]));

  it('passes exactly these options to turnstile.render()', () => {
    const options = renderOptions(TEST_SITEKEY, 'compact', on);
    expect(Object.keys(options).sort()).toEqual(
      [
        'action',
        'appearance',
        'callback',
        'error-callback',
        'expired-callback',
        'feedback-enabled',
        'language',
        'response-field',
        'sitekey',
        'size',
        'theme',
        'timeout-callback',
        'unsupported-callback',
      ].sort(),
    );
    const values = { ...options };
    for (const key of Object.keys(values)) if (typeof values[key] === 'function') delete values[key];
    expect(values).toEqual({
      sitekey: TEST_SITEKEY,
      action: 'feedback',
      theme: 'light',
      language: 'en',
      size: 'compact',
      appearance: 'always',
      'response-field': false,
      'feedback-enabled': false,
    });
  });

  it('routes each callback, and the error callback returns true so Turnstile logs nothing', () => {
    const options = renderOptions(TEST_SITEKEY, 'normal', on);
    calls.length = 0;
    options.callback('t');
    options['expired-callback']();
    options['timeout-callback']();
    expect(options['error-callback']('110100')).toBe(true);
    options['unsupported-callback']();
    expect(calls).toEqual([['token', 't'], ['expired'], ['timeout'], ['error', '110100'], ['unsupported']]);
  });
});

// ---- feedback.js on the built pages -------------------------------------------------

/** A stand-in for Cloudflare's window.turnstile: records calls, renders an iframe. */
function fakeTurnstile() {
  const widgets = [];
  const calls = [];
  return {
    widgets,
    calls,
    render(container, options) {
      const id = `widget-${widgets.length + 1}`;
      calls.push(['render', id]);
      const frame = container.ownerDocument.createElement('iframe');
      container.append(frame);
      widgets.push({ id, container, options, frame, removed: false });
      return id;
    },
    reset(id) {
      calls.push(['reset', id]);
    },
    remove(id) {
      calls.push(['remove', id]);
      const widget = widgets.find((w) => w.id === id);
      if (widget) {
        widget.removed = true;
        widget.frame.remove();
      }
    },
    getResponse() {},
    isExpired() {
      return false;
    },
    /** The newest widget. */
    get last() {
      return widgets.at(-1);
    },
  };
}

describe('feedback.js in the browser (SPEC §11, §13)', () => {
  let dom;
  let requests; // every fetch: { url, init, body, answer(status), fail() }
  let mode; // 'manual' | number (answer at once with that status) | 'reject' | 'redirect' | 'missing'
  let events; // sleepsteps:event reports
  let storage;
  let turnstile;

  beforeEach(() => {
    for (const method of CONSOLE) vi.spyOn(console, method);
  });

  afterEach(() => {
    for (const method of CONSOLE) expect(console[method], `console.${method}`).not.toHaveBeenCalled();
    expect(events ?? []).toEqual([]);
    for (const store of storage ?? []) expect(store.length).toBe(0);
    vi.restoreAllMocks();
    vi.useRealTimers();
    dom?.restore();
    dom = undefined;
  });

  const fetchStub = (url, init) =>
    new Promise((resolve, reject) => {
      const request = {
        url,
        init,
        body: JSON.parse(init.body),
        answer: (status) => resolve({ ok: status >= 200 && status < 300, status }),
        fail: () => reject(new TypeError('Failed to fetch')),
      };
      init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      requests.push(request);
      if (typeof mode === 'number') request.answer(mode);
      // 'redirect': the API redirected to another site, as Cloudflare Access
      // does once a preview's session ends. The browser refuses to follow it
      // (connect-src 'self', and CORS without the CSP) and the fetch rejects
      // with "TypeError: Failed to fetch" (Chrome 157, M7).
      else if (mode === 'reject' || mode === 'redirect') request.fail();
    });

  /** The problem page with the dialog's site key set to `key` (as the build escapes it). */
  const withKey = (key) => pageAt(site, PROBLEM).replace(/data-sitekey="[^"]*"/, `data-sitekey="${key}"`);
  // site.config.json has the real key since 2026-11-10, so decision A1's
  // tests set the placeholder themselves.
  const PLACEHOLDER_KEY = '&lt;PUBLIC_SITE_KEY&gt;';

  /** Open a built page (or `html`) and run feedback.js on it, freshly imported. */
  async function open(url = PROBLEM, { answer = 204, html, hostname = 'localhost', dialog = true, layoutWidth, innerHeight, visualViewport, before } = {}) {
    dom?.restore();
    requests = [];
    events = [];
    mode = answer;
    storage = [new MemoryStorage(), new MemoryStorage()];
    turnstile = fakeTurnstile();
    dom = installDom(html ?? pageAt(site, url), {
      fetch: answer === 'missing' ? undefined : fetchStub,
      hostname,
      dialog,
      layoutWidth,
      innerHeight,
      visualViewport,
      localStorage: storage[0],
      sessionStorage: storage[1],
    });
    dom.document.addEventListener('sleepsteps:event', (event) => events.push(event.detail));
    before?.(dom);
    vi.resetModules();
    return import('../../src/js/feedback.js');
  }

  const settle = () => new Promise((resolve) => setImmediate(resolve));
  /** Wait for the message a dialog opens with, written REANNOUNCE_MS after opening. */
  const afterOpening = () => new Promise((resolve) => setTimeout(resolve, REANNOUNCE_MS + 20));
  /** Let the dialog's "close" event, which comes in a later task, arrive. */
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const $ = (selector) => dom.document.querySelector(selector);
  // The footer's "Send feedback": a page's last trigger, after its videos' buttons.
  const trigger = () => $('.site-footer [data-feedback-trigger]');
  /** The videos' "Feedback" buttons, in page order; and one by its video_id. */
  const videoButtons = () => dom.document.querySelectorAll('button[data-feedback-video]');
  const videoButton = (id) => $(`button[data-feedback-video="${id}"]`);
  /** The title of a video on the page, as its heading gives it. */
  const titleOf = (id) => dom.document.getElementById(`video-${id}-title`).textContent;
  const dialog = () => $('dialog');
  const title = () => $('#feedback-title');
  const about = () => $('[data-feedback-about]');
  const textarea = () => $('#feedback-message');
  const check = () => $('[data-feedback-check]');
  const send = () => $('[data-feedback-send]');
  const cancel = () => $('[data-feedback-cancel]');
  const status = () => $('[data-feedback-status]');
  const said = () => status().children.map((p) => p.textContent);
  const active = () => dom.document.activeElement;
  const turnstileScripts = () => dom.document.querySelectorAll('script').filter((s) => s.getAttribute('src') === TURNSTILE_URL);

  /** The visitor types `value` (maxlength cuts it, as browsers do). */
  function type(value) {
    textarea().value = value.slice(0, MAX_LENGTH);
    textarea().dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** Turnstile's script arrives: window.turnstile is set, then "load". */
  function loadTurnstile() {
    dom.window.turnstile = turnstile;
    turnstileScripts()[0].dispatchEvent(new Event('load'));
  }

  /** Open the dialog with the widget rendered and its token given. */
  async function ready(url, options) {
    await open(url, options);
    trigger().click();
    loadTurnstile();
    turnstile.last.options.callback(DUMMY_TOKEN);
  }

  // The problem page's videos, in page order: its own, then its solutions'.
  const VIDEOS = videosOf(pageAt(site, PROBLEM));
  const [FIRST, SECOND] = VIDEOS;

  /** The same, opened from the "Feedback" button of the video `id`. */
  async function readyFrom(id, url, options) {
    await open(url, options);
    videoButton(id).click();
    loadTurnstile();
    turnstile.last.options.callback(DUMMY_TOKEN);
  }

  /** Close the open dialog, then open it again from `opener` with a new widget's token. */
  async function reopenFrom(opener) {
    if (dialog().open) {
      dialog().close();
      await tick();
    }
    opener.click();
    turnstile.last.options.callback(DUMMY_TOKEN);
  }

  describe('on load', () => {
    it('swaps the link for a button that looks the same, and unhides the closed dialog, contacting nobody', async () => {
      await open();
      const button = trigger();
      expect(button.localName).toBe('button');
      expect([button.getAttribute('type'), button.className, button.textContent]).toEqual(['button', 'site-footer__feedback', 'Send feedback']);
      expect(button.parentElement.localName).toBe('li');
      expect(button.closest('footer')).toBeTruthy();
      expect(dom.document.querySelectorAll('a[data-feedback-trigger]')).toEqual([]);
      expect([dialog().hidden, dialog().open]).toEqual([false, false]);
      expect(dialog().getClientRects()).toEqual([]);
      expect(status().getAttribute('role')).toBe('status');
      expect(said()).toEqual([]);
      expect(turnstileScripts()).toEqual([]);
      expect(dom.window.turnstile).toBeUndefined();
      expect(requests).toEqual([]);
    });

    it('shows each video\'s "Feedback" button, as it shipped but for `hidden`, and leaves the line for a video empty and hidden', async () => {
      const shipped = pageAt(site, PROBLEM);
      expect(tags(shipped, 'button').filter((b) => attr(b, 'data-feedback-video') !== undefined).every((b) => attr(b, 'hidden') === '')).toBe(true);
      await open();
      expect(VIDEOS.length).toBeGreaterThan(3);
      expect(videoButtons().map((b) => [b.getAttribute('data-feedback-video'), b.hidden])).toEqual(VIDEOS.map((id) => [id, false]));
      for (const button of videoButtons()) {
        expect([button.localName, button.getAttribute('type'), button.className]).toEqual(['button', 'button', 'format-button']);
        expect(button.parentElement.className).toBe('video-controls');
        expect(button.hasAttribute('data-feedback-trigger')).toBe(true);
        expect(button.textContent.replace(/\s+/g, ' ')).toBe(`Feedback: ${titleOf(button.getAttribute('data-feedback-video'))}`);
        // Its only attributes: nothing is added but the missing `hidden`.
        expect([...button.attributes.keys()].sort()).toEqual(['class', 'data-feedback-trigger', 'data-feedback-video', 'type']);
      }
      expect([about().hidden, about().textContent, dialog().open]).toEqual([true, '', false]);
      expect(turnstileScripts()).toEqual([]);
      expect(requests).toEqual([]);
    });

    it('shows the buttons on Start here too, and none where there is no video', async () => {
      await open('/start/');
      const chapters = videosOf(pageAt(site, '/start/'));
      expect(chapters.length).toBeGreaterThan(1);
      expect(videoButtons().map((b) => [b.getAttribute('data-feedback-video'), b.hidden])).toEqual(chapters.map((id) => [id, false]));
      for (const url of ['/', '/problems/', '/search/', '/contact/']) {
        await open(url);
        expect(videoButtons(), url).toEqual([]);
        expect(trigger().localName, url).toBe('button');
      }
    });

    it('leaves hidden a button that can\'t name its video: no title heading, an empty heading, or a video_id that isn\'t one', async () => {
      const page = pageAt(site, PROBLEM);
      const heading = (id) => new RegExp(`(<h[23] class="video-block__title" id="video-${id}-title"[^>]*>)[^<]*(</h[23]>)`);
      const html = page
        .replace(heading(VIDEOS[0]), '$1 \n $2')
        .replace(` id="video-${VIDEOS[1]}-title"`, ` id="video-${VIDEOS[1]}-heading"`)
        .replace(`data-feedback-video="${VIDEOS[2]}"`, 'data-feedback-video="Not A Slug"');
      expect(html).not.toBe(page);
      await open(PROBLEM, { html });
      expect(videoButtons().map((b) => b.hidden)).toEqual(VIDEOS.map((_, i) => i < 3));
      // A hidden one opens nothing; the others and the footer's still work.
      for (const button of videoButtons().slice(0, 3)) button.click();
      expect(dialog().open).toBe(false);
      videoButtons()[3].click();
      expect([dialog().open, about().textContent]).toEqual([true, `${MESSAGES.ABOUT}${titleOf(VIDEOS[3])}`]);
      expect(trigger().localName).toBe('button');
    });

    it('keeps focus on "Send feedback" if the link had it', async () => {
      await open(PROBLEM, { before: (d) => d.document.querySelector('a[data-feedback-trigger]').focus() });
      expect(active()).toBe(trigger());
    });

    it.each([
      ['without a data-page-id', { before: (d) => d.document.body.removeAttribute('data-page-id') }],
      ['without <dialog> support', { dialog: false }],
      ['without the dialog\'s markup', { html: pageAt(site, PROBLEM).replace(/<dialog[\s\S]*<\/dialog>/, '') }],
      ['when the dialog lacks its status line', { html: pageAt(site, PROBLEM).replace(/<div class="feedback__status"[^>]*><\/div>/, '') }],
      ['when the dialog lacks its line for a video', { html: pageAt(site, PROBLEM).replace(/<p class="feedback__about"[^>]*><\/p>/, '') }],
      ['without the footer\'s link', { html: pageAt(site, PROBLEM).replace(/<li><a class="site-footer__feedback"[^>]*>[^<]*<\/a><\/li>/, '') }],
    ])('leaves the link to the Contact page, the dialog hidden and every video\'s "Feedback" button hidden %s', async (name, options) => {
      const { init } = await open(PROBLEM, options);
      expect(init()).toBe(false);
      // The link is there in every case but the last, which took it away.
      expect(trigger() === null).toBe(name === "without the footer's link");
      if (trigger()) {
        expect(trigger().localName).toBe('a');
        expect(trigger().getAttribute('href')).toBe('/contact/');
      }
      if (dialog()) expect(dialog().hidden).toBe(true);
      // As without JavaScript: no video has a "Feedback" button to press.
      expect(videoButtons()).toHaveLength(VIDEOS.length);
      for (const button of videoButtons()) {
        expect(button.hidden).toBe(true);
        expect(button.getClientRects()).toEqual([]);
        button.click();
      }
      if (dialog()) expect(dialog().hasAttribute('open')).toBe(false);
      expect(turnstileScripts()).toEqual([]);
    });

    it('leaves the 404 page\'s link alone', async () => {
      const { init } = await open('/404.html');
      expect(trigger().localName).toBe('a');
      expect(init()).toBe(false);
    });

    it('works on every kind of page with the dialog, the search page included (decision A4)', async () => {
      for (const url of ['/', '/search/', '/start/', '/privacy/']) {
        await open(url);
        expect(trigger().localName, url).toBe('button');
        dom.restore();
        dom = undefined;
      }
    });
  });

  describe('opening', () => {
    it('opens as a modal dialog with focus on its heading, and only then loads Turnstile, once', async () => {
      await open();
      const before = dom.document.querySelectorAll('script');
      expect(turnstileScripts()).toEqual([]);
      trigger().focus();
      trigger().click();
      expect([dialog().open, dialog().modal]).toEqual([true, true]);
      expect(active()).toBe(title());
      const scripts = dom.document.querySelectorAll('script').filter((s) => !before.includes(s));
      expect(scripts).toHaveLength(1);
      expect(scripts[0].parentElement).toBe(dom.document.head);
      expect([scripts[0].getAttribute('src'), scripts[0].async]).toEqual([TURNSTILE_URL, true]);
      expect(scripts[0].hasAttribute('integrity') || scripts[0].hasAttribute('crossorigin')).toBe(false);
      expect(said()).toEqual([]);
      expect(requests).toEqual([]);
    });

    it('renders the widget into its box when the script loads, with the test key on a local host', async () => {
      await open();
      trigger().click();
      expect(turnstile.calls).toEqual([]);
      loadTurnstile();
      expect(turnstile.calls).toEqual([['render', 'widget-1']]);
      const { container, options } = turnstile.last;
      expect(container).toBe(check());
      expect([options.sitekey, options.size, options.action]).toEqual([TEST_SITEKEY, 'normal', 'feedback']);
      expect(check().hidden).toBe(false);
      expect(Object.keys(options).sort()).toEqual(Object.keys(renderOptions('k', 'normal', {})).sort());
      expect(check().dataset.size).toBe('normal');
    });

    it('uses the compact widget, and reserves its height, when the box is narrower than 300px', async () => {
      await open(PROBLEM, { layoutWidth: NORMAL_WIDTH - 1 });
      trigger().click();
      expect(check().dataset.size).toBe('compact');
      loadTurnstile();
      expect(turnstile.last.options.size).toBe('compact');
    });

    it.each([
      ['a preview', 'pr-12-sleepsteps.team.workers.dev', PLACEHOLDER_KEY, TEST_SITEKEY],
      ['production, with a real key', 'sleepsteps.org', REAL_KEY, REAL_KEY],
    ])('on %s host, renders with the right key', async (name, hostname, key, expected) => {
      await open(PROBLEM, { html: withKey(key), hostname });
      trigger().click();
      loadTurnstile();
      expect(turnstile.last.options.sitekey).toBe(expected);
    });

    it('renders a new widget on each open and removes it on each close, loading the script only once', async () => {
      await open();
      trigger().click();
      loadTurnstile();
      dialog().close();
      await tick();
      expect(turnstile.calls).toEqual([['render', 'widget-1'], ['remove', 'widget-1']]);
      expect(check().children).toEqual([]);
      trigger().click();
      expect(turnstile.calls.at(-1)).toEqual(['render', 'widget-2']);
      expect(turnstileScripts()).toHaveLength(1);
    });

    it('waits for the script if the dialog is closed before it loads, and renders on the next open', async () => {
      await open();
      trigger().click();
      dialog().close();
      await tick();
      loadTurnstile();
      expect(turnstile.calls).toEqual([]);
      trigger().click();
      expect(turnstile.calls).toEqual([['render', 'widget-1']]);
    });

    it('goes to the Contact page if the dialog can\'t open', async () => {
      await open();
      dialog().remove();
      trigger().click();
      expect(dom.window.location.href).toBe('/contact/');
      expect(turnstileScripts()).toEqual([]);
    });
  });

  describe('with no usable site key (decision A1: the dialog shows anyway)', () => {
    it.each(['sleepsteps.team.workers.dev', 'sleepsteps.example.org'])(
      'on %s, offers only Close and the Contact page, says why once open, and loads nothing from Cloudflare',
      async (hostname) => {
        await open(PROBLEM, { hostname, html: withKey(PLACEHOLDER_KEY) });
        expect(trigger().localName).toBe('button');
        // Nothing to write in and nothing to send, so nobody writes a message
        // that can't go; the status line comes straight after Close.
        expect([$('[data-feedback-field]').hidden, check().hidden, send().hidden, cancel().hidden]).toEqual([true, true, true, false]);
        expect(cancel().textContent).toBe(MESSAGES.CLOSE);
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        trigger().click();
        expect(dialog().open).toBe(true);
        expect(active()).toBe(title());
        // Written once the live region is in the accessibility tree, so it is announced.
        expect(said()).toEqual([]);
        await vi.advanceTimersByTimeAsync(REANNOUNCE_MS);
        expect(said()).toEqual([MESSAGES.CHECK_FAILED, CONTACT_LINE]);
        expect(status().querySelector('a').getAttribute('href')).toBe('/contact/');
        expect(turnstileScripts()).toEqual([]);
        $('form').requestSubmit();
        await vi.advanceTimersByTimeAsync(REANNOUNCE_MS);
        expect(requests).toEqual([]);
        expect(said()).toEqual([MESSAGES.CHECK_FAILED, CONTACT_LINE]);
        // Close closes, and stays "Close"; reopening says it again.
        cancel().click();
        await vi.advanceTimersByTimeAsync(0);
        expect([dialog().open, active(), cancel().textContent, said()]).toEqual([false, trigger(), MESSAGES.CLOSE, []]);
        trigger().click();
        expect(said()).toEqual([]);
        await vi.advanceTimersByTimeAsync(REANNOUNCE_MS);
        expect(said()).toEqual([MESSAGES.CHECK_FAILED, CONTACT_LINE]);
        expect(turnstileScripts()).toEqual([]);
      },
    );
  });

  describe('when Turnstile fails', () => {
    it('says so when its script fails to load, and sends nothing', async () => {
      await open();
      trigger().click();
      turnstileScripts()[0].dispatchEvent(new Event('error'));
      expect(said()).toEqual([MESSAGES.CHECK_FAILED, CONTACT_LINE]);
      type('Hello');
      send().click();
      await settle();
      expect(requests).toEqual([]);
      // Closing clears the line; reopening says it again, and adds no second script.
      dialog().close();
      await tick();
      expect(said()).toEqual([]);
      trigger().click();
      expect(said()).toEqual([]);
      await afterOpening();
      expect(said()).toEqual([MESSAGES.CHECK_FAILED, CONTACT_LINE]);
      expect(turnstileScripts()).toHaveLength(1);
    });

    it('says so when the script loads without the API', async () => {
      await open();
      trigger().click();
      turnstileScripts()[0].dispatchEvent(new Event('load'));
      expect(said()).toEqual([MESSAGES.CHECK_FAILED, CONTACT_LINE]);
    });

    it(`says so after ${LOAD_TIMEOUT_MS / 1000} seconds without the script, and recovers if it loads later`, async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await open();
      trigger().click();
      await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
      expect(said()).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(said()).toEqual([MESSAGES.CHECK_FAILED, CONTACT_LINE]);
      loadTurnstile();
      expect(said()).toEqual([]);
      expect(turnstile.calls).toEqual([['render', 'widget-1']]);
      turnstile.last.options.callback(DUMMY_TOKEN);
      type('Hello');
      send().click();
      expect(requests).toHaveLength(1);
    });

    it('says so on the widget\'s error callback, which returns true, until a token arrives', async () => {
      await open();
      trigger().click();
      loadTurnstile();
      expect(turnstile.last.options['error-callback']('300010')).toBe(true);
      expect(said()).toEqual([MESSAGES.CHECK_FAILED, CONTACT_LINE]);
      type('Hello');
      send().click();
      expect(requests).toEqual([]);
      turnstile.last.options.callback(DUMMY_TOKEN);
      expect(said()).toEqual([]);
      send().click();
      expect(requests).toHaveLength(1);
    });

    it('says so when the browser is unsupported, or render() throws', async () => {
      await open();
      trigger().click();
      loadTurnstile();
      turnstile.last.options['unsupported-callback']();
      expect(said()).toEqual([MESSAGES.CHECK_FAILED, CONTACT_LINE]);

      await open();
      turnstile.render = () => {
        throw new Error('Invalid sitekey');
      };
      trigger().click();
      loadTurnstile();
      expect(said()).toEqual([MESSAGES.CHECK_FAILED, CONTACT_LINE]);
    });

    it('ignores callbacks from a widget that was removed', async () => {
      await open();
      trigger().click();
      loadTurnstile();
      const old = turnstile.last.options;
      dialog().close();
      await tick();
      old.callback(DUMMY_TOKEN);
      old['error-callback']('300010');
      trigger().click();
      expect(said()).toEqual([]);
      type('Hello');
      send().click();
      expect(said()).toEqual([MESSAGES.WAITING]);
      expect(requests).toEqual([]);
    });
  });

  describe('Send, before sending', () => {
    it('says a blank message needs writing, marks the field invalid and focuses it, until the next input', async () => {
      await ready();
      type('  \n\t ');
      send().focus();
      send().click();
      expect(dialog().open).toBe(true);
      expect(said()).toEqual([MESSAGES.EMPTY]);
      expect(textarea().getAttribute('aria-invalid')).toBe('true');
      expect(textarea().getAttribute('aria-describedby')).toBe('feedback-hint feedback-status');
      expect(active()).toBe(textarea());
      expect(requests).toEqual([]);
      type('H');
      expect(textarea().hasAttribute('aria-invalid')).toBe(false);
      expect(textarea().getAttribute('aria-describedby')).toBe('feedback-hint');
      expect(said()).toEqual([]);
    });

    it('says the spam check is still running when there is no token yet', async () => {
      await open();
      trigger().click();
      type('Hello');
      send().click();
      expect(said()).toEqual([MESSAGES.WAITING]);
      // The script loading is no token yet.
      loadTurnstile();
      expect(said()).toEqual([MESSAGES.WAITING]);
      expect(requests).toEqual([]);
      turnstile.last.options.callback(DUMMY_TOKEN);
      expect(said()).toEqual([]);
      send().click();
      expect(requests).toHaveLength(1);
    });

    it('drops an expired or timed-out token', async () => {
      for (const callback of ['expired-callback', 'timeout-callback']) {
        await ready();
        turnstile.last.options[callback]();
        type('Hello');
        send().click();
        expect(said(), callback).toEqual([MESSAGES.WAITING]);
        expect(requests).toEqual([]);
      }
    });

    it('says once each time the 2,000-character limit is reached', async () => {
      await ready();
      type('a'.repeat(MAX_LENGTH - 1));
      expect(said()).toEqual([]);
      type('a'.repeat(MAX_LENGTH + 500)); // a long paste, cut to the limit
      expect(textarea().value).toHaveLength(MAX_LENGTH);
      expect(said()).toEqual([MESSAGES.LIMIT]);
      // Still at the limit: not said again (a repeat would clear the line first).
      type('b'.repeat(MAX_LENGTH));
      expect(said()).toEqual([MESSAGES.LIMIT]);
      // Below it and back: said again.
      type('b'.repeat(MAX_LENGTH - 1));
      type('b'.repeat(MAX_LENGTH));
      expect(said()).toEqual([]);
      await new Promise((resolve) => setTimeout(resolve, REANNOUNCE_MS + 20));
      expect(said()).toEqual([MESSAGES.LIMIT]);
    });

    it('refuses a message over the limit if one gets past maxlength', async () => {
      await ready();
      textarea().value = 'a'.repeat(MAX_LENGTH + 1);
      send().click();
      expect(said()).toEqual([MESSAGES.LIMIT]);
      expect(requests).toEqual([]);
    });

    it('says a repeated message again, after a pause', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await open();
      trigger().click();
      type('Hello');
      send().click();
      expect(said()).toEqual([MESSAGES.WAITING]);
      send().click();
      expect(said()).toEqual([]);
      await vi.advanceTimersByTimeAsync(REANNOUNCE_MS);
      expect(said()).toEqual([MESSAGES.WAITING]);
    });
  });

  describe('sending', () => {
    it('POSTs exactly page_id, message and the token, once, and the Worker\'s own check accepts it', async () => {
      await ready(PROBLEM, { answer: 'manual' });
      const message = '  It helped.\r\nThanks — a lot  ';
      type(message);
      send().focus();
      send().click();
      expect(dialog().open).toBe(true);
      expect(requests).toHaveLength(1);
      const [request] = requests;
      expect(request.url).toBe('/api/feedback');
      expect([request.init.method, request.init.headers, request.init.keepalive]).toEqual(['POST', { 'Content-Type': 'application/json' }, false]);
      expect(Object.keys(request.body)).toEqual(FEEDBACK_KEYS);
      expect(request.body).toEqual({ page_id: 'tired-but-wired', message, turnstile_token: DUMMY_TOKEN });
      // From the footer: no video_id key at all (not null), so the Worker stores no video.
      expect(JSON.parse(request.init.body)).not.toHaveProperty(FEEDBACK_VIDEO_KEY);
      expect(request.init.body).not.toContain('video');
      const checked = validateFeedback(request.body, index);
      expect(checked.row).toEqual({ page: 'tired-but-wired', video: null, message: cleanMessage(message) });
      expect(checked.token).toBe(DUMMY_TOKEN);
      // While it is in flight.
      expect(said()).toEqual([MESSAGES.SENDING]);
      expect([send().getAttribute('aria-disabled'), send().disabled, textarea().readOnly]).toEqual(['true', false, true]);
      expect(active()).toBe(send());
      // One request at a time.
      send().click();
      $('form').requestSubmit();
      expect(requests).toHaveLength(1);
      request.answer(204);
      await settle();
    });

    it('sends the body the Worker accepts from every page with the dialog', async () => {
      for (const { file, html } of readHtmlPages(site).filter((p) => dialogOf(p.html))) {
        await open(null, { html });
        trigger().click();
        loadTurnstile();
        turnstile.last.options.callback(DUMMY_TOKEN);
        type('Feedback');
        send().click();
        expect(validateFeedback(requests[0].body, index).row?.page, file).toBe(pageIdOf(html));
        // The footer's "Send feedback" is general feedback, on a page with videos too.
        expect(Object.keys(requests[0].body), file).toEqual(FEEDBACK_KEYS);
        expect(validateFeedback(requests[0].body, index).row.video, file).toBeNull();
        expect([about().hidden, about().textContent], file).toEqual([true, '']);
        await settle();
        dom.restore();
        dom = undefined;
      }
    });

    it('thanks the visitor, clears the message and offers Close, keeping the dialog open and focus where it was (decision A2 = B)', async () => {
      await ready();
      type('Hello');
      send().focus();
      send().click();
      await settle();
      expect(dialog().open).toBe(true);
      expect(said()).toEqual([MESSAGES.THANKS]);
      expect(MESSAGES.THANKS).toBe('Thanks — your feedback has been sent');
      expect(textarea().value).toBe('');
      expect(cancel().textContent).toBe('Close');
      expect(active()).toBe(send());
      expect([send().hasAttribute('aria-disabled'), textarea().readOnly]).toEqual([false, false]);
      // The token is spent: the widget gets a new one.
      expect(turnstile.calls).toEqual([['render', 'widget-1'], ['reset', 'widget-1']]);
      type('Again');
      send().click();
      expect(said()).toEqual([MESSAGES.WAITING]);
      expect(requests).toHaveLength(1);
      turnstile.last.options.callback('second-token');
      send().click();
      expect(requests.map((r) => r.body.turnstile_token)).toEqual([DUMMY_TOKEN, 'second-token']);
      await settle();
      // Closing puts back "Cancel".
      cancel().click();
      await tick();
      expect(cancel().textContent).toBe('Cancel');
    });

    it.each([
      ['403 (Turnstile refused)', 403],
      ['404 (collection off, as in previews)', 404],
      ['429', 429],
      ['500', 500],
      ['a network error', 'reject'],
      ['a redirect to the Access sign-in on another site (a preview whose session ended)', 'redirect'],
      ['a 302 with no Location, which fetch returns as it is', 302],
      ['no fetch', 'missing'],
    ])('on %s, says it couldn\'t send, offers the Contact page and keeps the text', async (name, answer) => {
      await ready(PROBLEM, { answer });
      type('Keep me');
      send().click();
      await settle();
      expect(said()).toEqual([SEND_FAILED, CONTACT_LINE]);
      expect(status().querySelector('a').getAttribute('href')).toBe('/contact/');
      expect(textarea().value).toBe('Keep me');
      expect(cancel().textContent).toBe('Cancel');
      expect([send().hasAttribute('aria-disabled'), textarea().readOnly]).toEqual([false, false]);
      expect(turnstile.calls.at(-1)).toEqual(['reset', 'widget-1']);
      // The spent token isn't sent again.
      send().click();
      expect(said()).toEqual([MESSAGES.WAITING]);
    });

    it(`says it couldn't send when there is no answer within ${TIMEOUT_MS / 1000} seconds`, async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await ready(PROBLEM, { answer: 'manual' });
      type('Hello');
      send().click();
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
      expect(said()).toEqual([SEND_FAILED, CONTACT_LINE]);
      expect(textarea().value).toBe('Hello');
    });

    it('applies an answer that comes after the dialog closed, and shows it when it reopens', async () => {
      await ready(PROBLEM, { answer: 'manual' });
      type('Hello');
      send().click();
      pressEscape(dom.document);
      await tick();
      expect(turnstile.calls.at(-1)).toEqual(['remove', 'widget-1']);
      requests[0].answer(204);
      await settle();
      // The removed widget isn't reset.
      expect(turnstile.calls.filter(([call]) => call === 'reset')).toEqual([]);
      trigger().click();
      // Cleared, then written once the reopened dialog's live region can announce it.
      expect(said()).toEqual([]);
      await afterOpening();
      expect(said()).toEqual([MESSAGES.THANKS]);
      expect([textarea().value, cancel().textContent]).toEqual(['', 'Close']);
      // Only once.
      cancel().click();
      await tick();
      trigger().click();
      expect(said()).toEqual([]);
    });

    it('keeps "Sending…" when reopened while the request is in flight', async () => {
      await ready(PROBLEM, { answer: 'manual' });
      type('Hello');
      send().click();
      cancel().click();
      await tick();
      trigger().click();
      expect(said()).toEqual([]);
      await afterOpening();
      expect(said()).toEqual([MESSAGES.SENDING]);
      expect(textarea().readOnly).toBe(true);
      requests[0].answer(500);
      await settle();
      expect(said()).toEqual([SEND_FAILED, CONTACT_LINE]);
      // The new widget's token wasn't the one spent.
      expect(turnstile.calls.filter(([call]) => call === 'reset')).toEqual([]);
    });

    it('shows an answer that comes just after reopening, not the message the dialog reopened with', async () => {
      await ready(PROBLEM, { answer: 'manual' });
      type('Hello');
      send().click();
      cancel().click();
      await tick();
      trigger().click();
      requests[0].answer(204);
      await settle();
      expect(said()).toEqual([MESSAGES.THANKS]);
      await afterOpening();
      expect(said()).toEqual([MESSAGES.THANKS]);
    });
  });

  describe('keeping the status line in view', () => {
    it('scrolls it into view for Send\'s answers only, never on opening or while the visitor reads', async () => {
      await open();
      const reveals = [];
      status().scrollIntoView = (options) => reveals.push([said()[0], options]);
      trigger().click();
      turnstileScripts()[0].dispatchEvent(new Event('error'));
      expect(said()).toEqual([MESSAGES.CHECK_FAILED, CONTACT_LINE]);
      // Reopening with the check still failed says so again, without scrolling.
      dialog().close();
      await tick();
      trigger().click();
      await afterOpening();
      expect(said()).toEqual([MESSAGES.CHECK_FAILED, CONTACT_LINE]);
      expect(reveals).toEqual([]);
      send().click();
      await afterOpening();
      expect(reveals).toEqual([[MESSAGES.EMPTY, { block: 'nearest' }]]);

      await ready(PROBLEM, { answer: 'manual' });
      reveals.length = 0;
      status().scrollIntoView = (options) => reveals.push([said()[0], options]);
      turnstile.last.options['error-callback']('300010');
      turnstile.last.options.callback(DUMMY_TOKEN);
      type('a'.repeat(MAX_LENGTH));
      expect(said()).toEqual([MESSAGES.LIMIT]);
      expect(reveals).toEqual([]);
      send().click();
      requests[0].answer(204);
      await settle();
      expect(reveals.map(([message]) => message)).toEqual([MESSAGES.SENDING, MESSAGES.THANKS]);
    });
  });

  // An on-screen keyboard shrinks only the visual viewport (iOS Safari, and
  // Chrome on Android by default), so the dialog, fixed to the layout
  // viewport, would keep Turnstile's box, Send, Cancel and the status line
  // behind it. Sizes from a 390x664 phone screen in Safari, with 328px left
  // above the keyboard.
  describe('above an on-screen keyboard (SPEC §13 "Look")', () => {
    const SCREEN = 664;
    const ABOVE_KEYBOARD = 328;
    /** The dialog's two fit properties, '' while unset. */
    const fitted = () => [FIT_PROPERTIES.top, FIT_PROPERTIES.height].map((name) => dialog().style.getPropertyValue(name));
    /** A built page on a phone with a visual viewport; returns that viewport. */
    async function onPhone(options = {}) {
      const viewport = new VisualViewport({ height: SCREEN });
      await open(PROBLEM, { innerHeight: SCREEN, visualViewport: viewport, ...options });
      return viewport;
    }

    it('fits the dialog to the visible area while the keyboard is open, follows it as it pans, and writes only changes', async () => {
      const viewport = await onPhone();
      trigger().click();
      expect(fitted()).toEqual(['', '']);
      const set = vi.spyOn(dialog().style, 'setProperty');
      textarea().focus();
      viewport.change({ height: ABOVE_KEYBOARD });
      expect(fitted()).toEqual(['0px', `${ABOVE_KEYBOARD}px`]);
      // Safari pans the visual viewport to the field: the dialog follows.
      viewport.change({ offsetTop: 120 });
      expect(fitted()).toEqual(['120px', `${ABOVE_KEYBOARD}px`]);
      expect(set).toHaveBeenCalledTimes(3);
      // Fractions round to the same whole pixels: nothing is written.
      viewport.change({ height: ABOVE_KEYBOARD - 0.4, offsetTop: 120.3 });
      expect(set).toHaveBeenCalledTimes(3);
      // The keyboard closes: the dialog goes back to its usual place.
      viewport.change({ height: SCREEN, offsetTop: 0 });
      expect(fitted()).toEqual(['', '']);
      expect(dialog().style.length).toBe(0);
      expect(dialog().open).toBe(true);
    });

    it('removes the fit and its listeners on closing, and fits at once on reopening above an open keyboard', async () => {
      const viewport = await onPhone();
      expect(viewport.listenerCount).toBe(0);
      trigger().click();
      expect(viewport.listenerCount).toBe(2);
      viewport.change({ height: ABOVE_KEYBOARD });
      expect(fitted()).toEqual(['0px', `${ABOVE_KEYBOARD}px`]);
      pressEscape(dom.document);
      await tick();
      expect([dialog().open, viewport.listenerCount, dialog().style.length]).toEqual([false, 0, 0]);
      // Closed, nothing follows the keyboard.
      viewport.change({ height: 300, offsetTop: 40 });
      expect(dialog().style.length).toBe(0);
      trigger().click();
      expect(viewport.listenerCount).toBe(2);
      expect(fitted()).toEqual(['40px', '300px']);
      cancel().click();
      await tick();
      expect([viewport.listenerCount, dialog().style.length]).toEqual([0, 0]);
      // A dialog that can't open follows nothing.
      dialog().remove();
      trigger().click();
      expect(dom.window.location.href).toBe('/contact/');
      expect(viewport.listenerCount).toBe(0);
    });

    it('leaves the dialog where it is while pinch-zoomed, or when the visual viewport is full height', async () => {
      const viewport = await onPhone();
      trigger().click();
      textarea().focus();
      // Zoomed in, the visual viewport is smaller, keyboard or not: nothing
      // is fitted, so a reader pans the magnified page as before.
      viewport.change({ scale: 2, height: SCREEN / 2, offsetTop: 200 });
      expect(fitted()).toEqual(['', '']);
      viewport.change({ height: ABOVE_KEYBOARD / 2 });
      expect(fitted()).toEqual(['', '']);
      // Back to no zoom with the keyboard open: fitted.
      viewport.change({ scale: 1, height: ABOVE_KEYBOARD, offsetTop: 0 });
      expect(fitted()).toEqual(['0px', `${ABOVE_KEYBOARD}px`]);
      // Zooming in again removes the fit; a scale within rounding of 1 isn't zoom.
      viewport.change({ scale: 1.5, height: ABOVE_KEYBOARD / 1.5 });
      expect(fitted()).toEqual(['', '']);
      viewport.change({ scale: 1.004, height: ABOVE_KEYBOARD });
      expect(fitted()).toEqual(['0px', `${ABOVE_KEYBOARD}px`]);
      // Full height, taller than innerHeight, or short of it only by
      // innerHeight's rounding to whole px (Chrome at 125% display scaling,
      // no keyboard: 705.6 against 706): no keyboard.
      for (const height of [SCREEN, SCREEN + 40, SCREEN - 0.4, SCREEN - 0.6, SCREEN - 1]) {
        viewport.change({ scale: 1, height });
        expect(fitted(), String(height)).toEqual(['', '']);
      }
      expect(dialog().style.length).toBe(0);
      // Anything more is a keyboard, or a shortcut bar.
      viewport.change({ height: SCREEN - 2 });
      expect(fitted()).toEqual(['0px', `${SCREEN - 2}px`]);
    });

    it('keeps the focused textarea in view by scrolling the dialog, never the page', async () => {
      const viewport = await onPhone();
      trigger().click();
      // A small layout: the dialog where site.css puts it (a 16px gutter,
      // fitted or not, and 900px of content), its 1px border, and the
      // textarea (194px tall) 300px down its content.
      const d = dialog();
      const px = (name, unset) => Number.parseFloat(d.style.getPropertyValue(name) || unset);
      const box = () => {
        const top = px(FIT_PROPERTIES.top, 0) + 16;
        const height = Math.min(900, px(FIT_PROPERTIES.height, SCREEN) - 32);
        return { top, height, bottom: top + height };
      };
      d.getBoundingClientRect = box;
      d.clientTop = 1;
      Object.defineProperty(d, 'clientHeight', { configurable: true, get: () => box().height - 2 });
      const field = textarea();
      field.getBoundingClientRect = () => {
        const top = box().top + 1 + 300 - d.scrollTop;
        return { top, bottom: top + 194 };
      };
      const pageScrolls = [];
      dom.window.scrollTo = dom.window.scrollBy = (...args) => pageScrolls.push(args);
      field.scrollIntoView = (...args) => pageScrolls.push(args);
      field.focus();
      expect(field.getBoundingClientRect()).toEqual({ top: 317, bottom: 511 });
      // The keyboard leaves 328px: the dialog's inside is 17 to 311, so the
      // textarea's bottom is brought up to FIT_MARGIN above that.
      viewport.change({ height: ABOVE_KEYBOARD });
      expect(d.scrollTop).toBe(208);
      expect(field.getBoundingClientRect()).toEqual({ top: 109, bottom: 311 - FIT_MARGIN });
      // Panning moves the dialog and the textarea together: no scrolling.
      viewport.change({ offsetTop: 120 });
      expect(d.scrollTop).toBe(208);
      // A taller keyboard (its suggestion bar) shrinks the dialog again.
      viewport.change({ height: 280 });
      expect(d.scrollTop).toBe(256);
      expect(field.getBoundingClientRect().bottom).toBe(box().bottom - 1 - FIT_MARGIN);
      // Shorter than the textarea: its top stays in view.
      viewport.change({ height: 200 });
      expect(field.getBoundingClientRect().top).toBe(box().top + 1 + FIT_MARGIN);
      // A taller dialog doesn't scroll.
      const before = d.scrollTop;
      viewport.change({ height: 300 });
      expect(d.scrollTop).toBe(before);
      // Focus outside the textarea (here the heading, in view) moves nothing either.
      title().getBoundingClientRect = () => ({ top: box().top + 20, bottom: box().top + 52 });
      title().focus();
      viewport.change({ height: 250 });
      expect(d.scrollTop).toBe(before);
      expect(pageScrolls).toEqual([]);
    });

    it('changes nothing without window.visualViewport (browsers older than the API)', async () => {
      await open(PROBLEM, { innerHeight: SCREEN });
      expect(dom.window.visualViewport).toBeUndefined();
      trigger().click();
      loadTurnstile();
      textarea().focus();
      type('Hello');
      expect([dialog().open, dialog().style.length, dialog().scrollTop]).toEqual([true, 0, 0]);
      cancel().click();
      await tick();
      expect([dialog().open, dialog().style.length, active()]).toEqual([false, 0, trigger()]);
    });

    it('leaves the A1 layout as it is: no field, box or Send, and Close above the spam-check message', async () => {
      const viewport = await onPhone({ hostname: 'sleepsteps.example.org', html: withKey(PLACEHOLDER_KEY) });
      const hidden = () => [$('[data-feedback-field]').hidden, check().hidden, send().hidden, cancel().hidden];
      trigger().click();
      await afterOpening();
      expect(hidden()).toEqual([true, true, true, false]);
      expect(said()).toEqual([MESSAGES.CHECK_FAILED, CONTACT_LINE]);
      // A shorter visible area (say an iPad keyboard's shortcut bar) fits the
      // dialog and changes nothing else.
      viewport.change({ height: SCREEN - 56 });
      expect(fitted()).toEqual(['0px', `${SCREEN - 56}px`]);
      expect(hidden()).toEqual([true, true, true, false]);
      expect([cancel().textContent, said()]).toEqual([MESSAGES.CLOSE, [MESSAGES.CHECK_FAILED, CONTACT_LINE]]);
      expect(turnstileScripts()).toEqual([]);
      cancel().click();
      await tick();
      expect([viewport.listenerCount, dialog().style.length, active()]).toEqual([0, 0, trigger()]);
    });
  });

  describe('closing', () => {
    it('closes on Escape, keeps the draft, removes the widget and returns focus to "Send feedback"', async () => {
      await open();
      trigger().focus();
      trigger().click();
      loadTurnstile();
      type('A draft');
      textarea().focus();
      expect(pressEscape(dom.document)).toBe(true);
      expect(dialog().open).toBe(false);
      await tick();
      expect(active()).toBe(trigger());
      expect(turnstile.calls).toEqual([['render', 'widget-1'], ['remove', 'widget-1']]);
      expect(turnstile.last.removed).toBe(true);
      trigger().click();
      expect(textarea().value).toBe('A draft');
      expect(active()).toBe(title());
    });

    it('closes on Cancel, and returns focus to the button even when the browser didn\'t focus it (Safari)', async () => {
      await open();
      trigger().click(); // a click that doesn't focus the button
      expect(active()).toBe(title());
      cancel().click();
      expect(dialog().open).toBe(false);
      await tick();
      expect(active()).toBe(trigger());
    });

    it('leaves focus alone if it has already moved elsewhere on the page', async () => {
      await open();
      trigger().click();
      const elsewhere = dom.document.querySelector('a[href="/privacy/"]');
      dialog().close();
      elsewhere.focus();
      await tick();
      expect(active()).toBe(elsewhere);
    });
  });

  // A video's "Feedback" button opens the same dialog about that video
  // (project lead, 2026-11-13; SPEC §13): a line under the heading names it,
  // and its id goes with the message. Everything else is the dialog above.
  describe('from a video\'s "Feedback" button', () => {
    const ABOUT = (id) => `${MESSAGES.ABOUT}${titleOf(id)}`;

    describe('opening', () => {
      it('opens the same modal dialog with focus on its heading, says which video it is about, and only then loads Turnstile, once', async () => {
        await open();
        const before = dom.document.querySelectorAll('script');
        videoButton(FIRST).focus();
        videoButton(FIRST).click();
        expect([dialog().open, dialog().modal]).toEqual([true, true]);
        expect(active()).toBe(title());
        expect([about().hidden, about().textContent]).toEqual([false, ABOUT(FIRST)]);
        expect(about().textContent).toBe(`About the video: ${titleOf(FIRST)}`);
        expect(titleOf(FIRST).length).toBeGreaterThan(3);
        const scripts = dom.document.querySelectorAll('script').filter((s) => !before.includes(s));
        expect(scripts.map((s) => s.getAttribute('src'))).toEqual([TURNSTILE_URL]);
        expect(said()).toEqual([]);
        expect(requests).toEqual([]);
        // The widget renders as from the footer.
        loadTurnstile();
        expect(turnstile.calls).toEqual([['render', 'widget-1']]);
        expect([turnstile.last.container, turnstile.last.options.sitekey]).toEqual([check(), TEST_SITEKEY]);
      });

      it('makes the line part of the dialog\'s description, before the notice, directly under the heading', async () => {
        await open();
        videoButton(SECOND).click();
        expect(dialog().getAttribute('aria-describedby')).toBe('feedback-about feedback-notice');
        expect([about().id, about().localName, about().className]).toEqual(['feedback-about', 'p', 'feedback__about']);
        const parts = dialog().querySelector('form').children;
        expect(parts.slice(0, 3).map((el) => el.id)).toEqual(['feedback-title', 'feedback-about', 'feedback-notice']);
        expect(dialog().getAttribute('aria-labelledby')).toBe('feedback-title');
        expect(title().textContent).toBe('Send feedback');
        // The line is rendered; the notice is unchanged.
        expect(about().getClientRects()).toHaveLength(1);
        expect($('#feedback-notice').textContent).toContain(NOTICE[0]);
      });

      it.each(['/problems/tired-but-wired/', '/problems/sharing-a-bed/', '/start/'])('names each video of %s by its own title', async (url) => {
        const ids = videosOf(pageAt(site, url));
        await open(url);
        for (const id of ids) {
          videoButton(id).click();
          expect(dialog().open, id).toBe(true);
          expect(about().textContent, id).toBe(ABOUT(id));
          expect(about().hidden, id).toBe(false);
          dialog().close();
          await tick();
        }
        // One line each, all different on a page.
        expect(new Set(ids.map((id) => titleOf(id))).size).toBe(ids.length);
      });

      it('writes the title as text, never as markup', async () => {
        const hostile = '<b>Bold</b> & "quoted" <img src=x onerror=alert(1)>';
        const escaped = hostile.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const html = pageAt(site, PROBLEM).replace(
          new RegExp(`(<h2 class="video-block__title" id="video-${FIRST}-title">)[^<]*(</h2>)`),
          `$1${escaped}$2`,
        );
        await open(PROBLEM, { html });
        expect(titleOf(FIRST)).toBe(hostile);
        videoButton(FIRST).click();
        expect(about().textContent).toBe(`About the video: ${hostile}`);
        expect(about().children).toEqual([]);
        expect(dialog().querySelectorAll('b, img')).toEqual([]);
      });

      it('goes to the Contact page if the dialog can\'t open', async () => {
        await open();
        dialog().remove();
        videoButton(FIRST).click();
        expect(dom.window.location.href).toBe('/contact/');
        expect(turnstileScripts()).toEqual([]);
      });

      it('with no usable site key (decision A1), still opens about the video, with only Close and the Contact line', async () => {
        await open(PROBLEM, { hostname: 'sleepsteps.example.org', html: withKey(PLACEHOLDER_KEY) });
        expect(videoButtons().map((b) => b.hidden)).toEqual(VIDEOS.map(() => false));
        videoButton(FIRST).click();
        await afterOpening();
        expect([dialog().open, about().hidden, about().textContent]).toEqual([true, false, ABOUT(FIRST)]);
        expect([$('[data-feedback-field]').hidden, check().hidden, send().hidden, cancel().hidden, cancel().textContent]).toEqual([true, true, true, false, MESSAGES.CLOSE]);
        expect(said()).toEqual([MESSAGES.CHECK_FAILED, CONTACT_LINE]);
        $('form').requestSubmit();
        await settle();
        expect(requests).toEqual([]);
        expect(turnstileScripts()).toEqual([]);
        cancel().click();
        await tick();
        expect([dialog().open, active()]).toEqual([false, videoButton(FIRST)]);
      });
    });

    describe('sending', () => {
      it('POSTs exactly page_id, video_id, message and the token, once, and the Worker\'s own check accepts it and stores that video', async () => {
        await readyFrom(SECOND, PROBLEM, { answer: 'manual' });
        const message = '  About this one.\r\nThanks  ';
        type(message);
        send().click();
        expect(requests).toHaveLength(1);
        const [request] = requests;
        expect(request.url).toBe('/api/feedback');
        expect([request.init.method, request.init.headers, request.init.keepalive]).toEqual(['POST', { 'Content-Type': 'application/json' }, false]);
        expect(Object.keys(request.body)).toEqual(['page_id', 'video_id', 'message', 'turnstile_token']);
        expect(Object.keys(request.body).sort()).toEqual([...FEEDBACK_KEYS, FEEDBACK_VIDEO_KEY].sort());
        expect(request.body).toEqual({ page_id: 'tired-but-wired', video_id: SECOND, message, turnstile_token: DUMMY_TOKEN });
        const checked = validateFeedback(request.body, index);
        expect(checked).toEqual({ row: { page: 'tired-but-wired', video: SECOND, message: cleanMessage(message) }, token: DUMMY_TOKEN });
        // The title is never sent: only the id, which the Worker checks.
        expect(request.init.body).not.toContain(titleOf(SECOND));
        expect(said()).toEqual([MESSAGES.SENDING]);
        send().click();
        expect(requests).toHaveLength(1);
        request.answer(204);
        await settle();
        // Decision A2: thanks, cleared, Close; the dialog stays open, about the same video.
        expect([said(), textarea().value, cancel().textContent, dialog().open]).toEqual([[MESSAGES.THANKS], '', 'Close', true]);
        expect([about().hidden, about().textContent]).toEqual([false, ABOUT(SECOND)]);
      });

      it('sends, from every video on every page, a body the Worker accepts for that page and video', async () => {
        let sent = 0;
        for (const { file, html } of readHtmlPages(site).filter((p) => videosOf(p.html).length)) {
          await open(null, { html });
          expect(videoButtons().map((b) => b.getAttribute('data-feedback-video')), file).toEqual(videosOf(html));
          for (const id of videosOf(html)) {
            videoButton(id).click();
            if (turnstileScripts().length && !dom.window.turnstile) loadTurnstile();
            turnstile.last.options.callback(DUMMY_TOKEN);
            type(`About ${id}`);
            send().click();
            const { body } = requests.at(-1);
            expect(Object.keys(body), `${file} ${id}`).toEqual(['page_id', 'video_id', 'message', 'turnstile_token']);
            expect(validateFeedback(body, index), `${file} ${id}`).toEqual({ row: { page: pageIdOf(html), video: id, message: `About ${id}` }, token: DUMMY_TOKEN });
            await settle();
            dialog().close();
            await tick();
            sent += 1;
          }
          expect(requests, file).toHaveLength(videosOf(html).length);
          dom.restore();
          dom = undefined;
        }
        // Every (page, video) pair of pages.json, once.
        expect(sent).toBe(Object.values(pagesJson).reduce((n, page) => n + page.videos.length, 0));
      });

      it('sends the video the dialog is about when Send is pressed: the last button that opened it', async () => {
        await readyFrom(FIRST);
        type('A draft');
        await reopenFrom(videoButton(SECOND));
        expect(about().textContent).toBe(ABOUT(SECOND));
        expect(textarea().value).toBe('A draft');
        send().click();
        await settle();
        expect(requests.map((r) => r.body)).toEqual([{ page_id: 'tired-but-wired', video_id: SECOND, message: 'A draft', turnstile_token: DUMMY_TOKEN }]);
        // Then from the footer: the next message is about no video.
        await reopenFrom(trigger());
        type('General');
        send().click();
        await settle();
        expect(requests[1].body).toEqual({ page_id: 'tired-but-wired', message: 'General', turnstile_token: DUMMY_TOKEN });
        expect(Object.keys(requests[1].body)).toEqual(FEEDBACK_KEYS);
        // And from the first video again.
        await reopenFrom(videoButton(FIRST));
        type('Back to the first');
        send().click();
        await settle();
        expect(requests[2].body).toEqual({ page_id: 'tired-but-wired', video_id: FIRST, message: 'Back to the first', turnstile_token: DUMMY_TOKEN });
        expect(requests).toHaveLength(3);
      });

      it('keeps a request in flight about the video it was sent for, when the dialog is reopened from another control before the answer', async () => {
        await readyFrom(FIRST, PROBLEM, { answer: 'manual' });
        type('In flight');
        send().click();
        expect(requests[0].body.video_id).toBe(FIRST);
        await reopenFrom(trigger());
        // Only the line changes; "Sending…" and the read-only text are the dialog's.
        expect([about().hidden, about().textContent]).toEqual([true, '']);
        await afterOpening();
        expect([said(), textarea().readOnly, textarea().value]).toEqual([[MESSAGES.SENDING], true, 'In flight']);
        send().click();
        expect(requests).toHaveLength(1);
        requests[0].answer(204);
        await settle();
        expect([said(), textarea().value, cancel().textContent]).toEqual([[MESSAGES.THANKS], '', 'Close']);
        expect(requests.map((r) => r.body.video_id)).toEqual([FIRST]);
      });

      it.each([
        ['400 (as for a video the Worker doesn\'t know)', 400],
        ['404 (collection off, as in previews)', 404],
        ['500', 500],
        ['a network error', 'reject'],
      ])('on %s, says it couldn\'t send, offers the Contact page and keeps the text and the video', async (name, answer) => {
        await readyFrom(FIRST, PROBLEM, { answer });
        type('Keep me');
        send().click();
        await settle();
        expect(said()).toEqual([SEND_FAILED, CONTACT_LINE]);
        expect([textarea().value, cancel().textContent, about().textContent]).toEqual(['Keep me', 'Cancel', ABOUT(FIRST)]);
        expect(turnstile.calls.at(-1)).toEqual(['reset', 'widget-1']);
        // A new token, and the retry is about the same video.
        turnstile.last.options.callback('second-token');
        send().click();
        expect(requests.map((r) => [r.body.video_id, r.body.turnstile_token])).toEqual([[FIRST, DUMMY_TOKEN], [FIRST, 'second-token']]);
        await settle();
      });

      it('says what is wrong before sending, as from the footer: a blank message, then no token yet', async () => {
        await open();
        videoButton(FIRST).click();
        send().click();
        expect(said()).toEqual([MESSAGES.EMPTY]);
        expect([textarea().getAttribute('aria-invalid'), active()]).toEqual(['true', textarea()]);
        type('Hello');
        send().click();
        expect(said()).toEqual([MESSAGES.WAITING]);
        expect(requests).toEqual([]);
      });
    });

    describe('the footer\'s "Send feedback" afterwards', () => {
      it('empties and hides the line, and sends exactly the three keys', async () => {
        await readyFrom(FIRST);
        expect([about().hidden, about().textContent]).toEqual([false, ABOUT(FIRST)]);
        await reopenFrom(trigger());
        // Emptied as well as hidden: a description is read even from a hidden element.
        expect([about().hidden, about().textContent, about().children]).toEqual([true, '', []]);
        expect(about().getClientRects()).toEqual([]);
        expect(dialog().getAttribute('aria-describedby')).toBe('feedback-about feedback-notice');
        type('General feedback');
        send().click();
        await settle();
        expect(requests).toHaveLength(1);
        expect(Object.keys(requests[0].body)).toEqual(FEEDBACK_KEYS);
        expect(requests[0].body).toEqual({ page_id: 'tired-but-wired', message: 'General feedback', turnstile_token: DUMMY_TOKEN });
        expect(validateFeedback(requests[0].body, index).row).toEqual({ page: 'tired-but-wired', video: null, message: 'General feedback' });
      });

      it('names the video again when a video\'s button opens it next', async () => {
        await open();
        for (const [opener, hidden, line] of [
          [trigger(), true, ''],
          [videoButton(SECOND), false, ABOUT(SECOND)],
          [trigger(), true, ''],
          [videoButton(FIRST), false, ABOUT(FIRST)],
        ]) {
          opener.click();
          expect([dialog().open, about().hidden, about().textContent]).toEqual([true, hidden, line]);
          dialog().close();
          await tick();
        }
        expect(turnstileScripts()).toHaveLength(1);
      });
    });

    describe('closing', () => {
      it('returns focus on Escape to the button that opened the dialog, not to "Send feedback", and removes the widget', async () => {
        await open();
        videoButton(SECOND).focus();
        videoButton(SECOND).click();
        loadTurnstile();
        textarea().focus();
        expect(pressEscape(dom.document)).toBe(true);
        expect(dialog().open).toBe(false);
        await tick();
        expect(active()).toBe(videoButton(SECOND));
        expect(active()).not.toBe(trigger());
        expect(turnstile.calls).toEqual([['render', 'widget-1'], ['remove', 'widget-1']]);
      });

      it('returns focus on Cancel even when the browser didn\'t focus the button it was opened from (Safari)', async () => {
        await open();
        videoButton(FIRST).click(); // a click that doesn't focus the button
        expect(active()).toBe(title());
        cancel().click();
        await tick();
        expect([dialog().open, active()]).toEqual([false, videoButton(FIRST)]);
      });

      it('returns focus to whichever control opened it last', async () => {
        await open();
        const openers = [videoButton(FIRST), trigger(), videoButton(SECOND), videoButtons().at(-1), trigger(), videoButton(FIRST)];
        for (const [i, opener] of openers.entries()) {
          // Pressed with the keyboard, or clicked in a browser that focuses a
          // clicked button; or clicked in Safari, which focuses nothing.
          if (i % 2) opener.focus();
          else active().blur();
          opener.click();
          expect(active()).toBe(title());
          if (i % 3) cancel().click();
          else pressEscape(dom.document);
          await tick();
          expect(active(), String(i)).toBe(opener);
        }
      });

      it('leaves focus alone if it has already moved elsewhere on the page', async () => {
        await open();
        videoButton(FIRST).click();
        const elsewhere = videoButton(SECOND);
        dialog().close();
        elsewhere.focus();
        await tick();
        expect(active()).toBe(elsewhere);
      });

      it('returns focus to "Send feedback" if the button it was opened from has left the page', async () => {
        await open();
        const button = videoButton(FIRST);
        button.click();
        button.remove();
        cancel().click();
        await tick();
        expect(active()).toBe(trigger());
      });

      it('keeps the draft across Cancel and Escape, whichever control opens the dialog next', async () => {
        await open();
        videoButton(FIRST).click();
        loadTurnstile();
        type('A draft about the first video');
        cancel().click();
        await tick();
        for (const opener of [trigger(), videoButton(SECOND), videoButton(FIRST)]) {
          opener.click();
          expect(textarea().value).toBe('A draft about the first video');
          expect(said()).toEqual([]);
          pressEscape(dom.document);
          await tick();
        }
        // Never stored anywhere but the textarea (afterEach checks both storages are empty).
        expect(textarea().value).toBe('A draft about the first video');
      });

      it('fits above an on-screen keyboard and puts the dialog back on closing, as from the footer', async () => {
        const viewport = new VisualViewport({ height: 664 });
        await open(PROBLEM, { innerHeight: 664, visualViewport: viewport });
        videoButton(FIRST).click();
        expect(viewport.listenerCount).toBe(2);
        viewport.change({ height: 328 });
        expect([FIT_PROPERTIES.top, FIT_PROPERTIES.height].map((name) => dialog().style.getPropertyValue(name))).toEqual(['0px', '328px']);
        cancel().click();
        await tick();
        expect([viewport.listenerCount, dialog().style.length, active()]).toEqual([0, 0, videoButton(FIRST)]);
      });
    });
  });
});
