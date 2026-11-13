// npm run test:a11y: the local accessibility check (SPEC §20 M7), on the
// project lead's Mac only. It is not part of `npm test` or Workers Builds,
// which have no browser.
//
// `npm run test:a11y` builds the site first; this script then
// 1. serves dist/ and the Worker's /api/* and /admin pages locally
//    (server.js: the real router, a D1 stand-in with sample rows, a
//    throwaway Access token, and dist/_headers, so pages load under the real
//    Content-Security-Policy);
// 2. drives the system's Google Chrome over CDP (chrome.js; CHROME_PATH
//    overrides /Applications/Google Chrome.app) with no package but
//    axe-core, which it injects from node_modules;
// 3. runs axe-core with the WCAG 2.0, 2.1 and 2.2 A and AA tags on every
//    built page and the main states (menus, groups, the filter, an open
//    solution card with its worksheets, ratings sent and failed, search
//    results, none and
//    failed, the statistics switch, the feedback dialog's states (opened
//    from the footer and from a video's "Feedback" button), pages
//    without JavaScript, the admin summary, error and download pages) at 320
//    and 1280px, and with WCAG 1.4.12's text spacing at 320px on every page
//    and on the open phone menu, solution card and feedback dialog and the
//    admin summary and download pages; no state may scroll the page
//    sideways or cut off text in a box that clips (probes.js);
// 4. walks each page type with Tab and Shift+Tab at both widths (every stop
//    shows a 2px ring, is at least 44px, ends up wholly on screen, the order
//    is the same both ways and the walk comes back round, so nothing traps
//    focus), and works the phone menu, a solution card and the feedback
//    dialog (from the footer, from a video's button and from an open
//    solution card's) from the keyboard;
// 5. counts the site's own errors in every state (C2, SPEC §20 M7): CSP
//    violations, uncaught exceptions, console calls from our scripts, and
//    failed requests to this site other than the ones a state causes on
//    purpose.
// It fails (exit 1) on any WCAG violation, keyboard failure or error of the
// site's own; best-practice findings and axe's "incomplete" items are listed
// for a person to check. Exit 2: it couldn't run (no Chrome, no build). A
// state that needs a feature switched off in site.config.json is skipped,
// and the output says so.
//
// Options: --only <regex> runs the states and walks whose names match;
// --report <file> writes every result as JSON.
//
// `--serve` (npm run a11y:serve) only serves: the same local site, admin
// pages and sample data, with collection on, for a person's checks (the
// screen-reader session, zoom, print, a download; SPEC §18.4), until Ctrl+C.
// No Chrome is needed. --port <n> (default 8790) picks the port; --host
// <address> listens on that address instead of 127.0.0.1 (a LAN address,
// so NVDA in a Windows virtual machine or on another computer can reach
// it). Nothing is stored beyond the run.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, launchChrome, MAC_CHROME, openTab } from './chrome.js';
import { createD1, seedD1 } from './d1-sqlite.js';
import { CLIPPED, FOCUS_INFO, SIDEWAYS } from './probes.js';
import { startServer } from './server.js';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const WIDTHS = [320, 1280];
const HEIGHT = { 320: 800, 1280: 900 };
// axe-core's tags for WCAG 2.0, 2.1 and 2.2 at levels A and AA (2.2 added no
// level-A rule to axe).
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const only = option('--only') ? new RegExp(option('--only'), 'i') : null;
const reportFile = option('--report');
const serveOnly = args.includes('--serve');
const SERVE_PORT = 8790;

// ---------------------------------------------------------------- the states

const dayIso = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
const js = (tab, expression) => tab.evaluate(expression);

/** Every built page, by its address. */
function builtPages() {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      else if (entry.name === 'index.html') out.push(prefix);
    }
  };
  walk(DIST, '/');
  return out.sort();
}

/**
 * WCAG 1.4.12's test spacing, added through the CSSOM to a stylesheet of
 * our own (the CSP blocks a <style> element, not CSSOM rules).
 */
const textSpacing = async (tab) => {
  await js(tab, `(() => {
    const sheet = [...document.styleSheets].find((s) => s.href && new URL(s.href).origin === location.origin);
    sheet.insertRule('* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }', sheet.cssRules.length);
    sheet.insertRule('p { margin-bottom: 2em !important; }', sheet.cssRules.length);
  })()`);
  await tab.sleep(150);
};

