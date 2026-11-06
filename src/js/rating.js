// The ratings widget (SPEC §11, §12): "Was this helpful?" and five radio
// stars in the row of controls under each video on the problem pages and
// Start here. Markup: src/_includes/partials/rating.njk, inside
// partials/video-controls.njk. base.njk loads this module only on those
// pages, and only while site.config.json's features.ratings is exactly true.
//
// Without JavaScript, or if this module fails, nothing shows: the widget and
// a row of controls that would hold only the widget ([data-rating-reveal])
// ship `hidden`. This module reveals the widgets once its listeners are in
// place, and makes each status line a live region (role="status"), so
// nothing is announced on load.
//
// Sending: POST /api/rate { page_id, video_id, stars } through api.js, with
// keepalive, so a rating made just before leaving still gets out.
// - A choice made by pointer, touch, Space or a screen reader's activation
//   (all clicks) is sent at once.
// - A choice made with an arrow key is held, as native radios check every
//   star the arrows pass: it is sent on the first of HOLD_MS without another
//   change, focus leaving the group, Enter, or pagehide (decision a1 = B,
//   SPEC §12); Space on it sends it too, as Chrome and Safari fire no click
//   for Space on a checked radio. A held choice equal to the last one the API accepted is not
//   sent again; the status line then thanks the visitor for it.
// - A press on a star drops a held choice: the clicked star is sent at once,
//   alone. Browsers blur the focused radio when a star's label is pressed,
//   before the click (focusout with no relatedTarget), so from pointerdown
//   on a star until the next click that focusout doesn't count as focus
//   leaving, and the hold waits (pointerup restarts it, for a press that
//   ends off the star). Clicking the star that is already checked fires no
//   change event: if it is the held star, it is sent then.
// - One request at a time per widget, newest wins: a choice made while one
//   is in flight waits, replacing any choice already waiting, and is sent
//   when that one ends unless it is the value just sent. If the page is
//   hidden while a request is in flight, the choice still waiting is sent
//   then, without waiting, and becomes the newest request.
// - Only the newest request's answer counts: an older one (still in flight
//   after that pagehide send, if the page comes back from the back/forward
//   cache) changes nothing. The status line only changes once nothing newer
//   is waiting or held, so it always matches the checked star.
//
// Status line: empty until there is news (READY_TEXT, decision a2 = B; its
// height is reserved by hidden copies of the longest messages, so nothing
// shifts). Nothing changes while sending, and the radios are never
// disabled. On success: "Thanks. You rated this n of 5." Nothing else on
// the page shows the rating (no closed-card summary, project lead,
// 2026-11-06). On failure (any non-2xx answer, a network error or api.js's
// timeout): SEND_FAILED, and the stars go back to the last rating the API
// accepted, or none, so picking any star retries. A message equal to the one shown is
// cleared and set again REANNOUNCE_MS later, so it is announced again.
//
// Nothing is stored on the device and no visit code is read or sent: no
// earlier rating is shown, and every radio is unchecked at load, so a
// browser restoring form state can't show one. Ratings send no usage event
// and ignore the usage statistics switch (SPEC §10.1). No console calls.

import { SEND_FAILED, postJson, succeeded } from './api.js';

const ENDPOINT = '/api/rate';

/** Decision a1: true holds arrow-key choices (B); false sends every change (A). */
export const HOLD_ARROW_KEYS = true;

/** How long an arrow-key choice is held without another change. */
export const HOLD_MS = 2000;

/** Decision a2: the status line before a rating ('' is B; A was "Ratings are anonymous."). */
export const READY_TEXT = '';

/** The pause before a repeated message is set again, so it is announced. */
export const REANNOUNCE_MS = 100;

/** The scale (SPEC §12; the Worker checks 1 to 5). */
export const STARS = 5;

export const thanksText = (n) => `Thanks. You rated this ${n} of ${STARS}.`;

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Each widget's root element -> its state. */
const widgets = new Map();
let pageId = '';

