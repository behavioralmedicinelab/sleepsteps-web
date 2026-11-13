// The list of sleep problems on Home (/#sleep-problems): the accordion of
// areas and the live filter (SPEC §7.2, §8.1; HANDOFF §6.3). Until
// 2026-11-13 the list was a page of its own, /problems/.
//
// Home lists the problems by area: one group per area, each a heading
// over its list of problems. The HTML works without this module: every area
// is open under a plain heading, the toolbar carries `hidden`, and the
// result line is static. This module:
//
// - turns each area heading's <span> into a <button aria-expanded
//   aria-controls> (as menu.js does for the Menu) and closes every area,
//   except the one named in the URL (/#mind), which it opens, also on
//   hashchange;
// - shows the toolbar (the filter) and the lede's sentence about it
//   (data-problems-hint);
// - filters as you type, over each problem's short title, statement, area
//   name and keywords (data-keywords, from data/keywords.csv when it
//   exists). While some topics match, areas without a match are hidden and
//   areas with one open. When nothing matches, or the field is cleared, the
//   areas are as they were before the filter narrowed them (every area
//   shown, one with no topics included, as on load), and the result line
//   says so;
// - writes the result line (aria-live="polite") once typing pauses, so a
//   screen reader hears one count per pause, not one per keystroke.
//
// Privacy (SPEC §8.1; CLAUDE.md): what someone types is never logged, sent,
// stored or put in the URL, and reaches the page only through textContent.
// Nothing is remembered between visits: no storage at all.
//
// Focus never moves: not on load, toggling or filtering. Motion is CSS only
// (the chevron turn), behind prefers-reduced-motion. Every element is found
// and checked before anything changes, inside try/catch, so a failure
// leaves the no-JavaScript page as it was.
//
// The pure functions below are exported for the unit tests
// (test/node/page-home-start.test.js); nothing touches the DOM until init().

/** Milliseconds without typing before the result line is updated. */
export const STATUS_DELAY = 400;

export const NO_MATCH = 'Nothing matches yet. Try a different word, or open an area below.';

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
 * The result line. No query: "36 topics in 10 areas". Matches: "4 topics
 * match “night”" or "1 topic matches “pain”". None: NO_MATCH.
 */
export function resultMessage({ query, matched, total, groupCount }) {
  if (parseQuery(query).length === 0) {
    return `${plural(total, 'topic', 'topics')} in ${plural(groupCount, 'area', 'areas')}`;
  }
  if (matched === 0) return NO_MATCH;
  const q = displayQuery(query);
  return matched === 1 ? `1 topic matches “${q}”` : `${matched} topics match “${q}”`;
}

/** An area's count: "6", or "2 of 6" while the filter narrows the list. */
export function countText(shown, total, filtering) {
  return filtering ? `${shown} of ${total}` : String(total);
}

// ---- DOM ------------------------------------------------------------------

/**
 * Find and check every element first; null if the page isn't as expected.
 * Each group is an area; each of its items is a problem with the text the
 * filter searches: its words and the area's name.
 */
function collect(doc) {
  const root = doc.querySelector('[data-problems]');
  const tools = doc.querySelector('[data-problems-tools]');
  const hint = doc.querySelector('[data-problems-hint]'); // optional
  const status = doc.querySelector('[data-filter-status]');
  const input = doc.querySelector('[data-problem-filter]');
  if (!root || !tools || !status || !input) return null;

  const groups = [];
  let total = 0; // problems on the page
  for (const header of root.querySelectorAll('[data-group-header]')) {
    const section = header.closest('section');
    const list = section?.querySelector('[data-group-list]');
    const count = section?.querySelector('[data-group-count]');
    const name = section?.querySelector('[data-group-name]');
    const size = Number(count?.dataset.total);
    if (!section || !list?.id || !count || !name || !Number.isInteger(size)) return null;
    const items = [];
    for (const li of list.children) {
      if (!li.dataset.slug) continue;
      const title = li.querySelector('[data-topic-title]');
      const statement = li.querySelector('[data-topic-statement]');
      if (!title || !statement) return null;
      items.push({
        li,
        haystack: normalise([title.textContent, statement.textContent, name.textContent, li.dataset.keywords].join(' ')),
        match: false,
      });
    }
    total += items.length;
    groups.push({ header, section, list, count, total: size, items, button: null, open: true });
  }
  if (groups.length === 0 || total === 0) return null;

  return { root, tools, hint, status, input, groups, total };
}

function init(doc, win) {
  const page = collect(doc);
  if (!page) return;
  const { root, tools, hint, status, input, groups, total } = page;

  let narrowed = false; // the lists show only the matches
  let snapshot = null; // areas open before the filter narrowed the lists
  let matched = 0;
  let statusTimer;

  const setOpen = (group, open) => {
    group.open = open;
    group.button.setAttribute('aria-expanded', String(open));
    group.list.hidden = !open;
  };

  const message = () => resultMessage({ query: input.value, matched, total, groupCount: groups.length });

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
    for (const group of groups) {
      for (const item of group.items) {
        item.match = query.length > 0 && matches(item.haystack, query);
        if (item.match) matched += 1;
      }
    }
    const narrow = matched > 0;
    if (narrow && !narrowed) snapshot = new Set(groups.filter((g) => g.open));

    for (const group of groups) {
      let shown = 0;
      for (const item of group.items) {
        item.li.hidden = narrow && !item.match;
        if (!item.li.hidden) shown += 1;
      }
      // Only while narrowing: otherwise an area with no topics at all would
      // vanish after typing and clearing, though it shows on load.
      group.section.hidden = narrow && shown === 0;
      group.count.textContent = countText(shown, group.total, narrow);
      if (narrow && shown > 0) setOpen(group, true);
    }
    // When the lists stop narrowing (the query is cleared, or nothing
    // matches), the areas go back to how they were before.
    if (!narrow && narrowed && snapshot) {
      for (const group of groups) setOpen(group, snapshot.has(group));
      snapshot = null;
    }
    narrowed = narrow;
    scheduleStatus();
  };

  const areaFromHash = () => {
    let id;
    try {
      id = decodeURIComponent(win.location.hash.slice(1));
    } catch {
      return null;
    }
    return (id && groups.find((g) => g.section.id === id)) || null;
  };

  // ---- Change the page (nothing above has touched it) ----

  for (const group of groups) {
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

  // Every area starts closed (project lead, 2026-11-07), except one named
  // in the URL, which someone chose to go to.
  const target = areaFromHash();
  for (const group of groups) setOpen(group, group === target);

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

  // An area link on this page, or Back/Forward between them, opens that
  // area, clearing a filter that hides it. Other fragments (such as the
  // skip link's #main, or #sleep-problems) are left alone.
  win.addEventListener('hashchange', () => {
    const area = areaFromHash();
    if (!area) return;
    if (area.section.hidden) {
      input.value = '';
      applyFilter();
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
