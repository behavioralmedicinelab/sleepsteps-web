// The privacy page's "Turn off usage statistics" button (SPEC §10.1, §15.2).
// base.njk loads it only when features.events is on, as the page renders the
// switch only then.
//
// Markup (content/pages/privacy.md):
//   <div data-stats-switch>
//     <p data-stats-status>(what to know without JavaScript)</p>
//     <button type="button" data-stats-toggle hidden>…</button>
//   </div>
//
// Without JavaScript, or if this module doesn't run, the status line explains
// that the switch needs JavaScript and the button stays hidden. With it:
// - if the browser won't let the site read localStorage, no choice can be
//   remembered: the button stays hidden and the line says statistics stay on;
// - otherwise the line says whether statistics are on or off in this
//   browser, and the one button turns them off or back on (usage-prefs.js;
//   turning them off also deletes this tab's visit code). Its label says what
//   it will do, so it has no aria-pressed. Focus stays on it, and the line
//   (role="status" from then on) announces the new state, or that the choice
//   couldn't be saved.
// The state is shown again when the page is restored from the back/forward
// cache or another tab changes it.
//
// All of this wording is a draft until the privacy officer approves it (M8).
import { OFF_KEY, localStorageReadable, setStatsOff, statsOff } from './usage-prefs.js';

const TEXT = {
  on: 'Usage statistics are on in this browser.',
  off: 'Usage statistics are off in this browser.',
  turnOff: 'Turn off usage statistics',
  turnOn: 'Turn on usage statistics',
  notSaved: "Your browser didn't let us save that choice.",
  noStorage:
    "Your browser isn't letting this website save anything, so it can't remember a choice to turn usage statistics off. Usage statistics stay on in this browser.",
};

function stateText() {
  return statsOff() ? TEXT.off : TEXT.on;
}

function initSwitch(root) {
  const status = root.querySelector('[data-stats-status]');
  const button = root.querySelector('[data-stats-toggle]');
  if (!status || !button) return;

  if (!localStorageReadable()) {
    status.textContent = TEXT.noStorage;
    return;
  }

  const render = (prefix) => {
    status.textContent = prefix ? `${prefix} ${stateText()}` : stateText();
    button.textContent = statsOff() ? TEXT.turnOn : TEXT.turnOff;
  };
  render();
  // A live region from now on, so the first state isn't announced on load
  // but every change is.
  status.setAttribute('role', 'status');
  button.hidden = false;

  button.addEventListener('click', () => {
    const saved = setStatsOff(!statsOff());
    render(saved ? '' : TEXT.notSaved);
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) render();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === OFF_KEY || event.key === null) render();
  });
}

try {
  document.querySelectorAll('[data-stats-switch]').forEach(initSwitch);
} catch {
  // The no-JavaScript text stays.
}
