// Deployment configuration (SPEC §14.1, §14.3, §16.1, §17, §18.1-§18.3):
// wrangler.jsonc and its previews block, the preview-migrations config, the
// npm and Node pins, the built dist/_headers with its security headers, and
// the built dist/_redirects. Wrangler doesn't check _headers on deploy (a bad
// line is silently dropped), and a bad _redirects line gets only a warning
// in the build log while the deploy goes ahead, so both are checked here.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, inject, it, vi } from 'vitest';
import { unstable_readConfig } from 'wrangler';
import { AUD_RE, TEAM_DOMAIN_RE } from '../../worker/lib/access-jwt.js';
import { hostAllowed } from '../../worker/lib/hosts.js';
import { ADMIN_HEADERS } from '../../worker/routes/admin.js';
import { listFiles } from './helpers.js';

// The two D1 databases (SPEC §17). Pinned, so a swap can't send preview
// writes or migrations to production, or the reverse.
const PRODUCTION_DB = { name: 'sleepsteps', id: '7da77651-1695-4331-8708-114382f04757' };
const PREVIEW_DB = { name: 'sleepsteps-preview', id: '38b5ff0a-4518-4aa0-b884-c93546b9ee56' };

/** Read a Wrangler config file the way Wrangler does, failing on any warning. */
function readConfig(file) {
  const warn = vi.spyOn(console, 'warn');
  const error = vi.spyOn(console, 'error');
  const config = unstable_readConfig({ config: file });
  expect(warn, `${file}: Wrangler warnings`).not.toHaveBeenCalled();
  expect(error, `${file}: Wrangler errors`).not.toHaveBeenCalled();
  return config;
}
afterEach(() => vi.restoreAllMocks());

const config = readConfig('wrangler.jsonc');
const migrations = readConfig('wrangler.preview-migrations.jsonc');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const siteConfig = JSON.parse(readFileSync('site.config.json', 'utf8'));

// Cloudflare's published Turnstile test secrets
// (https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
// They go with the test site keys' dummy token XXXX.DUMMY.TOKEN.XXXX, which
// production's secret refuses; the always-pass one also accepted a made-up
// token in a local run, so it checks nothing (SPEC §14.3, §18.4).
const TEST_SECRETS = Object.freeze({
  pass: '1x0000000000000000000000000000000AA',
  fail: '2x0000000000000000000000000000000AA',
  spent: '3x0000000000000000000000000000000AA',
});

// The API's hosts (SPEC §14.1, §18.2): production's custom domain
// (sleepsteps.org since 2026-11-10; the "<DOMAIN>" placeholder before that),
// and every preview URL. Version URLs look like preview URLs but run with
// production's vars, so production must never match them.
const PREVIEW_HOSTS = '*-sleepsteps.*.workers.dev';
const VERSION_HOSTS = ['abc12345-sleepsteps.team-sub.workers.dev', '0a1b2c3d-sleepsteps.example-sub.workers.dev'];

