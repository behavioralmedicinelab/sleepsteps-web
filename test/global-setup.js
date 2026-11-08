// Builds the site before both test projects, into fresh temporary
// directories, and passes their paths to the tests. It runs from the root
// config, so the worker project gets it too.
//
// - inject('builtSite'): the real build, from eleventy.config.js and
//   site.config.json as they are: what production deploys. It also writes
//   worker/generated/pages.json (SPEC §8.3), which the Worker imports, so the
//   Worker tests pass on a fresh clone, as in Workers Builds.
// - inject('builtSiteOn'): the site with all three feature switches on,
//   whatever site.config.json says. The tests of a switchable feature's
//   widgets and modules run on it, so turning a feature off skips none of
//   them and `npm test` still passes on the push that turns it off (SPEC §11,
//   §19.3).
// - inject('featureBuilds'): [{ name, features, dir }] for every combination
//   of the three switches, all on first, for the whole-site checks of each
//   state (test/node/features-off.test.js). One of them has the same switches
//   as site.config.json, and that test checks it matches the real build file
//   for file.
// The variants use test/features.config.js, which overrides site.features
// and never writes pages.json. `npm run test:features` runs the whole suite
// with site.config.json itself set to each combination (SPEC §11).
//
// Why not read dist/: it may be stale (an old build, or a half-written one
// while `npm run dev` is watching), and rebuilding into it would fight with
// the dev server. A temporary build is always current, and a failed build
// fails the run with Eleventy's error.
//
// The builds run Eleventy's own CLI (the same entry point as `npm run build`)
// because only the CLI's --output overrides the `dir.output` set in
// eleventy.config.js; the programmatic API lets the config file win.
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { FEATURE_VARIANTS } from '../scripts/lib/feature-variants.js';

const require = createRequire(import.meta.url);

export default async function setup(project) {
  // The package exports only its API, so find cmd.cjs from the entry point.
  const cli = path.join(path.dirname(require.resolve('@11ty/eleventy')), '..', 'cmd.cjs');
  const dirs = [];
  const cleanup = () => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));

  const build = async (label, args = [], env = {}) => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'sleepsteps-build-'));
    dirs.push(outDir);
    try {
      await promisify(execFile)(process.execPath, [cli, `--output=${outDir}`, '--quiet', ...args], {
        cwd: project.config.root,
        env: { ...process.env, ...env },
      });
    } catch (error) {
      throw new Error(`Eleventy build (${label}) failed:\n${error.stderr || error.message}`);
    }
    return outDir;
  };

  try {
    const [real, ...variants] = await Promise.all([
      build('site.config.json'),
      ...FEATURE_VARIANTS.map(({ name, features }) =>
        build(name, ['--config=test/features.config.js'], { FEATURES: JSON.stringify(features) }),
      ),
    ]);
    project.provide('builtSite', real);
    project.provide('builtSiteOn', variants[0]);
    project.provide(
      'featureBuilds',
      FEATURE_VARIANTS.map((variant, i) => ({ ...variant, dir: variants[i] })),
    );
  } catch (error) {
    await cleanup();
    throw error;
  }

  return cleanup;
}
