// How the tests cover every combination of the feature switches (SPEC §11):
// the list of combinations (scripts/lib/feature-variants.js), the test-only
// Eleventy config that builds the site with each (test/features.config.js),
// and the helpers of `npm run test:features` (scripts/test-features.js),
// which runs the whole suite with site.config.json set to each.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import base, { config as baseConfig } from '../../eleventy.config.js';
import { FEATURE_NAMES, FEATURE_VARIANTS } from '../../scripts/lib/feature-variants.js';
import { compare, summarise, withFeatures } from '../../scripts/test-features.js';

const siteConfig = readFileSync('site.config.json', 'utf8');

describe('scripts/lib/feature-variants.js', () => {
  it('lists all eight combinations of the three switches once, all on first and all off last', () => {
    expect(FEATURE_NAMES).toEqual(Object.keys(JSON.parse(siteConfig).features));
    expect(FEATURE_VARIANTS).toHaveLength(8);
    expect(new Set(FEATURE_VARIANTS.map((v) => JSON.stringify(v.features))).size).toBe(8);
    expect(FEATURE_VARIANTS[0]).toEqual({ name: 'all on', features: { ratings: true, feedback: true, events: true } });
    expect(FEATURE_VARIANTS.at(-1)).toEqual({ name: 'all off', features: { ratings: false, feedback: false, events: false } });
    for (const { name, features } of FEATURE_VARIANTS.slice(1, -1)) {
      expect(name).toBe(`${FEATURE_NAMES.filter((f) => !features[f]).join(' and ')} off`);
    }
  });
});

describe('test/features.config.js', () => {
  afterEach(() => {
    delete process.env.FEATURES;
    vi.resetModules();
  });

  /** Every call a config function makes on Eleventy's config object. */
  function callsOf(configure) {
    const calls = [];
    configure(new Proxy({}, { get: (_, method) => (...args) => calls.push([method, ...args]) }));
    return calls;
  }

  async function wrapper(features) {
    if (features !== undefined) process.env.FEATURES = features;
    vi.resetModules();
    return import('../features.config.js');
  }

  it('makes every call the real config makes, but for the eleventy.after hook that writes pages.json', async () => {
    const real = callsOf(base);
    const { default: configure, config } = await wrapper();
    const wrapped = callsOf(configure);
    expect(real.filter(([method, event]) => method === 'on').map(([, event]) => event)).toEqual(['eleventy.before', 'eleventy.after']);
    expect(wrapped.filter(([method]) => method === 'on').map(([, event]) => event)).toEqual(['eleventy.before']);
    const others = (calls) => calls.filter(([method]) => method !== 'on').map(([method, name]) => [method, typeof name === 'string' ? name : JSON.stringify(name)]);
    expect(others(wrapped)).toEqual(others(real));
    expect(config).toEqual(baseConfig);
  });

  it('keeps site.config.json\'s switches without FEATURES, and merges FEATURES over them', async () => {
    const site = (calls) => calls.find(([method, name]) => method === 'addGlobalData' && name === 'site')[2];
    const real = site(callsOf(base));
    expect(site(callsOf((await wrapper()).default))).toEqual(real);
    const off = site(callsOf((await wrapper('{"ratings":false}')).default));
    expect(off).toEqual({ ...real, features: { ...real.features, ratings: false } });
  });

  it.each(['[]', 'null', '"off"', '{'])('refuses FEATURES=%s', async (features) => {
    await expect(wrapper(features)).rejects.toThrow();
  });
});

describe('scripts/test-features.js', () => {
  it('edits only the switches in site.config.json, on their own line', () => {
    // Each switch the other way from site.config.json, so the line always changes.
    const features = Object.fromEntries(FEATURE_NAMES.map((name) => [name, JSON.parse(siteConfig).features[name] !== true]));
    const edited = withFeatures(siteConfig, features);
    expect(JSON.parse(edited)).toEqual({ ...JSON.parse(siteConfig), features });
    const before = siteConfig.split('\n');
    const after = edited.split('\n');
    expect(after).toHaveLength(before.length);
    expect(after.filter((line, i) => line !== before[i])).toEqual([
      `  "features": { "ratings": ${features.ratings}, "feedback": ${features.feedback}, "events": ${features.events} },`,
    ]);
    expect(() => withFeatures('{"siteName":"x"}', features)).toThrow(/no "features"/);
  });

  const report = (files) => ({
    testResults: Object.entries(files).map(([name, tests]) => ({
      name: `/tmp/sleepsteps-features-x/test/node/${name}`,
      status: tests.some((t) => t[1] === 'failed') ? 'failed' : 'passed',
      message: '',
      assertionResults: tests.map(([fullName, status]) => ({ fullName, status })),
    })),
  });

  it('accepts a run with the same tests as all on, and reports fewer, more skipped or others', () => {
    const base = summarise(report({ 'a.test.js': [['one', 'passed'], ['two', 'passed']], 'b.test.js': [['three', 'passed']] }));
    expect(Object.keys(base)).toEqual(['test/node/a.test.js', 'test/node/b.test.js']);
    expect(compare(base, base)).toEqual([]);
    const fewer = summarise(report({ 'a.test.js': [['one', 'passed']], 'b.test.js': [['three', 'passed']] }));
    expect(compare(base, fewer)).toEqual([
      'test/node/a.test.js: 1 tests, not 2 as with all on',
      'test/node/a.test.js: 1 tests that ran with all on didn\'t run, e.g. "two"',
    ]);
    const skipped = summarise(report({ 'a.test.js': [['one', 'passed'], ['two', 'skipped']], 'b.test.js': [['three', 'passed']] }));
    expect(compare(base, skipped)).toEqual([
      'test/node/a.test.js: 1 more skipped than with all on',
      'test/node/a.test.js: 1 tests that ran with all on didn\'t run, e.g. "two"',
    ]);
    const renamed = summarise(report({ 'a.test.js': [['one', 'passed'], ['two (off)', 'passed']], 'b.test.js': [['three', 'passed']] }));
    expect(compare(base, renamed)).toEqual(['test/node/a.test.js: 1 tests that ran with all on didn\'t run, e.g. "two"']);
    const uncollected = summarise(report({ 'a.test.js': [['one', 'passed'], ['two', 'passed']] }));
    expect(compare(base, uncollected)).toEqual([
      'test/node/b.test.js: 0 tests, not 1 as with all on',
      'test/node/b.test.js: 1 tests that ran with all on didn\'t run, e.g. "three"',
    ]);
  });

  it('counts a failed test, and a file that failed before running any', () => {
    const files = summarise({
      testResults: [
        { name: '/x/test/node/a.test.js', status: 'failed', message: '', assertionResults: [{ fullName: 'one', status: 'failed' }] },
        { name: '/x/test/node/b.test.js', status: 'failed', message: 'TypeError: boom', assertionResults: [] },
      ],
    });
    expect([files['test/node/a.test.js'].failed, files['test/node/b.test.js'].failed, files['test/node/b.test.js'].message]).toEqual([1, 1, 'TypeError: boom']);
  });
});
