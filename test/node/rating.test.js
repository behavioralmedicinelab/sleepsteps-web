// The ratings widget (SPEC §11, §12; M4): where the built site renders
// it and what it ships, which pages load src/js/rating.js, the sources of
// rating.js and api.js, and both modules run on the built pages in the small
// test DOM (mini-dom.js). Every request body is also run through the
// Worker's own check (worker/routes/rate.js) against the built pages.json, so
// the browser sends exactly what the Worker accepts. The markup macros are
// checked in components.test.js and page-problem.test.js.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import configure from '../../eleventy.config.js';
import { SEND_FAILED, TIMEOUT_MS, postJson, succeeded } from '../../src/js/api.js';
// Its constants only: with no document here, the module itself does nothing.
import { STARS, thanksText } from '../../src/js/rating.js';
import { pageIndex } from '../../worker/lib/pages.js';
import { RATE_KEYS, validateRating } from '../../worker/routes/rate.js';
import { validateContent } from '../../scripts/validate-content.js';
import { attr, elementByClass, pageAt, readHtmlPages, tags, text } from './helpers.js';
import { MemoryStorage, installDom } from './mini-dom.js';

// The site built with every feature on, whatever site.config.json says, so
// none of these checks is skipped while features.ratings is off (SPEC §11).
// The pages with the switch off are checked in features-off.test.js.
const site = inject('builtSiteOn');
const pagesJson = JSON.parse(readFileSync('worker/generated/pages.json', 'utf8'));
const index = pageIndex(pagesJson);
const { model } = validateContent(process.cwd());

const PROBLEM = '/problems/tired-but-wired/';
const THANKS = (n) => `Thanks. You rated this ${n} of 5.`;
const CONSOLE = ['log', 'info', 'warn', 'error', 'debug', 'trace'];

/** Every element (opening tag to its matching close) with this class. */
function elements(html, className, tagName = '[a-z0-9]+') {
  const found = [];
  let rest = html;
  for (let el = elementByClass(rest, className, tagName); el; el = elementByClass(rest, className, tagName)) {
    found.push(el);
    rest = rest.slice(rest.indexOf(el) + el.length);
  }
  return found;
}

const mainOf = (html) => html.slice(html.indexOf('<main'), html.indexOf('</main>'));
const ratedIn = (html) => [...html.matchAll(/\sdata-rating="([^"]*)"/g)].map((m) => m[1]);
const scriptsOf = (html) => tags(html, 'script').map((t) => attr(t, 'src'));
const pageIdOf = (html) => attr(tags(html, 'body')[0], 'data-page-id');

// ---- The built site ----------------------------------------------------------

