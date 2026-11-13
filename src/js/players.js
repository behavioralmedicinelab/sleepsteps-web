// Video and audio players (SPEC §9.1-§9.4; HANDOFF §5 VideoEmbed, FormatLinks).
//
// The HTML works without this module (SPEC §2, §11): each video facade is a
// "Watch on YouTube" link, "Audio only" is a native <details>, and handouts
// and worksheets are plain links. There are no transcripts on the site
// (SPEC §9.3). This module:
//
// - turns each facade link into a "Play video" button of the same size. Only
//   when it is pressed does it load the YouTube IFrame Player API (once per
//   page) and swap in the player, so nothing contacts YouTube before the
//   visitor chooses to play (SPEC §9.1, §16.2). If the player can't load, the
//   frame says so and links to the video on YouTube;
// - pauses every other video and audio when one starts;
// - keeps the furthest point reached per media item (0/25/50/75/100) and
//   reports it, plus handout clicks and clicks on a solution card's
//   worksheet links (SPEC §7.6), through report() (SPEC §9.4, §10.2), for
//   events.js to send: see below.
//
// Exports, for page scripts (solutions.js): pauseWithin(root).
//
// Usage statistics: report() only dispatches a `sleepsteps:event`
// CustomEvent on document, with detail { type, detail } in the SPEC §10.2
// shapes, which worker/routes/event.js accepts: video_play / audio_play
// { media, furthest } (furthest 0, 25, 50, 75 or 100) and handout_open
// { media }, where media is always the video_id (data-video, data-media,
// data-handout); and worksheet_open { worksheet }, the worksheet_id
// (data-worksheet). events.js, loaded before this module whenever
// features.events is on, listens and sends them (SPEC §10.1). Nothing is
// sent or stored here.

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

/**
 * Pause every video and audio inside `root` (e.g. a card being closed). A
 * video that is still loading isn't playing yet, so there is nothing to
 * pause: outOfReach() keeps it from starting once it is ready.
 */
export function pauseWithin(root) {
  players.forEach((entry, wrapper) => {
    if (root.contains(wrapper)) pausePlayer(entry);
  });
  root.querySelectorAll('audio').forEach((audio) => audio.pause());
}

/**
 * Whether the visitor can't get to this video: it is inside something
 * hidden, as when its solution card was closed while it loaded
 * (solutions.js). A video there must not start playing.
 */
function outOfReach(wrapper) {
  return wrapper.closest('[hidden]') !== null;
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
  wrapper.classList.remove('is-loading');
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
  // Starting where the visitor can't get to it (`autoplay: 1` starts a video
  // that was still loading when its card closed): pause it, pause nothing
  // else and report no play.
  if ((state === states.PLAYING || state === states.BUFFERING) && outOfReach(wrapper)) {
    clearInterval(entry.poll);
    try {
      entry.player.pauseVideo();
    } catch {
      // Mid-teardown; nothing to pause.
    }
    return;
  }
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

  let readyTimer;
  loadApi()
    .then((YT) => {
      const mount = document.createElement('div');
      mount.className = 'video__player';
      const target = document.createElement('div');
      mount.append(target);
      frame.append(mount);

      readyTimer = setTimeout(() => showError(wrapper), LOAD_TIMEOUT_MS);
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
            // Autoplay may be blocked (iOS); YouTube then shows its own play
            // button, which the focused iframe makes the next thing to press.
            // Not if the visitor has closed its card meanwhile.
            if (!outOfReach(wrapper)) player.playVideo();
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
    .catch(() => {
      // Creating the player may have thrown with its timer already running,
      // which would show the error a second time.
      clearTimeout(readyTimer);
      showError(wrapper);
    });
}

/** Swap a facade link for a button with the same classes and contents. */
function upgradeFacade(link) {
  const wrapper = link.closest('[data-video]');
  if (!wrapper?.dataset.youtubeId) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = link.className;
  // The page's YouTube note (id youtube-note-text, notices/video.njk;
  // SPEC §9.1, §15.1) stays its description.
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
  // `play` is only the request: it fires before any of the file has loaded
  // (preload="none"), and the file may never load.
  audio.addEventListener('play', () => pauseOthers(audio));
  // audio_play is reported from these listeners: from `playing`, as a
  // video's is from the PLAYING state.
  audio.addEventListener('playing', () => track('audio_play', media, fraction()));
  // Seeking while paused fires timeupdate too, but isn't a play (SPEC §9.4:
  // reported only "if the item was played at all").
  audio.addEventListener('timeupdate', () => {
    if (!audio.paused) track('audio_play', media, fraction());
  });
  audio.addEventListener('ended', () => track('audio_play', media, 1));
}

// ---- Set-up ----------------------------------------------------------------------------

function onClick(event) {
  const link = event.target.closest?.('a[href]');
  // handout_open { media: video_id } when a handout link is clicked
  // (whatever the format): the row's "Handout" or a closed card's quick
  // link.
  if (link?.dataset.handout) report('handout_open', { media: link.dataset.handout });
  // worksheet_open { worksheet: worksheet_id } when a worksheet link in an
  // open solution card is clicked (SPEC §7.6), in the same way.
  if (link?.dataset.worksheet) report('worksheet_open', { worksheet: link.dataset.worksheet });
}

function init() {
  document.querySelectorAll('a.video__facade').forEach(upgradeFacade);
  document.querySelectorAll('audio[data-media]').forEach(setUpAudio);
  document.addEventListener('click', onClick);
  // A middle click opens the link in a new tab, and fires auxclick, not click.
  document.addEventListener('auxclick', (event) => {
    if (event.button === 1) onClick(event);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
  window.addEventListener('pagehide', flushAll);
}

try {
  init();
} catch {
  // Leave the no-JavaScript versions in place.
}
