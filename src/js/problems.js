// Sleep problems page (/problems/): the By area accordion, the "When it
// happens" view and the live filter (SPEC §7.2, §8.1; HANDOFF §6.3).
//
// The HTML works without this module: every area is open, the toolbar and
// the lanes carry `hidden`, and the result line is static. This module:
//
// - turns each area heading's <span> into a <button aria-expanded
//   aria-controls> (as menu.js does for the Menu) and opens only the first
//   area, or the one named in the URL (/problems/#mind), also on hashchange;
// - shows the toolbar: the filter, the By area / When it happens radios,
//   and "Open all areas" / "Close all areas" (By area view only), and the
//   lede's sentence about them (data-problems-hint);
// - filters both views as you type, over each problem's short title,
//   statement, area name and keywords (data-keywords, from
//   data/keywords.csv when it exists). Areas with no matches are hidden and
//   areas with matches open. When nothing matches, both views show every
//   topic and the result line says so;
// - writes the result line (aria-live="polite") once typing pauses, so a
//   screen reader hears one count per pause, not one per keystroke.
//
// Privacy (SPEC §8.1; CLAUDE.md): what someone types is never logged, sent,
// stored or put in the URL, and reaches the page only through textContent.
// Nothing is remembered between visits: no storage at all.
//
// Focus never moves: not on load, toggling, filtering or switching view.
// Motion is CSS only (the chevron turn), behind prefers-reduced-motion.
// Every element is found and checked before anything changes, inside
// try/catch, so a failure leaves the no-JavaScript page as it was.
//
// The pure functions below are exported for the unit tests
// (test/node/page-problems.test.js); nothing touches the DOM until init().

/** Milliseconds without typing before the result line is updated. */
export const STATUS_DELAY = 400;