describe('built pages and the ratings widget (SPEC §12)', () => {
  const pages = readHtmlPages(site);
  const problems = [...model.problems.entries()];
  const chapters = model.start.data.chapters.map((c) => c.video);
  const expectedOn = (file) => {
    const slug = file.match(/^problems\/([^/]+)\/index\.html$/)?.[1];
    if (slug && model.problems.has(slug)) {
      const { data } = model.problems.get(slug);
      return [data.problem_video, ...(data.solutions ?? []).map((s) => s.video)];
    }
    return file === 'start/index.html' ? chapters : [];
  };

  it.each(pages.map((p) => [p.file, p.html]))('%s has one widget per video, in page order, and only on problem pages and Start here', (file, html) => {
    expect(ratedIn(html)).toEqual(expectedOn(file));
  });

  it('renders widgets on exactly the 36 problem pages (13 of them stand-alone) and Start here', () => {
    const rated = pages.filter((p) => ratedIn(p.html).length).map((p) => p.file);
    expect(rated).toHaveLength(37);
    expect(problems.filter(([, p]) => p.data.standalone === true)).toHaveLength(13);
    expect(pages.filter((p) => p.file === 'start/index.html' && ratedIn(p.html).length === 2)).toHaveLength(1);
  });

  it('names in data-rating only videos pages.json lets that page rate', () => {
    for (const { file, html } of pages) {
      const page = pageIdOf(html);
      for (const id of ratedIn(html)) expect(pagesJson[page]?.videos, `${file}: ${id}`).toContain(id);
    }
  });

  it.each(pages.map((p) => [p.file, p.html]))('%s loads rating.js exactly when it renders a widget', (file, html) => {
    expect(scriptsOf(html).filter((s) => s === '/js/rating.js')).toHaveLength(ratedIn(html).length ? 1 : 0);
  });

  it('loads rating.js on exactly 37 pages, and builds api.js beside it', () => {
    const loading = pages.filter((p) => scriptsOf(p.html).includes('/js/rating.js'));
    expect(loading).toHaveLength(37);
    expect(existsSync(path.join(site, 'js/rating.js'))).toBe(true);
    expect(existsSync(path.join(site, 'js/api.js'))).toBe(true);
  });

  describe('on problem pages', () => {
    describe.each(problems.map(([slug, p]) => [slug, p.data]))('/problems/%s/', (slug, data) => {
      const main = mainOf(pageAt(site, `/problems/${slug}/`));
      const solutions = data.solutions ?? [];

      // The row of controls under a video ends with its widget, after
      // "Audio only" and the handout. The row is never hidden: it always
      // holds those two (SPEC §7.1), so only the widget waits for rating.js.
      const checkRow = (row, id) => {
        const widget = elementByClass(row, 'rating', 'div');
        expect(tags(widget, 'div')[0], id).toBe(`<div class="rating" data-rating="${id}" hidden>`);
        expect(row.slice(row.indexOf(widget) + widget.length).trim(), id).toBe('</div>');
        expect(row, id).toMatch(/class="format-button"[\s\S]*<div class="rating"/);
        expect(tags(row, 'div')[0], id).toBe('<div class="video-controls">');
      };

      it('ends the row under the problem video with the widget', () => {
        const block = elementByClass(main, 'problem-video', 'div');
        const video = elementByClass(block, 'video', 'div');
        const row = elementByClass(block, 'video-controls', 'div');
        expect(block.indexOf(row)).toBeGreaterThan(block.indexOf(video) + video.length - 1);
        checkRow(row, data.problem_video);
      });

      it('ends the row under each card\'s video with its widget, and puts no rating summary in the closed card', () => {
        const cards = elements(main, 'solution', 'li');
        expect(cards).toHaveLength(solutions.length);
        cards.forEach((card, i) => {
          const id = solutions[i].video;
          const row = elementByClass(elementByClass(card, 'solution__panel', 'div'), 'video-controls', 'div');
          checkRow(row, id);
          expect(elementByClass(card, 'solution__face', 'summary')).not.toMatch(/rating|You rated/);
          expect(card).not.toMatch(/solution__meta/);
        });
        expect(main).not.toMatch(/data-rating-summary|data-rating-reveal/);
      });
    });
  });

  describe('each widget', () => {
    const widgets = pages.flatMap(({ file, html }) => elements(html, 'rating', 'div').map((w) => [file, w]));

    it('are all checked here', () => {
      expect(widgets.length).toBe(pages.reduce((n, p) => n + ratedIn(p.html).length, 0));
      expect(widgets.length).toBeGreaterThan(37);
    });

    it.each(widgets)('%s: ships hidden, unchecked and without a live region: the legend, five stars and the status line, and no notice', (file, html) => {
      const id = attr(tags(html, 'div')[0], 'data-rating');
      expect(attr(tags(html, 'div')[0], 'hidden')).toBe('');
      // The legend, then the video's title for screen readers.
      const legend = elementByClass(html, 'rating__legend', 'legend');
      expect(legend).toMatch(/^<legend class="rating__legend">Was this helpful\?<span class="visually-hidden"> [^<]+<\/span><\/legend>$/);
      expect(text(legend)).toBe(`Was this helpful? ${model.videos.get(id).data.title}`);
      // Five radios, 1 to 5, one name, none checked, each labelled.
      const radios = tags(html, 'input');
      expect(radios).toHaveLength(STARS);
      radios.forEach((radio, i) => {
        expect([attr(radio, 'type'), attr(radio, 'name'), attr(radio, 'value'), attr(radio, 'autocomplete'), attr(radio, 'checked')]).toEqual(
          ['radio', `rating-${id}`, String(i + 1), 'off', undefined],
        );
        const label = html.match(new RegExp(`<label class="rating__star" for="${attr(radio, 'id')}">([\\s\\S]*?)</label>`));
        expect(text(label[1])).toBe(i ? `${i + 1} stars` : '1 star');
      });
      // The status line, empty (decision a2 = B) and not yet role="status".
      const status = tags(html, 'p').find((t) => /\sdata-rating-status[\s>]/.test(t));
      expect(attr(status, 'role')).toBeUndefined();
      expect(elementByClass(html, 'rating__status', 'p')).toMatch(/^<p [^>]*><\/p>$/);
      // The sizers hold the longest messages rating.js shows.
      expect(elements(html, 'rating__sizer', 'p').map(text)).toEqual([thanksText(STARS), SEND_FAILED]);
      // Nothing else: no §15.1 ratings notice, link or summary (project lead,
      // 2026-11-06). The status box closes the widget.
      expect(tags(html, 'legend')).toHaveLength(1);
      expect(tags(html, 'fieldset')).toHaveLength(1);
      expect(tags(html, 'a')).toEqual([]);
      expect(html).not.toMatch(/notice-text|anonymous|About the information|privacy/i);
      expect(html).toMatch(/<\/fieldset>\s*<div class="rating__status-box">[\s\S]*<\/div>\s*<\/div>$/);
    });
  });

  it('shows every Start here row without JavaScript: every video has its audio and handout now (SPEC §7.1)', () => {
    const main = mainOf(pageAt(site, '/start/'));
    const rows = elements(main, 'video-controls', 'div');
    expect(rows).toHaveLength(chapters.length);
    rows.forEach((row, i) => {
      const { handout, audio } = model.videos.get(chapters[i]).data;
      expect([Boolean(handout), Boolean(audio)], chapters[i]).toEqual([true, true]);
      expect(tags(row, 'div')[0], chapters[i]).toBe('<div class="video-controls">');
      expect(row, chapters[i]).toMatch(/class="format-button"/);
    });
    // No row holds only the widget, so none waits for rating.js.
    expect(main).not.toMatch(/data-rating-reveal/);
  });
});

// The same layout with the switch's other values (features-off.test.js
// checks the pages built with it off).
describe('base.njk and features.ratings', () => {
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
  const render = (ratings, data) =>
    env.render('layouts/base.njk', {
      site: { siteName: 'SleepSteps', features: { ratings, feedback: false, events: false } },
      title: 'A page',
      page_id: 'a-page',
      header: 'minimal',
      content: '<main id="main"></main>',
      ...data,
    });

  it.each([
    [{ scripts: ['solutions.js', 'rating.js', 'players.js'] }, ['/js/solutions.js', '/js/rating.js', '/js/players.js'], ['/js/solutions.js', '/js/players.js']],
    [{ scripts: ['players.js', 'rating.js'] }, ['/js/players.js', '/js/rating.js'], ['/js/players.js']],
    [{ scripts: ['problems.js'] }, ['/js/problems.js'], ['/js/problems.js']],
  ])('%j loads %j with features.ratings on and %j with it off', (data, on, off) => {
    expect(scriptsOf(render(true, data))).toEqual(on);
    expect(scriptsOf(render(false, data))).toEqual(off);
    expect(scriptsOf(render('true', data))).toEqual(off);
  });
});

// ---- Sources -----------------------------------------------------------------

