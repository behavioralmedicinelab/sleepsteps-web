// Single Worker for the site (SPEC §4). Requests that match a static file in
// dist/ never reach this code, and nor do browser navigations to unmatched
// paths: those get the 404 page straight from static assets. Other unmatched
// requests (fetch, beacons, crawlers) do reach it, and `run_worker_first` in
// wrangler.jsonc sends every /api/* request here first (SPEC §18.2). /admin
// page loads will need it too (M6).
//
// The routing is in router.js. pages.json is written by every Eleventy build
// (scripts/build-data.js, SPEC §8.3), so run `npm run build` before
// `wrangler dev` or `wrangler deploy` (npm run dev and Workers Builds do).
//
// Only the default export: the Vitest plugin treats named function exports
// of the entry point as entrypoints.
import site from '../site.config.json';
import pages from './generated/pages.json';
import { createRouter } from './router.js';

export default createRouter({ pages, site });
