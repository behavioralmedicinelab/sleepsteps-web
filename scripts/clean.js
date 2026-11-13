// Empties dist/ for `npm run build` (SPEC §18.1), after the content check
// and before Eleventy. Eleventy only adds and overwrites files, so a page or
// script removed from the site would otherwise stay in an old dist/, where
// `wrangler dev` serves it and `npm run test:a11y` checks it. Production
// never had the problem: Workers Builds starts from a fresh checkout.
//
// The folder itself stays, so a dev server watching it keeps it. Only
// `npm run build` runs this; Eleventy's watcher (`npm run dev`) rebuilds
// into the folder as it is. Node built-ins only (SPEC §5).
//
// CLI:    node scripts/clean.js
// Module: emptyDir(dir)
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './lib/cli.js';

/** This checkout's build output: Eleventy's `dir.output` (eleventy.config.js). */
export const DIST = fileURLToPath(new URL('../dist', import.meta.url));

/** Removes everything inside `dir` and keeps the folder; a missing folder is left missing. */
export function emptyDir(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const name of names) rmSync(path.join(dir, name), { recursive: true, force: true });
}

if (isMain(import.meta.url)) emptyDir(DIST);