describe('rating.js and api.js sources (SPEC §11, §12, §15.4)', () => {
  const code = (file) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const rating = code('src/js/rating.js');
  const api = code('src/js/api.js');

  it('rating.js imports only api.js, and sends only to /api/rate', () => {
    expect([...rating.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1])).toEqual(['./api.js']);
    expect(rating.match(/['"`]\/api\/[^'"`]*['"`]/g)).toEqual(["'/api/rate'"]);
    expect(api).not.toMatch(/^import /m);
    expect(api.match(/['"`]\/api\/[^'"`]*['"`]/g)).toBeNull();
  });

  it.each([
    ['src/js/rating.js', rating],
    ['src/js/api.js', api],
  ])('%s stores nothing, reports no usage event, sends no visit code and styles nothing', (file, source) => {
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|caches\./);
    expect(source).not.toMatch(/sendBeacon|XMLHttpRequest|sleepsteps:event|sleepsteps-|session_id|usage-prefs/);
    expect(source).not.toMatch(/\.style\b|innerHTML|outerHTML|insertAdjacentHTML|setAttribute\(\s*['"]style/);
    expect(source).not.toMatch(/console\./);
  });

  it('api.js leaves credentials, mode and the referrer alone, and never reads the answer\'s body', () => {
    expect(api).not.toMatch(/credentials|mode:|referrer|\.json\(\)|\.text\(\)|\.body\b|retry/);
    expect(TIMEOUT_MS).toBe(5000);
    expect(SEND_FAILED).toBe("Couldn't send right now — please try again later");
  });

  it('rating.js sends exactly the keys the Worker requires', () => {
    expect(rating).toMatch(/\(\{ page_id: pageId, video_id: state\.videoId, stars: n \}\)/);
    expect(RATE_KEYS).toEqual(['page_id', 'video_id', 'stars']);
  });
});

// ---- api.js --------------------------------------------------------------------

describe('api.js postJson', () => {
  let dom;
  let calls;
  afterEach(() => {
    dom?.restore();
    dom = undefined;
    vi.useRealTimers();
  });

  const install = (fetch) => {
    calls = [];
    const record = fetch && ((url, init) => (calls.push({ url, init }), fetch(url, init)));
    dom = installDom('<!doctype html><html><head></head><body></body></html>', { fetch: record });
  };

  it('POSTs JSON once and resolves to the status', async () => {
    install(() => Promise.resolve({ ok: true, status: 204 }));
    await expect(postJson('/api/x', { a: 1, b: 'é' }, { keepalive: true })).resolves.toBe(204);
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    expect(url).toBe('/api/x');
    expect(Object.keys(init).sort()).toEqual(['body', 'headers', 'keepalive', 'method', 'signal']);
    expect([init.method, init.headers, init.body, init.keepalive]).toEqual(['POST', { 'Content-Type': 'application/json' }, '{"a":1,"b":"é"}', true]);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal.aborted).toBe(false);
  });

  it('sends without keepalive unless asked', async () => {
    install(() => Promise.resolve({ status: 200 }));
    await postJson('/api/x', {});
    await postJson('/api/x', {}, { keepalive: 'yes' });
    expect(calls.map((c) => c.init.keepalive)).toEqual([false, false]);
  });

  it.each([404, 429, 500, 503, 302])('resolves to %i, which is not success, and does not retry', async (status) => {
    install(() => Promise.resolve({ status }));
    const result = await postJson('/api/x', {});
    expect([result, succeeded(result)]).toEqual([status, false]);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['a rejected fetch', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a fetch that throws', () => {
      throw new TypeError('Failed to fetch');
    }],
    ['an answer without a status', () => Promise.resolve({})],
    ['a fetch that returns nothing', () => undefined],
  ])('resolves to 0 for %s, once', async (name, fetch) => {
    install(fetch);
    await expect(postJson('/api/x', {})).resolves.toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('resolves to 0 without window.fetch', async () => {
    install(undefined);
    await expect(postJson('/api/x', {})).resolves.toBe(0);
  });

  it('gives up after 5 seconds, aborting the request, and clears its timer when the answer comes first', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    install(() => new Promise(() => {}));
    let result;
    postJson('/api/x', {}).then((status) => (result = status));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(result).toBeUndefined();
    expect(calls[0].init.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe(0);
    expect(calls[0].init.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    dom.restore();
    install(() => Promise.resolve({ status: 204 }));
    await expect(postJson('/api/x', {})).resolves.toBe(204);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('succeeded() is true for 2xx only', () => {
    expect([200, 201, 204, 299].map(succeeded)).toEqual([true, true, true, true]);
    expect([0, 199, 300, 404, 500, '204', undefined, 204.5].map(succeeded)).toEqual(Array(8).fill(false));
  });
});

// ---- rating.js on the built pages ---------------------------------------------

describe('rating.js in the browser (SPEC §11, §12)', () => {
  let dom;
  let requests; // every fetch: { url, init, body, answer(status), fail() }
  let mode; // 'manual' | number (answer at once with that status) | 'reject' | 'redirect' | 'missing' | 'hang'
  let events; // sleepsteps:event reports

  beforeEach(() => {
    for (const method of CONSOLE) vi.spyOn(console, method);
  });

  afterEach(() => {
    for (const method of CONSOLE) expect(console[method], `console.${method}`).not.toHaveBeenCalled();
    expect(events ?? []).toEqual([]);
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

  /** Open a built page and run `modules` on it, freshly imported. */
  async function open(url, { modules = ['rating'], answer = 204, html, before, local, session } = {}) {
    requests = [];
    events = [];
    mode = answer;
    dom = installDom(html ?? pageAt(site, url), {
      fetch: answer === 'missing' ? undefined : fetchStub,
      localStorage: local,
      sessionStorage: session,
    });
    dom.document.addEventListener('sleepsteps:event', (event) => events.push(event.detail));
    before?.(dom);
    vi.resetModules();
    const loaded = [];
    for (const name of modules) loaded.push(await import(`../../src/js/${name}.js`));
    return loaded.at(-1);
  }

  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const $ = (selector) => dom.document.querySelector(selector);
  const $$ = (selector) => dom.document.querySelectorAll(selector);
  const widget = (id) => $(`[data-rating="${id}"]`);
  const radio = (id, n) => dom.document.getElementById(`rating-${id}-${n}`);
  const radios = (id) => [1, 2, 3, 4, 5].map((n) => radio(id, n));
  const checked = (id) => radios(id).findIndex((r) => r.checked) + 1;
  const status = (id) => widget(id).querySelector('[data-rating-status]');
  // What the closed card shows of a video's rating: nothing (no summary
  // line, project lead, 2026-11-06). Only the status line in the open card's
  // row says what was rated.
  const cardShows = (id) => {
    const card = dom.document.getElementById(`solution-${id}`);
    const face = card.querySelector('.solution__face').textContent;
    return face.match(/You rated[^.]*\./)?.[0] ?? '';
  };
  const event = (type, props = {}) => Object.assign(new Event(type, { bubbles: true }), props);

  /**
   * Move focus as a browser does: focusout on the focused element, whose
   * relatedTarget is where focus goes (null when it goes nowhere, as when a
   * label is pressed or the window loses focus), then focusin on `to`.
   */
  function moveFocus(to) {
    const active = dom.document.activeElement;
    const from = active === dom.document.body ? null : active;
    if (from === to) return;
    from?.dispatchEvent(event('focusout', { relatedTarget: to }));
    if (to) {
      to.focus();
      to.dispatchEvent(event('focusin', { relatedTarget: from }));
    } else {
      from?.blur();
    }
  }

  /**
   * An arrow key, in the order headless Chrome gave on the built page:
   * keydown on the focused star (Tab first puts focus on the checked star,
   * or the first), focus moves to star n, then star n gets a click, which
   * checks it before the click's listeners run, change follows, and keyup
   * lands on star n. Real arrows move one star at a time; here any star can
   * be the next.
   */
  function arrowTo(id, n, key = 'ArrowRight') {
    const active = dom.document.activeElement;
    if (!(active?.classList?.contains('rating__input') && widget(id).contains(active))) moveFocus(radio(id, checked(id) || 1));
    dom.document.activeElement.dispatchEvent(event('keydown', { key }));
    moveFocus(radio(id, n));
    radio(id, n).click();
    radio(id, n).dispatchEvent(event('keyup', { key }));
  }

  /** What a press on star n's label hits: the star icon's shape. */
  const iconOf = (id, n) => {
    const svg = widget(id).querySelector(`label[for="rating-${id}-${n}"] svg`);
    return svg.children[0] ?? svg;
  };

  /**
   * A mouse, pen or touch press on star n, in the order headless Chrome
   * gave for real input on the built page: pointerdown and mousedown on the
   * star's label; focusout from the focused radio with relatedTarget null,
   * since a label can't take focus; pointerup and mouseup; then the label's
   * click, after which the label focuses star n and clicks it (change
   * follows only if it wasn't checked). With touch (a tap), pointerup comes
   * before mousedown.
   */
  function press(id, n, pointerType = 'mouse') {
    const icon = iconOf(id, n);
    icon.dispatchEvent(event('pointerdown', { pointerType }));
    if (pointerType === 'touch') icon.dispatchEvent(event('pointerup', { pointerType }));
    icon.dispatchEvent(event('mousedown'));
    moveFocus(null);
    if (pointerType !== 'touch') icon.dispatchEvent(event('pointerup', { pointerType }));
    icon.dispatchEvent(event('mouseup'));
    icon.dispatchEvent(event('click'));
    moveFocus(radio(id, n));
    radio(id, n).click();
  }

  /**
   * Space on the focused star: keydown and keyup, then a click only if the
   * star isn't checked. Chrome (as headless Chrome showed on the built page)
   * and Safari fire no click for Space on a checked radio.
   */
  function space() {
    const star = dom.document.activeElement;
    star.dispatchEvent(event('keydown', { key: ' ' }));
    star.dispatchEvent(event('keyup', { key: ' ' }));
    if (!star.checked) star.click();
  }

  /** Count the change events from here on. */
  function countChanges() {
    const count = { changes: 0 };
    dom.document.addEventListener('change', () => count.changes++);
    return count;
  }

  const PROBLEM_VIDEO = 'tired-but-wired-about';
  const CARD_VIDEO = 'conditioning';

  describe('on load', () => {
    it('reveals every widget, and every row of controls, and makes each status line a live region', async () => {
      await open(PROBLEM, { modules: ['solutions', 'rating'] });
      const ids = [...$$('[data-rating]')].map((w) => w.getAttribute('data-rating'));
      expect(ids).toEqual(['tired-but-wired-about', ...model.problems.get('tired-but-wired').data.solutions.map((s) => s.video)]);
      for (const id of ids) {
        expect(widget(id).hidden, id).toBe(false);
        expect(status(id).getAttribute('role')).toBe('status');
        expect(status(id).textContent).toBe('');
        expect(radios(id).some((r) => r.checked || r.disabled)).toBe(false);
      }
      expect($$('[data-rating-summary]')).toEqual([]);
      // No row of controls is ever hidden: each holds "Audio only" and the handout.
      for (const row of $$('.video-controls')) expect(row.hidden).toBe(false);
      expect($$('[data-rating-reveal]')).toHaveLength(0);
      expect(requests).toEqual([]);
    });

    it('unchecks a star the browser restored', async () => {
      await open(PROBLEM, { before: () => (radio(PROBLEM_VIDEO, 3).checked = true) });
      expect(checked(PROBLEM_VIDEO)).toBe(0);
      expect(requests).toEqual([]);
    });

    it('on Start here, reveals the two widgets', async () => {
      await open('/start/', { modules: ['players', 'rating'] });
      expect([...$$('[data-rating]')].map((w) => [w.getAttribute('data-rating'), w.hidden])).toEqual(
        model.start.data.chapters.map((c) => [c.video, false]),
      );
      expect([...$$('.video-controls')].map((row) => row.hidden)).toEqual([false, false]);
      expect($$('[data-rating-reveal]')).toHaveLength(0);
      radio('how-to-use-this-program', 5).click();
      await settle();
      expect(requests.map((r) => r.body)).toEqual([{ page_id: 'start', video_id: 'how-to-use-this-program', stars: 5 }]);
      expect(validateRating(requests[0].body, index)).toEqual({ row: { page: 'start', video: 'how-to-use-this-program', stars: 5 } });
      expect(status('how-to-use-this-program').textContent).toBe(THANKS(5));
    });

    it('shows nothing and sends nothing on a page without a page id', async () => {
      const html = pageAt(site, PROBLEM).replace(/ data-page-id="[^"]*"/, '');
      await open(PROBLEM, { html, modules: ['solutions', 'rating'] });
      for (const w of $$('[data-rating]')) expect(w.hidden).toBe(true);
      expect(status(PROBLEM_VIDEO).hasAttribute('role')).toBe(false);
      radio(PROBLEM_VIDEO, 4).click();
      await settle();
      expect(requests).toEqual([]);
    });

    it('leaves a widget whose markup is wrong hidden, and the others working', async () => {
      const html = pageAt(site, PROBLEM).replace(/<input [^>]*id="rating-conditioning-5"[^>]*>/, '');
      await open(PROBLEM, { html });
      expect(widget(CARD_VIDEO).hidden).toBe(true);
      expect(status(CARD_VIDEO).hasAttribute('role')).toBe(false);
      expect(widget(PROBLEM_VIDEO).hidden).toBe(false);
      radio(CARD_VIDEO, 2).click();
      radio(PROBLEM_VIDEO, 2).click();
      await settle();
      expect(requests.map((r) => r.body.video_id)).toEqual([PROBLEM_VIDEO]);
    });
  });

  describe('sending a choice', () => {
    it('sends one POST the Worker accepts when a star is clicked, with keepalive', async () => {
      await open(PROBLEM, { answer: 'manual' });
      radio(PROBLEM_VIDEO, 4).click();
      expect(requests).toHaveLength(1);
      const [{ url, init, body }] = requests;
      expect(url).toBe('/api/rate');
      expect([init.method, init.headers, init.keepalive, init.signal instanceof AbortSignal]).toEqual(['POST', { 'Content-Type': 'application/json' }, true, true]);
      expect(init.body).toBe('{"page_id":"tired-but-wired","video_id":"tired-but-wired-about","stars":4}');
      expect(Object.keys(body)).toEqual(RATE_KEYS);
      expect(validateRating(body, index)).toEqual({ row: { page: 'tired-but-wired', video: PROBLEM_VIDEO, stars: 4 } });
      // Nothing changes while it is in flight.
      expect([status(PROBLEM_VIDEO).textContent, checked(PROBLEM_VIDEO)]).toEqual(['', 4]);
      expect(radios(PROBLEM_VIDEO).some((r) => r.disabled)).toBe(false);
      requests[0].answer(204);
      await settle();
      expect(status(PROBLEM_VIDEO).textContent).toBe(THANKS(4));
    });

    it('thanks the visitor in the status line only, and sends a changed rating as a new request', async () => {
      await open(PROBLEM, { modules: ['solutions', 'rating'] });
      radio(CARD_VIDEO, 4).click();
      await settle();
      expect([status(CARD_VIDEO).textContent, cardShows(CARD_VIDEO)]).toEqual([THANKS(4), '']);
      radio(CARD_VIDEO, 2).click();
      await settle();
      expect(requests.map((r) => r.body.stars)).toEqual([4, 2]);
      expect([status(CARD_VIDEO).textContent, cardShows(CARD_VIDEO), checked(CARD_VIDEO)]).toEqual([THANKS(2), '', 2]);
      for (const r of requests) expect(validateRating(r.body, index).row).toBeTruthy();
    });

    it('sends every video on the page as itself, each accepted by the Worker', async () => {
      await open(PROBLEM, { modules: ['solutions', 'rating'] });
      const ids = [...$$('[data-rating]')].map((w) => w.getAttribute('data-rating'));
      ids.forEach((id, i) => radio(id, (i % 5) + 1).click());
      await settle();
      expect(requests.map((r) => [r.body.video_id, r.body.stars])).toEqual(ids.map((id, i) => [id, (i % 5) + 1]));
      for (const r of requests) expect(validateRating(r.body, index).row, r.body.video_id).toBeTruthy();
    });

    it('keeps widgets independent', async () => {
      await open(PROBLEM, { answer: 'manual' });
      radio(PROBLEM_VIDEO, 3).click();
      radio(CARD_VIDEO, 5).click();
      expect(requests.map((r) => [r.body.video_id, r.body.stars])).toEqual([[PROBLEM_VIDEO, 3], [CARD_VIDEO, 5]]);
      requests[1].answer(500);
      requests[0].answer(204);
      await settle();
      expect([status(PROBLEM_VIDEO).textContent, checked(PROBLEM_VIDEO)]).toEqual([THANKS(3), 3]);
      expect([status(CARD_VIDEO).textContent, checked(CARD_VIDEO)]).toEqual([SEND_FAILED, 0]);
    });

    it('works whichever of solutions.js and rating.js runs first', async () => {
      for (const modules of [['solutions', 'rating'], ['rating', 'solutions']]) {
        await open(PROBLEM, { modules });
        expect($$('details.solution__disclosure')).toEqual([]);
        radio(CARD_VIDEO, 3).click();
        await settle();
        expect(status(CARD_VIDEO).textContent).toBe(THANKS(3));
        dom.restore();
        dom = undefined;
      }
    });

    it('stores nothing and works with storage blocked or usage statistics off', async () => {
      const local = new MemoryStorage({ 'sleepsteps-stats-off': '1' });
      const session = new MemoryStorage();
      await open(PROBLEM, { local, session });
      radio(PROBLEM_VIDEO, 5).click();
      await settle();
      expect(status(PROBLEM_VIDEO).textContent).toBe(THANKS(5));
      expect([...local.items.keys()]).toEqual(['sleepsteps-stats-off']);
      expect(session.length).toBe(0);
      dom.restore();
      await open(PROBLEM, { local: 'blocked', session: 'blocked' });
      radio(PROBLEM_VIDEO, 1).click();
      await settle();
      expect(status(PROBLEM_VIDEO).textContent).toBe(THANKS(1));
    });
  });

  describe('failures (SPEC §11)', () => {
    it.each([
      ['a 404 (the API is off)', 404],
      ['a 429', 429],
      ['a 500', 500],
      ['a network error', 'reject'],
      ['a redirect to the Access sign-in on another site (a preview whose session ended)', 'redirect'],
      ['a 302 with no Location, which fetch returns as it is', 302],
      ['no fetch', 'missing'],
    ])('shows the message after %s, un-checks the stars, and retries the same star', async (name, answer) => {
      await open(PROBLEM, { answer });
      radio(PROBLEM_VIDEO, 4).click();
      await settle();
      expect([status(PROBLEM_VIDEO).textContent, checked(PROBLEM_VIDEO)]).toEqual([SEND_FAILED, 0]);
      radio(PROBLEM_VIDEO, 4).click();
      await settle();
      expect(requests).toHaveLength(answer === 'missing' ? 0 : 2);
      expect(checked(PROBLEM_VIDEO)).toBe(0);
    });

    it('gives up after 5 seconds without an answer', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await open(PROBLEM, { answer: 'hang' });
      radio(PROBLEM_VIDEO, 2).click();
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
      expect([status(PROBLEM_VIDEO).textContent, checked(PROBLEM_VIDEO)]).toEqual(['', 2]);
      await vi.advanceTimersByTimeAsync(1);
      expect([status(PROBLEM_VIDEO).textContent, checked(PROBLEM_VIDEO)]).toEqual([SEND_FAILED, 0]);
      expect(requests[0].init.signal.aborted).toBe(true);
    });

    it('goes back to the last rating the API accepted', async () => {
      await open(PROBLEM, { modules: ['solutions', 'rating'], answer: 'manual' });
      radio(CARD_VIDEO, 3).click();
      requests[0].answer(204);
      await settle();
      radio(CARD_VIDEO, 5).click();
      requests[1].answer(503);
      await settle();
      expect([status(CARD_VIDEO).textContent, checked(CARD_VIDEO), cardShows(CARD_VIDEO)]).toEqual([SEND_FAILED, 3, '']);
    });

    it('announces a repeated message again: cleared, then set after a moment', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { REANNOUNCE_MS } = await open(PROBLEM, { answer: 500 });
      radio(PROBLEM_VIDEO, 1).click();
      await settle();
      expect(status(PROBLEM_VIDEO).textContent).toBe(SEND_FAILED);
      radio(PROBLEM_VIDEO, 1).click();
      await settle();
      expect(status(PROBLEM_VIDEO).textContent).toBe('');
      await vi.advanceTimersByTimeAsync(REANNOUNCE_MS);
      expect(status(PROBLEM_VIDEO).textContent).toBe(SEND_FAILED);
      expect(REANNOUNCE_MS).toBe(100);
    });
  });

  describe('one request at a time, newest wins', () => {
    it('sends a choice made while one is in flight after it ends, and shows only the last answer', async () => {
      await open(PROBLEM, { answer: 'manual' });
      radio(PROBLEM_VIDEO, 4).click();
      radio(PROBLEM_VIDEO, 5).click();
      expect(requests).toHaveLength(1);
      requests[0].answer(204);
      await settle();
      expect(requests.map((r) => r.body.stars)).toEqual([4, 5]);
      expect(status(PROBLEM_VIDEO).textContent).toBe('');
      requests[1].answer(204);
      await settle();
      expect([status(PROBLEM_VIDEO).textContent, checked(PROBLEM_VIDEO)]).toEqual([THANKS(5), 5]);
    });

    it('replaces a waiting choice, and drops it when it is the value just sent', async () => {
      await open(PROBLEM, { answer: 'manual' });
      radio(PROBLEM_VIDEO, 4).click();
      radio(PROBLEM_VIDEO, 5).click();
      radio(PROBLEM_VIDEO, 4).click();
      requests[0].answer(204);
      await settle();
      expect(requests).toHaveLength(1);
      expect([status(PROBLEM_VIDEO).textContent, checked(PROBLEM_VIDEO)]).toEqual([THANKS(4), 4]);
    });

    it('sends the waiting choice even when the one before it failed, and reports only that', async () => {
      await open(PROBLEM, { answer: 'manual' });
      radio(PROBLEM_VIDEO, 2).click();
      radio(PROBLEM_VIDEO, 3).click();
      requests[0].answer(500);
      await settle();
      expect([status(PROBLEM_VIDEO).textContent, checked(PROBLEM_VIDEO)]).toEqual(['', 3]);
      requests[1].answer(204);
      await settle();
      expect([status(PROBLEM_VIDEO).textContent, checked(PROBLEM_VIDEO)]).toEqual([THANKS(3), 3]);
    });
  });

  describe('arrow keys (decision a1 = B)', () => {
    it('holds arrow-key choices, sending the last one after 2 seconds without another change', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { HOLD_ARROW_KEYS, HOLD_MS } = await open(PROBLEM);
      expect([HOLD_ARROW_KEYS, HOLD_MS]).toEqual([true, 2000]);
      radio(PROBLEM_VIDEO, 1).focus();
      arrowTo(PROBLEM_VIDEO, 2);
      await vi.advanceTimersByTimeAsync(HOLD_MS - 1);
      arrowTo(PROBLEM_VIDEO, 3);
      arrowTo(PROBLEM_VIDEO, 4);
      await vi.advanceTimersByTimeAsync(HOLD_MS - 1);
      expect(requests).toEqual([]);
      expect(checked(PROBLEM_VIDEO)).toBe(4);
      await vi.advanceTimersByTimeAsync(1);
      await settle();
      expect(requests.map((r) => r.body.stars)).toEqual([4]);
      expect(requests[0].init.keepalive).toBe(true);
      expect(status(PROBLEM_VIDEO).textContent).toBe(THANKS(4));
    });

    it('sends at once when focus leaves the group, but not when it moves within it', async () => {
      await open(PROBLEM);
      arrowTo(PROBLEM_VIDEO, 2);
      arrowTo(PROBLEM_VIDEO, 3, 'ArrowDown');
      await settle();
      expect(requests).toEqual([]);
      moveFocus($('.problem__all a'));
      await settle();
      expect(requests.map((r) => r.body.stars)).toEqual([3]);
      // Focus leaving the page (relatedTarget null) sends too.
      arrowTo(PROBLEM_VIDEO, 2, 'ArrowLeft');
      moveFocus(null);
      await settle();
      expect(requests.map((r) => r.body.stars)).toEqual([3, 2]);
    });

    it('sends at once on Enter', async () => {
      await open(PROBLEM);
      radio(PROBLEM_VIDEO, 5).focus();
      arrowTo(PROBLEM_VIDEO, 1, 'ArrowRight');
      radio(PROBLEM_VIDEO, 1).dispatchEvent(event('keydown', { key: 'Enter' }));
      await settle();
      expect(requests.map((r) => r.body.stars)).toEqual([1]);
      expect(status(PROBLEM_VIDEO).textContent).toBe(THANKS(1));
    });

    it('sends at once, with keepalive, when the page is hidden', async () => {
      await open(PROBLEM, { answer: 'manual' });
      arrowTo(CARD_VIDEO, 3);
      expect(requests).toEqual([]);
      dom.window.dispatchEvent(new Event('pagehide'));
      expect(requests.map((r) => [r.body.video_id, r.body.stars, r.init.keepalive])).toEqual([[CARD_VIDEO, 3, true]]);
    });

    it('sends nothing when the arrows come back to the rating already accepted', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { HOLD_MS } = await open(PROBLEM);
      radio(PROBLEM_VIDEO, 3).click();
      await settle();
      radio(PROBLEM_VIDEO, 3).focus();
      arrowTo(PROBLEM_VIDEO, 4);
      arrowTo(PROBLEM_VIDEO, 3, 'ArrowLeft');
      await vi.advanceTimersByTimeAsync(HOLD_MS);
      // The thanks already shown isn't cleared to be said again.
      expect(status(PROBLEM_VIDEO).textContent).toBe(THANKS(3));
      radio(PROBLEM_VIDEO, 3).dispatchEvent(event('keydown', { key: 'Enter' }));
      dom.window.dispatchEvent(new Event('pagehide'));
      expect(requests.map((r) => r.body.stars)).toEqual([3]);
      expect(status(PROBLEM_VIDEO).textContent).toBe(THANKS(3));
    });

    it('holds a choice made while a request is in flight, and reports only the newest', async () => {
      await open(PROBLEM, { answer: 'manual' });
      radio(PROBLEM_VIDEO, 2).click();
      arrowTo(PROBLEM_VIDEO, 3);
      requests[0].answer(500);
      await settle();
      // The failure isn't shown, nor the stars reverted: a newer choice is waiting.
      expect([status(PROBLEM_VIDEO).textContent, checked(PROBLEM_VIDEO)]).toEqual(['', 3]);
      radio(PROBLEM_VIDEO, 3).dispatchEvent(event('keydown', { key: 'Enter' }));
      requests[1].answer(204);
      await settle();
      expect(requests.map((r) => r.body.stars)).toEqual([2, 3]);
      expect(status(PROBLEM_VIDEO).textContent).toBe(THANKS(3));
    });

    it.each([
      ['the hold runs out', async ({ HOLD_MS }) => vi.advanceTimersByTimeAsync(HOLD_MS)],
      ['focus leaves the group', async () => moveFocus($('.problem__all a'))],
    ])('thanks the visitor for a held star already stored once %s: clicked, then arrowed away and back while it was in flight', async (name, end) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const module = await open(PROBLEM, { modules: ['solutions', 'rating'], answer: 'manual' });
      press(CARD_VIDEO, 4);
      arrowTo(CARD_VIDEO, 5);
      arrowTo(CARD_VIDEO, 4, 'ArrowLeft');
      requests[0].answer(204);
      await settle();
      // Stored, but a star is still held, so the status waits for the hold.
      expect([status(CARD_VIDEO).textContent, checked(CARD_VIDEO)]).toEqual(['', 4]);
      await end(module);
      await settle();
      expect(requests.map((r) => r.body.stars)).toEqual([4]);
      expect([status(CARD_VIDEO).textContent, checked(CARD_VIDEO)]).toEqual([THANKS(4), 4]);
    });

    it('thanks the visitor when the arrows come back to the stored star after a failure', async () => {
      await open(PROBLEM, { answer: 'manual' });
      press(PROBLEM_VIDEO, 3);
      requests[0].answer(204);
      await settle();
      press(PROBLEM_VIDEO, 5);
      requests[1].answer(500);
      await settle();
      expect([status(PROBLEM_VIDEO).textContent, checked(PROBLEM_VIDEO)]).toEqual([SEND_FAILED, 3]);
      arrowTo(PROBLEM_VIDEO, 4);
      arrowTo(PROBLEM_VIDEO, 3, 'ArrowLeft');
      radio(PROBLEM_VIDEO, 3).dispatchEvent(event('keydown', { key: 'Enter' }));
      expect(requests).toHaveLength(2);
      expect([status(PROBLEM_VIDEO).textContent, checked(PROBLEM_VIDEO)]).toEqual([THANKS(3), 3]);
    });
  });

  describe('a click after arrowing, in the browser\'s event order (decision a1 = B)', () => {
    it.each(['mouse', 'pen', 'touch'])('a %s press on another star drops the held star and sends the pressed one at once, alone', async (pointerType) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { HOLD_MS } = await open(PROBLEM, { answer: 'manual' });
      arrowTo(PROBLEM_VIDEO, 2);
      arrowTo(PROBLEM_VIDEO, 3);
      press(PROBLEM_VIDEO, 5, pointerType);
      expect(requests.map((r) => r.body.stars)).toEqual([5]);
      expect([checked(PROBLEM_VIDEO), dom.document.activeElement]).toEqual([5, radio(PROBLEM_VIDEO, 5)]);
      requests[0].answer(204);
      await settle();
      await vi.advanceTimersByTimeAsync(HOLD_MS * 2);
      moveFocus(null);
      dom.window.dispatchEvent(new Event('pagehide'));
      expect(requests).toHaveLength(1);
      expect([status(PROBLEM_VIDEO).textContent, checked(PROBLEM_VIDEO)]).toEqual([THANKS(5), 5]);
    });

    it.each(['mouse', 'touch'])('a %s press on the held star sends it at once: it is already checked, so no change event follows', async (pointerType) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { HOLD_MS } = await open(PROBLEM);
      arrowTo(PROBLEM_VIDEO, 2);
      arrowTo(PROBLEM_VIDEO, 3);
      const count = countChanges();
      press(PROBLEM_VIDEO, 3, pointerType);
      expect(count.changes).toBe(0);
      expect(requests.map((r) => r.body.stars)).toEqual([3]);
      await settle();
      await vi.advanceTimersByTimeAsync(HOLD_MS);
      expect(requests).toHaveLength(1);
      expect(status(PROBLEM_VIDEO).textContent).toBe(THANKS(3));
    });

    it('Space on the held star sends it at once, though it is checked, so no click or change follows', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { HOLD_MS } = await open(PROBLEM);
      arrowTo(PROBLEM_VIDEO, 2);
      arrowTo(PROBLEM_VIDEO, 4);
      const count = countChanges();
      space();
      expect(count.changes).toBe(0);
      expect(requests.map((r) => r.body.stars)).toEqual([4]);
      await settle();
      await vi.advanceTimersByTimeAsync(HOLD_MS);
      expect(requests).toHaveLength(1);
      expect(status(PROBLEM_VIDEO).textContent).toBe(THANKS(4));
    });

    it('Space on a star not yet checked sends it at once, and a modified arrow key is no arrow', async () => {
      await open(PROBLEM);
      moveFocus(radio(PROBLEM_VIDEO, 1));
      space();
      expect(requests.map((r) => r.body.stars)).toEqual([1]);
      // Alt+arrow doesn't move between radios, so the next change is a click's.
      radio(PROBLEM_VIDEO, 1).dispatchEvent(event('keydown', { key: 'ArrowRight', altKey: true }));
      radio(PROBLEM_VIDEO, 3).click();
      await settle();
      expect(requests.map((r) => r.body.stars)).toEqual([1, 3]);
    });

    it('clicking the checked star when nothing is held sends nothing', async () => {
      await open(PROBLEM);
      press(PROBLEM_VIDEO, 2);
      await settle();
      press(PROBLEM_VIDEO, 2);
      space();
      await settle();
      expect(requests.map((r) => r.body.stars)).toEqual([2]);
    });

    it('a press on another widget\'s star sends the held star, as focus left its group, and the pressed one, each at once', async () => {
      await open(PROBLEM, { answer: 'manual' });
      arrowTo(PROBLEM_VIDEO, 2);
      press(CARD_VIDEO, 4);
      expect(requests.map((r) => [r.body.video_id, r.body.stars])).toEqual([[PROBLEM_VIDEO, 2], [CARD_VIDEO, 4]]);
    });

    it('the hold waits through a long press, and the pressed star alone is sent', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { HOLD_MS } = await open(PROBLEM);
      arrowTo(PROBLEM_VIDEO, 3);
      await vi.advanceTimersByTimeAsync(HOLD_MS - 100);
      const icon = iconOf(PROBLEM_VIDEO, 5);
      icon.dispatchEvent(event('pointerdown', { pointerType: 'touch' }));
      await vi.advanceTimersByTimeAsync(HOLD_MS);
      expect(requests).toEqual([]);
      icon.dispatchEvent(event('pointerup', { pointerType: 'touch' }));
      icon.dispatchEvent(event('mousedown'));
      moveFocus(null);
      icon.dispatchEvent(event('mouseup'));
      icon.dispatchEvent(event('click'));
      moveFocus(radio(PROBLEM_VIDEO, 5));
      radio(PROBLEM_VIDEO, 5).click();
      await vi.advanceTimersByTimeAsync(HOLD_MS);
      expect(requests.map((r) => r.body.stars)).toEqual([5]);
    });

    it('a press that ends off the stars keeps the held star, sent when the hold runs out', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { HOLD_MS } = await open(PROBLEM);
      arrowTo(PROBLEM_VIDEO, 2);
      arrowTo(PROBLEM_VIDEO, 3);
      const icon = iconOf(PROBLEM_VIDEO, 4);
      const legend = widget(PROBLEM_VIDEO).querySelector('legend');
      icon.dispatchEvent(event('pointerdown', { pointerType: 'mouse' }));
      icon.dispatchEvent(event('mousedown'));
      moveFocus(null);
      legend.dispatchEvent(event('pointerup', { pointerType: 'mouse' }));
      legend.dispatchEvent(event('mouseup'));
      // The click goes to the element holding both, so no star is clicked.
      widget(PROBLEM_VIDEO).querySelector('fieldset').dispatchEvent(event('click'));
      expect([requests, checked(PROBLEM_VIDEO)]).toEqual([[], 3]);
      await vi.advanceTimersByTimeAsync(HOLD_MS - 1);
      expect(requests).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(requests.map((r) => r.body.stars)).toEqual([3]);
    });

    it('a cancelled press (the page scrolled) keeps the held star, and focus leaving afterwards sends as usual', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const { HOLD_MS } = await open(PROBLEM, { answer: 'manual' });
      arrowTo(PROBLEM_VIDEO, 3);
      const icon = iconOf(PROBLEM_VIDEO, 5);
      icon.dispatchEvent(event('pointerdown', { pointerType: 'touch' }));
      icon.dispatchEvent(event('pointercancel', { pointerType: 'touch' }));
      await vi.advanceTimersByTimeAsync(HOLD_MS);
      expect(requests.map((r) => r.body.stars)).toEqual([3]);
      arrowTo(PROBLEM_VIDEO, 4);
      moveFocus(null);
      expect(requests).toHaveLength(1);
      requests[0].answer(204);
      await settle();
      expect(requests.map((r) => r.body.stars)).toEqual([3, 4]);
    });
  });

  describe('the page hidden with a request in flight, then back from the back/forward cache', () => {
    it('sends the newest waiting star at once, and only its answer sets the accepted star and the status line', async () => {
      await open(PROBLEM, { modules: ['solutions', 'rating'], answer: 'manual' });
      press(CARD_VIDEO, 2);
      press(CARD_VIDEO, 3);
      arrowTo(CARD_VIDEO, 4);
      dom.window.dispatchEvent(new Event('pagehide'));
      expect(requests.map((r) => [r.body.stars, r.init.keepalive])).toEqual([[2, true], [4, true]]);
      const shown = () => [status(CARD_VIDEO).textContent, checked(CARD_VIDEO), cardShows(CARD_VIDEO)];
      // Back from the cache: the older answer comes first and changes nothing.
      requests[0].answer(204);
      await settle();
      expect(requests).toHaveLength(2);
      expect(shown()).toEqual(['', 4, '']);
      requests[1].answer(204);
      await settle();
      expect(shown()).toEqual([THANKS(4), 4, '']);
      // 4 is the accepted star, so arrowing on to 5 and back down to 2 sends 2.
      arrowTo(CARD_VIDEO, 5);
      for (const n of [4, 3, 2]) arrowTo(CARD_VIDEO, n, 'ArrowLeft');
      moveFocus(null);
      expect(requests.map((r) => r.body.stars)).toEqual([2, 4, 2]);
      requests[2].answer(204);
      await settle();
      expect(shown()).toEqual([THANKS(2), 2, '']);
    });

    it('ignores an older answer that comes after the newer one, even a failure', async () => {
      await open(PROBLEM, { modules: ['solutions', 'rating'], answer: 'manual' });
      press(CARD_VIDEO, 2);
      arrowTo(CARD_VIDEO, 4);
      dom.window.dispatchEvent(new Event('pagehide'));
      requests[1].answer(204);
      await settle();
      requests[0].answer(500);
      await settle();
      expect(requests).toHaveLength(2);
      expect([status(CARD_VIDEO).textContent, checked(CARD_VIDEO)]).toEqual([THANKS(4), 4]);
    });

    it('sends nothing more when the waiting star is the one in flight', async () => {
      await open(PROBLEM, { answer: 'manual' });
      press(PROBLEM_VIDEO, 2);
      press(PROBLEM_VIDEO, 5);
      press(PROBLEM_VIDEO, 2);
      dom.window.dispatchEvent(new Event('pagehide'));
      requests[0].answer(204);
      await settle();
      expect(requests.map((r) => r.body.stars)).toEqual([2]);
      expect(status(PROBLEM_VIDEO).textContent).toBe(THANKS(2));
    });
  });
});
