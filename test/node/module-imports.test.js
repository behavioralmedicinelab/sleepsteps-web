// The browser modules' import graph (SPEC §11): each page loads its modules
// as separate <script type="module"> tags, so one that fails to load (a
// network error, a blocked file) stops only itself and the modules that
// import it, statically, and the rest of the page keeps working. These tests
// pin each module's imports, which decide what fails together, and run the
// built pages in the small test DOM (mini-dom.js) with one module failing to
// load: its dependants never run, so their markup stays as it works without
// JavaScript, and the page's other modules still do their part. They read the
// site built with every feature on (test/global-setup.js).
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { attr, listFiles, pageAt, tags } from './helpers.js';
import { MemoryStorage, installDom } from './mini-dom.js';

const site = inject('builtSiteOn');
const CONSOLE = ['log', 'info', 'warn', 'error', 'debug', 'trace'];

// Every module in src/js/ and the modules it imports statically.
const IMPORTS = {
  'admin-export.js': [],
  'api.js': [],
  'events.js': ['./usage-prefs.js'],
  'feedback.js': ['./api.js'],
  'menu.js': [],
  'players.js': [],
  'problems.js': [],
  'rating.js': ['./api.js'],
  'search-config.js': [],
  'search.js': ['./search-config.js'],
  'solutions.js': ['./players.js'],
  'stats-switch.js': ['./usage-prefs.js'],
  'usage-prefs.js': [],
};