const openMenu = async (tab) => {
  await tab.click('.mobile-menu__toggle');
  await tab.waitFor(`document.querySelector('.mobile-menu__toggle[aria-expanded="true"]')`, 2000);
};
// The enhanced face (solutions.js), never "any button in the card": the
// template's Close always carries aria-expanded="true" and stays in the DOM
// inside the hidden panel, so a looser selector matches before any card
// opens. If solutions.js didn't enhance the cards, the click finds nothing
// and throws.
//
// The open card must show worksheets (SPEC §7.6), so every state that opens
// one checks that section too: the first solution of the page these states
// use, /problems/tired-but-wired/, has three. If the content changes and it
// has none, this says so rather than letting the section go unchecked.
const WORKSHEET_SHOWN = `(() => {
  const link = document.querySelector('.solution.is-open .worksheets a[data-worksheet]');
  return !!link && link.getClientRects().length > 0;
})()`;
const openFirstCard = async (tab) => {
  await tab.click('.solution button.solution__face[aria-expanded]');
  if (!(await tab.waitFor(`document.querySelector('.solution button.solution__face[aria-expanded="true"]')`, 2000))) {
    throw new Error("the first solution card didn't open");
  }
  if (!(await js(tab, WORKSHEET_SHOWN))) {
    throw new Error("the open solution card shows no worksheets: this page's first solution needs at least one in data/worksheets.csv (SPEC §7.6)");
  }
};
const openCardAndAudio = async (tab) => {
  await openFirstCard(tab);
  await js(tab, `[...document.querySelectorAll('.solution .format-disclosure')].find((d) => d.offsetParent)?.setAttribute('open', '')`);
};
// The footer's "Send feedback" (general feedback), and the problem video's
// "Feedback" button (feedback about that video, SPEC §13). Each video's row
// has one, before the footer in the page, so the footer's is named.
const FOOTER_TRIGGER = '.site-footer [data-feedback-trigger]';
const VIDEO_TRIGGER = '.problem-video button[data-feedback-video]';
// The same button in the open solution card.
const CARD_TRIGGER = '.solution.is-open button[data-feedback-video]';
const openDialog = async (tab) => {
  await tab.click(FOOTER_TRIGGER);
  await tab.waitFor(`document.querySelector('[data-feedback-dialog]')?.open`, 3000);
};
/** Opens the dialog from the problem video's button, and fails unless it says which video it is about. */
const openDialogFromVideo = async (tab) => {
  await tab.click(VIDEO_TRIGGER);
  await tab.waitFor(`document.querySelector('[data-feedback-dialog]')?.open`, 3000);
  const about = await js(tab, `(() => { const el = document.querySelector('[data-feedback-about]'); return el && !el.hidden && el.getClientRects().length ? el.textContent : ''; })()`);
  if (!/^Video: \S/.test(about)) throw new Error(`the dialog didn't say which video it is about ("${about}")`);
};
/**
 * Waits for Turnstile's frame (inside a closed shadow root, and in a process
 * of its own, so it is found among the browser's targets); false if it
 * never came (offline).
 */
const waitForTurnstile = async (tab) => {
  for (let i = 0; i < 60; i += 1) {
    if ((await tab.thirdPartyFrames()).some((url) => url.startsWith('https://challenges.cloudflare.com/'))) {
      await tab.sleep(2500);
      return true;
    }
    await tab.sleep(200);
  }
  return false;
};
const statusText = (selector) => `[...document.querySelectorAll(${JSON.stringify(selector)})].map((e) => e.textContent.trim()).filter(Boolean).join(' | ')`;

/**
 * name; path; widths (default both); feature, a switch the state needs
 * (skipped, and said so, while it is off in site.config.json); host
 * (default 127.0.0.1, so the
 * dialog gets Cloudflare's test key; a1.localhost gets none, decision A1);
 * js: false for a page without JavaScript (noJs then runs once it has
 * loaded); apiOff, noDb and fail bend the server (server.js); status is the
 * document's expected status when it isn't 200; setup works the page into
 * the state and may return a note.
 */