describe('wrangler.jsonc', () => {
  it('names the Worker "sleepsteps", with no account_id (Workers Builds supplies it)', () => {
    expect(config.name).toBe('sleepsteps');
    expect(config.account_id).toBeUndefined();
  });

  it('answers on workers.dev only until siteUrl is the custom domain, with preview URLs on (SPEC §18.2, §18.3)', () => {
    expect(config.workers_dev).toBe(siteConfig.siteUrl.includes('<'));
    expect(config.preview_urls).toBe(true);
  });

  it('binds DB to the production database, and previews to their own database', () => {
    const [prod] = config.d1_databases;
    const [preview] = config.previews.d1_databases;
    expect(config.d1_databases).toHaveLength(1);
    expect(config.previews.d1_databases).toHaveLength(1);
    expect([prod.binding, prod.database_name, prod.database_id, prod.migrations_dir]).toEqual(['DB', PRODUCTION_DB.name, PRODUCTION_DB.id, 'migrations']);
    expect([preview.binding, preview.database_name, preview.database_id]).toEqual(['DB', PREVIEW_DB.name, PREVIEW_DB.id]);
  });

  it('marks no binding "remote", so local development and tests never reach a real database', () => {
    expect(JSON.stringify(config)).not.toMatch(/"remote":\s*true/);
  });

  it('gives previews every production var, since previews inherit none', () => {
    expect(Object.keys(config.previews.vars).sort()).toEqual(Object.keys(config.vars).sort());
  });

  it('keeps data collection off in previews, and on in production only on the custom domain (SPEC §11, §18.3, §21)', () => {
    expect(config.previews.vars.DATA_COLLECTION).toBe('off');
    expect(['on', 'off']).toContain(config.vars.DATA_COLLECTION);
    if (config.vars.DATA_COLLECTION === 'on') {
      // Production collects only on siteUrl's host, behind the self-hosted
      // Access application there, never on workers.dev (SPEC §18.3).
      expect(siteConfig.siteUrl).not.toContain('<');
      expect(config.vars.API_HOSTS).toBe(new URL(siteConfig.siteUrl).host);
      expect(config.workers_dev).toBe(false);
    }
  });

  it('runs the Worker first for /api/*, /admin and /admin/*, so they answer even where a file matches (SPEC §14.4, §18.2)', () => {
    // Both admin entries: "/admin/*" doesn't match "/admin".
    expect(config.assets.run_worker_first).toEqual(['/api/*', '/admin', '/admin/*']);
  });

  it('sets ACCESS_TEAM_DOMAIN and ACCESS_AUD to the placeholders or well-formed values (SPEC §14.4, §18.2)', () => {
    const blocks = { production: config.vars, previews: config.previews.vars };
    for (const [name, vars] of Object.entries(blocks)) {
      const team = vars.ACCESS_TEAM_DOMAIN;
      const aud = vars.ACCESS_AUD;
      expect(team === '<TEAM>.cloudflareaccess.com' || TEAM_DOMAIN_RE.test(team), `${name} ACCESS_TEAM_DOMAIN`).toBe(true);
      expect(aud === '<AUD_TAG>' || AUD_RE.test(aud), `${name} ACCESS_AUD`).toBe(true);
    }
    // One team; and previews use the Worker-level application's AUD, never the /admin one's.
    const teams = [config.vars.ACCESS_TEAM_DOMAIN, config.previews.vars.ACCESS_TEAM_DOMAIN].filter((t) => TEAM_DOMAIN_RE.test(t));
    if (teams.length === 2) expect(teams[0]).toBe(teams[1]);
    const auds = [config.vars.ACCESS_AUD, config.previews.vars.ACCESS_AUD].filter((a) => AUD_RE.test(a));
    if (auds.length === 2) expect(auds[0]).not.toBe(auds[1]);
  });

  it('has no "access" key: access.dev only simulates ctx.access, which a Worker with static assets never gets (SPEC §14.4)', () => {
    expect(config.access).toBeUndefined();
    expect(config.previews.access).toBeUndefined();
    expect(readFileSync('wrangler.jsonc', 'utf8')).not.toMatch(/"access"\s*:/);
  });

  it('turns Workers Logs off in production and in previews: invocation logs record request metadata (SPEC §14.1)', () => {
    expect(config.observability?.enabled).toBe(false);
    expect(config.previews.observability?.enabled).toBe(false);
  });

  it("lets production's API answer only on production's own host: never a wildcard or a version URL (SPEC §18.2, §20 M3)", () => {
    const hosts = config.vars.API_HOSTS;
    expect(typeof hosts).toBe('string');
    expect(hosts).not.toContain('*');
    expect(hosts).not.toContain('-sleepsteps');
    const siteHost = siteConfig.siteUrl.includes('<') ? undefined : new URL(siteConfig.siteUrl).host;
    const entries = hosts.split(',').map((h) => h.trim());
    for (const entry of entries) {
      const allowed = entry === '<DOMAIN>' || entry === siteHost || /^sleepsteps\.[a-z0-9-]+\.workers\.dev$/.test(entry);
      expect(allowed, `API_HOSTS entry "${entry}"`).toBe(true);
    }
    // Once siteUrl is real, API_HOSTS holds its host too (SPEC §18.3).
    if (siteHost) expect(entries).toContain(siteHost);
    for (const host of VERSION_HOSTS) expect(hostAllowed(host, hosts), host).toBe(false);
  });

  it('keeps TURNSTILE_SECRET out of the config: no var of that name, and no secrets list (SPEC §14.3, §18.2)', () => {
    expect(config.vars).not.toHaveProperty('TURNSTILE_SECRET');
    expect(config.previews.vars).not.toHaveProperty('TURNSTILE_SECRET');
    // `secrets.required` would make every build and deploy fail until a
    // person had set the secret.
    expect(config.secrets).toBeUndefined();
    expect(config.previews.secrets).toBeUndefined();
    expect(readFileSync('wrangler.jsonc', 'utf8')).not.toMatch(/"secrets"\s*:/);
  });

  it('lets previews answer on every preview URL, and on nothing else', () => {
    const hosts = config.previews.vars.API_HOSTS;
    expect(hosts).toBe(PREVIEW_HOSTS);
    expect(hostAllowed('my-branch-sleepsteps.team-sub.workers.dev', hosts)).toBe(true);
    for (const host of ['sleepsteps.team-sub.workers.dev', 'a.b-sleepsteps.team-sub.workers.dev', 'my-branch-sleepsteps.team-sub.workers.dev.example.org']) {
      expect(hostAllowed(host, hosts), host).toBe(false);
    }
  });
});