/** The star an input stands for, or 0. */
function starOf(input) {
  const n = Number(input.value);
  return Number.isInteger(n) && n >= 1 && n <= STARS ? n : 0;
}

function stateOf(target) {
  const root = typeof target?.closest === 'function' ? target.closest('[data-rating]') : null;
  return root ? widgets.get(root) : undefined;
}

const isStar = (target) => Boolean(target?.classList?.contains('rating__input'));

function checkedStar(state) {
  const radio = state.radios.find((r) => r.checked);
  return radio ? starOf(radio) : 0;
}

/** Check star n, or none for 0. Setting `checked` fires no change event. */
function check(state, n) {
  for (const radio of state.radios) radio.checked = starOf(radio) === n;
}

function announce(state, message) {
  window.clearTimeout(state.announceTimer);
  if (message && state.status.textContent === message) {
    state.status.textContent = '';
    state.announceTimer = window.setTimeout(() => {
      state.status.textContent = message;
    }, REANNOUNCE_MS);
  } else {
    state.status.textContent = message;
  }
}

const body = (state, n) => ({ page_id: pageId, video_id: state.videoId, stars: n });

function send(state, n) {
  const id = ++state.sends;
  state.inFlight = true;
  state.sent = n;
  postJson(ENDPOINT, body(state, n), { keepalive: true }).then((status) => {
    // A newer request went out as the page was hidden (onPagehide): only its
    // answer counts, so this one can't set an older star as accepted.
    if (id !== state.sends) return;
    state.inFlight = false;
    const ok = succeeded(status);
    if (ok) state.confirmed = n;
    const next = state.queued;
    state.queued = 0;
    if (next && next !== n) {
      send(state, next);
      return;
    }
    // A newer choice is still held (flush() reports it), or, as a safeguard,
    // another star is checked: the status line stays as it is.
    if (state.pending || checkedStar(state) !== n) return;
    if (ok) {
      announce(state, thanksText(n));
    } else {
      announce(state, SEND_FAILED);
      check(state, state.confirmed);
    }
  });
}

function request(state, n) {
  if (state.inFlight) state.queued = n;
  else send(state, n);
}

/** Hold an arrow-key choice until HOLD_MS pass without another change. */
function hold(state, n) {
  window.clearTimeout(state.holdTimer);
  state.pending = n;
  state.holdTimer = window.setTimeout(() => flush(state), HOLD_MS);
}

/** Send the held choice, if any. */
function flush(state) {
  window.clearTimeout(state.holdTimer);
  const n = state.pending;
  state.pending = 0;
  if (!n) return;
  if (state.inFlight || n !== state.confirmed) {
    request(state, n);
  } else if (state.status.textContent !== thanksText(n)) {
    // Already accepted (the arrows came back to it, perhaps while it was in
    // flight): not sent again, but the status line says it is stored.
    announce(state, thanksText(n));
  }
}

function onChange(event) {
  const input = event.target;
  const state = isStar(input) ? stateOf(input) : undefined;
  const n = state && input.checked ? starOf(input) : 0;
  if (!n) return;
  const arrowed = state.arrowing;
  state.arrowing = false;
  if (HOLD_ARROW_KEYS && arrowed) {
    hold(state, n);
    return;
  }
  window.clearTimeout(state.holdTimer);
  state.pending = 0;
  request(state, n);
}