function states() {
  const list = builtPages().map((p) => ({ name: `page ${p}`, path: p }));
  list.push({ name: 'page /404', path: '/404' }, { name: 'page missing', path: '/does-not-exist/', status: 404 });
  // Exports cover whole UTC days that have ended (SPEC §14.4).
  const from = dayIso(-30);
  const to = dayIso(-1);
  // WCAG 1.4.12's spacing at 320px on every page, and on the parts that
  // ship hidden and the admin pages: nothing may scroll sideways, cut off
  // text (each state checks both) or fail axe. The spacing goes in first,
  // so a part opened afterwards lays out with it.
  for (const p of [...builtPages(), '/404']) list.push({ name: `text spacing ${p}`, path: p, widths: [320], setup: textSpacing });
  const spaced = (setup) => async (tab) => {
    await textSpacing(tab);
    return setup(tab);
  };
  list.push(
    { name: 'text spacing: menu open (a problem page)', path: '/problems/pain/', widths: [320], setup: spaced(openMenu) },
    { name: 'text spacing: an area of sleep problems open (Home)', path: '/', widths: [320], setup: spaced((tab) => tab.click('[data-problems] button[aria-expanded]')) },
    { name: 'text spacing: a solution card and its audio open', path: '/problems/tired-but-wired/', widths: [320], setup: spaced(openCardAndAudio) },
    {
      name: 'text spacing: feedback open',
      feature: 'feedback',
      path: '/problems/pain/',
      widths: [320],
      setup: spaced(async (tab) => {
        await openDialog(tab);
        return (await waitForTurnstile(tab)) ? undefined : "Turnstile didn't load (offline?): checked without its widget";
      }),
    },
    {
      name: "text spacing: feedback open from a video's button",
      feature: 'feedback',
      path: '/problems/pain/',
      widths: [320],
      setup: spaced(async (tab) => {
        await openDialogFromVideo(tab);
        return (await waitForTurnstile(tab)) ? undefined : "Turnstile didn't load (offline?): checked without its widget";
      }),
    },
    { name: 'text spacing: admin summary', path: '/admin/', widths: [320], setup: textSpacing },
    { name: 'text spacing: admin download in parts', path: `/admin/export?table=feedback&from=${from}&to=${to}`, widths: [320], setup: textSpacing },
  );
  list.push(
    { name: 'menu open (Home)', path: '/', widths: [320], setup: openMenu },
    {
      name: 'menu open with TopicNav (a problem page)',
      path: '/problems/pain/',
      widths: [320],
      setup: async (tab) => {
        await openMenu(tab);
        await js(tab, `document.querySelector('.topic-nav details')?.setAttribute('open', '')`);
      },
    },
    // Home's list of sleep problems (SPEC §7.2; the Sleep problems page until 2026-11-13).
    { name: 'problems: an area open', path: '/', setup: (tab) => tab.click('[data-problems] button[aria-expanded]') },
    { name: 'problems: area named in the address', path: '/#mind' },
    { name: 'problems: the list named in the address', path: '/#sleep-problems' },
    {
      name: 'problems: the filter matches',
      path: '/',
      setup: async (tab) => {
        await js(tab, `document.querySelector('#problem-filter').focus()`);
        await tab.type('night');
        await tab.sleep(1500);
      },
    },
    {
      name: 'problems: the filter matches nothing',
      path: '/',
      setup: async (tab) => {
        await js(tab, `document.querySelector('#problem-filter').focus()`);
        await tab.type('xyzzyq');
        await tab.sleep(1500);
      },
    },
    { name: 'problem: a solution card and its audio open', path: '/problems/tired-but-wired/', setup: openCardAndAudio },
    {
      name: 'problem: a rating sent',
      feature: 'ratings',
      path: '/problems/tired-but-wired/',
      setup: async (tab) => {
        await tab.click('.problem-video .rating__star');
        const done = await tab.waitFor(`/Thanks/.test(${statusText('[data-rating-status]')})`, 6000);
        if (!done) throw new Error('the rating never said thanks');
      },
    },
    {
      name: 'problem: a rating that failed (collection off)',
      feature: 'ratings',
      path: '/problems/tired-but-wired/',
      apiOff: true,
      setup: async (tab) => {
        await tab.click('.problem-video .rating__star');
        const done = await tab.waitFor(`/Couldn't send/.test(${statusText('[data-rating-status]')})`, 6000);
        if (!done) throw new Error('the rating never showed its failure');
      },
    },
    { name: 'search: results', path: '/search/?q=sleep', setup: (tab) => expect(tab, `document.querySelector('[data-search-results] li')`, 'no results showed') },
    { name: 'search: no results', path: '/search/?q=zzqxv', setup: (tab) => expect(tab, `!document.querySelector('[data-search-empty]').hidden`, 'the no-results message never showed') },
    {
      name: 'search: the index fails',
      path: '/search/?q=sleep',
      fail: ['/search-index.json'],
      setup: (tab) => expect(tab, `!document.querySelector('[data-search-error]').hidden`, "it never said search isn't working", 17000),
    },
    {
      name: 'privacy: usage statistics turned off',
      feature: 'events',
      path: '/privacy/',
      setup: async (tab) => {
        await tab.click('[data-stats-toggle]');
        await tab.sleep(300);
      },
    },
    {
      name: 'feedback: open',
      feature: 'feedback',
      path: '/problems/pain/',
      setup: async (tab) => {
        await openDialog(tab);
        return (await waitForTurnstile(tab)) ? undefined : "Turnstile didn't load (offline?): checked without its widget";
      },
    },
    {
      name: "feedback: open from a video's button",
      feature: 'feedback',
      path: '/problems/pain/',
      setup: async (tab) => {
        await openDialogFromVideo(tab);
        return (await waitForTurnstile(tab)) ? undefined : "Turnstile didn't load (offline?): checked without its widget";
      },
    },
    {
      name: "feedback: open from a solution card's button",
      feature: 'feedback',
      path: '/problems/tired-but-wired/',
      setup: async (tab) => {
        await openFirstCard(tab);
        await tab.click(CARD_TRIGGER);
        if (!(await tab.waitFor(`document.querySelector('[data-feedback-dialog]')?.open`, 3000))) throw new Error("the card's Feedback button didn't open the dialog");
        return (await waitForTurnstile(tab)) ? undefined : "Turnstile didn't load (offline?): checked without its widget";
      },
    },
    {
      name: 'feedback: a blank message',
      feature: 'feedback',
      path: '/problems/pain/',
      setup: async (tab) => {
        await openDialog(tab);
        const note = (await waitForTurnstile(tab)) ? undefined : "Turnstile didn't load (offline?)";
        await tab.click('[data-feedback-send]');
        await tab.sleep(400);
        return note;
      },
    },
    {
      name: 'feedback: sent',
      feature: 'feedback',
      path: '/problems/pain/',
      setup: async (tab) => sendFeedback(tab, /Thanks/),
    },
    {
      name: "feedback: sent from a video's button",
      feature: 'feedback',
      path: '/problems/pain/',
      setup: async (tab) => sendFeedback(tab, /Thanks/, openDialogFromVideo),
    },
    {
      name: "feedback: couldn't send (collection off)",
      feature: 'feedback',
      path: '/problems/pain/',
      apiOff: true,
      setup: async (tab) => sendFeedback(tab, /Couldn't send/),
    },
    {
      name: "feedback: the spam check isn't working",
      feature: 'feedback',
      path: '/problems/pain/',
      blockThirdParty: true,
      setup: async (tab) => {
        await openDialog(tab);
        const shown = await tab.waitFor(`/spam check isn't working/.test(${statusText('[data-feedback-status]')})`, 17000);
        if (!shown) throw new Error("the dialog never said the spam check isn't working");
      },
    },
    {
      name: 'feedback: no usable site key (A1)',
      feature: 'feedback',
      path: '/problems/pain/',
      host: 'a1.localhost',
      setup: async (tab) => {
        await openDialog(tab);
        await tab.sleep(400);
      },
    },
    { name: 'no JavaScript: Home, with every area of sleep problems open', path: '/', js: false },
    { name: 'no JavaScript: a problem page', path: '/problems/tired-but-wired/', js: false },
    {
      // The open <details> shows the video, its row and its worksheets
      // (SPEC §7.6), plain links that need no JavaScript.
      name: 'no JavaScript: a solution card open',
      path: '/problems/tired-but-wired/',
      js: false,
      noJs: `(() => {
        const card = document.querySelector('details.solution__disclosure');
        card.open = true;
        if (!card.querySelector('.worksheets a[data-worksheet]')?.getClientRects().length) throw new Error("the open solution card shows no worksheets: this page's first solution needs at least one in data/worksheets.csv (SPEC §7.6)");
      })()`,
    },
    { name: 'no JavaScript: search', path: '/search/?q=sleep', js: false },
    { name: 'no JavaScript: privacy', path: '/privacy/', js: false },
    { name: 'no JavaScript: the menu open', path: '/', js: false, widths: [320], noJs: `document.querySelector('[data-mobile-menu]').open = true` },
    { name: 'admin: summary', path: '/admin/' },
    { name: 'admin: an invalid range', path: `/admin/?from=${to}&to=${from}`, status: 400 },
    { name: "admin: the database can't be read", path: '/admin/', noDb: true, status: 500 },
    { name: 'admin: download in parts', path: `/admin/export?table=feedback&from=${from}&to=${to}` },
    {
      name: 'admin: download in parts, done',
      path: `/admin/export?table=feedback&from=${from}&to=${to}`,
      setup: async (tab) => {
        await tab.click('button[data-export]');
        const done = await tab.waitFor(`/^Done/.test(${statusText('[data-export-status]')})`, 10000);
        if (!done) throw new Error('the download never finished');
      },
    },
  );
  return list;
}

/** Waits for `expression`, and fails the state if it never holds. */
async function expect(tab, expression, failure, timeout = 15000) {
  if (!(await tab.waitFor(expression, timeout))) throw new Error(failure);
}

async function sendFeedback(tab, expected, open = openDialog) {
  await open(tab);
  if (!(await waitForTurnstile(tab))) return "Turnstile didn't load (offline?): this state couldn't be reached";
  await js(tab, `document.querySelector('[data-feedback-dialog] textarea').focus()`);
  await tab.type('A message from the accessibility check');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await tab.click('[data-feedback-send]');
    const answered = await tab.waitFor(`/Thanks|Couldn't send/.test(${statusText('[data-feedback-status]')})`, 6000);
    if (answered) break;
    await tab.sleep(1500); // the token wasn't ready yet
  }
  const text = await js(tab, statusText('[data-feedback-status]'));
  if (!expected.test(text)) throw new Error(`the dialog said "${text}"`);
  return undefined;
}

