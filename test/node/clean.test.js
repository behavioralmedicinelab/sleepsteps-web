// scripts/clean.js (SPEC §18.1): `npm run build` empties dist/ before
// Eleventy writes to it, so a page or script removed from the site doesn't
// stay in an old dist/, where `wrangler dev` would serve it and
// `npm run test:a11y` would check it. Run here on temporary folders only,
// never on the real dist/.
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { config } from '../../eleventy.config.js';
import { DIST, emptyDir } from '../../scripts/clean.js';

const dirs = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const temp = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sleepsteps-clean-'));
  dirs.push(dir);
  return dir;
};
/** A folder with what an old build leaves: pages, a script, a hidden file. */
function oldBuild(dir) {
  for (const file of ['index.html', 'old-page/index.html', 'js/vendor/old.js', '.hidden']) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), 'old');
  }
  return dir;
}

describe('scripts/clean.js', () => {
  it('empties a folder of files, folders and hidden files, and keeps the folder itself', () => {
    const dir = oldBuild(path.join(temp(), 'dist'));
    emptyDir(dir);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('does nothing when the folder is missing (a fresh clone, Workers Builds)', () => {
    const dir = path.join(temp(), 'dist');
    expect(() => emptyDir(dir)).not.toThrow();
    expect(existsSync(dir)).toBe(false);
  });

  it("removes a link inside the folder, never what it points to", () => {
    const root = temp();
    const outside = oldBuild(path.join(root, 'outside'));
    const dir = oldBuild(path.join(root, 'dist'));
    symlinkSync(outside, path.join(dir, 'link'), 'dir');
    emptyDir(dir);
    expect(readdirSync(dir)).toEqual([]);
    expect(readdirSync(outside).sort()).toEqual(['.hidden', 'index.html', 'js', 'old-page']);
  });

  it("empties this checkout's dist/: Eleventy's output folder, next to scripts/", () => {
    expect(DIST).toBe(path.resolve(config.dir.output));
    expect(DIST).toBe(path.resolve('dist'));
  });

  // The command itself, on a copy of the script in a temporary "checkout",
  // so the dist/ it empties is that folder's.
  it('run as a command, empties the dist/ beside its scripts/ folder and nothing else', async () => {
    const root = temp();
    mkdirSync(path.join(root, 'scripts/lib'), { recursive: true });
    copyFileSync('scripts/clean.js', path.join(root, 'scripts/clean.js'));
    copyFileSync('scripts/lib/cli.js', path.join(root, 'scripts/lib/cli.js'));
    writeFileSync(path.join(root, 'package.json'), '{ "type": "module" }');
    oldBuild(path.join(root, 'dist'));
    oldBuild(path.join(root, 'content'));
    // Started from another folder: it goes by where the script is.
    await promisify(execFile)(process.execPath, [path.join(root, 'scripts/clean.js')], { cwd: temp() });
    expect(readdirSync(path.join(root, 'dist'))).toEqual([]);
    expect(readdirSync(path.join(root, 'content')).sort()).toEqual(['.hidden', 'index.html', 'js', 'old-page']);
  });
});

describe('npm run build (package.json, SPEC §18.1)', () => {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));

  it('checks the content, then empties dist/, then runs Eleventy: invalid content leaves the old build alone', () => {
    expect(scripts.build).toBe('node scripts/validate-content.js && node scripts/clean.js && eleventy');
  });

  it('is what dev, dev:collect, test:a11y and a11y:serve start with, so each starts from a clean dist/', () => {
    expect(scripts.predev).toBe('npm run build');
    for (const name of ['dev:collect', 'test:a11y', 'a11y:serve']) expect(scripts[name], name).toMatch(/^npm run build && /);
    // Nothing else empties it: the watcher rebuilds into the folder the dev server is serving.
    for (const [name, script] of Object.entries(scripts)) {
      if (name !== 'build') expect(script, name).not.toContain('clean.js');
    }
  });
});