/** A module's static imports and re-exports, from its source. */
function staticImports(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...code.matchAll(/^\s*(?:import|export)\s(?:[^'";]*?\sfrom\s)?['"]([^'"]+)['"]/gm)].map((m) => m[1]);
}

/** The modules that can't run if `name` fails to load: itself and everything that imports it, directly or not. */
function failsWith(name) {
  const out = new Set([name]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [module, imports] of Object.entries(IMPORTS)) {
      if (!out.has(module) && imports.some((i) => out.has(i.replace(/^\.\//, '')))) {
        out.add(module);
        grew = true;
      }
    }
  }
  return [...out].sort();
}

describe('static imports (SPEC §11)', () => {
  it('pins every module in src/js/', () => {
    expect(listFiles('src/js', (f) => f.endsWith('.js') && !f.includes('/'))).toEqual(Object.keys(IMPORTS));
  });

  it.each(Object.entries(IMPORTS))('%s imports %j, and only from this folder', (name, expected) => {
    const source = readFileSync(`src/js/${name}`, 'utf8');
    expect(staticImports(source)).toEqual(expected);
  });

  it('has one dynamic import: search.js loading MiniSearch from the address the page gives', () => {
    for (const name of Object.keys(IMPORTS)) {
      const code = readFileSync(`src/js/${name}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code.match(/\bimport\s*\(([^)]*)\)/g) ?? [], name).toEqual(name === 'search.js' ? ['import(root.dataset.minisearch)'] : []);
    }
  });

  it('fails together: api.js takes ratings and feedback, usage-prefs.js the usage statistics, players.js the solution cards', () => {
    expect(failsWith('api.js')).toEqual(['api.js', 'feedback.js', 'rating.js']);
    expect(failsWith('usage-prefs.js')).toEqual(['events.js', 'stats-switch.js', 'usage-prefs.js']);
    expect(failsWith('players.js')).toEqual(['players.js', 'solutions.js']);
    expect(failsWith('search-config.js')).toEqual(['search-config.js', 'search.js']);
    for (const name of ['menu.js', 'problems.js', 'admin-export.js']) expect(failsWith(name)).toEqual([name]);
  });

  it('loads every module a page names, and never a shared one (api.js, usage-prefs.js, search-config.js) on its own', () => {
    const named = new Set();
    for (const file of listFiles(site, (f) => f.endsWith('.html'))) {
      for (const tag of tags(pageAt(site, `/${file}`), 'script')) named.add(attr(tag, 'src').replace(/^\/js\//, ''));
    }
    expect([...named].sort()).toEqual(['events.js', 'feedback.js', 'menu.js', 'players.js', 'problems.js', 'rating.js', 'search.js', 'solutions.js', 'stats-switch.js']);
  });
});

// ---- One module failing on a built page -------------------------------------------

describe('a module that fails to load, on the built pages (SPEC §2, §11)', () => {
  let dom;
  let api;

  beforeEach(() => {
    for (const method of CONSOLE) vi.spyOn(console, method);
  });

  afterEach(() => {
    for (const method of CONSOLE) expect(console[method], `console.${method}`).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    for (const name of Object.keys(IMPORTS)) vi.doUnmock(`../../src/js/${name}`);
    vi.resetModules();
    dom?.restore();
    dom = undefined;
  });

  /**
   * Open a built page and run each of its modules as the browser would, one
   * <script type="module"> at a time, with `broken` failing to load.
   * Returns { ran, failed }: the page's modules that ran and that didn't.
   */
  async function open(url, broken) {
    api = [];
    const html = pageAt(site, url);
    const record = (target, init) => (api.push({ url: target, body: init?.body }), Promise.resolve({ ok: false, status: 404 }));
    dom = installDom(html, {
      localStorage: new MemoryStorage(),
      sessionStorage: new MemoryStorage(),
      navigator: { sendBeacon: (target, body) => (api.push({ url: target, body }), true) },
      fetch: record,
    });
    vi.resetModules();
    vi.doMock(`../../src/js/${broken}`, () => {
      throw new TypeError(`Failed to fetch dynamically imported module: /js/${broken}`);
    });
    const ran = [];
    const failed = [];
    for (const tag of tags(html, 'script')) {
      const name = attr(tag, 'src').replace(/^\/js\//, '');
      try {
        await import(`../../src/js/${name.replace(/\.js$/, '')}.js`);
        ran.push(name);
      } catch {
        failed.push(name);
      }
    }
    return { ran, failed };
  }

  const $ = (selector) => dom.document.querySelector(selector);
  const $$ = (selector) => dom.document.querySelectorAll(selector);

  it('api.js: no rating widget appears and "Send feedback" stays a link to Contact; the menu, videos and cards still work', async () => {
    const { ran, failed } = await open('/problems/tired-but-wired/', 'api.js');
    expect(failed).toEqual(['rating.js', 'feedback.js']);
    expect(ran).toEqual(['menu.js', 'events.js', 'solutions.js', 'players.js']);
    // Ratings and their rows stay hidden, as without JavaScript (SPEC §12).
    expect($$('[data-rating]').length).toBeGreaterThan(0);
    for (const widget of $$('[data-rating]')) expect(widget.hidden).toBe(true);
    for (const row of $$('[data-rating-reveal]')) expect(row.hidden).toBe(true);
    // "Send feedback" is still the plain Contact link, and the dialog stays shut (SPEC §13).
    const trigger = $('[data-feedback-trigger]');
    expect([trigger.localName, trigger.getAttribute('href')]).toEqual(['a', '/contact/']);
    expect($('dialog').hidden).toBe(true);
    // solutions.js (and players.js, which it imports) did their part, and the page view went out.
    expect($('details.solution__disclosure')).toBeNull();
    expect($('.solution__face').localName).toBe('button');
    expect(api.map((r) => [r.url, JSON.parse(r.body).type])).toEqual([['/api/event', 'page_view']]);
  });

  it('players.js: the facades stay "Watch on YouTube" links and the cards native disclosures; ratings and feedback still work', async () => {
    const { ran, failed } = await open('/problems/tired-but-wired/', 'players.js');
    expect(failed).toEqual(['solutions.js', 'players.js']);
    expect(ran).toEqual(['menu.js', 'events.js', 'rating.js', 'feedback.js']);
    expect($$('details.solution__disclosure').length).toBeGreaterThan(0);
    expect($('summary.solution__face')).not.toBeNull();
    for (const widget of $$('[data-rating]')) expect(widget.hidden).toBe(false);
    expect($('[data-feedback-trigger]').localName).toBe('button');
  });

  it('usage-prefs.js: no usage statistics are sent, and the rest of the page works', async () => {
    const { ran, failed } = await open('/start/', 'usage-prefs.js');
    expect(failed).toEqual(['events.js']);
    expect(ran).toEqual(['menu.js', 'players.js', 'rating.js', 'feedback.js']);
    expect(api).toEqual([]);
    for (const widget of $$('[data-rating]')) expect(widget.hidden).toBe(false);
  });

  it('usage-prefs.js on the privacy page: the switch stays as without JavaScript, explaining, with its button hidden', async () => {
    const { ran, failed } = await open('/privacy/', 'usage-prefs.js');
    expect(failed).toEqual(['stats-switch.js']);
    expect(ran).toEqual(['menu.js', 'feedback.js']);
    expect($('[data-stats-status]').textContent).toBe(
      'Turning usage statistics off here needs JavaScript. Without JavaScript, your browser sends us no usage statistics.',
    );
    expect($('[data-stats-toggle]').hidden).toBe(true);
    expect($('[data-stats-status]').getAttribute('role')).toBeNull();
  });

  it('search-config.js: the search page keeps its route to Sleep problems, and sends nothing', async () => {
    const { ran, failed } = await open('/search/', 'search-config.js');
    expect(failed).toEqual(['search.js']);
    expect(ran).toEqual(['menu.js', 'events.js', 'feedback.js']);
    expect($('[data-search-fallback]').hidden).toBe(false);
    expect($('[data-search-results]').hidden).toBe(true);
    expect(api).toEqual([]);
  });

  it('menu.js: the other modules still run, and the page keeps its no-JavaScript menu', async () => {
    const { ran, failed } = await open('/problems/tired-but-wired/', 'menu.js');
    expect(failed).toEqual(['menu.js']);
    expect(ran).toEqual(['events.js', 'solutions.js', 'rating.js', 'players.js', 'feedback.js']);
    expect($('details.solution__disclosure')).toBeNull();
    expect($('[data-feedback-trigger]').localName).toBe('button');
    for (const widget of $$('[data-rating]')) expect(widget.hidden).toBe(false);
  });
});
