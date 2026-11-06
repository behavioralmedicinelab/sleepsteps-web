// The feedback dialog (SPEC §13, §15.1, §16.2). Markup:
// src/_includes/partials/feedback-dialog.njk, which base.njk renders, with
// this module, on every page that has the footer and a data-page-id while
// features.feedback is exactly true. Not on Getting urgent help (no footer)
// or the 404 page (no page_id); there the footer's "Send feedback" stays a
// link to the Contact page.
//
// Without JavaScript, without <dialog> support, or if this module fails,
// nothing changes: "Send feedback" is an <a href="/contact/"> and the dialog
// stays `hidden` and closed. Once its listeners are in place, this module
// swaps the link for a <button> of the same look (no layout shift) and
// unhides the dialog, which stays closed until the button is pressed.
//
// Opening: showModal(), then focus on the dialog's heading (not the first
// field, which on phones would raise the keyboard over the notice). The
// notice is the dialog's description. Escape, Cancel or Close close it,
// keep the draft in memory (never stored) and return focus to the button.
// Escape does nothing while focus is inside Turnstile's frame, whose key
// presses never reach this page (another origin); Tab leaves the frame, and
// Escape works from there.
//
// Turnstile (Cloudflare's spam check): its script is fetched only when the
// dialog first opens, once per page, from the exact URL Cloudflare gives,
// with ?render=explicit; this module renders a widget into the reserved box
// each time the dialog opens and removes it each time it closes, so nothing
// talks to Cloudflare while the dialog is closed. No turnstile.ready(), no
// global onload callback, no preconnect. The site key is chosen here, at
// run time, since the build can't tell production from a preview (SPEC §11):
// Cloudflare's always-pass test key on local and preview hosts, and the
// configured key (data-sitekey, from site.config.json) elsewhere. Decision
// A1 (project lead, 2026-11-07): the dialog shows in production even while
// that key is still the placeholder; with no usable key it loads nothing
// from Cloudflare and hides the field, the widget's box and Send, so nobody
// writes a message that can't be sent: the dialog holds the notice, Close
// and the line saying the spam check isn't working, offering the Contact
// page, which then sits just below Close, in view. The same message follows a
// script that fails or doesn't load within LOAD_TIMEOUT_MS, and the
// widget's error or unsupported callback; a token arriving later clears it.
// Closing the dialog clears the status line, except "Sending…".
//
// Sending: POST /api/feedback { page_id, message, turnstile_token } through
// api.js, exactly those keys; the Worker cleans and checks the message.
// One request at a time. Send sends nothing, and says why, when the message
// is blank, the spam check failed or its token hasn't arrived. While
// sending, Send is aria-disabled (never disabled, which would drop focus)
// and the textarea read-only. After every answer the token is spent, so the
// widget is reset. Success (decision A2 = B): the status line thanks the
// visitor, the textarea is cleared and Cancel becomes Close; the dialog
// stays open and focus stays where it is. Any other answer (403, the 404
// production gives before the go-ahead, 429, 5xx, no answer): SEND_FAILED,
// a line offering the Contact page, and the text kept. An answer that
// arrives after the dialog was closed still applies, and is shown when it
// next opens.
//
// The status line, last in the dialog, becomes role="status" when this
// module starts, so nothing is announced on load. A message equal to the
// one shown is cleared and set again REANNOUNCE_MS later, so it is heard
// again. A message the dialog opens with (the spam check failed, "Sending…",
// or an answer that came while it was closed) is also written REANNOUNCE_MS
// after opening: a closed dialog's live region isn't in the accessibility
// tree, and one that appears together with its text may not be announced.
// Messages only make the dialog longer downwards, so nothing above
// them moves. After Send, the dialog scrolls, if it must, to show the line
// (on a phone it is below the buttons); nothing else scrolls it.
//
// Never: console calls, device storage, a `sleepsteps:event`, reading the
// address's query, or putting the message anywhere but the request body.

import { SEND_FAILED, postJson, succeeded } from './api.js';

const ENDPOINT = '/api/feedback';
const CONTACT_URL = '/contact/';

/** Turnstile's script, exactly as Cloudflare gives it, in explicit-render mode. */
export const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Cloudflare's always-pass, visible test site key, for local and preview hosts. */
export const TEST_SITEKEY = '1x00000000000000000000AA';

/** How long the Turnstile script may take to load before the dialog says the check isn't working. */
export const LOAD_TIMEOUT_MS = 15000;

/** The pause before a repeated message is set again, so it is announced. */
export const REANNOUNCE_MS = 100;

/** The longest message, in UTF-16 code units: the textarea's maxlength and the Worker's limit. */
export const MAX_LENGTH = 2000;

