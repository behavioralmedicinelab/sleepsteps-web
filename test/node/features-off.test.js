// The site with its feature switches off (SPEC §11, §15.2; M7): the whole
// built pages for every combination of features.ratings, features.feedback
// and features.events (test/global-setup.js builds each with
// test/features.config.js), what each page loads and renders, what the
// privacy page claims, the storage it names, and the page's own modules run
// in the small test DOM (mini-dom.js). The real build (site.config.json as it
// is) must match the combination with the same switches, file for file, so
// these checks and the all-on checks in the other files cover what
// production deploys. `npm run test:features` also runs the whole suite with
// site.config.json itself set to each combination.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { pagesIndex } from '../../scripts/build-data.js';
import { validateContent } from '../../scripts/validate-content.js';
import { attr, elementByClass, listFiles, pageAt, readHtmlPages, tags, text } from './helpers.js';
import { MemoryStorage, installDom } from './mini-dom.js';

const builds = inject('featureBuilds');
const real = inject('builtSite');
const config = JSON.parse(readFileSync('site.config.json', 'utf8'));
const pagesJson = JSON.parse(readFileSync('worker/generated/pages.json', 'utf8'));
const { model } = validateContent(process.cwd());

const CONSOLE = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
const scriptsOf = (html) => tags(html, 'script').map((t) => attr(t, 'src'));
const bodyOf = (html) => tags(html, 'body')[0];
const count = (html, needle) => html.split(needle).length - 1;

/** Every element (opening tag to its matching close) with this class. */
function elements(html, className, tagName) {
  const found = [];
  let rest = html;
  for (let el = elementByClass(rest, className, tagName); el; el = elementByClass(rest, className, tagName)) {
    found.push(el);
    rest = rest.slice(rest.indexOf(el) + el.length);
  }
  return found;
}

