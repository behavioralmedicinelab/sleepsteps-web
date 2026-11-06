// The feedback dialog (SPEC §11, §13, §15.1, §16.2; M5): what the built site
// ships, where base.njk renders it and loads src/js/feedback.js, the module's
// source, and the module run on built pages in the small test DOM
// (mini-dom.js) with a stand-in for Cloudflare's Turnstile API. Every
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
import { FEEDBACK_KEYS, MAX_MESSAGE_LENGTH, cleanMessage, validateFeedback } from '../../worker/routes/feedback.js';
import { attr, elementByClass, listFiles, pageAt, readHtmlPages, tags, text } from './helpers.js';
import { MemoryStorage, installDom, pressEscape } from './mini-dom.js';

const site = inject('builtSite');
const config = JSON.parse(readFileSync('site.config.json', 'utf8'));
const feedbackOn = config.features.feedback === true;
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
const scriptsOf = (html) => tags(html, 'script').map((t) => attr(t, 'src'));
const dialogOf = (html) => elementByClass(html, 'feedback-dialog', 'dialog');

// ---- The built site ----------------------------------------------------------

describe.runIf(feedbackOn)('built pages and the feedback dialog (SPEC §13)', () => {
  const pages = readHtmlPages(site);
  const withDialog = pages.filter((p) => p.file !== 'urgent-help/index.html' && p.file !== '404.html');

  it('renders the dialog on every page but Getting urgent help (no footer) and the 404 page (no page_id)', () => {
    expect(pages.filter((p) => dialogOf(p.html)).map((p) => p.file)).toEqual(withDialog.map((p) => p.file));
    expect(withDialog.length).toBe(pages.length - 2);
    expect(pageIdOf(pageAt(site, '/404.html'))).toBeUndefined();
    expect(pageAt(site, '/urgent-help/')).not.toMatch(/<footer/);
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

  describe('the dialog', () => {
    const html = dialogOf(pageAt(site, PROBLEM));
    const open = tags(html, 'dialog')[0];
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

    it('ships hidden and closed, named by its heading and described by the notice', () => {
      expect([attr(open, 'hidden'), attr(open, 'open'), attr(open, 'data-feedback-dialog')]).toEqual(['', undefined, '']);
      expect([attr(open, 'aria-labelledby'), attr(open, 'aria-describedby')]).toEqual(['feedback-title', 'feedback-notice']);
      for (const id of [attr(open, 'aria-labelledby'), attr(open, 'aria-describedby')]) expect(ids).toContain(id);
      expect(attr(open, 'role')).toBeUndefined();
      expect(attr(open, 'tabindex')).toBeUndefined();
      expect(tags(html, 'h2')).toEqual(['<h2 class="feedback__title" id="feedback-title" tabindex="-1">']);
      expect(text(elementByClass(html, 'feedback__title', 'h2'))).toBe('Send feedback');
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

    it('puts the parts in order: heading, notice, field, hint, Turnstile box, Send and Cancel, status line', () => {
      const order = ['feedback__title', 'feedback__notice', 'feedback__field', 'feedback__label', 'feedback__message', 'feedback__hint', 'feedback__check', 'feedback__actions', 'feedback__status'];
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

  it('leaves out the dialog and feedback.js without the footer or a page_id, keeping the link with the footer', () => {
    const noFooter = render(true, { footer: false });
    expect([triggers(noFooter), tags(noFooter, 'dialog'), scriptsOf(noFooter)]).toEqual([[], [], []]);
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
// follow features.events. The built site has one config, so the page's
// source is also rendered here with the switch off.
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

  const ITEM = 'Written feedback, if you choose to send it, and the page you sent it from. We store it with the time rounded to the hour';
  const CHECK = "The check receives technical details such as your IP address and browser, and the address of the page you're on, which on the search page includes your search.";
  const ROW = '<code>cf.turnstile.u</code>';
  const shown = (html) => [html.includes(`<li>${ITEM}</li>`), text(html).includes(CHECK), html.includes(ROW)];

  it('lists the feedback item (time rounded to the hour), what the check receives and cf.turnstile.u while the switch is on', () => {
    expect(shown(render(true))).toEqual([true, true, true]);
  });

  it.each([false, 'true', undefined])('leaves all three out with features.feedback %s, and keeps the rest', (feedback) => {
    const html = render(feedback);
    expect(shown(html)).toEqual([false, false, false]);
    expect(html).toContain('<li>Star ratings you give a video</li>');
    expect(html).toContain('<code>cf_clearance</code>');
    expect(text(html)).toContain('It also protects the site from spam and automated attacks.');
  });

  it.runIf(feedbackOn)('says all three on the built page', () => {
    expect(shown(pageAt(site, '/privacy/'))).toEqual([true, true, true]);
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
    expect(code).toMatch(/postJson\(ENDPOINT, \{ page_id: pageId, message, turnstile_token: token \}\)/);
    expect(FEEDBACK_KEYS).toEqual(['page_id', 'message', 'turnstile_token']);
  });

  it('stores nothing, reports no usage event, logs nothing and styles nothing', () => {
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|caches\./);
    expect(code).not.toMatch(/sendBeacon|XMLHttpRequest|sleepsteps:event|sleepsteps-|session_id|usage-prefs/);
    expect(code).not.toMatch(/console\./);
    expect(code).not.toMatch(/\.style\b|innerHTML|outerHTML|insertAdjacentHTML|setAttribute\(\s*['"]style/);
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

describe.runIf(feedbackOn)('feedback.js in the browser (SPEC §11, §13)', () => {
  let dom;
  let requests; // every fetch: { url, init, body, answer(status), fail() }
  let mode; // 'manual' | number (answer at once with that status) | 'reject' | 'missing'
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
      else if (mode === 'reject') request.fail();
    });

  /** Open a built page (or `html`) and run feedback.js on it, freshly imported. */
  async function open(url = PROBLEM, { answer = 204, html, hostname = 'localhost', dialog = true, layoutWidth, before } = {}) {
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
  const trigger = () => $('[data-feedback-trigger]');
  const dialog = () => $('dialog');
  const title = () => $('#feedback-title');
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

    it('keeps focus on "Send feedback" if the link had it', async () => {
      await open(PROBLEM, { before: (d) => d.document.querySelector('a[data-feedback-trigger]').focus() });
      expect(active()).toBe(trigger());
    });

    it.each([
      ['without a data-page-id', { before: (d) => d.document.body.removeAttribute('data-page-id') }],
      ['without <dialog> support', { dialog: false }],
      ['without the dialog\'s markup', { html: pageAt(site, PROBLEM).replace(/<dialog[\s\S]*<\/dialog>/, '') }],
      ['when the dialog lacks its status line', { html: pageAt(site, PROBLEM).replace(/<div class="feedback__status"[^>]*><\/div>/, '') }],
    ])('leaves the link to the Contact page and the dialog hidden %s', async (name, options) => {
      await open(PROBLEM, options);
      expect(trigger().localName).toBe('a');
      expect(trigger().getAttribute('href')).toBe('/contact/');
      if (dialog()) expect(dialog().hidden).toBe(true);
      expect(turnstileScripts()).toEqual([]);
    });

    it('leaves the 404 page\'s link alone', async () => {
      const { init } = await open('/404.html');
      expect(trigger().localName).toBe('a');
      expect(init()).toBe(false);
    });

    it('works on every kind of page with the dialog, the search page included (decision A4)', async () => {
      for (const url of ['/', '/search/', '/start/', '/privacy/', '/problems/']) {
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
      ['a preview', 'pr-12-sleepsteps.team.workers.dev', '&lt;PUBLIC_SITE_KEY&gt;', TEST_SITEKEY],
      ['production, with a real key', 'sleepsteps.team.workers.dev', REAL_KEY, REAL_KEY],
    ])('on %s host, renders with the right key', async (name, hostname, key, expected) => {
      const html = pageAt(site, PROBLEM).replace(/data-sitekey="[^"]*"/, `data-sitekey="${key}"`);
      await open(PROBLEM, { html, hostname });
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
        await open(PROBLEM, { hostname });
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
      const checked = validateFeedback(request.body, index);
      expect(checked.row).toEqual({ page: 'tired-but-wired', title: pagesJson['tired-but-wired'].title, message: cleanMessage(message) });
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
      ['404 (before the go-ahead)', 404],
      ['429', 429],
      ['500', 500],
      ['a network error', 'reject'],
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
});
