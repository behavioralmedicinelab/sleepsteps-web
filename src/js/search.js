// The search results page, /search/ (SPEC §8.1, §8.4). Loaded only there.
//
// It reads ?q= from the address, so results can be shared and the Back
// button works (each search is a plain GET of /search/?q=...). With a query,
// it loads MiniSearch and the index (the root's data-minisearch and
// data-index), searches with the settings in search-config.js, and lists the
// top MAX_RESULTS: title (linked), type and summary, built with textContent
// only. The count goes to the page's status region (role="status"). With no
// results, or if the index or MiniSearch fails to load, the page says so and
// links to the Sleep problems page. Without JavaScript, the static page says
// that results need it.
//
// Analytics (M3): report() only dispatches a `sleepsteps:event` CustomEvent,
// `search` with { q (first MAX_QUERY_LOGGED characters), results }, as
// players.js does; M3's events.js sends it. The query is never logged to the
// console or kept in browser storage, and from M3 it is stored only as that
// event (SPEC §10, §15.3). The page's referrer policy (strict-origin, set in
// content/search.njk) keeps it out of the Referer of the pages it leads to.
import { INDEX_OPTIONS, MAX_QUERY_LOGGED, MAX_RESULTS, SEARCH_OPTIONS, TYPE_LABELS } from './search-config.js';

const LOAD_TIMEOUT_MS = 15000;

function report(type, detail) {
  document.dispatchEvent(new CustomEvent('sleepsteps:event', { detail: { type, detail } }));
}

/** Rejects if `promise` takes longer than LOAD_TIMEOUT_MS. */
function withTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), LOAD_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function loadIndex(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`index: ${response.status}`);
  return response.json();
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** One result: title (linked), type and summary. */
function resultItem(result) {
  const item = element('li', 'search-result');
  const heading = element('h2', 'search-result__title');
  const link = element('a', '', result.title);
  // Index URLs are this site's own paths.
  if (typeof result.url === 'string' && result.url.startsWith('/') && !result.url.startsWith('//')) {
    link.setAttribute('href', result.url);
  }
  heading.append(link);
  item.append(heading, element('p', 'search-result__type', TYPE_LABELS[result.type] ?? ''));
  if (result.summary) item.append(element('p', 'search-result__summary', result.summary));
  return item;
}

function countLine(total, query) {
  const quoted = `“${query}”`;
  if (total > MAX_RESULTS) return `The top ${MAX_RESULTS} of ${total} results for ${quoted}`;
  return `${total} ${total === 1 ? 'result' : 'results'} for ${quoted}`;
}

async function run(root) {
  const input = root.querySelector('[data-search-input]');
  const status = root.querySelector('[data-search-status]');
  const list = root.querySelector('[data-search-results]');
  const empty = root.querySelector('[data-search-empty]');
  const failed = root.querySelector('[data-search-error]');
  const fallback = root.querySelector('[data-search-fallback]');
  if (!status || !list) return;
  if (fallback) fallback.hidden = true;

  const query = (new URLSearchParams(location.search).get('q') ?? '').trim();
  if (input) input.value = query;
  if (!query) return;

  status.textContent = 'Searching…';
  let results;
  try {
    const [{ default: MiniSearch }, documents] = await withTimeout(
      Promise.all([import(root.dataset.minisearch), loadIndex(root.dataset.index)]),
    );
    const index = new MiniSearch(INDEX_OPTIONS);
    index.addAll(documents);
    results = index.search(query, SEARCH_OPTIONS);
  } catch {
    status.textContent = "Search isn't working right now.";
    if (failed) failed.hidden = false;
    return;
  }

  if (results.length === 0) {
    status.textContent = `No results for “${query}”.`;
    if (empty) empty.hidden = false;
  } else {
    status.textContent = countLine(results.length, query);
    list.replaceChildren(...results.slice(0, MAX_RESULTS).map(resultItem));
    list.hidden = false;
  }
  report('search', { q: query.slice(0, MAX_QUERY_LOGGED), results: results.length });
}

const root = document.querySelector('[data-search]');
if (root) run(root);
