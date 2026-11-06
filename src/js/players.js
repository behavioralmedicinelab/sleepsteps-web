// Video and audio players (SPEC §9.1-§9.4; HANDOFF §5 VideoEmbed, FormatLinks).
//
// The HTML works without this module (SPEC §2, §11): each video facade is a
// "Watch on YouTube" link, transcripts and audio are native <details>, and
// handouts are plain links. This module:
//
// - turns each facade link into a "Play video" button of the same size. Only
//   when it is pressed does it load the YouTube IFrame Player API (once per
//   page) and swap in the player, so nothing contacts YouTube before the
//   visitor chooses to play (SPEC §9.1, §16.2). If the player can't load, the
//   frame says so and links to the video on YouTube;
// - pauses every other video and audio when one starts;
// - opens the transcript a "#transcript-<video_id>" link points to (the
//   notice's "Read the transcript instead", or a page's own links), and shows
//   each transcript's "Print transcript" button;
// - keeps the furthest point reached per media item (0/25/50/75/100) and
//   reports it, plus transcript opens and handout clicks, through report()
//   (SPEC §9.4, §10.2), for events.js to send: see below.
//
// Exports, for page scripts (solutions.js): pauseWithin(root) and
// revealTranscript(details). revealTranscript dispatches a bubbling
// `sleepsteps:reveal` event first, so a closed card around the transcript
// can open itself.
//
// Usage statistics: report() only dispatches a `sleepsteps:event`
// CustomEvent on document, with detail { type, detail } in the SPEC §10.2
// shapes, which worker/routes/event.js accepts: video_play / audio_play
// { media, furthest } (furthest 0, 25, 50, 75 or 100), transcript_open
// { media } and handout_open { media }, where media is always the video_id
// (data-video, data-media, data-transcript, data-handout). events.js, loaded
// before this module whenever features.events is on, listens and sends them
// (SPEC §10.1). Nothing is sent or stored here.

// SPEC §9.1. The player is only created after the visitor presses play, so
// `autoplay: 1` starts the video they chose; it never plays before that.
// Captions are on by default: `cc_load_policy: 1` shows them when the player
// loads, even if the viewer turned them off on YouTube (the player's CC
// button and the c key still turn them off), and `cc_lang_pref: 'en'` picks
// the uploaded English track. No `hl` (the player follows the viewer's
// language) and no `origin` (the IFrame API adds it).
const PLAYER_VARS = Object.freeze({ rel: 0, playsinline: 1, autoplay: 1, cc_load_policy: 1, cc_lang_pref: 'en' });
// The IFrame API builds the iframe from this `host` option, which works but
// isn't in its reference (checked 2026-11-06, SPEC §9.1).
const PLAYER_HOST = 'https://www.youtube-nocookie.com';
const API_URL = 'https://www.youtube.com/iframe_api';
const WATCH_URL = 'https://www.youtube.com/watch?v=';
const LOAD_TIMEOUT_MS = 15000;
const POLL_MS = 5000; // SPEC §9.4: poll while playing

const players = new Map(); // .video wrapper -> { player, videoId, poll }

// ---- Reports, sent by events.js ---------------------------------------------

function report(type, detail) {
  document.dispatchEvent(new CustomEvent('sleepsteps:event', { detail: { type, detail } }));
}

// ---- Furthest point reached (SPEC §9.4) --------------------------------------

const progress = new Map(); // "video_play:<id>" -> { type, media, furthest, reported }

function milestone(fraction) {
  if (!(fraction > 0)) return 0;
  if (fraction >= 0.99) return 100;
  return Math.floor(Math.min(fraction, 1) * 4) * 25;
}

function flush(item) {
  if (item.furthest > item.reported) {
    item.reported = item.furthest;
    report(item.type, { media: item.media, furthest: item.furthest });
  }
}

function track(type, media, fraction) {
  const key = `${type}:${media}`;
  let item = progress.get(key);
  if (!item) {
    item = { type, media, furthest: 0, reported: -1 };
    progress.set(key, item);
  }
  item.furthest = Math.max(item.furthest, milestone(fraction));
  // Reaching the end is reported at once; anything less when the page is
  // hidden (and again later only if it gets further).
  if (item.furthest === 100) flush(item);
}

function flushAll() {
  progress.forEach(flush);
}

// ---- Pausing ---------------------------------------------------------------------

function pausePlayer(entry) {
  try {
    const state = entry.player.getPlayerState?.();
    if (state === window.YT?.PlayerState?.PLAYING || state === window.YT?.PlayerState?.BUFFERING) {
      entry.player.pauseVideo();
    }
  } catch {
    // The player may be mid-teardown; nothing to pause.
  }
}

function pauseOthers(except) {
  players.forEach((entry, wrapper) => {
    if (wrapper !== except) pausePlayer(entry);
  });
  document.querySelectorAll('audio').forEach((audio) => {
    if (audio !== except && !audio.paused) audio.pause();
  });
}

