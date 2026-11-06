// Usage statistics (SPEC §10.1, §10.2, §11). base.njk loads this module only
// when site.config.json's features.events is on, and only on the pages that
// can send something: pages that send a page view (<body data-page-view>:
// problem pages, Start here and Getting urgent help) and pages that load
// players.js or search.js. It comes before those modules, so it is listening
// before they report anything.
//
// - On load, a page marked data-page-view sends one page_view. A page
//   restored from the back/forward cache doesn't run this again, so it sends
//   none.
// - players.js and search.js report through a `sleepsteps:event` DOM event on
//   document, with detail { type, detail }. This module sends each one at
//   once, as its own beacon, with only the SPEC §10.2 keys of that type's
//   detail: nothing is batched or held back, so the reports players.js makes
//   as the page is hidden still get out.
// - The page comes from <body data-page-id>. Every type but search carries
//   the visit code (session_id), created the first time one is sent and kept
//   in sessionStorage as sleepsteps-visit, so the search page never creates
//   it. A search is sent without it.
// - If usage statistics are turned off (usage-prefs.js, read again before
//   every send), nothing is sent and this tab's visit code is deleted.
//
// It sends with navigator.sendBeacon, or fetch with keepalive if sendBeacon
// is missing, refuses or throws, as text/plain JSON to /api/event (SPEC
// §14.1). Nothing reads the response. Every failure is silent (SPEC §11): no
// console calls, and the page never waits on the API. It never reads the
// user agent, screen, referrer or the address's query, and never sends a
// time (the Worker sets it).
import { VISIT_KEY, forgetVisit, statsOff } from './usage-prefs.js';

const ENDPOINT = '/api/event';

/** type -> the keys of its detail (SPEC §10.2). worker/routes/event.js keeps the same list. */
export const SHAPES = new Map([
  ['page_view', []],
  ['search', ['q', 'results']],
  ['video_play', ['media', 'furthest']],
  ['audio_play', ['media', 'furthest']],
  ['handout_open', ['media']],
]);

/** A v4 UUID as crypto.randomUUID() writes it, the only visit code the Worker accepts. */
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// This page's visit code when the tab can't keep one (storage blocked or
// full): it then lasts for this page only (SPEC §10.1).
let memoryId = null;
let storageFailed = false;

/** A random v4 UUID. crypto.randomUUID needs a secure context and a newer browser. */
function newId() {
  const { crypto } = window;
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** This tab's visit code: the stored one, or a new one, stored if the tab allows. */
function visitId() {
  if (!storageFailed) {
    try {
      const stored = window.sessionStorage.getItem(VISIT_KEY);
      if (stored !== null && UUID_V4.test(stored)) return stored;
    } catch {
      storageFailed = true;
    }
  }
  if (storageFailed) {
    if (!memoryId) memoryId = newId();
    return memoryId;
  }
  const id = newId();
  try {
    window.sessionStorage.setItem(VISIT_KEY, id);
  } catch {
    storageFailed = true;
    memoryId = id;
  }
  return id;
}

/** Send one event. Nothing reads the answer, and nothing that fails is reported. */
function post(payload) {
  const body = JSON.stringify(payload);
  try {
    const { navigator } = window;
    if (typeof navigator?.sendBeacon === 'function' && navigator.sendBeacon(ENDPOINT, body)) return;
  } catch {
    // Fall back to fetch.
  }
  try {
    const sent = window.fetch(ENDPOINT, { method: 'POST', body, keepalive: true });
    if (sent && typeof sent.catch === 'function') sent.catch(() => {});
  } catch {
    // Nothing else to try.
  }
}

/** Stop: usage statistics are off. */
function forget() {
  memoryId = null;
  forgetVisit();
}

function send(type, detail) {
  try {
    const keys = SHAPES.get(type);
    const page = document.body?.getAttribute('data-page-id');
    if (!keys || !page) return;
    if (statsOff()) {
      forget();
      return;
    }
    const source = detail !== null && typeof detail === 'object' ? detail : {};
    if (!keys.every((key) => Object.prototype.hasOwnProperty.call(source, key))) return;
    const clean = {};
    for (const key of keys) clean[key] = source[key];
    post(type === 'search' ? { type, page, detail: clean } : { type, page, session_id: visitId(), detail: clean });
  } catch {
    // Usage statistics fail silently (SPEC §11).
  }
}

function onReport(event) {
  const report = event.detail;
  if (report !== null && typeof report === 'object') send(report.type, report.detail);
}

try {
  if (statsOff()) forget();
  document.addEventListener('sleepsteps:event', onReport);
  if (document.body?.hasAttribute('data-page-view')) send('page_view', {});
} catch {
  // The page works without usage statistics.
}