describe('migrations/ (SPEC §17)', () => {
  it('starts with 0001_init.sql, and holds only numbered SQL files', () => {
    const files = readdirSync('migrations');
    expect(files[0]).toBe('0001_init.sql');
    for (const file of files) expect(file).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });
});

// D1 records only a migration's file name, so a migration edited after it
// has been applied to a remote database never reaches it (SPEC §17). Each
// migration is pinned here; a schema change is a new NNNN_name.sql file
// (add its hash below, at the latest once it is applied anywhere remote).
const APPLIED_MIGRATIONS = {
  // Applied to the local and preview databases (2026-11-06, 2026-11-07) and
  // to production's (2026-11-10).
  '0001_init.sql': 'aa5201b2ccadc89219a58fce2d79c4992331c70e748b5e75b4f499f97e9e2ccb',
  // Feedback without page_title (project lead, 2026-11-07). Pinned before
  // its first remote apply: a person runs `npm run db:migrate:preview` after
  // this merges (SPEC §17); production got it with 0001 at its first
  // `npm run db:migrate:remote` (2026-11-10). It must not change once applied anywhere.
  '0002_feedback_drop_page_title.sql': 'ab705000414d47bf26598b4d4133243cd3adb8f59ea944ae7c34eaf319baeeb0',
  // Feedback's nullable `video` (project lead, 2026-11-13). Pinned before its
  // first remote apply: a person runs `npm run db:migrate:preview` when its
  // pull request opens and `npm run db:migrate:remote` just before it merges
  // (SPEC §17, §18.4). It must not change once applied anywhere.
  '0003_feedback_add_video.sql': 'eb3d75c3b50e06041101df7e6142bf0d8dba06862f88107b38d018e6bc204adb',
};

describe('migrations/', () => {
  it.each(Object.entries(APPLIED_MIGRATIONS))('%s is unchanged (make a new migration instead)', (file, hash) => {
    const actual = createHash('sha256').update(readFileSync(`migrations/${file}`)).digest('hex');
    expect(actual, `migrations/${file} changed: never edit a migration; add migrations/NNNN_name.sql`).toBe(hash);
  });
});

describe('wrangler.preview-migrations.jsonc', () => {
  it('declares only the preview database, with the same name, ID and migrations as wrangler.jsonc', () => {
    expect(migrations.d1_databases).toHaveLength(1);
    const [db] = migrations.d1_databases;
    expect([db.database_name, db.database_id]).toEqual([PREVIEW_DB.name, PREVIEW_DB.id]);
    expect(db.migrations_dir).toBe(config.d1_databases[0].migrations_dir);
  });
});