/** Pause every video and audio inside `root` (e.g. a card being closed). */
export function pauseWithin(root) {
  players.forEach((entry, wrapper) => {
    if (root.contains(wrapper)) pausePlayer(entry);
  });
  root.querySelectorAll('audio').forEach((audio) => audio.pause());
}

// ---- YouTube player --------------------------------------------------------------

let apiPromise;

function loadApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const fail = (error) => {
      clearTimeout(timer);
      apiPromise = undefined; // let a later press try again
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error('YouTube API timed out')), LOAD_TIMEOUT_MS);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      if (typeof previous === 'function') previous();
      resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = API_URL;
    script.async = true;
    script.addEventListener('error', () => fail(new Error('YouTube API failed to load')));
    document.head.append(script);
  });
  return apiPromise;
}

function showError(wrapper) {
  const entry = players.get(wrapper);
  if (entry) {
    clearInterval(entry.poll);
    players.delete(wrapper);
    try {
      entry.player.destroy();
    } catch {
      // Already gone.
    }
  }
  const frame = wrapper.querySelector('.video__frame');
  if (!frame) return;
  const hadFocus = wrapper.contains(document.activeElement);
  const message = document.createElement('p');
  message.className = 'video__error';
  message.setAttribute('role', 'alert');
  const link = document.createElement('a');
  link.href = WATCH_URL + encodeURIComponent(wrapper.dataset.youtubeId);
  link.rel = 'noreferrer';
  link.textContent = 'Watch on YouTube';
  message.append("The video couldn't load here. ", link);
  frame.replaceChildren(message);
  wrapper.classList.remove('is-loading', 'is-playing');
  if (hadFocus) link.focus();
}

function sample(entry) {
  try {
    const duration = entry.player.getDuration();
    track('video_play', entry.videoId, duration > 0 ? entry.player.getCurrentTime() / duration : 0);
  } catch {
    // Not ready; the next poll will catch up.
  }
}

function onStateChange(wrapper, state) {
  const entry = players.get(wrapper);
  const states = window.YT?.PlayerState;
  if (!entry || !states) return;
  // video_play is reported from here and from the 5-second poll.
  if (state === states.PLAYING) {
    pauseOthers(wrapper);
    sample(entry);
    clearInterval(entry.poll);
    entry.poll = setInterval(() => sample(entry), POLL_MS);
    return;
  }
  clearInterval(entry.poll);
  if (state === states.ENDED) track('video_play', entry.videoId, 1);
  else if (state === states.PAUSED) sample(entry);
}

function play(wrapper, button) {
  if (button.getAttribute('aria-disabled') === 'true') return;
  const frame = wrapper.querySelector('.video__frame');
  const { video: videoId, youtubeId, title } = wrapper.dataset;
  if (!frame || !youtubeId) return;

  button.setAttribute('aria-disabled', 'true');
  wrapper.classList.add('is-loading');
  const status = document.createElement('p');
  status.className = 'video__status';
  status.setAttribute('role', 'status');
  frame.append(status);
  // Text set after the live region is in the page, so it is announced.
  status.textContent = 'Loading video…';

  loadApi()
    .then((YT) => {
      const mount = document.createElement('div');
      mount.className = 'video__player';
      const target = document.createElement('div');
      mount.append(target);
      frame.append(mount);

      const readyTimer = setTimeout(() => showError(wrapper), LOAD_TIMEOUT_MS);
      const player = new YT.Player(target, {
        host: PLAYER_HOST,
        videoId: youtubeId,
        width: '100%',
        height: '100%',
        playerVars: { ...PLAYER_VARS },
        events: {
          onReady: () => {
            clearTimeout(readyTimer);
            const iframe = player.getIframe();
            iframe.title = title;
            // Focus moves to the player only if it hasn't gone elsewhere while
            // the player loaded (up to LOAD_TIMEOUT_MS): still on the button,
            // or on nothing (Safari doesn't focus a clicked button).
            const active = document.activeElement;
            const moveFocus = !active || active === document.body || wrapper.contains(active);
            frame.querySelectorAll('.video__media, .video__facade, .video__status').forEach((el) => el.remove());
            wrapper.classList.remove('is-loading');
            wrapper.classList.add('is-playing');
            // Autoplay may be blocked (iOS); YouTube then shows its own play
            // button, which the focused iframe makes the next thing to press.
            player.playVideo();
            if (moveFocus) iframe.focus();
          },
          onStateChange: (event) => onStateChange(wrapper, event.data),
          onError: () => {
            clearTimeout(readyTimer);
            showError(wrapper);
          },
        },
      });
      players.set(wrapper, { player, videoId, poll: 0 });
    })
    .catch(() => showError(wrapper));
}