// ------------------------------------------------------------- the error rule

/**
 * The site's own errors in a report (C2, SPEC §20 M7), and the other
 * messages, which are listed but don't count.
 */
function judge(report, { origin, state, control, documentUrl }) {
  const errors = [];
  const listed = [];
  for (const v of report.csp) errors.push(`CSP violation: ${v}`);
  for (const e of report.log) {
    if (e.source === 'security' || /Content Security Policy/i.test(e.text)) errors.push(`CSP: ${e.text}`);
    else if (e.source !== 'network') listed.push(`${e.level} (${e.source}): ${e.text}`);
  }
  for (const e of report.exceptions) errors.push(`exception: ${e}`);
  for (const c of report.console) {
    if (c.url.startsWith(origin) || c.url.startsWith('http://a1.localhost')) errors.push(`console.${c.type} from ${c.url}: ${c.text}`);
    else listed.push(`console.${c.type} (${c.url || 'no script'}): ${c.text}`);
  }
  for (const f of report.failed) {
    let url;
    try {
      url = new URL(f.url);
    } catch {
      listed.push(`failed: ${f.url} ${f.error ?? f.status}`);
      continue;
    }
    const own = url.hostname === '127.0.0.1' || url.hostname.endsWith('localhost');
    const why = f.status ? `${f.status}` : f.error || (f.blocked ? `blocked (${f.blocked})` : 'failed');
    const expected =
      (f.type === 'Document' && state.status && f.status === state.status && f.url.startsWith(documentUrl.split('#')[0])) ||
      (control.apiOff && url.pathname.startsWith('/api/') && f.status === 404) ||
      control.fail.some((prefix) => url.pathname.startsWith(prefix));
    if (own && !expected) errors.push(`failed request: ${f.method ?? ''} ${url.pathname}${url.search} ${why}`);
    else listed.push(`failed request${own ? ' (on purpose)' : ''}: ${f.url.slice(0, 120)} ${why}`);
  }
  return { errors, listed };
}

// ---------------------------------------------------------------- axe

const AXE_SOURCE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

async function runAxe(tab) {
  if ((await tab.evaluate('typeof window.axe')) !== 'object') await tab.evaluate(`${AXE_SOURCE}\n;true`);
  const options = { runOnly: { type: 'tag', values: [...WCAG_TAGS, 'best-practice'] }, iframes: false, resultTypes: ['violations', 'incomplete'] };
  return tab.evaluate(`axe.run(document, ${JSON.stringify(options)}).then((r) => ({
    version: r.testEngine.version,
    violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, wcag: v.tags.some((t) => ${JSON.stringify(WCAG_TAGS)}.includes(t)), help: v.help,
      nodes: v.nodes.map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 200), summary: (n.failureSummary || '').slice(0, 400) })) })),
    incomplete: r.incomplete.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.map((n) => n.target.join(' ')) })),
  }))`);
}

// ---------------------------------------------------------------- keyboard

