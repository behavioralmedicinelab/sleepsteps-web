// Sleep problems page (/problems/): the two views, By area and "When it
// happens", and the live filter (SPEC §7.2, §8.1; HANDOFF §6.3).
//
// Both views are the same accordion: one group per area, or one per time of
// day, each a heading over its list of problems. The HTML works without this
// module: every area is open under a plain heading, the toolbar and the
// "When it happens" view carry `hidden`, and the result line is static.
// This module:
//
// - turns each group heading's <span>, in both views, into a <button
//   aria-expanded aria-controls> (as menu.js does for the Menu) and opens
//   only the first group of each view, or the area named in the URL
//   (/problems/#mind), also on hashchange;
// - shows the toolbar: the filter and the By area / When it happens radios,
//   and the lede's sentence about them (data-problems-hint);
// - filters both views as you type, over each problem's short title,
//   statement, area name and keywords (data-keywords, from
//   data/keywords.csv when it exists), so switching view keeps the filter.
//   While some topics match, groups without a match are hidden and groups
//   with one open. When nothing matches, or the field is cleared, both
//   views are as they were before the filter narrowed them (every group
//   shown, one with no topics included, as on load), and the result line
//   says so;
// - writes the result line (aria-live="polite") once typing pauses, so a
//   screen reader hears one count per pause, not one per keystroke.
//
// Privacy (SPEC §8.1; CLAUDE.md): what someone types is never logged, sent,
// stored or put in the URL, and reaches the page only through textContent.
// Nothing is remembered between visits: no storage at all.
//
// Focus never moves: not on load, toggling, filtering or switching view.
// Motion is CSS only (the chevron turn and the toggle's thumb), behind
// prefers-reduced-motion. Every element is found and checked before
// anything changes, inside try/catch, so a failure leaves the no-JavaScript
// page as it was.
//
// The pure functions below are exported for the unit tests
// (test/node/page-problems.test.js); nothing touches the DOM until init().

/** Milliseconds without typing before the result line is updated. */
export const STATUS_DELAY = 400;