/** Below this width (px) the widget is Turnstile's compact size (150x140), else normal (300x65). */
export const NORMAL_WIDTH = 300;

/** The dialog's copy (SPEC §13; SEND_FAILED and THANKS fixed by §11 and §13, the rest drafts for the lead, A5). */
export const MESSAGES = Object.freeze({
  EMPTY: 'Write your message before sending.',
  LIMIT: "You've reached the 2,000-character limit.",
  WAITING: "The spam check hasn't finished yet. Wait a moment, or complete it if it asks you to, then press Send again.",
  SENDING: 'Sending…',
  THANKS: 'Thanks — your feedback has been sent',
  SEND_FAILED,
  CHECK_FAILED: "The spam check isn't working, so this form can't send right now.",
  // The line after a failure: text, the link to the Contact page, text.
  CONTACT: Object.freeze(['You can also ', 'contact the team', " by email or phone, but that isn't anonymous."]),
  CANCEL: 'Cancel',
  CLOSE: 'Close',
});

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
// Preview and version URLs: <alias or version>-sleepsteps.<subdomain>.workers.dev
// (SPEC §14.1 API_HOSTS). Production's sleepsteps.<subdomain>.workers.dev
// doesn't match.
const PREVIEW_HOST = /^[a-z0-9-]+-sleepsteps\.[a-z0-9-]+\.workers\.dev$/;
// A real site key; the "<PUBLIC_SITE_KEY>" placeholder is not one.
const SITE_KEY = /^0x[A-Za-z0-9_-]+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The Turnstile site key for this host, or null when there is no usable one.
 * @param {string} hostname   location.hostname
 * @param {string} configured site.config.json's turnstileSiteKey
 * @returns {string | null}
 */
export function chooseSitekey(hostname, configured) {
  const host = String(hostname ?? '').toLowerCase();
  if (LOCAL_HOSTS.has(host) || PREVIEW_HOST.test(host)) return TEST_SITEKEY;
  return typeof configured === 'string' && SITE_KEY.test(configured) ? configured : null;
}

/**
 * The options for turnstile.render(). `action` labels Cloudflare's analytics
 * only; it is never checked. No cData, and never session-continuity-persist,
 * which would write `_cftscs_<sitekey>` to this site's localStorage. Visitor
 * feedback to Cloudflare is off, and so is the hidden response field (the
 * token is sent as JSON). The error callback returns true, so Turnstile logs
 * nothing to the console.
 * @param {string} sitekey
 * @param {'normal' | 'compact'} size
 * @param {{ token: Function, expired: Function, timeout: Function, error: Function, unsupported: Function }} on
 */
export function renderOptions(sitekey, size, on) {
  return {
    sitekey,
    action: 'feedback',
    theme: 'light',
    language: 'en',
    size,
    appearance: 'always',
    'response-field': false,
    'feedback-enabled': false,
    callback: (token) => on.token(token),
    'expired-callback': () => on.expired(),
    'timeout-callback': () => on.timeout(),
    'error-callback': (code) => {
      on.error(code);
      return true;
    },
    'unsupported-callback': () => on.unsupported(),
  };
}

