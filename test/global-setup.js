// Builds the site once, before both test projects, into a fresh temporary
// directory, and passes its path to the tests (inject('builtSite')). It runs
// from the root config, so the worker project gets it too: the build also
// writes worker/generated/pages.json (SPEC §8.3), which the Worker imports,
// so the Worker tests pass on a fresh clone, as in Workers Builds.
//
// Why not read dist/: it may be stale (an old build, or a half-written one
// while `npm run dev` is watching), and rebuilding into it would fight with
// the dev server. A temporary build is always current, and a failed build
// fails the run with Eleventy's error.
//
// The build runs Eleventy's own CLI (the same entry point as `npm run build`)
// because only the CLI's --output overrides the `dir.output` set in
// eleventy.config.js; the programmatic API lets the config file win.
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);

export default async function setup(project) {
  const outDir = await mkdtemp(path.join(tmpdir(), 'sleepsteps-build-'));
  // The package exports only its API, so find cmd.cjs from the entry point.
  const cli = path.join(path.dirname(require.resolve('@11ty/eleventy')), '..', 'cmd.cjs');
  try {
    await promisify(execFile)(process.execPath, [cli, `--output=${outDir}`, '--quiet'], {
      cwd: project.config.root,
    });
  } catch (error) {
    await rm(outDir, { recursive: true, force: true });
    throw new Error(`Eleventy build failed:\n${error.stderr || error.message}`);
  }
  project.provide('builtSite', outDir);

  return async () => {
    await rm(outDir, { recursive: true, force: true });
  };
}