export const NO_MATCH = {
  area: 'Nothing matches yet. Try a different word, or open an area below.',
  time: 'Nothing matches yet. Try a different word, or open a time of day below.',
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Text as the filter compares it: lower case, accents and apostrophes
 * removed ("Can’t" -> "cant"), and every run of anything but letters and
 * digits turned into one space.
 */
export function normalise(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['`\u2018\u2019\u02bc]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * A query as groups of terms: commas and semicolons separate alternatives
 * (OR), and the words within one alternative must all match (AND).
 * "night sweats, 3am" -> [["night", "sweats"], ["3am"]]. Empty -> [].
 */
export function parseQuery(raw) {
  return String(raw ?? '')
    .split(/[,;]/)
    .map((part) => normalise(part).split(' ').filter(Boolean))
    .filter((terms) => terms.length > 0);
}

/** Whether a normalised haystack matches any group (substring match). */
export function matches(haystack, groups) {
  return groups.some((terms) => terms.every((term) => haystack.includes(term)));
}

/** The query as the result line quotes it: trimmed, spaces collapsed. */
export function displayQuery(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * The result line. No query: "36 topics in 10 areas" (By area) or "36
 * topics across 6 times of day" (When it happens). Matches: "4 topics match
 * “night”" or "1 topic matches “pain”". None: NO_MATCH for the view.
 */
export function resultMessage({ query, matched, total, groupCount, view }) {
  const byTime = view === 'time';
  if (parseQuery(query).length === 0) {
    const topics = plural(total, 'topic', 'topics');
    return byTime
      ? `${topics} across ${plural(groupCount, 'time of day', 'times of day')}`
      : `${topics} in ${plural(groupCount, 'area', 'areas')}`;
  }
  if (matched === 0) return byTime ? NO_MATCH.time : NO_MATCH.area;
  const q = displayQuery(query);
  return matched === 1 ? `1 topic matches “${q}”` : `${matched} topics match “${q}”`;
}

/** A group's count: "6", or "2 of 6" while the filter narrows the list. */
export function countText(shown, total, filtering) {
  return filtering ? `${shown} of ${total}` : String(total);
}

// ---- DOM ------------------------------------------------------------------

/** The groups in one view's panel, checked; null if any is malformed. */
function collectGroups(panel) {
  const groups = [];
  for (const header of panel.querySelectorAll('[data-group-header]')) {
    const section = header.closest('section');
    const list = section?.querySelector('[data-group-list]');
    const count = section?.querySelector('[data-group-count]');
    const name = section?.querySelector('[data-group-name]');
    const total = Number(count?.dataset.total);
    if (!section || !list?.id || !count || !name || !Number.isInteger(total)) return null;
    const items = [...list.children].filter((li) => li.dataset.slug);
    groups.push({ header, section, list, count, name, total, items, button: null, open: true });
  }
  return groups.length > 0 ? groups : null;
}

/** Find and check every element first; null if the page isn't as expected. */
function collect(doc) {
  const root = doc.querySelector('[data-problems]');
  const tools = doc.querySelector('[data-problems-tools]');
  const hint = doc.querySelector('[data-problems-hint]'); // optional
  const status = doc.querySelector('[data-filter-status]');
  const input = doc.querySelector('[data-problem-filter]');
  const panels = {
    area: doc.querySelector('[data-view-panel="area"]'),
    time: doc.querySelector('[data-view-panel="time"]'),
  };
  const radios = [...doc.querySelectorAll('[data-view-choice]')];
  if (!root || !tools || !status || !input || !panels.area || !panels.time) return null;
  const choices = {
    area: radios.find((c) => c.value === 'area'),
    time: radios.find((c) => c.value === 'time'),
  };
  if (radios.length !== 2 || !choices.area || !choices.time) return null;

  const groups = { area: collectGroups(panels.area), time: collectGroups(panels.time) };
  if (!groups.area || !groups.time) return null;

  // Each problem once, from By area: its words and the area's name. The
  // "When it happens" view must list exactly the same problems.
  const problems = new Map();
  for (const group of groups.area) {
    for (const li of group.items) {
      const title = li.querySelector('[data-topic-title]');
      const statement = li.querySelector('[data-topic-statement]');
      if (!title || !statement || problems.has(li.dataset.slug)) return null;
      problems.set(li.dataset.slug, {
        haystack: normalise([title.textContent, statement.textContent, group.name.textContent, li.dataset.keywords].join(' ')),
        match: false,
      });
    }
  }
  const timeSlugs = groups.time.flatMap((g) => g.items.map((li) => li.dataset.slug));
  if (problems.size === 0 || timeSlugs.length !== problems.size || timeSlugs.some((s) => !problems.has(s))) return null;

  return { root, tools, hint, status, input, panels, choices, groups, problems };
}

function init(doc, win) {
  const page = collect(doc);
  if (!page) return;
  const { root, tools, hint, status, input, panels, choices, groups, problems } = page;
  const allGroups = [...groups.area, ...groups.time];

  let view = 'area';
  let narrowed = false; // the lists show only the matches
  let snapshot = null; // groups open before the filter narrowed the lists
  let matched = 0;
  let statusTimer;

  const isMatch = (li) => problems.get(li.dataset.slug).match;

  const setOpen = (group, open) => {
    group.open = open;
    group.button.setAttribute('aria-expanded', String(open));
    group.list.hidden = !open;
  };

  const message = () =>
    resultMessage({ query: input.value, matched, total: problems.size, groupCount: groups[view].length, view });

  // The live region is written once typing pauses, and only when its text
  // changes, so each pause is announced once.
  const scheduleStatus = () => {
    win.clearTimeout(statusTimer);
    statusTimer = win.setTimeout(() => {
      const text = message();
      if (status.textContent !== text) status.textContent = text;
    }, STATUS_DELAY);
  };

  const applyFilter = () => {
    const query = parseQuery(input.value);
    matched = 0;
    for (const problem of problems.values()) {
      problem.match = query.length > 0 && matches(problem.haystack, query);
      if (problem.match) matched += 1;
    }
    const narrow = matched > 0;
    if (narrow && !narrowed) snapshot = new Set(allGroups.filter((g) => g.open));

    for (const group of allGroups) {
      let shown = 0;
      for (const li of group.items) {
        li.hidden = narrow && !isMatch(li);
        if (!li.hidden) shown += 1;
      }
      // Only while narrowing: otherwise a group with no topics at all would
      // vanish after typing and clearing, though it shows on load.
      group.section.hidden = narrow && shown === 0;
      group.count.textContent = countText(shown, group.total, narrow);
      if (narrow && shown > 0) setOpen(group, true);
    }
    // When the lists stop narrowing (the query is cleared, or nothing
    // matches), the groups go back to how they were before.
    if (!narrow && narrowed && snapshot) {
      for (const group of allGroups) setOpen(group, snapshot.has(group));
      snapshot = null;
    }
    narrowed = narrow;
    scheduleStatus();
  };

  // The result line names the view's groups ("in 10 areas") or, when
  // nothing matches, how to browse them, so it follows the view.
  const setView = (next) => {
    view = next === 'time' ? 'time' : 'area';
    panels.area.hidden = view !== 'area';
    panels.time.hidden = view !== 'time';
    scheduleStatus();
  };

  const areaFromHash = () => {
    let id;
    try {
      id = decodeURIComponent(win.location.hash.slice(1));
    } catch {
      return null;
    }
    return (id && groups.area.find((g) => g.section.id === id)) || null;
  };

  // ---- Change the page (nothing above has touched it) ----

  for (const group of allGroups) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = group.header.className;
    button.dataset.groupHeader = '';
    button.setAttribute('aria-controls', group.list.id);
    button.append(...group.header.childNodes);
    group.header.replaceWith(button);
    group.button = button;
    button.addEventListener('click', () => setOpen(group, !group.open));
  }

  const target = areaFromHash();
  for (const group of groups.area) setOpen(group, group === (target ?? groups.area[0]));
  for (const group of groups.time) setOpen(group, group === groups.time[0]);

  choices.area.checked = true;
  panels.area.hidden = false;
  panels.time.hidden = true;
  tools.hidden = false;
  if (hint) hint.hidden = false;
  root.classList.add('is-enhanced');

  // A value restored by the browser despite autocomplete="off".
  if (input.value) applyFilter();

  // The browser may already have scrolled to the fragment before the other
  // areas closed; put the area back at the top. Focus stays where it is.
  if (target) target.section.scrollIntoView({ block: 'start' });

  input.addEventListener('input', applyFilter);

  // Escape clears the field (Firefox doesn't for type="search").
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || input.value === '') return;
    event.preventDefault();
    input.value = '';
    applyFilter();
  });

  for (const choice of [choices.area, choices.time]) {
    choice.addEventListener('change', () => {
      if (choice.checked) setView(choice.value);
    });
  }

  // An area link on this page, or Back/Forward between them, opens that
  // area in the By area view. Other fragments (such as the skip link's
  // #main) are left alone.
  win.addEventListener('hashchange', () => {
    const area = areaFromHash();
    if (!area) return;
    if (area.section.hidden) {
      input.value = '';
      applyFilter();
    }
    if (view !== 'area') {
      choices.area.checked = true;
      setView('area');
    }
    setOpen(area, true);
    area.section.scrollIntoView({ block: 'start' });
  });
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  try {
    init(document, window);
  } catch {
    // Leave the no-JavaScript page in place.
  }
}
