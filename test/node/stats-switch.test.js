// The privacy page's "Turn off usage statistics" button (SPEC §10.1, §15.2):
// its built HTML, which must make sense without JavaScript, and
// src/js/stats-switch.js run on that HTML in the small test DOM
// (mini-dom.js), with working, blocked and full storage. Last, a choice made
// here stops events.js on the next page.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { attr, elementByClass, pageAt, tags, text } from './helpers.js';
import { MemoryStorage, installDom } from './mini-dom.js';

const site = inject('builtSite');
const html = pageAt(site, '/privacy/');
const config = JSON.parse(readFileSync('site.config.json', 'utf8'));

const VISIT_KEY = 'sleepsteps-visit';
const OFF_KEY = 'sleepsteps-stats-off';
const NO_JS = 'Turning usage statistics off here needs JavaScript. Without JavaScript, your browser sends us no usage statistics.';
const ON = 'Usage statistics are on in this browser.';
const OFF = 'Usage statistics are off in this browser.';
const NOT_SAVED = "Your browser didn't let us save that choice.";
const NO_STORAGE =
  "Your browser isn't letting this website save anything, so it can't remember a choice to turn usage statistics off. Usage statistics stay on in this browser.";

const CONSOLE = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
let dom;

beforeEach(() => {
  for (const method of CONSOLE) vi.spyOn(console, method);
});

afterEach(() => {
  for (const method of CONSOLE) expect(console[method], `console.${method}`).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  dom?.restore();
  dom = undefined;
});