/** Set up the dialog. Returns true when the footer button now opens it. */
export function init() {
  const pageId = document.body?.getAttribute('data-page-id') ?? '';
  if (!SLUG.test(pageId)) return false;
  const link = document.querySelector('a[data-feedback-trigger]');
  const dialog = document.querySelector('dialog[data-feedback-dialog]');
  if (!link || !dialog || typeof dialog.showModal !== 'function' || typeof dialog.close !== 'function') return false;
  const form = dialog.querySelector('form');
  const title = dialog.querySelector('[tabindex="-1"]');
  const field = dialog.querySelector('[data-feedback-field]');
  const textarea = dialog.querySelector('textarea');
  const check = dialog.querySelector('[data-feedback-check]');
  const sendButton = dialog.querySelector('[data-feedback-send]');
  const cancel = dialog.querySelector('[data-feedback-cancel]');
  const status = dialog.querySelector('[data-feedback-status]');
  if (!form || !title || !field || !textarea || !check || !sendButton || !cancel || !status || !status.id) return false;

  const sitekey = chooseSitekey(window.location?.hostname, dialog.getAttribute('data-sitekey'));
  const hint = textarea.getAttribute('aria-describedby') ?? '';
  // With no usable key there is nothing to cancel: the button only closes.
  const closeLabel = sitekey ? MESSAGES.CANCEL : MESSAGES.CLOSE;

  const state = {
    script: 'idle', // the Turnstile script: idle, loading, ready or failed
    loadTimer: undefined,
    failed: !sitekey, // the spam check can't give a token (shown as CHECK_FAILED)
    widget: null, // the rendered widget's id
    live: 0, // the rendered widget's number; callbacks from an older one are ignored
    renders: 0,
    token: null, // the widget's current, unspent token
    sending: false,
    unseen: false, // an answer came while the dialog was closed
    limitShown: false,
    shown: '', // the status line's message key
    announceTimer: undefined,
  };

  // ---- The status line ----------------------------------------------------

  const paragraph = (text) => {
    const p = document.createElement('p');
    p.textContent = text;
    return p;
  };
  const contactLine = () => {
    const [before, label, after] = MESSAGES.CONTACT;
    const p = document.createElement('p');
    const a = document.createElement('a');
    a.href = CONTACT_URL;
    a.textContent = label;
    p.append(before, a, after);
    return p;
  };
  const STATUS = {
    empty: () => [paragraph(MESSAGES.EMPTY)],
    limit: () => [paragraph(MESSAGES.LIMIT)],
    waiting: () => [paragraph(MESSAGES.WAITING)],
    sending: () => [paragraph(MESSAGES.SENDING)],
    thanks: () => [paragraph(MESSAGES.THANKS)],
    failed: () => [paragraph(MESSAGES.SEND_FAILED), contactLine()],
    check: () => [paragraph(MESSAGES.CHECK_FAILED), contactLine()],
  };

  /**
   * Show the message `key` ('' clears the line), announcing a repeat again.
   * `reveal` scrolls the dialog, if it has to, so the line is in view: for
   * Send's answers only, since on a phone the line is below the buttons, and
   * never otherwise, so the dialog never jumps while someone reads or types.
   * `later` writes it REANNOUNCE_MS from now, after an empty line, as a
   * repeat is: for the message a dialog opens with.
   */
  function announce(key, { reveal = false, later = false } = {}) {
    window.clearTimeout(state.announceTimer);
    const show = () => {
      status.replaceChildren(...(key ? STATUS[key]() : []));
      if (reveal && key && dialog.open) status.scrollIntoView({ block: 'nearest' });
    };
    if (key && (later || state.shown === key)) {
      status.replaceChildren();
      state.announceTimer = window.setTimeout(show, REANNOUNCE_MS);
    } else {
      show();
    }
    state.shown = key;
  }

  function clearInvalid() {
    if (textarea.getAttribute('aria-invalid') !== 'true') return;
    textarea.removeAttribute('aria-invalid');
    textarea.setAttribute('aria-describedby', hint);
  }

  // ---- Turnstile ------------------------------------------------------------

  /** The spam check can't give a token: say so if the dialog is open. */
  function checkFailed() {
    state.failed = true;
    state.token = null;
    if (dialog.open && !state.sending) announce('check');
  }

  /** The check works after all: drop its failure message (and, with a token, the wait). */
  function checkRecovered({ token = false } = {}) {
    state.failed = false;
    if (state.shown === 'check' || (token && state.shown === 'waiting')) announce('');
  }

  function render() {
    if (!dialog.open || state.widget !== null || state.script !== 'ready' || !sitekey) return;
    const api = window.turnstile;
    const number = ++state.renders;
    const current = () => state.live === number;
    state.live = number;
    try {
      const id = api.render(
        check,
        renderOptions(sitekey, check.dataset.size === 'compact' ? 'compact' : 'normal', {
          token: (token) => {
            if (!current() || typeof token !== 'string' || !token) return;
            state.token = token;
            checkRecovered({ token: true });
          },
          expired: () => {
            if (current()) state.token = null;
          },
          timeout: () => {
            if (current()) state.token = null;
          },
          error: () => {
            if (current()) checkFailed();
          },
          unsupported: () => {
            if (current()) checkFailed();
          },
        }),
      );
      if (typeof id !== 'string' || !id) throw new Error('no widget');
      state.widget = id;
    } catch {
      state.live = 0;
      checkFailed();
    }
  }

  function removeWidget() {
    const id = state.widget;
    state.widget = null;
    state.live = 0;
    state.token = null;
    if (id !== null) {
      try {
        window.turnstile.remove(id);
      } catch {
        // Cleared below.
      }
    }
    check.replaceChildren();
  }

  function scriptLoaded() {
    window.clearTimeout(state.loadTimer);
    if (typeof window.turnstile?.render !== 'function') {
      state.script = 'failed';
      checkFailed();
      return;
    }
    state.script = 'ready';
    // A load after LOAD_TIMEOUT_MS still counts.
    checkRecovered();
    render();
  }

  function scriptFailed() {
    window.clearTimeout(state.loadTimer);
    state.script = 'failed';
    checkFailed();
  }

  function loadScript() {
    if (state.script !== 'idle' || !sitekey) return;
    state.script = 'loading';
    const script = document.createElement('script');
    script.src = TURNSTILE_URL;
    script.async = true;
    script.addEventListener('load', scriptLoaded, { once: true });
    script.addEventListener('error', scriptFailed, { once: true });
    state.loadTimer = window.setTimeout(() => {
      if (state.script === 'loading') checkFailed();
    }, LOAD_TIMEOUT_MS);
    document.head.append(script);
  }

  // ---- Opening and closing ----------------------------------------------------

  function open() {
    if (dialog.open) return;
    try {
      dialog.showModal();
    } catch {
      // The dialog can't open: go where the link went.
      window.location.href = CONTACT_URL;
      return;
    }
    title.focus();
    // Reserve the widget's box at its size before it renders.
    check.dataset.size = check.getBoundingClientRect().width >= NORMAL_WIDTH ? 'normal' : 'compact';
    // Keep "Sending…", or an answer that came while the dialog was closed;
    // otherwise the line is empty (onClose), unless the check has failed.
    // Written once the dialog's live region is in the accessibility tree, so
    // it is announced.
    const opening = state.sending || state.unseen ? state.shown : state.failed ? 'check' : '';
    if (opening) announce(opening, { later: true });
    state.unseen = false;
    if (state.script === 'idle') loadScript();
    else render();
  }

  function onClose() {
    removeWidget();
    cancel.textContent = closeLabel;
    // A fresh line next time, except "Sending…", whose answer is still to come.
    if (!state.sending) announce('');
    // Back to the footer button, unless focus has already gone somewhere else
    // on the page (browsers that don't restore focus leave it on <body>).
    const active = document.activeElement;
    const elsewhere = active && active !== document.body && active.isConnected && !dialog.contains(active);
    if (!elsewhere) trigger.focus();
  }

  // ---- Sending ----------------------------------------------------------------

  async function send() {
    // With no usable key there is no field or Send button to submit from.
    if (state.sending || !sitekey) return;
    const message = textarea.value;
    const reveal = { reveal: true };
    if (!message.trim()) {
      announce('empty', reveal);
      textarea.setAttribute('aria-invalid', 'true');
      textarea.setAttribute('aria-describedby', `${hint} ${status.id}`.trim());
      textarea.focus();
      return;
    }
    if (message.length > MAX_LENGTH) {
      announce('limit', reveal);
      return;
    }
    if (state.failed) {
      announce('check', reveal);
      return;
    }
    if (!state.token) {
      announce('waiting', reveal);
      return;
    }

    const token = state.token;
    const widget = state.widget;
    state.token = null; // single use
    state.sending = true;
    sendButton.setAttribute('aria-disabled', 'true');
    textarea.readOnly = true;
    announce('sending', reveal);

    const answer = await postJson(ENDPOINT, { page_id: pageId, message, turnstile_token: token });

    state.sending = false;
    sendButton.removeAttribute('aria-disabled');
    textarea.readOnly = false;
    // The token is spent whatever the answer: get the same widget a new one.
    if (widget !== null && state.widget === widget) {
      state.token = null;
      try {
        window.turnstile.reset(widget);
      } catch {
        // The widget will give no new token; Send then says it is waiting.
      }
    }
    state.unseen = !dialog.open;
    if (succeeded(answer)) {
      textarea.value = '';
      state.limitShown = false;
      clearInvalid();
      cancel.textContent = MESSAGES.CLOSE;
      announce('thanks', reveal);
    } else {
      announce('failed', reveal);
    }
  }

  // ---- Wiring -----------------------------------------------------------------

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = link.className;
  trigger.setAttribute('data-feedback-trigger', '');
  trigger.textContent = link.textContent;

  trigger.addEventListener('click', open);
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', onClose);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    send().catch(() => {
      // postJson never rejects; nothing else here throws.
    });
  });
  textarea.addEventListener('input', () => {
    if (textarea.getAttribute('aria-invalid') === 'true') {
      clearInvalid();
      if (state.shown === 'empty') announce('');
    }
    // maxlength cuts a long paste off silently: say so, once each time.
    const atLimit = textarea.value.length >= MAX_LENGTH;
    if (atLimit && !state.limitShown) announce('limit');
    state.limitShown = atLimit;
  });

  status.setAttribute('role', 'status');
  // With no usable key nothing can be sent (decision A1): no field, no
  // widget's box and no Send, so the status line sits just below Close.
  if (!sitekey) {
    field.hidden = true;
    check.hidden = true;
    sendButton.hidden = true;
    cancel.textContent = closeLabel;
  }
  dialog.hidden = false;
  // Swapping a focused element drops focus, so put it back.
  const hadFocus = document.activeElement === link;
  link.replaceWith(trigger);
  if (hadFocus) trigger.focus();
  return true;
}

try {
  init();
} catch {
  // "Send feedback" stays a link to the Contact page.
}