// The modules a switch leaves out (base.njk and the moduleScripts filter,
// SPEC §10.1, §11, §12, §13).
const SWITCHED = { 'rating.js': 'ratings', 'feedback.js': 'feedback', 'events.js': 'events', 'stats-switch.js': 'events' };
const keep = (features) => (src) => {
  const feature = SWITCHED[src.replace(/^\/js\//, '')];
  return !feature || features[feature] === true;
};

// What each kind of page loads with every feature on, in order.
const ALL_ON = {
  'problem with solutions': ['menu', 'events', 'solutions', 'rating', 'players', 'feedback'],
  'stand-alone problem': ['menu', 'events', 'rating', 'players', 'feedback'],
  'Start here': ['menu', 'events', 'players', 'rating', 'feedback'],
  Search: ['menu', 'events', 'search', 'feedback'],
  // Home holds the list of sleep problems (project lead, 2026-11-13).
  Home: ['menu', 'problems', 'feedback'],
  Privacy: ['menu', 'stats-switch', 'feedback'],
  'Getting urgent help': ['events', 'feedback'],
  'About, Contact, Referral info': ['menu', 'feedback'],
  '404 page': ['menu'],
};

function kindOf(file) {
  const slug = file.match(/^problems\/([^/]+)\/index\.html$/)?.[1];
  if (slug) return (model.problems.get(slug).data.solutions ?? []).length ? 'problem with solutions' : 'stand-alone problem';
  return {
    'index.html': 'Home',
    'start/index.html': 'Start here',
    'search/index.html': 'Search',
    'privacy/index.html': 'Privacy',
    'urgent-help/index.html': 'Getting urgent help',
    '404.html': '404 page',
  }[file] ?? 'About, Contact, Referral info';
}

const allOn = builds.find((b) => b.name === 'all on');
const allOnPages = new Map(readHtmlPages(allOn.dir).map((p) => [p.file, p.html]));

// ---- The real build -------------------------------------------------------------

describe('the real build (site.config.json as it is)', () => {
  it('is, file for file, the combination with the same switches', () => {
    // A switch is on only when it is exactly true (SPEC §11).
    const on = { ratings: config.features?.ratings === true, feedback: config.features?.feedback === true, events: config.features?.events === true };
    const twin = builds.find((b) => JSON.stringify(b.features) === JSON.stringify(on));
    expect(twin, JSON.stringify(on)).toBeTruthy();
    const files = listFiles(real);
    expect(listFiles(twin.dir)).toEqual(files);
    for (const file of files) {
      expect(readFileSync(path.join(twin.dir, file)).equals(readFileSync(path.join(real, file))), file).toBe(true);
    }
  });

  it('builds all eight combinations, all on first', () => {
    expect(builds.map((b) => b.name)).toEqual([
      'all on',
      'ratings off',
      'feedback off',
      'ratings and feedback off',
      'events off',
      'ratings and events off',
      'feedback and events off',
      'all off',
    ]);
    expect(new Set(builds.map((b) => JSON.stringify(b.features))).size).toBe(8);
  });
});

// ---- Every combination -------------------------------------------------------------

describe.each(builds)('$name', ({ features, dir }) => {
  const pages = readHtmlPages(dir);
  const on = (feature) => features[feature] === true;
  const privacy = pageAt(dir, '/privacy/');
  const privacyText = text(privacy);

  it('builds the same pages as with every feature on', () => {
    expect(pages.map((p) => p.file)).toEqual([...allOnPages.keys()]);
  });

  it('loads exactly the scripts each kind of page needs, in order', () => {
    for (const { file, html } of pages) {
      const expected = ALL_ON[kindOf(file)].map((name) => `/js/${name}.js`).filter(keep(features));
      expect(scriptsOf(html), file).toEqual(expected);
      // The all-on page's scripts, less those of the switches that are off.
      expect(scriptsOf(html), file).toEqual(scriptsOf(allOnPages.get(file)).filter(keep(features)));
    }
  });

  it('loads each switchable module on as many pages as with every feature on, or on none', () => {
    const loading = (pageList, src) => pageList.filter((html) => scriptsOf(html).includes(src)).length;
    const htmls = pages.map((p) => p.html);
    const allOnHtmls = [...allOnPages.values()];
    for (const [module, feature] of Object.entries(SWITCHED)) {
      expect(loading(htmls, `/js/${module}`), module).toBe(on(feature) ? loading(allOnHtmls, `/js/${module}`) : 0);
    }
  });

  it('keeps every page to the shell and the CSP rules (SPEC §16.1), with no /api/ path in the HTML', () => {
    for (const { file, html } of pages) {
      expect(html, file).toMatch(/<html lang="en-AU">/);
      expect(tags(html, 'h1'), file).toHaveLength(1);
      expect(html, file).toMatch(/<body[^>]*>\s*<a class="skip-link" href="#main">Skip to content<\/a>/);
      expect(tags(html, 'main').filter((t) => attr(t, 'id') === 'main'), file).toHaveLength(1);
      expect(html, file).not.toMatch(/\sstyle\s*=|<style[\s>]|<[^>]+\son[a-z]+\s*=/i);
      for (const tag of tags(html, 'script')) expect(attr(tag, 'src'), `${file}: ${tag}`).toMatch(/^\/js\/[a-z-]+\.js$/);
      expect(html, file).not.toMatch(/http-equiv\s*=\s*["']?content-security-policy/i);
      for (const tag of html.match(/<(?!a\b)[a-z][a-z0-9-]*\b[^>]*>/gi) ?? []) {
        for (const name of ['src', 'href', 'srcset', 'poster', 'data', 'action', 'formaction']) {
          const value = attr(tag, name);
          if (value !== undefined) expect(value, `${file}: ${tag}`).not.toMatch(/^\s*(?:[a-z][a-z0-9+.-]*:|\/\/|\\\\)/i);
        }
      }
      expect(html, file).not.toMatch(/\/api\//);
      expect(html, file).not.toMatch(/challenges\.cloudflare\.com|youtube-nocookie|iframe_api/);
    }
  });

  it('builds the same worker/generated/pages.json as the real build', () => {
    const fromBuild = pagesIndex(
      pages.map(({ file, html }) => ({ url: `/${file.replace(/(^|\/)index\.html$/, '$1')}`, outputPath: file, content: html })),
    );
    expect(fromBuild).toEqual(pagesJson);
  });

  it('keeps data-page-view on exactly the 38 tracked pages, whatever features.events says (pages.json reads it)', () => {
    const marked = pages.filter((p) => attr(bodyOf(p.html), 'data-page-view') !== undefined).map((p) => attr(bodyOf(p.html), 'data-page-id'));
    expect(marked.sort()).toEqual([...model.problems.keys(), 'start', 'urgent-help'].sort());
    expect(marked).toHaveLength(38);
  });

  // ---- features.ratings ----

  it(`${on('ratings') ? 'renders' : 'renders no'} rating widget, and never an empty row of controls`, () => {
    for (const { file, html } of pages) {
      const before = allOnPages.get(file);
      expect(count(html, ' data-rating="'), file).toBe(on('ratings') ? count(before, ' data-rating="') : 0);
      if (!on('ratings')) expect(html, file).not.toMatch(/data-rating|rating__|Was this helpful/);
      // "Audio only" and the handout stay whatever the switch says.
      for (const needle of ['class="format-button"', 'class="format-disclosure"', '<audio ']) {
        expect(count(html, needle), `${file}: ${needle}`).toBe(count(before, needle));
      }
      for (const row of elements(html, 'video-controls', 'div')) {
        expect(row, file).toMatch(/class="format-button"|class="format-disclosure"|class="rating"/);
      }
    }
    expect(pages.filter((p) => p.html.includes('class="video-controls')).length).toBeGreaterThan(0);
  });

  // Home's "Rate each video to help us improve" went with its step cards
  // (2026-11-13), and with it the [data-js-only] hook that menu.js used to
  // show: text marked that way would now stay hidden for good.
  it('says nothing about ratings on Home, and marks no text [data-js-only]', () => {
    const home = pageAt(dir, '/');
    expect(home).not.toMatch(/home-step__note|Rate each video/);
    expect(pages.filter((p) => /\sdata-js-only[\s>=]/.test(p.html)).map((p) => p.file)).toEqual([]);
    expect(readFileSync('src/js/menu.js', 'utf8')).not.toMatch(/data-js-only/);
  });

  // Home is the Sleep problems page (SPEC §7.2): the list and its script
  // are there whatever the switches say, and the old page isn't built.
  it('has the list of sleep problems on Home, loads problems.js there alone, and builds no /problems/ page', () => {
    expect(pages.filter((p) => scriptsOf(p.html).includes('/js/problems.js')).map((p) => p.file)).toEqual(['index.html']);
    expect(pages.filter((p) => /\sdata-problems[\s>=]/.test(p.html)).map((p) => p.file)).toEqual(['index.html']);
    expect(pages.map((p) => p.file)).not.toContain('problems/index.html');
  });

  // ---- features.feedback ----

  it(`${on('feedback') ? 'renders' : 'renders no'} feedback dialog or "Send feedback" link, the 404 page included`, () => {
    for (const { file, html } of pages) {
      const hasId = attr(bodyOf(html), 'data-page-id') !== undefined;
      expect(tags(html, 'dialog'), file).toHaveLength(on('feedback') && hasId ? 1 : 0);
      expect(count(html, 'data-feedback-trigger'), file).toBe(on('feedback') ? 1 : 0);
      if (!on('feedback')) expect(html, file).not.toMatch(/feedback-dialog|data-feedback|Send feedback/);
      // The footer's Contact link stays.
      expect(tags(elementByClass(html, 'site-footer', 'footer'), 'a').some((t) => attr(t, 'href') === '/contact/'), file).toBe(true);
    }
  });

  it(`${on('feedback') ? 'describes' : "doesn't describe"} the spam check on the privacy page`, () => {
    expect(privacyText.includes('When you open the feedback form, a Cloudflare check runs in your browser')).toBe(on('feedback'));
    expect(privacy.includes('<code>cf.turnstile.u</code>')).toBe(on('feedback'));
    expect(privacyText.includes('the spam check on the feedback form')).toBe(on('feedback'));
    // Cloudflare's own check (cf_clearance) is there whatever the switch says.
    expect(privacy).toContain('<code>cf_clearance</code>');
  });

  // ---- features.events ----

  it(`${on('events') ? 'shows' : 'shows no'} the statistics switch and its storage rows on the privacy page`, () => {
    expect(privacy.includes('data-stats-switch')).toBe(on('events'));
    expect(privacy.includes('<code>sleepsteps-visit</code>')).toBe(on('events'));
    expect(privacy.includes('<code>sleepsteps-stats-off</code>')).toBe(on('events'));
    expect(privacyText.includes("This website isn't collecting usage statistics at the moment, so there is nothing to turn off.")).toBe(!on('events'));
    expect(privacyText.includes('To count visits, your browser tab holds a temporary random code.')).toBe(on('events'));
    // The storage section's opening sentence names visit counting only while
    // it happens, and reads as a list either way.
    expect(privacyText.includes('to count visits without knowing who you are')).toBe(on('events'));
    expect(privacyText).toContain(
      on('events')
        ? 'to protect it from spam and automated programs, to tell our hosting provider about connections that fail, or to count visits without knowing who you are. They are all listed here.'
        : 'to protect it from spam and automated programs, or to tell our hosting provider about connections that fail. They are all listed here.',
    );
  });

  // ---- The privacy page's claims (SPEC §15.2) ----

  describe('the privacy page says only what is being collected', () => {
    const card = elementByClass(privacy, 'privacy-card--collect', 'section');
    const items = [...card.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]));
    const anyOn = on('ratings') || on('feedback') || on('events');

    it(`${on('ratings') ? 'lists' : "doesn't list"} star ratings`, () => {
      expect(items.includes('Star ratings you give a video')).toBe(on('ratings'));
    });

    it(`${on('feedback') ? 'lists' : "doesn't list"} written feedback`, () => {
      expect(items.includes('Written feedback, if you choose to send it, and the page you sent it from')).toBe(on('feedback'));
    });

    it(`${on('events') ? 'lists' : "doesn't list"} searches and usage, and the paragraph on turning statistics off`, () => {
      expect(items.some((item) => item.startsWith('Words you type into the site search.'))).toBe(on('events'));
      expect(items.some((item) => item.startsWith('Anonymous usage:'))).toBe(on('events'));
      expect(privacyText.includes('You can stop your browser sending us anonymous usage information')).toBe(on('events'));
    });

    it('names in "still reach us" only the features that are on', () => {
      const sentences = ['Ratings and feedback you choose to send still reach us.', 'Ratings you choose to give still reach us.', 'Feedback you choose to send still reaches us.'];
      let expected = [];
      if (on('events') && on('ratings') && on('feedback')) expected = [sentences[0]];
      else if (on('events') && on('ratings')) expected = [sentences[1]];
      else if (on('events') && on('feedback')) expected = [sentences[2]];
      expect(sentences.filter((s) => privacyText.includes(s))).toEqual(expected);
      expect(count(privacyText, 'still reach')).toBe(expected.length);
    });

    it(`${anyOn ? 'lists what is collected, with the note on times' : 'says nothing is being collected, with no empty list'}`, () => {
      expect(items.length > 0).toBe(anyOn);
      expect(tags(card, 'ul')).toHaveLength(anyOn ? 1 : 0);
      expect(text(card).includes('Each of these is stored with the page it came from and the date and hour, never the exact time.')).toBe(anyOn);
      expect(text(card).includes('Nothing at the moment: ratings, feedback and usage statistics are all turned off.')).toBe(!anyOn);
    });
  });

  // ---- Storage named on the privacy page (SPEC §15.4) ----

  it('names every storage key the loaded modules use on the privacy page, and no key of ours they leave unused', () => {
    // The modules any page loads, with their static imports.
    const loaded = new Set();
    const visit = (name) => {
      if (loaded.has(name)) return;
      loaded.add(name);
      const source = readFileSync(`src/js/${name}`, 'utf8');
      for (const [, imported] of source.matchAll(/^import\s[^;]*?from\s+'\.\/([a-z-]+\.js)';$/gm)) visit(imported);
    };
    for (const { html } of pages) for (const src of scriptsOf(html)) visit(src.replace(/^\/js\//, ''));
    const keyPatterns = [
      /(?:local|session)Storage\s*(?:\.\s*(?:getItem|setItem|removeItem)\(\s*|\[\s*)['"`]([^'"`]+)['"`]/g,
      /['"`](sleepsteps-[a-z0-9-]+)['"`]/g,
    ];
    const keysOf = (name) => keyPatterns.flatMap((p) => [...readFileSync(`src/js/${name}`, 'utf8').matchAll(p)].map((m) => m[1]));
    const used = new Set([...loaded].flatMap(keysOf));
    for (const key of used) expect(privacyText, key).toContain(key);
    const named = new Set(privacyText.match(/sleepsteps-[a-z0-9-]+/g) ?? []);
    for (const key of named) expect(used.has(key), `${key} is named, but no loaded module uses it`).toBe(true);
    expect(used.size > 0).toBe(on('events'));
  });

  // ---- The page's modules in the test DOM ----

  describe('each kind of page, with its own modules running', () => {
    let dom;
    beforeEach(() => {
      for (const method of CONSOLE) vi.spyOn(console, method);
    });
    afterEach(() => {
      for (const method of CONSOLE) expect(console[method], `console.${method}`).not.toHaveBeenCalled();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      dom?.restore();
      dom = undefined;
    });

    const SAMPLES = [
      ['/', ''],
      ['/problems/tired-but-wired/', ''],
      ['/problems/restless-legs/', ''],
      ['/start/', ''],
      ['/search/', '?q=sleep'],
      ['/privacy/', ''],
      ['/urgent-help/', ''],
      ['/contact/', ''],
      ['/404.html', ''],
    ];

    it.each(SAMPLES)('%s%s calls the API only to send a page view or a search, and only while events is on', async (url, search) => {
      const html = pageAt(dir, url).replace(
        /data-minisearch="[^"]*"/,
        `data-minisearch="${pathToFileURL(path.join(dir, 'js/vendor/minisearch/index.js')).href}"`,
      );
      const api = [];
      const indexJson = readFileSync(path.join(dir, 'search-index.json'), 'utf8');
      // search.js fetches the index with the global fetch; the widgets and
      // events.js use window's.
      const fetchStub = async (target, init) => {
        if (String(target).startsWith('/api/')) {
          api.push({ url: String(target), body: init?.body });
          return { ok: false, status: 404 };
        }
        if (target === '/search-index.json') return new Response(indexJson, { status: 200 });
        throw new TypeError('Failed to fetch');
      };
      vi.stubGlobal('fetch', fetchStub);
      dom = installDom(html, {
        search,
        localStorage: new MemoryStorage(),
        sessionStorage: new MemoryStorage(),
        navigator: { sendBeacon: (target, body) => (api.push({ url: target, body }), true) },
        fetch: fetchStub,
      });
      vi.resetModules();
      for (const src of scriptsOf(html)) await import(`../../src/js/${src.replace(/^\/js\/|\.js$/g, '')}.js`);
      const status = dom.document.querySelector('[data-search-status]');
      if (status) await vi.waitFor(() => expect(status.textContent).toMatch(/results? for|No results/));

      const sent = api.map(({ url: target, body }) => [target, JSON.parse(body).type]);
      const tracked = attr(bodyOf(html), 'data-page-view') !== undefined;
      const expected = [];
      if (on('events') && tracked) expected.push(['/api/event', 'page_view']);
      if (on('events') && search) expected.push(['/api/event', 'search']);
      expect(sent).toEqual(expected);
      // Without the switch's module, its widgets aren't there to send anything.
      expect(dom.document.querySelectorAll('[data-rating]').length > 0).toBe(on('ratings') && /problems\/|start/.test(url));
      expect(dom.document.querySelector('dialog') !== null).toBe(on('feedback') && url !== '/404.html');
    });
  });
});

// ---- All off ------------------------------------------------------------------------

describe('all off', () => {
  const { dir } = builds.find((b) => b.name === 'all off');

  it('loads no script on Getting urgent help, only menu.js on the plain pages, and problems.js too on Home', () => {
    expect(scriptsOf(pageAt(dir, '/urgent-help/'))).toEqual([]);
    for (const url of ['/about/', '/contact/', '/help/', '/privacy/', '/404.html']) expect(scriptsOf(pageAt(dir, url)), url).toEqual(['/js/menu.js']);
    expect(scriptsOf(pageAt(dir, '/'))).toEqual(['/js/menu.js', '/js/problems.js']);
  });

  it('loads no module that can call the API on any page', () => {
    for (const { file, html } of readHtmlPages(dir)) {
      for (const src of scriptsOf(html)) expect(['/js/menu.js', '/js/players.js', '/js/solutions.js', '/js/problems.js', '/js/search.js'], `${file}: ${src}`).toContain(src);
    }
  });
});
