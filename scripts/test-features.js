// `npm run test:features`: runs the whole of `npm test`, then `npm run build`,
// with site.config.json's feature switches set to each combination the team
// might push (SPEC §11, §19.3): all eight, from all on to all off. Each run
// is a copy of the working tree in a temporary directory (the files git
// would commit, plus uncommitted changes; never .dev.vars, dist/ or anything
// else .gitignore lists, so it needs a git checkout), sharing node_modules
// through a link, with only the switches edited. The repository itself is
// never touched.
//
// It fails unless every run passes and runs the same tests as the all-on
// run: the same number in each file, with none skipped that the all-on run
// ran. A check that skips itself, or quietly isn't collected, while a feature
// is off would otherwise pass unnoticed (M7, SPEC §22).
//
// Not part of `npm test` (it runs `npm test` eight times) or Workers Builds.
// Run it before a pull request that changes a template, a module of a
// switchable feature, or a test of one. Node built-ins only.
//
//   npm run test:features            all eight combinations
//   npm run test:features -- --keep  keep the copies and their logs
import { execFileSync, spawn } from 'node:child_process';
import { constants, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURE_VARIANTS } from './lib/feature-variants.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const keep = process.argv.includes('--keep');

/** site.config.json with only its "features" object replaced, as a person would edit it. */
export function withFeatures(source, features) {
  const pattern = /"features"\s*:\s*\{[^{}]*\}/;
  if (!pattern.test(source)) throw new Error('site.config.json has no "features": { … } object');
  const pairs = Object.entries(features).map(([name, value]) => `${JSON.stringify(name)}: ${JSON.stringify(value)}`);
  const edited = source.replace(pattern, `"features": { ${pairs.join(', ')} }`);
  if (JSON.stringify(JSON.parse(edited).features) !== JSON.stringify(features)) throw new Error('could not set the switches');
  return edited;
}

/** Per test file: { tests, skipped, failed, ran, message }, from Vitest's JSON report; `ran` counts each test name that ran. */
export function summarise(report) {
  const files = {};
  for (const file of report.testResults) {
    // The copy's path differs in every run, so key by the path from test/.
    const key = file.name.split(path.sep).join('/').match(/(?:^|\/)(test\/.*)$/)?.[1] ?? file.name;
    const results = file.assertionResults ?? [];
    files[key] = {
      tests: results.length,
      skipped: results.filter((r) => r.status === 'skipped' || r.status === 'pending' || r.status === 'todo').length,
      failed: results.filter((r) => r.status === 'failed').length + (file.status === 'failed' && results.length === 0 ? 1 : 0),
      ran: results
        .filter((r) => r.status === 'passed' || r.status === 'failed')
        .reduce((counts, r) => counts.set(r.fullName, (counts.get(r.fullName) ?? 0) + 1), new Map()),
      message: file.message || '',
    };
  }
  return files;
}

/** How a run differs from the all-on run: a list of lines, empty if none. */
export function compare(base, run) {
  const lines = [];
  for (const file of [...new Set([...Object.keys(base), ...Object.keys(run)])].sort()) {
    const a = base[file] ?? { tests: 0, skipped: 0 };
    const b = run[file] ?? { tests: 0, skipped: 0 };
    if (a.tests !== b.tests) lines.push(`${file}: ${b.tests} tests, not ${a.tests} as with all on`);
    if (b.skipped > a.skipped) lines.push(`${file}: ${b.skipped - a.skipped} more skipped than with all on`);
    // The same tests, not just as many: each test that ran with all on runs here too.
    const missing = [...(a.ran ?? new Map())].filter(([name, n]) => (b.ran?.get(name) ?? 0) < n).map(([name]) => name);
    if (missing.length) {
      lines.push(`${file}: ${missing.length} tests that ran with all on didn't run, e.g. "${missing.slice(0, 3).join('", "')}"`);
    }
  }
  return lines;
}

function copyTree(dest) {
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  for (const rel of listed.split('\0').filter(Boolean)) {
    const from = path.join(ROOT, rel);
    const to = path.join(dest, rel);
    mkdirSync(path.dirname(to), { recursive: true });
    try {
      // A copy-on-write clone where the disk supports it (APFS), else a copy.
      copyFileSync(from, to, constants.COPYFILE_FICLONE);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error; // a tracked file deleted in the working tree
    }
  }
  symlinkSync(path.join(ROOT, 'node_modules'), path.join(dest, 'node_modules'), 'dir');
}

async function run(cmd, args, cwd, log) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, FORCE_COLOR: '0', CI: '1' } });
    const chunks = [];
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => chunks.push(d));
    child.on('close', (code) => {
      writeFileSync(log, Buffer.concat(chunks));
      resolve(code);
    });
  });
}

async function main() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  let base;
  let failed = false;
  const dirs = [];
  try {
    for (const variant of FEATURE_VARIANTS) {
      const dir = mkdtempSync(path.join(tmpdir(), `sleepsteps-features-${variant.name.replace(/\s+/g, '-')}-`));
      dirs.push(dir);
      copyTree(dir);
      const configPath = path.join(dir, 'site.config.json');
      writeFileSync(configPath, withFeatures(readFileSync(configPath, 'utf8'), variant.features));

      const reportPath = path.join(dir, 'vitest-report.json');
      const testLog = path.join(dir, 'npm-test.log');
      const testCode = await run(npm, ['test', '--', '--reporter=json', `--outputFile=${reportPath}`], dir, testLog);
      let files;
      try {
        files = summarise(JSON.parse(readFileSync(reportPath, 'utf8')));
      } catch {
        files = null;
      }
      const buildCode = testCode === 0 ? await run(npm, ['run', 'build'], dir, path.join(dir, 'npm-build.log')) : null;

      const problems = [];
      if (!files) problems.push(`npm test wrote no report (exit ${testCode}); see ${testLog}`);
      else {
        for (const [file, r] of Object.entries(files)) {
          if (r.failed) problems.push(`${file}: ${r.failed} failed${r.message ? ` (${r.message.split('\n')[0]})` : ''}`);
        }
        if (testCode !== 0 && problems.length === 0) problems.push(`npm test exited ${testCode}; see ${testLog}`);
        if (variant === FEATURE_VARIANTS[0]) base = files;
        else problems.push(...compare(base, files));
      }
      if (buildCode !== null && buildCode !== 0) problems.push(`npm run build failed; see ${path.join(dir, 'npm-build.log')}`);

      const total = (key) => Object.values(files ?? {}).reduce((n, r) => n + r[key], 0);
      const summary = files ? `${total('tests')} tests, ${total('skipped')} skipped` : 'no report';
      console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${variant.name.padEnd(24)} ${JSON.stringify(variant.features)}  ${summary}`);
      for (const line of problems) console.log(`        ${line}`);
      if (problems.length) failed = true;
      if (variant === FEATURE_VARIANTS[0] && problems.length) break; // nothing to compare against
    }
  } finally {
    if (keep || failed) console.log(`\nCopies and logs kept in:\n${dirs.map((d) => `  ${d}`).join('\n')}`);
    else for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  }
  if (failed) {
    console.log('\nnpm test or npm run build fails, or runs other tests, with some switch combination (SPEC §11).');
    process.exitCode = 1;
  } else {
    console.log('\nEvery combination passes npm test and npm run build, with the same tests as all on (SPEC §11).');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