/** Swap a facade link for a button with the same classes and contents. */
function upgradeFacade(link) {
  const wrapper = link.closest('[data-video]');
  if (!wrapper?.dataset.youtubeId) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = link.className;
  // The notice under the video (SPEC §9.1, §15.1) stays its description.
  const describedBy = link.getAttribute('aria-describedby');
  if (describedBy) button.setAttribute('aria-describedby', describedBy);
  button.append(...link.childNodes);
  const action = button.querySelector('.video__action');
  if (action) action.textContent = 'Play video: ';
  const hadFocus = document.activeElement === link;
  link.replaceWith(button);
  if (hadFocus) button.focus();
  button.addEventListener('click', () => play(wrapper, button));
}

// ---- Audio ---------------------------------------------------------------------------

function setUpAudio(audio) {
  const media = audio.dataset.media;
  const fraction = () => (audio.duration > 0 ? audio.currentTime / audio.duration : 0);
  // audio_play is reported from these listeners.
  audio.addEventListener('play', () => {
    pauseOthers(audio);
    track('audio_play', media, fraction());
  });
  // Seeking while paused fires timeupdate too, but isn't a play (SPEC §9.4:
  // reported only "if the item was played at all").
  audio.addEventListener('timeupdate', () => {
    if (!audio.paused) track('audio_play', media, fraction());
  });
  audio.addEventListener('ended', () => track('audio_play', media, 1));
}

// ---- Transcripts ---------------------------------------------------------------------

/**
 * Open a transcript <details> and (by default) move focus to its summary.
 * Dispatches a bubbling `sleepsteps:reveal` event first, so a closed card
 * around it can open (solutions.js).
 */
export function revealTranscript(details, { focus = true } = {}) {
  details.dispatchEvent(new CustomEvent('sleepsteps:reveal', { bubbles: true }));
  details.open = true;
  if (focus) details.querySelector(':scope > summary')?.focus();
}

function transcriptFor(hash) {
  if (!hash?.startsWith('#transcript-')) return null;
  let id;
  try {
    id = decodeURIComponent(hash.slice(1));
  } catch {
    return null;
  }
  const target = document.getElementById(id);
  return target instanceof HTMLDetailsElement ? target : null;
}

function printTranscript(details) {
  document.querySelector('.print-sheet')?.remove();
  const sheet = document.createElement('div');
  sheet.className = 'print-sheet';
  const heading = document.createElement('p');
  heading.className = 'print-sheet__title';
  heading.textContent = `Transcript: ${details.dataset.title ?? ''}`;
  const source = document.createElement('p');
  source.className = 'print-sheet__source';
  const pageTitle = document.querySelector('h1')?.textContent.trim() ?? document.title;
  source.textContent = `From “${pageTitle}”: ${location.href.split('#')[0]}`;
  const body = details.querySelector('.transcript__body')?.cloneNode(true);
  sheet.append(heading, source);
  if (body) sheet.append(body);
  document.body.append(sheet);

  const root = document.documentElement;
  root.dataset.printing = '';
  const cleanUp = () => {
    sheet.remove();
    delete root.dataset.printing;
    window.removeEventListener('afterprint', cleanUp);
  };
  window.addEventListener('afterprint', cleanUp);
  window.print();
}

function setUpTranscript(details) {
  const print = details.querySelector('.transcript__print');
  if (print) {
    print.hidden = false;
    print.addEventListener('click', () => printTranscript(details));
  }
  // transcript_open, each time it is opened.
  details.addEventListener('toggle', () => {
    if (details.open) report('transcript_open', { media: details.dataset.transcript });
  });
}

// ---- Set-up ----------------------------------------------------------------------------

function onClick(event) {
  const link = event.target.closest?.('a[href]');
  if (!link) return;
  // handout_open { media: video_id } when a handout link is clicked
  // (whatever the format).
  if (link.dataset.handout) report('handout_open', { media: link.dataset.handout });
  const href = link.getAttribute('href');
  const details = href.startsWith('#') ? transcriptFor(href) : null;
  if (details) {
    event.preventDefault();
    revealTranscript(details);
  }
}

function revealFromHash() {
  const details = transcriptFor(location.hash);
  if (!details) return;
  revealTranscript(details, { focus: false });
  details.scrollIntoView();
}

function init() {
  document.querySelectorAll('a.video__facade').forEach(upgradeFacade);
  document.querySelectorAll('details[data-transcript]').forEach(setUpTranscript);
  document.querySelectorAll('audio[data-media]').forEach(setUpAudio);
  document.addEventListener('click', onClick);
  window.addEventListener('hashchange', revealFromHash);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
  window.addEventListener('pagehide', flushAll);
  // A transcript in the URL (#transcript-<id>) opens once every module on
  // the page has run, so a page script can open a card around it first.
  if (document.readyState === 'complete') revealFromHash();
  else document.addEventListener('DOMContentLoaded', revealFromHash, { once: true });
}

try {
  init();
} catch {
  // Leave the no-JavaScript versions in place.
}
