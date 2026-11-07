// Test-only Eleventy config (SPEC §11, §22): the real eleventy.config.js with
// site.features replaced by the FEATURES environment variable (JSON, merged
// over site.config.json's switches), so test/global-setup.js can build the
// site with each feature on or off without editing site.config.json.
//
// - Never used by `npm run build`, `npm run dev` or Workers Builds: only the
//   tests pass it to Eleventy's CLI, with --config. eleventy.config.js itself
//   reads no environment variable, so a Builds variable can never make the
//   built pages disagree with the Worker, which reads site.config.json.
// - Never writes worker/generated/pages.json: it drops the eleventy.after
//   hook, so only the real build (the tests' `builtSite`, `npm run build`)
//   writes the file the Worker imports.
import base, { config as baseConfig } from '../eleventy.config.js';

const overrides = JSON.parse(process.env.FEATURES ?? '{}');
if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
  throw new Error('FEATURES must be a JSON object, e.g. {"ratings":false}');
}

export default function (eleventyConfig) {
  const wrapped = new Proxy(eleventyConfig, {
    get(target, prop) {
      if (prop === 'addGlobalData') {
        return (name, data) =>
          target.addGlobalData(name, name === 'site' ? { ...data, features: { ...data.features, ...overrides } } : data);
      }
      if (prop === 'on') {
        return (event, fn) => (event === 'eleventy.after' ? undefined : target.on(event, fn));
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return base(wrapped);
}

export const config = baseConfig;