export const NO_MATCH = {
  area: 'Nothing matches yet. Try a different word, or open an area below.',
  time: 'Nothing matches yet. Try a different word, or look through the topics below.',
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
 * The result line. No query: "36 topics in 10 areas". Matches:
 * "4 topics match “night”" or "1 topic matches “pain”". None: NO_MATCH for
 * the current view.
 */
export function resultMessage({ query, matched, total, areaCount, view }) {
  if (parseQuery(query).length === 0) {
    return `${plural(total, 'topic', 'topics')} in ${plural(areaCount, 'area', 'areas')}`;
  }
  if (matched === 0) return view === 'time' ? NO_MATCH.time : NO_MATCH.area;
  const q = displayQuery(query);
  return matched === 1 ? `1 topic matches “${q}”` : `${matched} topics match “${q}”`;
}

/** An area's count: "6", or "2 of 6" while the filter narrows the list. */
export function countText(shown, total, filtering) {
  return filtering ? `${shown} of ${total}` : String(total);
}

/** A lane's count: "3 topics", "1 topic", "0 topics". */
export function laneCountText(n) {
  return plural(n, 'topic', 'topics');
}

// ---- DOM ------------------------------------------------------------------

/** Find and check every element first; null if the page isn't as expected. */
function collect(doc) {
  const root = doc.querySelector('[data-problems]');
  const tools = doc.querySelector('[data-problems-tools]');
  const hint = doc.querySelector('[data-problems-hint]'); // optional
  const status = doc.querySelector('[data-filter-status]');
  const input = doc.querySelector('[data-problem-filter]');
  const toggleAll = doc.querySelector('[data-toggle-all]');
  const areaPanel = doc.querySelector('[data-view-panel="area"]');
  const timePanel = doc.querySelector('[data-view-panel="time"]');
  const choices = [...doc.querySelectorAll('[data-view-choice]')];
  if (!root || !tools || !status || !input || !toggleAll || !areaPanel || !timePanel) return null;
  const areaChoice = choices.find((c) => c.value === 'area');
  const timeChoice = choices.find((c) => c.value === 'time');
  if (choices.length !== 2 || !areaChoice || !timeChoice) return null;

  const problems = new Map();
  const areas = [];
  for (const header of areaPanel.querySelectorAll('[data-area-header]')) {
    const section = header.closest('section');
    const list = section?.querySelector('[data-area-list]');
    const count = section?.querySelector('[data-area-count]');
    const name = section?.querySelector('[data-area-name]');
    const total = Number(count?.dataset.total);
    if (!section || !list?.id || !count || !name || !Number.isInteger(total)) return null;
    const items = [...list.children].filter((li) => li.dataset.slug);
    for (const li of items) {
      const title = li.querySelector('[data-topic-title]');
      const statement = li.querySelector('[data-topic-statement]');
      if (!title || !statement || problems.has(li.dataset.slug)) return null;
      problems.set(li.dataset.slug, {
        haystack: normalise([title.textContent, statement.textContent, name.textContent, li.dataset.keywords].join(' ')),
        match: false,
      });
    }
    areas.push({ id: header.dataset.areaHeader, header, section, list, count, total, items, button: null, open: true });
  }

  const lanes = [];
  for (const lane of timePanel.querySelectorAll('[data-lane]')) {
    const list = lane.querySelector('[data-lane-list]');
    const count = lane.querySelector('[data-lane-count]');
    if (!list || !count) return null;
    const items = [...list.children].filter((li) => li.dataset.slug);
    if (items.some((li) => !problems.has(li.dataset.slug))) return null;
    lanes.push({ list, count, items });
  }
  if (areas.length === 0 || problems.size === 0) return null;

  return { root, tools, hint, status, input, toggleAll, areaPanel, timePanel, areaChoice, timeChoice, areas, lanes, problems };
}

function init(doc, win) {
  const page = collect(doc);
  if (!page) return;
  const { root, tools, hint, status, input, toggleAll, areaPanel, timePanel, areaChoice, timeChoice, areas, lanes, problems } = page;

  let view = 'area';
  let narrowed = false; // the lists show only the matches
  let snapshot = null; // open areas before the filter narrowed the lists
  let matched = 0;
  let statusTimer;

  const isMatch = (li) => problems.get(li.dataset.slug).match;

  const setOpen = (area, open) => {
    area.open = open;
    area.button.setAttribute('aria-expanded', String(open));
    area.list.hidden = !open;
  };

  const visibleAreas = () => areas.filter((a) => !a.section.hidden);

  const updateToggleAll = () => {
    const shown = visibleAreas();
    const allOpen = shown.length > 0 && shown.every((a) => a.open);
    toggleAll.textContent = allOpen ? 'Close all areas' : 'Open all areas';
    return allOpen;
  };

  const message = () =>
    resultMessage({ query: input.value, matched, total: problems.size, areaCount: areas.length, view });

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
    const groups = parseQuery(input.value);
    matched = 0;
    for (const problem of problems.values()) {
      problem.match = groups.length > 0 && matches(problem.haystack, groups);
      if (problem.match) matched += 1;
    }
    const narrow = matched > 0;
    if (narrow && !narrowed) snapshot = new Set(areas.filter((a) => a.open).map((a) => a.id));

    for (const area of areas) {
      let shown = 0;
      for (const li of area.items) {
        li.hidden = narrow && !isMatch(li);
        if (!li.hidden) shown += 1;
      }
      area.section.hidden = shown === 0;
      area.count.textContent = countText(shown, area.total, narrow);
      if (narrow && shown > 0) setOpen(area, true);
    }
    // When the lists stop narrowing (the query is cleared, or nothing
    // matches), the areas go back to how they were before.
    if (!narrow && narrowed && snapshot) {
      for (const area of areas) setOpen(area, snapshot.has(area.id));
      snapshot = null;
    }
    narrowed = narrow;

    for (const lane of lanes) {
      let shown = 0;
      for (const li of lane.items) {
        li.hidden = narrow && !isMatch(li);
        if (!li.hidden) shown += 1;
      }
      lane.list.hidden = shown === 0;
      lane.count.textContent = laneCountText(shown);
    }

    updateToggleAll();
    scheduleStatus();
  };

  const setView = (next) => {
    view = next === 'time' ? 'time' : 'area';
    areaPanel.hidden = view !== 'area';
    timePanel.hidden = view !== 'time';
    toggleAll.hidden = view !== 'area';
    // Only the no-match message differs between the views.
    if (parseQuery(input.value).length > 0 && matched === 0) scheduleStatus();
  };

  const areaFromHash = () => {
    let id;
    try {
      id = decodeURIComponent(win.location.hash.slice(1));
    } catch {
      return null;
    }
    return areas.find((a) => a.id === id) ?? null;
  };

  // ---- Change the page (nothing above has touched it) ----

  for (const area of areas) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = area.header.className;
    button.dataset.areaHeader = area.id;
    button.setAttribute('aria-controls', area.list.id);
    button.append(...area.header.childNodes);
    area.header.replaceWith(button);
    area.button = button;
    button.addEventListener('click', () => {
      setOpen(area, !area.open);
      updateToggleAll();
    });
  }

  const target = areaFromHash();
  for (const area of areas) setOpen(area, area === (target ?? areas[0]));

  areaChoice.checked = true;
  setView('area');
  updateToggleAll();
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

  for (const choice of [areaChoice, timeChoice]) {
    choice.addEventListener('change', () => {
      if (choice.checked) setView(choice.value);
    });
  }

  toggleAll.addEventListener('click', () => {
    const open = !updateToggleAll();
    for (const area of visibleAreas()) setOpen(area, open);
    updateToggleAll();
  });

  // An area link on this page, or Back/Forward between them, opens that
  // area. Other fragments (such as the skip link's #main) are left alone.
  win.addEventListener('hashchange', () => {
    const area = areaFromHash();
    if (!area) return;
    if (area.section.hidden) {
      input.value = '';
      applyFilter();
    }
    if (view !== 'area') {
      areaChoice.checked = true;
      setView('area');
    }
    setOpen(area, true);
    updateToggleAll();
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