describe('package.json and .node-version (SPEC §18.1, §18.3)', () => {
  it('migrates each database by its configured name', () => {
    const [prod] = config.d1_databases;
    const [preview] = config.previews.d1_databases;
    expect(pkg.scripts['db:migrate:local']).toBe(`wrangler d1 migrations apply ${prod.database_name} --local`);
    expect(pkg.scripts['db:migrate:remote']).toBe(`wrangler d1 migrations apply ${prod.database_name} --remote`);
    expect(pkg.scripts['db:migrate:preview']).toBe(
      `wrangler d1 migrations apply ${preview.database_name} --remote --config wrangler.preview-migrations.jsonc`,
    );
  });

  it('collects data locally only through --var on the command line, never through .dev.vars (SPEC §11)', () => {
    const script = pkg.scripts['dev:collect'];
    expect(script).toContain('--var DATA_COLLECTION:on');
    expect(script).toContain('--var API_HOSTS:localhost:8787,127.0.0.1:8787');
    expect(script).not.toMatch(/--remote|\bdeploy\b/);
    // Production's value at the top level is "on" (SPEC §18.3), so dev turns
    // collection off for its run; localhost isn't in API_HOSTS either.
    expect(pkg.scripts.dev).toMatch(/ wrangler dev --var DATA_COLLECTION:off$/);
    // None of these is committed, but wrangler dev and the Worker tests read
    // them if they exist (.env and .env.local when there is no .dev.vars).
    for (const file of ['.dev.vars', '.env', '.env.local', '.env.development', '.env.test']) {
      if (existsSync(file)) {
        expect(readFileSync(file, 'utf8'), file).not.toMatch(/^\s*(?:export\s+)?(DATA_COLLECTION|API_HOSTS)\s*[=:]/m);
      }
    }
  });

  it("gives Turnstile's check Cloudflare's always-pass test secret in dev:collect only (SPEC §14.3, §18.1)", () => {
    expect(pkg.scripts['dev:collect'].match(/--var TURNSTILE_SECRET:[\w-]*/g)).toEqual([`--var TURNSTILE_SECRET:${TEST_SECRETS.pass}`]);
    for (const [name, script] of Object.entries(pkg.scripts)) {
      if (name !== 'dev:collect') expect(script, name).not.toContain('TURNSTILE_SECRET');
    }
  });

  it("lets a local .dev.vars or .env file set TURNSTILE_SECRET only to one of Cloudflare's test secrets", () => {
    // Allowed for local runs (wrangler dev reads these files), but a real
    // secret belongs only in Cloudflare (`wrangler secret put`, SPEC §18.4).
    for (const file of ['.dev.vars', '.env', '.env.local', '.env.development', '.env.test']) {
      if (!existsSync(file)) continue;
      const text = readFileSync(file, 'utf8');
      for (const [, value] of text.matchAll(/^\s*(?:export\s+)?TURNSTILE_SECRET\s*[=:]\s*["']?([^"'\s#]*)/gm)) {
        expect(Object.values(TEST_SECRETS), `${file}: TURNSTILE_SECRET`).toContain(value);
      }
    }
  });

  it('pins exact npm and Node versions: npm 11 or later (which reads allowScripts), Node within engines', () => {
    expect(pkg.packageManager).toMatch(/^npm@\d+\.\d+\.\d+$/);
    expect(Number(pkg.packageManager.match(/^npm@(\d+)/)[1])).toBeGreaterThanOrEqual(11);
    const node = readFileSync('.node-version', 'utf8').trim();
    expect(node).toMatch(/^\d+\.\d+\.\d+$/);
    const [min] = pkg.engines.node.match(/\d+\.\d+\.\d+/);
    const n = (v) => v.split('.').map(Number);
    const atLeast = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
    expect(atLeast(n(node), n(min))).toBeGreaterThanOrEqual(0);
  });
});

/**
 * Parse a _headers file the way Cloudflare does: a port of the parser Wrangler
 * 4.153.0 bundles (workers-shared parseHeaders and validateUrl). Returns
 * { rules: [{ line, url, headers: { name: value }, unset: [name] }], invalid }.
 * Cloudflare drops every `invalid` line without telling anyone.
 */
function parseHeaders(text) {
  const rules = [];
  const invalid = [];
  let rule;
  let skip = false;
  const close = () => {
    if (!rule) return;
    if (Object.keys(rule.headers).length || rule.unset.length) rules.push(rule);
    else invalid.push(`line ${rule.line}: no headers specified`);
  };
  text.split('\n').forEach((raw, i) => {
    const n = i + 1;
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    if (line.length > 2000) return invalid.push(`line ${n}: over 2,000 characters`);
    if (/^([^\s]+:\/\/|\/)/.test(line)) {
      skip = false;
      close();
      rule = undefined;
      if (rules.length >= 100) return invalid.push(`line ${n}: more than 100 rules`);
      const host = /^https:\/\/+(?<host>[^/]+)\/?/.exec(line)?.groups?.host;
      let error;
      if (host && /.*:\d+$/.test(host)) error = 'ports are not supported';
      else if (!host && !line.startsWith('/')) error = 'URLs must start with / or https://';
      else if ((line.match(/\*/g) ?? []).length > 1) error = 'only one * per rule';
      if (error) {
        skip = true;
        return invalid.push(`line ${n}: ${error}`);
      }
      rule = { line: n, url: line, headers: {}, unset: [] };
      return;
    }
    if (skip) return;
    if (!rule) return invalid.push(`line ${n}: a header before any rule`);
    if (!line.includes(':')) {
      if (line.startsWith('! ')) rule.unset.push(line.slice(2));
      else invalid.push(`line ${n}: expected "name: value"`);
      return;
    }
    const [rawName, ...rest] = line.split(':');
    const name = rawName.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (name === '' || name.includes(' ')) return invalid.push(`line ${n}: bad header name "${rawName}"`);
    if (value === '') return invalid.push(`line ${n}: no value for ${name}`);
    rule.headers[name] = rule.headers[name] ? `${rule.headers[name]}, ${value}` : value;
  });
  close();
  return { rules, invalid };
}

// X-Robots-Tag values that keep a page out of search results ("none" is
// noindex, nofollow), including the "googlebot: noindex" form.
const NOINDEX = /\b(noindex|none)\b/i;
// The only paths noindex may be set on for every host, the custom domain
// included: the 404 page, also served at /404 with a 200 (SPEC §16.1).
const NOINDEX_PATHS = ['/404'];

describe('dist/_headers (SPEC §16.1, §18.3)', () => {
  const file = path.join(inject('builtSite'), '_headers');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const { rules, invalid } = parseHeaders(text);

  it('is copied into the build', () => {
    expect(existsSync(file)).toBe(true);
  });

  it('has no line Cloudflare would drop (100 rules, 2,000-character lines, https, no ports, one *)', () => {
    expect(rules.length).toBeGreaterThan(0);
    expect(invalid).toEqual([]);
  });

  it('uses only well-formed header names', () => {
    for (const { line, headers, unset } of rules) {
      for (const name of [...Object.keys(headers), ...unset]) expect(name, `rule at line ${line}`).toMatch(/^[a-z0-9-]+$/i);
    }
  });

  it("marks every workers.dev address noindex: preview and version URLs, and production's should workers_dev ever be on", () => {
    const rule = rules.find((r) => r.url === 'https://:version.:subdomain.workers.dev/*');
    expect(rule?.headers['x-robots-tag']).toBe('noindex');
  });

  it('never marks a page noindex on every host, except the 404 page (that would hide the custom domain)', () => {
    for (const { url, headers, line } of rules) {
      if (!NOINDEX.test(headers['x-robots-tag'] ?? '')) continue;
      if (url.startsWith('/')) expect(NOINDEX_PATHS, `line ${line}: ${url}`).toContain(url);
      else expect(url, `line ${line}`).toMatch(/^https:\/\/[^/]*\.workers\.dev\//);
    }
  });

  it('marks the 404 page noindex where it is served with a 200 (/404)', () => {
    expect(rules.find((r) => r.url === '/404')?.headers['x-robots-tag']).toBe('noindex');
  });
});

// The security headers on every static response (SPEC §16.1), all from the
// /* rule. The API's and the admin pages' own are the Worker's
// (test/worker/router.test.js, admin.test.js).
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.youtube.com https://challenges.cloudflare.com",
  'frame-src https://www.youtube-nocookie.com https://challenges.cloudflare.com',
  "img-src 'self'",
  "connect-src 'self'",
  "style-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
const SECURITY_HEADERS = Object.freeze({
  'content-security-policy': CSP,
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000',
});

// What YouTube's player iframe asks for in its `allow` attribute (seen in
// Chrome 157, 2026-11-07): a Permissions-Policy that named any of these would
// take it away from the player.
const PLAYER_FEATURES = ['autoplay', 'encrypted-media', 'fullscreen', 'picture-in-picture', 'accelerometer', 'gyroscope', 'clipboard-write', 'web-share'];

/** A policy as { directive: [sources] }, directives lowercased. */
function directives(policy) {
  const out = {};
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out[name.toLowerCase()] = sources;
  }
  return out;
}

/** The browser code without its comments, as worker-source.test.js reads the Worker's. */
const jsCode = (file) => readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('dist/_headers security headers (SPEC §16.1)', () => {
  const file = path.join(inject('builtSite'), '_headers');
  const { rules } = parseHeaders(existsSync(file) ? readFileSync(file, 'utf8') : '');
  const all = rules.find((r) => r.url === '/*');
  const csp = directives(all?.headers['content-security-policy'] ?? '');

  it('sets each security header in the /* rule, and pins its value', () => {
    expect(all, 'a /* rule').toBeDefined();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(all.headers[name], name).toBe(value);
  });

  it('sets each one in no other rule, unless that rule comes later and detaches it first (Cloudflare joins two values with a comma: two policies, both enforced)', () => {
    const at = rules.indexOf(all);
    for (const [i, rule] of rules.entries()) {
      if (rule === all) continue;
      const unset = rule.unset.map((name) => name.toLowerCase());
      for (const name of Object.keys(SECURITY_HEADERS)) {
        if (!Object.hasOwn(rule.headers, name)) continue;
        expect(i > at && unset.includes(name), `line ${rule.line} (${rule.url}) sets ${name}`).toBe(true);
      }
    }
  });

  it('enforces the policy, with no Report-Only copy, no report-uri or report-to, and no reporting or NEL header of ours (SPEC §15.4)', () => {
    for (const { line, headers } of rules) {
      for (const name of ['content-security-policy-report-only', 'report-to', 'reporting-endpoints', 'nel']) {
        expect(headers, `line ${line}`).not.toHaveProperty(name);
      }
    }
    expect(csp).not.toHaveProperty('report-uri');
    expect(csp).not.toHaveProperty('report-to');
  });

  it('allows nothing unsafe or wide: no unsafe-*, wildcard, scheme source, nonce, hash or strict-dynamic, and hosts without paths', () => {
    for (const [name, sources] of Object.entries(csp)) {
      for (const source of sources) {
        const keyword = /^'[a-z-]+'$/.test(source);
        const origin = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(source);
        expect(keyword || origin, `${name} ${source}`).toBe(true);
        if (keyword) expect(["'self'", "'none'"], `${name} ${source}`).toContain(source);
      }
    }
  });

  it('gives scripts only this site, YouTube and Turnstile, and frames only youtube-nocookie and Turnstile', () => {
    expect(csp['script-src']).toEqual(["'self'", 'https://www.youtube.com', 'https://challenges.cloudflare.com']);
    expect(csp['frame-src']).toEqual(['https://www.youtube-nocookie.com', 'https://challenges.cloudflare.com']);
  });

  it('loads images, styles and connections from this site only (no data:, so the icons are files, SPEC §7.5)', () => {
    for (const name of ['default-src', 'img-src', 'style-src', 'connect-src']) expect(csp[name], name).toEqual(["'self'"]);
  });

  it('refuses plugins and framing, keeps <base> and forms here, and sets no sandbox (which blanks the PDF viewer)', () => {
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    expect(csp['form-action']).toEqual(["'self'"]);
    expect(csp).not.toHaveProperty('sandbox');
    expect(all.headers['x-frame-options']).toBe('DENY');
  });

  it('allows every third-party host the browser code loads, and names every https address in it (src/js/)', () => {
    const literal = (source, name) => jsCode(source).match(new RegExp(`\\b${name} = '([^']+)'`))?.[1];
    const api = literal('src/js/players.js', 'API_URL');
    const player = literal('src/js/players.js', 'PLAYER_HOST');
    const turnstile = literal('src/js/feedback.js', 'TURNSTILE_URL');
    for (const url of [api, player, turnstile]) expect(url).toMatch(/^https:\/\//);
    const origin = (url) => new URL(url).origin;
    // YouTube's IFrame API script and its player frame; Turnstile's script and its frames.
    expect(csp['script-src']).toEqual(expect.arrayContaining([origin(api), origin(turnstile)]));
    expect(csp['frame-src']).toEqual(expect.arrayContaining([origin(player), origin(turnstile)]));
    // A new address in the browser code (outside comments) needs its host in
    // the policy and in SPEC §16.2; "Watch on YouTube" links to www.youtube.com.
    const allowed = new Set([...csp['script-src'], ...csp['frame-src']]);
    for (const source of listFiles('src/js', (f) => f.endsWith('.js'))) {
      for (const [url] of jsCode(path.join('src/js', source)).matchAll(/https?:\/\/[^'"`\s)]+/g)) {
        expect(allowed.has(origin(url)), `src/js/${source}: ${url}`).toBe(true);
      }
    }
  });

  it("never denies a feature YouTube's player asks for", () => {
    const named = all.headers['permissions-policy'].split(',').map((item) => item.trim().split('=')[0]);
    for (const feature of PLAYER_FEATURES) expect(named, feature).not.toContain(feature);
  });

  it('sends the same Permissions-Policy, nosniff, X-Frame-Options and HSTS as the admin pages (SPEC §14.4)', () => {
    for (const name of ['Permissions-Policy', 'X-Content-Type-Options', 'X-Frame-Options', 'Strict-Transport-Security']) {
      expect(all.headers[name.toLowerCase()], name).toBe(ADMIN_HEADERS[name]);
    }
  });

  it('sends HSTS without includeSubDomains or preload', () => {
    expect(all.headers['strict-transport-security']).toBe('max-age=31536000');
    expect(all.headers['strict-transport-security']).not.toMatch(/includesubdomains|preload/i);
  });
});

describe('the _headers parser used above', () => {
  it('drops what Cloudflare drops', () => {
    const { rules, invalid } = parseHeaders(
      ['/a', '  ! X-Robots-Tag: noindex', '/b', '  Cache-Control', '/c', 'http://x.example/*', '  A: b',
        'https://x.example:8443/*', '  A: b', '/d/*/*', '  A: b', '/e', '  Empty:'].join('\n'),
    );
    expect(rules).toEqual([]);
    // Bad header lines, and every rule left with no header.
    expect(invalid.map((m) => m.match(/^line (\d+)/)[1])).toEqual(['2', '1', '4', '3', '5', '6', '8', '10', '13', '12']);
  });

  it('reads rules, repeated headers and unsets', () => {
    const { rules, invalid } = parseHeaders('# c\nhttps://:a.:b.workers.dev/*\n  X-Robots-Tag: noindex\n  x-robots-tag: nofollow\n/f\n  ! Server\n');
    expect(invalid).toEqual([]);
    expect(rules).toEqual([
      { line: 2, url: 'https://:a.:b.workers.dev/*', headers: { 'x-robots-tag': 'noindex, nofollow' }, unset: [] },
      { line: 5, url: '/f', headers: {}, unset: ['Server'] },
    ]);
  });
});

/**
 * Parse a _redirects file the way Cloudflare does: a port of the parser
 * Wrangler 4.153.0 bundles (workers-shared parseRedirects and validateUrl,
 * with html_handling left at its default). Returns { rules: [{ line, from,
 * to, status, dynamic }], invalid }. A rule is `dynamic` when its source has
 * a * or a :placeholder; any other rule is static and matches only the exact
 * path it names. Cloudflare drops every `invalid` line, with no more than a
 * warning in the build log.
 */
function parseRedirects(text) {
  const rules = [];
  const invalid = [];
  const seen = new Set();
  const pathOf = (token, search, hash) => {
    const url = new URL(`//${token.startsWith('/') ? token : `/${token}`}`, 'relative://');
    return `${url.pathname}${search ? url.search : ''}${hash ? url.hash : ''}`;
  };
  const hostOf = (token) => /^https:\/\/+(?<host>[^/]+)\/?(?<path>.*)/.exec(token)?.groups;
  text.split('\n').forEach((raw, i) => {
    const n = i + 1;
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    if (line.length > 2000) return invalid.push(`line ${n}: over 2,000 characters`);
    const tokens = line.replace(/\s+#.*$/, '').split(/\s+/);
    if (tokens.length < 2 || tokens.length > 3) return invalid.push(`line ${n}: ${tokens.length} parts, not 2 or 3`);
    const [source, destination, code = '302'] = tokens;
    // The source: a path on this site only.
    if (hostOf(source)) return invalid.push(`line ${n}: the source must be a path, not a full address`);
    const from = pathOf(source, false, false);
    // The destination: a path, or an https address.
    const host = hostOf(destination);
    if (!host && !destination.startsWith('/')) return invalid.push(`line ${n}: the destination must start with / or https://`);
    const to = host ? `https://${host.host}${pathOf(host.path, true, true)}` : pathOf(destination, true, true);
    const status = Number(code);
    if (![200, 301, 302, 303, 307, 308].includes(status)) return invalid.push(`line ${n}: status ${code}`);
    if (!host && ((from.endsWith('/*') && /\/index(.html)?$/.test(to)) || (from.endsWith('/') && /\/index(.html)?$/.test(to)))) {
      return invalid.push(`line ${n}: an endless loop`);
    }
    if (seen.has(from)) return invalid.push(`line ${n}: a second rule for ${from}`);
    seen.add(from);
    if (status === 200 && host) return invalid.push(`line ${n}: a 200 can only point to a path`);
    rules.push({ line: n, from, to, status, dynamic: /\*|:[A-Za-z]\w*/.test(from) });
  });
  if (rules.filter((r) => !r.dynamic).length > 2000) invalid.push('more than 2,000 static rules');
  if (rules.filter((r) => r.dynamic).length > 100) invalid.push('more than 100 dynamic rules');
  return { rules, invalid };
}

// The Sleep problems page became part of Home on 2026-11-13 (SPEC §7.2,
// §22), so its old address redirects there. Workers reads dist/_redirects
// with the static assets, as it reads _headers, and applies a rule whether
// or not a file matches the path.
describe('dist/_redirects (SPEC §7.2, §18.2)', () => {
  const site = inject('builtSite');
  const file = path.join(site, '_redirects');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const { rules, invalid } = parseRedirects(text);
  const slugs = readdirSync('content/problems').filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));

  it('is copied into the build as it is in src/', () => {
    expect(existsSync(file)).toBe(true);
    expect(text).toBe(readFileSync('src/_redirects', 'utf8'));
  });

  it('has no line Cloudflare would drop', () => {
    expect(invalid).toEqual([]);
  });

  it('sends the old Sleep problems address, with and without its final slash, to Home with a 301, and has no other rule', () => {
    expect(rules.map(({ from, to, status }) => [from, to, status])).toEqual([
      ['/problems', '/', 301],
      ['/problems/', '/', 301],
    ]);
  });

  it('has only static rules, each one exact path: none can match a problem page', () => {
    expect(slugs).toHaveLength(36);
    for (const rule of rules) {
      expect(rule.dynamic, `line ${rule.line}: ${rule.from}`).toBe(false);
      expect(rule.from, `line ${rule.line}`).not.toMatch(/[*:]/);
    }
    // A static rule is looked up by the request's exact path.
    const sources = new Set(rules.map((r) => r.from));
    for (const slug of slugs) {
      for (const address of [`/problems/${slug}/`, `/problems/${slug}`, `/problems/${slug}/index.html`]) expect(sources.has(address), address).toBe(false);
    }
    expect(text).not.toMatch(/^\s*\/problems\/\S/m);
  });

  it('redirects only addresses with no page of their own, to pages that are built, without a fragment (so /problems/#core keeps #core)', () => {
    for (const { from, to, line } of rules) {
      // A rule wins over a file at the same path, so a page there could never be reached.
      for (const built of [`${from.replace(/\/$/, '')}/index.html`, `${from.replace(/\/$/, '')}.html`]) {
        expect(existsSync(path.join(site, built)), `line ${line}: ${built}`).toBe(false);
      }
      expect(to, `line ${line}`).toMatch(/^\/[^#?]*$/);
      expect(existsSync(path.join(site, to.endsWith('/') ? `${to}index.html` : to)), `line ${line}: ${to}`).toBe(true);
    }
  });
});

describe('the _redirects parser used above', () => {
  it('drops what Cloudflare drops', () => {
    const { rules, invalid } = parseRedirects(
      ['/only-one-part', '/a /b 301 extra', 'https://x.example/a /b', '/c d', '/e /f 404', '/g/* /g/index.html', '/h /i', '/h /j', '/k https://x.example/ 200'].join('\n'),
    );
    expect(rules.map((r) => [r.line, r.from, r.to, r.status])).toEqual([[7, '/h', '/i', 302]]);
    expect(invalid.map((m) => m.match(/^line (\d+)/)[1])).toEqual(['1', '2', '3', '4', '5', '6', '8', '9']);
  });

  it('reads rules, the default status, comments, and tells static rules from dynamic ones', () => {
    const { rules, invalid } = parseRedirects('# c\n/old /new 301   # why\n/x/ https://x.example/y?z=1#top\n/blog/* /news/:splat 308\n/u/:id /users/:id\n');
    expect(invalid).toEqual([]);
    expect(rules).toEqual([
      { line: 2, from: '/old', to: '/new', status: 301, dynamic: false },
      { line: 3, from: '/x/', to: 'https://x.example/y?z=1#top', status: 302, dynamic: false },
      { line: 4, from: '/blog/*', to: '/news/:splat', status: 308, dynamic: true },
      { line: 5, from: '/u/:id', to: '/users/:id', status: 302, dynamic: true },
    ]);
  });
});
