// The usage statistics choice and the visit code (SPEC §10.1, §15.4), shared
// by events.js (which sends usage statistics) and stats-switch.js (the
// privacy page's "Turn off usage statistics" button).
//
// - sleepsteps-visit (sessionStorage, written only by events.js): the random
//   code that groups one visit's events. Deleted when the tab closes.
// - sleepsteps-stats-off (localStorage, written only by stats-switch.js): set
//   while usage statistics are turned off in this browser. Any value counts.
//
// Every storage access is inside try/catch: a browser can block storage, and
// then even reading `window.localStorage` throws. Nothing is ever written
// just to test whether storage works.

export const VISIT_KEY = 'sleepsteps-visit';
export const OFF_KEY = 'sleepsteps-stats-off';

/**
 * Whether usage statistics are turned off in this browser. If the choice
 * can't be read, none can have been saved, so statistics stay on (false).
 */
export function statsOff() {
  try {
    return window.localStorage.getItem(OFF_KEY) !== null;
  } catch {
    return false;
  }
}

/** Whether this browser lets the site read localStorage, so a choice can be remembered. */
export function localStorageReadable() {
  try {
    window.localStorage.getItem(OFF_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Delete this tab's visit code, if there is one. */
export function forgetVisit() {
  try {
    window.sessionStorage.removeItem(VISIT_KEY);
  } catch {
    // Storage is blocked, so there is no code to delete.
  }
}

/**
 * Turn usage statistics off (true) or back on (false) in this browser.
 * Turning them off also deletes this tab's visit code. Returns whether the
 * choice was saved (checked by reading it back).
 */
export function setStatsOff(off) {
  if (off) forgetVisit();
  try {
    if (off) window.localStorage.setItem(OFF_KEY, '1');
    else window.localStorage.removeItem(OFF_KEY);
    return statsOff() === Boolean(off);
  } catch {
    return false;
  }
}