/** The Tab order from the top of the page, then back with Shift+Tab. */
async function tabWalk(tab, { max = 300, inside = null } = {}) {
  const forward = [];
  const problems = [];
  let first = null;
  let previous = null;
  let wrapped = false;
  for (let i = 0; i < max; i += 1) {
    await tab.key('Tab');
    const stop = await tab.evaluate(FOCUS_INFO);
    if (stop.none) continue;
    if (first === null) first = stop.key;
    else if (stop.key === first) {
      wrapped = true;
      break;
    }
    // Tab moves through a frame's controls and a date field's parts
    // without moving document.activeElement.
    if (previous && stop.key === previous.key && !stop.frame && !stop.dateField) {
      problems.push(`focus stuck on ${stop.where} "${stop.name}"`);
      break;
    }
    previous = stop;
    forward.push(stop);
  }
  if (!wrapped && !problems.length) problems.push(`Tab never came back round within ${max} stops (a trap?)`);
  const back = [];
  if (wrapped) {
    for (let i = 0; i < max; i += 1) {
      await tab.key('Tab', { shift: true });
      const stop = await tab.evaluate(FOCUS_INFO);
      if (stop.none) continue;
      if (stop.key === first) break;
      back.push(stop);
    }
    const fwd = forward.slice(1).map((s) => s.key);
    const rev = back.map((s) => s.key).reverse();
    if (JSON.stringify(fwd) !== JSON.stringify(rev)) problems.push(`Shift+Tab order differs from Tab order (${fwd.length} stops forward, ${rev.length} back)`);
  }
  for (const stop of forward) {
    const label = `${stop.where} "${stop.name}"`;
    if (inside && !stop.inDialog) problems.push(`focus left the dialog: ${label}`);
    // Third-party frames and the browser's own date fields and players
    // draw their own focus and size their own parts (SPEC §7.5).
    if (stop.frame || stop.dateField || stop.media) continue;
    if (!stop.focusVisible) problems.push(`no :focus-visible: ${label}`);
    if (stop.ringWidth < 2) problems.push(`no 2px focus ring (${stop.outline}): ${label}`);
    // WCAG 2.4.11: never wholly hidden. And our own rule (SPEC §7.5): the
    // ring wholly on screen when it fits, except a text field's, which
    // Chrome scrolls only as far as its caret.
    if (!stop.partlyInView) problems.push(`focused element off screen (WCAG 2.4.11): ${label}`);
    else if (stop.fits && !stop.inView && !stop.textEntry) problems.push(`focus ring not wholly on screen: ${label}`);
    if (stop.w < 44 || stop.h < 44) problems.push(`target ${stop.w}×${stop.h}px, under 44px: ${label}`);
    if (stop.isDialog && stop.outlineOffset >= 0) problems.push(`the dialog's own ring is outside its border: ${label}`);
  }
  return { stops: forward.length, problems };
}