function onKeydown(event) {
  const state = isStar(event.target) ? stateOf(event.target) : undefined;
  if (!state) return;
  // An arrow key moves the checked star; any other key (Space, Tab) doesn't.
  state.arrowing = ARROW_KEYS.has(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey;
  // Enter sends a held star. So does Space: on the held star, which is
  // checked, Chrome and Safari fire no click (Space clicks only an
  // unchecked radio, whose change then sends it).
  if (event.key === 'Enter' || event.key === ' ') flush(state);
}

/** Whether `target` is a star: its radio, or its label (the label's icon included). */
const onStar = (target) => typeof target?.closest === 'function' && Boolean(target.closest('.rating__star, .rating__input'));

function onPointerdown(event) {
  const state = stateOf(event.target);
  if (!state) return;
  state.arrowing = false;
  if (!onStar(event.target)) return;
  // The click decides: until then the hold waits, and the focusout the press
  // causes isn't focus leaving the group.
  state.pressing = true;
  window.clearTimeout(state.holdTimer);
}

/** A press that ends without clicking a star lets the hold run again. */
function onPointerup(event) {
  for (const state of widgets.values()) {
    if (state.pressing && state.pending) hold(state, state.pending);
    // A cancelled press (the page scrolled, say) brings no click.
    if (event.type === 'pointercancel') state.pressing = false;
  }
}

function onClick(event) {
  for (const state of widgets.values()) state.pressing = false;
  const input = event.target;
  const state = isStar(input) ? stateOf(input) : undefined;
  // The held star clicked again (by pointer or a screen reader): it is
  // already checked, so no change event follows. A click on any other
  // star is followed by change, which drops the held choice.
  if (state?.pending && starOf(input) === state.pending) flush(state);
}

function onFocusout(event) {
  const state = isStar(event.target) ? stateOf(event.target) : undefined;
  if (!state || state.group.contains(event.relatedTarget ?? null)) return;
  if (state.pressing && !event.relatedTarget) return;
  flush(state);
}

function onPagehide() {
  for (const state of widgets.values()) {
    if (!state.inFlight) {
      flush(state);
      continue;
    }
    // The answer to the request in flight may never be handled now, so send
    // the newest waiting choice at once rather than after it. It becomes the
    // newest request, so only its answer counts if the page comes back.
    window.clearTimeout(state.holdTimer);
    const n = state.pending || state.queued;
    state.pending = 0;
    state.queued = 0;
    if (n && n !== state.sent) send(state, n);
  }
}

/** The state for one widget, or null if its markup isn't as expected. */
function setup(root) {
  const videoId = root.getAttribute('data-rating') ?? '';
  const group = root.querySelector('fieldset');
  const status = root.querySelector('[data-rating-status]');
  const radios = [...root.querySelectorAll('input.rating__input')];
  const valid =
    SLUG.test(videoId) &&
    group &&
    status &&
    radios.length === STARS &&
    radios.every((radio, i) => radio.type === 'radio' && starOf(radio) === i + 1);
  if (!valid) return null;
  for (const radio of radios) radio.checked = false;
  return {
    root,
    group,
    status,
    radios,
    videoId,
    confirmed: 0, // the last star the API accepted (only the newest request's answer sets it)
    sends: 0, // requests sent; the newest one's answer is the only one that counts
    inFlight: false, // the newest request has no answer yet
    sent: 0, // the star the newest request sent
    queued: 0, // a choice waiting for the request in flight
    pending: 0, // an arrow-key choice being held
    arrowing: false, // the next change comes from an arrow key
    pressing: false, // a press on a star, until the next click
    holdTimer: undefined,
    announceTimer: undefined,
  };
}

function init() {
  pageId = document.body?.getAttribute('data-page-id') ?? '';
  if (!SLUG.test(pageId)) return;
  for (const root of document.querySelectorAll('[data-rating]')) {
    try {
      const state = setup(root);
      if (state) widgets.set(root, state);
    } catch {
      // This widget stays hidden.
    }
  }
  if (!widgets.size) return;
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('pointerdown', onPointerdown);
  document.addEventListener('pointerup', onPointerup);
  document.addEventListener('pointercancel', onPointerup);
  document.addEventListener('click', onClick);
  document.addEventListener('focusout', onFocusout);
  window.addEventListener('pagehide', onPagehide);
  for (const state of widgets.values()) {
    state.status.textContent = READY_TEXT;
    state.status.setAttribute('role', 'status');
    const wrapper = state.root.parentElement?.closest('[data-rating-reveal]');
    if (wrapper) wrapper.hidden = false;
    state.root.hidden = false;
  }
}

try {
  init();
} catch {
  // The widgets stay hidden; the page works without them.
}