describe.runIf(config.features.events)('the built privacy page', () => {
  const block = elementByClass(html, 'stats-switch', 'div');

  it('puts the switch under "Turning off usage statistics", with no placeholder left', () => {
    expect(block).toBeTruthy();
    const section = html.slice(html.indexOf('<h3>Turning off usage statistics</h3>'), html.indexOf('<h3>Blocking cookies</h3>'));
    expect(section).toContain(block);
    expect(html).not.toMatch(/class="placeholder"[^>]*>\[The “Turn off usage statistics” switch/);
    expect(text(section)).toContain('Your choice is saved in this browser only.');
  });

  it('without JavaScript, explains and hides the button (no live region yet)', () => {
    const status = tags(block, 'p')[0];
    expect(attr(status, 'data-stats-status')).toBe('');
    expect(attr(status, 'role')).toBeUndefined();
    expect(text(block)).toBe(`${NO_JS} Turn off usage statistics`);
    const button = tags(block, 'button')[0];
    expect([attr(button, 'type'), attr(button, 'hidden'), attr(button, 'aria-pressed')]).toEqual(['button', '', undefined]);
    expect(attr(button, 'class')).toMatch(/\bbutton button--primary\b/);
  });

  it('loads stats-switch.js and no other usage statistics module', () => {
    expect(tags(html, 'script').map((t) => attr(t, 'src'))).toEqual(['/js/menu.js', '/js/stats-switch.js']);
  });
});

/** Run stats-switch.js on the built privacy page with these stores. */
async function open({ local = new MemoryStorage(), session = new MemoryStorage() } = {}) {
  dom = installDom(html, { localStorage: local, sessionStorage: session });
  vi.resetModules();
  await import('../../src/js/stats-switch.js');
  const $ = (selector) => dom.document.querySelector(selector);
  return { status: $('[data-stats-status]'), button: $('[data-stats-toggle]'), local, session };
}

describe.runIf(config.features.events)('src/js/stats-switch.js', () => {
  it('shows the state and the button, and makes the status line a live region', async () => {
    const { status, button } = await open();
    expect(status.textContent).toBe(ON);
    expect(status.getAttribute('role')).toBe('status');
    expect([button.hidden, button.textContent, button.hasAttribute('aria-pressed')]).toEqual([false, 'Turn off usage statistics', false]);
  });

  it('turns statistics off, deleting the visit code, and back on, keeping focus on the button', async () => {
    const session = new MemoryStorage({ [VISIT_KEY]: '2f1c4e1e-9a51-4b0e-8a39-2f0d1c7a6b5e' });
    const { status, button, local } = await open({ session });
    button.focus();

    button.click();
    expect(local.getItem(OFF_KEY)).toBe('1');
    expect(session.getItem(VISIT_KEY)).toBeNull();
    expect([status.textContent, button.textContent]).toEqual([OFF, 'Turn on usage statistics']);
    expect(dom.document.activeElement).toBe(button);

    button.click();
    expect(local.getItem(OFF_KEY)).toBeNull();
    expect([status.textContent, button.textContent]).toEqual([ON, 'Turn off usage statistics']);
    expect(dom.document.activeElement).toBe(button);
  });

  it('starts from a choice saved earlier', async () => {
    const { status, button } = await open({ local: new MemoryStorage({ [OFF_KEY]: '1' }) });
    expect([status.textContent, button.textContent]).toEqual([OFF, 'Turn on usage statistics']);
  });

  it('when the browser blocks storage, keeps the button hidden and says statistics stay on', async () => {
    const { status, button } = await open({ local: 'blocked', session: 'blocked' });
    expect(status.textContent).toBe(NO_STORAGE);
    expect(button.hidden).toBe(true);
    expect(status.hasAttribute('role')).toBe(false);
  });

  it("says so when the browser won't save the choice, and still deletes the visit code", async () => {
    const local = new MemoryStorage({}, { full: true });
    const session = new MemoryStorage({ [VISIT_KEY]: '2f1c4e1e-9a51-4b0e-8a39-2f0d1c7a6b5e' });
    const { status, button } = await open({ local, session });
    button.click();
    expect(status.textContent).toBe(`${NOT_SAVED} ${ON}`);
    expect(button.textContent).toBe('Turn off usage statistics');
    expect(local.length).toBe(0);
    expect(session.length).toBe(0);
  });

  it('checks the choice was kept: a store that ignores it counts as not saved', async () => {
    const ignoring = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    const { status, button } = await open({ local: ignoring });
    button.click();
    expect(status.textContent).toBe(`${NOT_SAVED} ${ON}`);
    expect(button.textContent).toBe('Turn off usage statistics');
  });

  it('shows a choice made in another tab, when it changes or when the page comes back from the back/forward cache', async () => {
    const { status, local } = await open();
    local.setItem(OFF_KEY, '1');
    dom.window.dispatchEvent(Object.assign(new Event('storage'), { key: 'unrelated' }));
    expect(status.textContent).toBe(ON);
    dom.window.dispatchEvent(Object.assign(new Event('storage'), { key: OFF_KEY }));
    expect(status.textContent).toBe(OFF);

    local.removeItem(OFF_KEY);
    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    dom.window.dispatchEvent(restored);
    expect(status.textContent).toBe(ON);
  });

  it('stops events.js on the next page: nothing is sent', async () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    const { button } = await open({ local, session });
    button.click();
    dom.restore();

    const beacons = [];
    dom = installDom(pageAt(site, '/problems/pain/'), {
      localStorage: local,
      sessionStorage: session,
      navigator: { sendBeacon: (url, body) => beacons.push(body) > 0 },
    });
    vi.resetModules();
    await import('../../src/js/events.js');
    dom.document.dispatchEvent(new CustomEvent('sleepsteps:event', { detail: { type: 'handout_open', detail: { media: 'x' } } }));
    expect(beacons).toEqual([]);
    expect(session.length).toBe(0);
  });
});

// With features.events off, the page has no switch, and says why (the built
// site can't show this: site.config.json is fixed for the test build).
describe('the privacy page with features.events off', () => {
  const require = createRequire(import.meta.url);
  const nunjucks = createRequire(require.resolve('@11ty/eleventy'))('nunjucks');
  const body = readFileSync('content/pages/privacy.md', 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
  const render = (events) =>
    new nunjucks.Environment(null, { autoescape: true }).renderString(body, { site: { features: { events } } });

  it('renders no switch, and says there is nothing to turn off', () => {
    const off = render(false);
    expect(off).not.toMatch(/data-stats-(switch|status|toggle)/);
    expect(off).toContain("This website isn't collecting usage statistics at the moment, so there is nothing to turn off.");
    expect(off).not.toContain('Your choice is saved in this browser only.');
    // Nor the two storage rows events.js would use, or the note about the visit code.
    expect(off).not.toMatch(/sleepsteps-visit|sleepsteps-stats-off/);
    // Only exactly true counts as on, as for the Worker and moduleScripts.
    expect(render('true')).not.toMatch(/data-stats-switch|sleepsteps-visit/);
    const on = render(true);
    expect(on).toContain('data-stats-switch');
    expect(on).toMatch(/sleepsteps-visit/);
    expect(on).not.toContain("This website isn't collecting usage statistics");
  });
});