function walks() {
  const from = dayIso(-30);
  const to = dayIso(-1);
  const pages = ['/', '/start/', '/problems/tired-but-wired/', '/problems/sharing-a-bed/', '/search/?q=sleep', '/help/', '/about/', '/contact/', '/privacy/', '/urgent-help/', '/404', '/admin/', `/admin/?from=${to}&to=${from}`, `/admin/export?table=feedback&from=${from}&to=${to}`];
  const list = pages.map((p) => ({ name: `walk ${p}`, path: p, status: p.includes(`from=${to}`) ? 400 : undefined, run: (tab) => tabWalk(tab) }));
  list.push(
    {
      name: 'keys: the phone menu',
      path: '/problems/pain/',
      widths: [320],
      run: async (tab) => {
        const problems = [];
        await js(tab, `document.querySelector('.mobile-menu__toggle').focus()`);
        await tab.key('Enter');
        if (!(await tab.waitFor(`document.querySelector('.mobile-menu__toggle[aria-expanded="true"]')`, 2000))) problems.push("Enter didn't open the menu");
        await tab.key('Tab');
        await tab.key('Escape');
        await tab.sleep(150);
        const after = await js(tab, `[document.activeElement.matches('.mobile-menu__toggle'), document.querySelector('.mobile-menu__toggle').getAttribute('aria-expanded')]`);
        if (!after[0] || after[1] !== 'false') problems.push(`Escape didn't close the menu and return focus to its button (${after})`);
        return { problems };
      },
    },
    {
      name: 'keys: a solution card',
      path: '/problems/tired-but-wired/',
      run: async (tab) => {
        const problems = [];
        if (!(await js(tab, `!!document.querySelector('.solution button.solution__face')`))) return { problems: ["solutions.js didn't enhance the cards"] };
        await js(tab, `document.querySelector('.solution button.solution__face').focus()`);
        await tab.key('Enter');
        if (!(await tab.waitFor(`document.querySelector('.solution button.solution__face[aria-expanded="true"]')`, 2000))) problems.push("Enter didn't open the card");
        else if (!(await js(tab, `document.activeElement.matches('.solution.is-open .video-block__title')`))) problems.push("Opening the card didn't move focus to its title");
        // The walk then stops at each worksheet link (SPEC §7.6): its ring and 44px target are checked with the rest.
        if (!(await js(tab, WORKSHEET_SHOWN))) problems.push("The open card shows no worksheets: this page's first solution needs at least one in data/worksheets.csv (SPEC §7.6)");
        const walk = await tabWalk(tab);
        return { stops: walk.stops, problems: [...problems, ...walk.problems] };
      },
    },
    {
      name: 'keys: the feedback dialog',
      feature: 'feedback',
      path: '/problems/pain/',
      run: async (tab) => {
        const problems = [];
        await js(tab, `document.querySelector(${JSON.stringify(FOOTER_TRIGGER)}).focus()`);
        await tab.key('Enter');
        if (!(await tab.waitFor(`document.querySelector('[data-feedback-dialog]')?.open`, 3000))) return { problems: ["Enter didn't open the dialog"] };
        const about = await js(tab, `[document.querySelector('[data-feedback-about]').hidden, document.querySelector('[data-feedback-about]').textContent]`);
        if (!about[0] || about[1] !== '') problems.push(`Opened from the footer, the dialog names a video (${about})`);
        const turnstile = await waitForTurnstile(tab);
        const walk = await tabWalk(tab, { max: 40, inside: true });
        problems.push(...walk.problems);
        await js(tab, `document.querySelector('[data-feedback-dialog] textarea').focus()`);
        await tab.key('Escape');
        await tab.sleep(200);
        const after = await js(tab, `[document.querySelector('[data-feedback-dialog]').open, document.activeElement.matches(${JSON.stringify(FOOTER_TRIGGER)})]`);
        if (after[0] || !after[1]) problems.push(`Escape didn't close the dialog and return focus to "Send feedback" (${after})`);
        return { stops: walk.stops, problems, note: turnstile ? undefined : "Turnstile didn't load (offline?)" };
      },
    },
    {
      name: "keys: the feedback dialog from a video's button",
      feature: 'feedback',
      path: '/problems/pain/',
      run: async (tab) => {
        const problems = [];
        const state = `(() => {
          const about = document.querySelector('[data-feedback-about]');
          const heading = document.querySelector('.problem-video .video-block__title');
          return {
            open: document.querySelector('[data-feedback-dialog]').open,
            onButton: document.activeElement.matches(${JSON.stringify(VIDEO_TRIGGER)}),
            onFooter: document.activeElement.matches(${JSON.stringify(FOOTER_TRIGGER)}),
            about: about.hidden ? null : about.textContent,
            expected: 'Video: ' + heading.textContent.trim(),
            draft: document.querySelector('[data-feedback-dialog] textarea').value,
          };
        })()`;
        if (!(await js(tab, `(() => { const b = document.querySelector(${JSON.stringify(VIDEO_TRIGGER)}); return b && !b.hidden && b.getClientRects().length > 0; })()`))) {
          return { problems: ["feedback.js didn't show the video's Feedback button"] };
        }
        await js(tab, `document.querySelector(${JSON.stringify(VIDEO_TRIGGER)}).focus()`);
        await tab.key('Enter');
        if (!(await tab.waitFor(`document.querySelector('[data-feedback-dialog]')?.open`, 3000))) return { problems: ["Enter didn't open the dialog"] };
        const opened = await js(tab, state);
        if (opened.about !== opened.expected) problems.push(`The dialog says "${opened.about}", not "${opened.expected}"`);
        const turnstile = await waitForTurnstile(tab);
        const walk = await tabWalk(tab, { max: 40, inside: true });
        problems.push(...walk.problems);
        // A draft, then Escape: focus goes back to the video's button, not the footer's.
        await js(tab, `document.querySelector('[data-feedback-dialog] textarea').focus()`);
        await tab.type('A draft');
        await tab.key('Escape');
        await tab.sleep(200);
        const closed = await js(tab, state);
        if (closed.open || !closed.onButton) problems.push(`Escape didn't close the dialog and return focus to the video's "Feedback" button (${JSON.stringify(closed)})`);
        // Space opens it again, about the same video, with the draft kept.
        await tab.key('Space');
        if (!(await tab.waitFor(`document.querySelector('[data-feedback-dialog]')?.open`, 3000))) problems.push("Space didn't open the dialog again");
        const again = await js(tab, state);
        if (again.about !== again.expected || again.draft !== 'A draft') problems.push(`Reopened, the dialog lost its video or the draft (${JSON.stringify(again)})`);
        await tab.key('Escape');
        await tab.sleep(200);
        // From the footer the same dialog names no video, and keeps the draft.
        await js(tab, `document.querySelector(${JSON.stringify(FOOTER_TRIGGER)}).focus()`);
        await tab.key('Enter');
        await tab.waitFor(`document.querySelector('[data-feedback-dialog]')?.open`, 3000);
        const footer = await js(tab, `(() => { const about = document.querySelector('[data-feedback-about]'); return { hidden: about.hidden, text: about.textContent, draft: document.querySelector('[data-feedback-dialog] textarea').value }; })()`);
        if (!footer.hidden || footer.text !== '' || footer.draft !== 'A draft') problems.push(`Opened from the footer afterwards, the dialog still names the video or lost the draft (${JSON.stringify(footer)})`);
        await tab.key('Escape');
        await tab.sleep(200);
        const end = await js(tab, state);
        if (end.open || !end.onFooter) problems.push(`Escape didn't return focus to "Send feedback" (${JSON.stringify(end)})`);
        return { stops: walk.stops, problems, note: turnstile ? undefined : "Turnstile didn't load (offline?)" };
      },
    },
    {
      // A button inside an open solution card: the dialog is about the
      // card's video, and Escape puts focus back on that button, with the
      // card still open. On a1.localhost the dialog has no site key (A1), so
      // nothing here waits for Cloudflare.
      name: "keys: the feedback dialog from a solution card's button",
      feature: 'feedback',
      path: '/problems/tired-but-wired/',
      host: 'a1.localhost',
      run: async (tab) => {
        const problems = [];
        if (!(await js(tab, `!!document.querySelector('.solution button.solution__face')`))) return { problems: ["solutions.js didn't enhance the cards"] };
        await js(tab, `document.querySelector('.solution button.solution__face').focus()`);
        await tab.key('Enter');
        if (!(await tab.waitFor(`document.querySelector('.solution button.solution__face[aria-expanded="true"]')`, 2000))) return { problems: ["Enter didn't open the card"] };
        const state = `(() => {
          const button = document.querySelector(${JSON.stringify(CARD_TRIGGER)});
          const about = document.querySelector('[data-feedback-about]');
          return {
            shown: Boolean(button) && !button.hidden && button.getClientRects().length > 0,
            open: document.querySelector('[data-feedback-dialog]').open,
            onButton: Boolean(button) && document.activeElement === button,
            about: about.hidden ? null : about.textContent,
            expected: 'Video: ' + (document.querySelector('.solution.is-open .video-block__title')?.textContent.trim() ?? ''),
          };
        })()`;
        if (!(await js(tab, state)).shown) return { problems: ["feedback.js didn't show the open card's Feedback button"] };
        await js(tab, `document.querySelector(${JSON.stringify(CARD_TRIGGER)}).focus()`);
        await tab.key('Enter');
        if (!(await tab.waitFor(`document.querySelector('[data-feedback-dialog]')?.open`, 3000))) return { problems: ["Enter didn't open the dialog"] };
        const opened = await js(tab, state);
        if (opened.about !== opened.expected) problems.push(`The dialog says "${opened.about}", not "${opened.expected}"`);
        await tab.key('Escape');
        await tab.sleep(200);
        const closed = await js(tab, state);
        if (closed.open || !closed.onButton) problems.push(`Escape didn't close the dialog and return focus to the open card's "Feedback" button (${JSON.stringify(closed)})`);
        return { problems };
      },
    },
    {
      name: 'keys: the feedback dialog when it scrolls',
      feature: 'feedback',
      path: '/problems/pain/',
      widths: [320],
      height: 500,
      host: 'a1.localhost',
      run: async (tab) => {
        await js(tab, `document.querySelector(${JSON.stringify(FOOTER_TRIGGER)}).focus()`);
        await tab.key('Enter');
        await tab.waitFor(`document.querySelector('[data-feedback-dialog]')?.open`, 3000);
        await tab.sleep(400);
        return tabWalk(tab, { max: 40, inside: true });
      },
    },
  );
  return list;
}

