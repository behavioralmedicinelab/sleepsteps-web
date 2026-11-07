// Every combination of site.config.json's three feature switches (SPEC §11),
// all on first, for the tests (test/global-setup.js builds the site with each)
// and `npm run test:features` (which runs the whole suite with each):
// [{ name: 'ratings and events off', features: { ratings: false, feedback: true, events: false } }, …]
export const FEATURE_NAMES = ['ratings', 'feedback', 'events'];

export const FEATURE_VARIANTS = Object.freeze(
  Array.from({ length: 2 ** FEATURE_NAMES.length }, (_, i) => {
    const features = Object.fromEntries(FEATURE_NAMES.map((name, bit) => [name, (i & (1 << bit)) === 0]));
    const off = FEATURE_NAMES.filter((name) => !features[name]);
    const name = off.length === 0 ? 'all on' : off.length === FEATURE_NAMES.length ? 'all off' : `${off.join(' and ')} off`;
    return Object.freeze({ name, features: Object.freeze(features) });
  }),
);
