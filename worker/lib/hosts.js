// Which hosts the API and the admin pages answer on (SPEC §14.1, §14.4,
// §18.2, §20 M3). Imports no JSON, so Node can load this module too.
//
// API_HOSTS (a Worker var in wrangler.jsonc, set in both blocks) is a
// comma-separated list of host patterns, compared with the request URL's
// host (with its port, if any). `*` stands for one DNS label or part of one
// (letters, digits and hyphens, never a dot). An entry with any other
// character, such as the "<DOMAIN>" placeholder, matches nothing, so a
// missing or placeholder value closes the API.
//
//   production   "sleepsteps.org", the custom domain (2026-11-10; "<DOMAIN>",
//                no host, before that)
//   previews     "*-sleepsteps.*.workers.dev"
//   local        "localhost:8787,127.0.0.1:8787" (npm run dev:collect)
//
// Production's version URLs have the same shape as preview URLs but run with
// production's vars, so they never match: the API answers them 404 and the
// admin pages 403. Every host listed must be behind an Access application
// that covers /admin and /admin/*, since the admin pages answer on them.

const ENTRY = /^[a-z0-9.*:-]+$/;
const LABEL = '[a-z0-9-]+';

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** API_HOSTS -> one anchored RegExp per usable entry. */
function hostPatterns(list) {
  if (typeof list !== 'string') return [];
  return list
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => ENTRY.test(entry))
    .map((entry) => new RegExp(`^${entry.split('*').map(escape).join(LABEL)}$`));
}

/** True if `host` ("example.org", "localhost:8787") matches an API_HOSTS entry. */
export function hostAllowed(host, list) {
  if (typeof host !== 'string' || host === '') return false;
  const name = host.toLowerCase();
  return hostPatterns(list).some((pattern) => pattern.test(name));
}