// ---------------------------------------------------------------- main

function loadBuild() {
  if (!existsSync(path.join(DIST, 'index.html')) || !existsSync(path.join(ROOT, 'worker/generated/pages.json'))) return null;
  return {
    pages: JSON.parse(readFileSync(path.join(ROOT, 'worker/generated/pages.json'), 'utf8')),
    site: JSON.parse(readFileSync(path.join(ROOT, 'site.config.json'), 'utf8')),
  };
}

const NO_BUILD = 'No build found: run `npm run test:a11y` (or `npm run a11y:serve`), which builds the site first, or `npm run build`.';

/** --serve: the local site and admin pages with sample data, until Ctrl+C. */
async function serve() {
  const build = loadBuild();
  if (!build) {
    console.error(NO_BUILD);
    return 2;
  }
  const port = option('--port') === undefined ? SERVE_PORT : Number(option('--port'));
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`--port needs a port number, not "${option('--port')}".`);
    return 2;
  }
  const host = option('--host');
  const db = createD1(path.join(ROOT, 'migrations'));
  await seedD1(db, build.pages, Date.now());
  let server;
  try {
    server = await startServer({ dist: DIST, ...build, db, pageRows: 50, port, host });
  } catch (error) {
    db.close();
    console.error(`Couldn't start the local server: ${error.message}${error.code === 'EADDRINUSE' ? ' (try another --port)' : ''}`);
    return 2;
  }
  const base = server.origin;
  console.log(
    [
      `Serving the built site, the API (collection on) and the admin pages with sample data at ${base}/`,
      'Nothing is stored beyond the run, and only the feedback dialog\'s test widget comes from Cloudflare; the admin pages sign themselves in with a throwaway token.',
      '',
      `  The site:                 ${base}/`,
      `  Admin summary:            ${base}/admin/`,
      `  Admin, an invalid range:  ${base}/admin/?from=${dayIso(0)}&to=${dayIso(-7)}`,
      `  Admin download page:      ${base}/admin/export?table=feedback&from=${dayIso(-30)}&to=${dayIso(-1)}`,
      '',
      host ? 'On a host other than localhost or 127.0.0.1, the feedback dialog says the spam check isn\'t working (decision A1), and Chrome logs a harmless error about Cross-Origin-Opener-Policy.' : null,
      'Press Ctrl+C to stop.',
    ]
      .filter((line) => line !== null)
      .join('\n'),
  );
  await new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  await server.close();
  db.close();
  console.log('\nStopped.');
  return 0;
}

