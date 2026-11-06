// Site search settings (SPEC §8.4), shared by the search page (search.js) and
// the query tests (test/node/search-queries.test.js), so the tests rank
// exactly as the site does. A starting point: tune against real queries, and
// rerun the query tests after every change here or to data/keywords.csv.

/** Lower case, with accents removed, so "café" matches "cafe". */
const processTerm = (term) =>
  term
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** MiniSearch constructor options for /search-index.json (SPEC §8.3). */
export const INDEX_OPTIONS = {
  fields: ['title', 'keywords', 'summary', 'transcript'],
  storeFields: ['title', 'url', 'summary', 'type'],
  processTerm,
};

/** Options for every search. */
export const SEARCH_OPTIONS = {
  boost: { keywords: 4, title: 3, summary: 2, transcript: 1 },
  fuzzy: 0.2,
  prefix: true,
  combineWith: 'OR',
};

/** Results shown at most (SPEC §8.1). */
export const MAX_RESULTS = 10;

/** The search event keeps at most this much of the query (SPEC §10.2). */
export const MAX_QUERY_LOGGED = 100;

/** How each entry type is named in the results. */
export const TYPE_LABELS = {
  problem: 'Sleep problem',
  start: 'Introduction',
  page: 'Information',
};