async function main() {
  if (serveOnly) return serve();
  const chrome = findChrome();
  if (!chrome) {
    console.error(
      `npm run test:a11y needs Google Chrome, and found no executable at ${process.env.CHROME_PATH || MAC_CHROME}.\n` +
        'Install Chrome, or set CHROME_PATH to a Chrome or Chromium executable (on a Mac, the file inside the .app bundle, such as ' +
        `${MAC_CHROME}). This check runs only on a Mac with Chrome (SPEC §20 M7); npm test does not need it.`,
    );
    return 2;
  }
  const build = loadBuild();
  if (!build) {
    console.error(NO_BUILD);
    return 2;
  }
  const { pages, site } = build;
  const db = createD1(path.join(ROOT, 'migrations'));
  await seedD1(db, pages, Date.now());
  const results = [];
  let failures = 0;
  const incomplete = new Map();
  const advisories = new Map();
  let axeVersion = '';
  let chromeHandle;
  let server;
  let version = '';

  const reset = (state) => {
    server.control.apiOff = Boolean(state.apiOff);
    server.control.noDb = Boolean(state.noDb);
    server.control.fail = state.fail ?? [];
  };
  const urlFor = (state) => `http://${state.host ?? '127.0.0.1'}:${server.port}${state.path}`;

  try {
    try {
      chromeHandle = await launchChrome(chrome);
    } catch (error) {
      console.error(`${error.message}. Check that Chrome opens normally, or set CHROME_PATH to another Chrome or Chromium executable.`);
      return 2;
    }
    const { browser } = chromeHandle;
    version = chromeHandle.version;
    // Chrome quit or crashed: every later check would only say "couldn't
    // check", so stop (the finally below still cleans up).
    const stopIfChromeIsGone = () => {
      if (browser.ws.readyState !== WebSocket.OPEN) throw Object.assign(new Error('Chrome closed the connection partway through the run; stopped.'), { plain: true });
    };
    server = await startServer({ dist: DIST, pages, site, db, pageRows: 50 });
    await browser.send('Browser.setDownloadBehavior', { behavior: 'deny' });
    console.log(`${version}, ${server.origin}`);
    const off = (item) => item.feature && site.features?.[item.feature] !== true;
    for (const item of [...states(), ...walks()].filter((x) => off(x) && (!only || only.test(x.name)))) {
      console.log(`${item.name}: skipped, features.${item.feature} is off in site.config.json`);
    }
    for (const state of states()) {
      if ((only && !only.test(state.name)) || off(state)) continue;
      for (const width of state.widths ?? WIDTHS) {
        reset(state);
        const result = { kind: 'axe', state: state.name, width, errors: [], violations: [], listed: [] };
        let tab;
        try {
          tab = await openTab(browser);
          if (state.blockThirdParty) {
            await tab.send('Network.setBlockedURLs', { urls: ['*://challenges.cloudflare.com/*'] });
          }
          const documentUrl = urlFor(state);
          await tab.navigate(documentUrl, { width, height: HEIGHT[width], js: state.js !== false });
          const note = state.setup ? await state.setup(tab) : undefined;
          if (typeof note === 'string') result.note = note;
          if (state.js === false) {
            await tab.send('Emulation.setScriptExecutionDisabled', { value: false });
            if (state.noJs) await tab.evaluate(state.noJs);
            await tab.sleep(150);
          }
          const axe = await runAxe(tab);
          axeVersion = axe.version;
          result.violations = axe.violations.filter((v) => v.wcag);
          for (const v of axe.violations.filter((x) => !x.wcag)) advisories.set(v.id, [...(advisories.get(v.id) ?? []), `${state.name} @${width}`]);
          for (const i of axe.incomplete) incomplete.set(i.id, [...(incomplete.get(i.id) ?? []), { state: `${state.name} @${width}`, nodes: i.nodes }]);
          const sideways = await tab.evaluate(SIDEWAYS);
          if (sideways) result.errors.push(`the page scrolls sideways (${sideways}px wide at ${width}px)`);
          for (const clipped of await tab.evaluate(CLIPPED)) result.errors.push(`text cut off: ${clipped}`);
          const judged = judge(await tab.takeReport(), { origin: server.origin, state, control: server.control, documentUrl });
          result.errors.push(...judged.errors);
          result.listed = judged.listed;
        } catch (error) {
          result.errors.push(`couldn't check: ${error.message}`);
        }
        await tab?.close();
        const bad = result.violations.length + result.errors.length;
        failures += bad ? 1 : 0;
        results.push(result);
        const summary = bad
          ? `FAIL ${[...result.violations.map((v) => `${v.id} (${v.nodes.length})`), ...result.errors].join('; ')}`
          : `ok${result.note ? ` (${result.note})` : ''}`;
        console.log(`${state.name} @${width}: ${summary}`);
        stopIfChromeIsGone();
      }
    }

    for (const walk of walks()) {
      if ((only && !only.test(walk.name)) || off(walk)) continue;
      for (const width of walk.widths ?? WIDTHS) {
        reset(walk);
        const result = { kind: 'keyboard', state: walk.name, width, errors: [], listed: [] };
        let tab;
        try {
          tab = await openTab(browser);
          const documentUrl = urlFor(walk);
          await tab.navigate(documentUrl, { width, height: walk.height ?? HEIGHT[width] });
          const outcome = await walk.run(tab);
          result.stops = outcome.stops;
          result.note = outcome.note;
          result.errors.push(...outcome.problems);
          const judged = judge(await tab.takeReport(), { origin: server.origin, state: walk, control: server.control, documentUrl });
          result.errors.push(...judged.errors);
          result.listed = judged.listed;
        } catch (error) {
          result.errors.push(`couldn't check: ${error.message}`);
        }
        await tab?.close();
        failures += result.errors.length ? 1 : 0;
        results.push(result);
        const stops = result.stops === undefined ? '' : `${result.stops} stops, `;
        console.log(`${walk.name} @${width}: ${stops}${result.errors.length ? `FAIL ${result.errors.join('; ')}` : `ok${result.note ? ` (${result.note})` : ''}`}`);
        stopIfChromeIsGone();
      }
    }
  } finally {
    await chromeHandle?.close();
    await server?.close();
    db.close();
  }

  const listed = new Map();
  for (const r of results) {
    for (const line of r.listed) {
      const key = line.replace(/:\d+\//, ':<port>/');
      listed.set(key, (listed.get(key) ?? 0) + 1);
    }
  }
  console.log(`\naxe-core ${axeVersion}, ${version}`);
  if (advisories.size) {
    console.log('\nBest-practice findings (not WCAG failures; listed for a person to judge):');
    for (const [id, where] of advisories) console.log(`  ${id}: ${where.length} state(s), e.g. ${where[0]}`);
  }
  if (incomplete.size) {
    console.log('\naxe could not decide these ("incomplete"); check them by hand:');
    for (const [id, where] of incomplete) {
      console.log(`  ${id}, in ${where.length} state(s):`);
      const targets = new Map();
      for (const { state, nodes } of where) for (const node of nodes) targets.set(node, [...(targets.get(node) ?? []), state]);
      for (const [node, states] of targets) console.log(`    ${node} (${states.length}: ${states.slice(0, 2).join('; ')}${states.length > 2 ? '; …' : ''})`);
    }
  }
  if (listed.size) {
    console.log("\nOther messages, listed but not counted (third-party, or caused on purpose; SPEC §20 M7):");
    for (const [line, count] of listed) console.log(`  ${count}× ${line}`);
  }
  if (reportFile) writeFileSync(reportFile, JSON.stringify({ chrome: version, axe: axeVersion, results, incomplete: Object.fromEntries(incomplete), advisories: Object.fromEntries(advisories) }, null, 1));
  const checked = results.length;
  console.log(failures ? `\n${failures} of ${checked} checks failed.` : `\nAll ${checked} checks passed.`);
  return failures ? 1 : 0;
}

process.exitCode = await main().catch((error) => {
  console.error(error.plain ? error.message : error);
  return 1;
});
