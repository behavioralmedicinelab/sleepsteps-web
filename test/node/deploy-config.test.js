// Deployment configuration (SPEC §14.1, §14.3, §16.1, §17, §18.1-§18.3):
// wrangler.jsonc and its previews block, the preview-migrations config, the
// npm and Node pins, and the built dist/_headers. Wrangler doesn't check
// _headers on deploy (a bad line is silently dropped), so it is checked here.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, inject, it, vi } from 'vitest';
import { unstable_readConfig } from 'wrangler';
import { hostAllowed } from '../../worker/lib/hosts.js';

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

// The API's hosts (SPEC §14.1, §18.2): production's placeholder until launch,
// and every preview URL. Version URLs look like preview URLs but run with
// production's vars, so production must never match them.
const PREVIEW_HOSTS = '*-sleepsteps.*.workers.dev';
const VERSION_HOSTS = ['abc12345-sleepsteps.team-sub.workers.dev', '0a1b2c3d-sleepsteps.example-sub.workers.dev'];

describe('wrangler.jsonc', () => {
  it('names the Worker "sleepsteps", with no account_id (Workers Builds supplies it)', () => {
    expect(config.name).toBe('sleepsteps');
    expect(config.account_id).toBeUndefined();
  });

  it('answers on workers.dev until launch, with preview URLs on (SPEC §18.2, §18.3)', () => {
    expect(config.workers_dev).toBe(true);
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

  it('keeps data collection off in production and in previews (SPEC §11, §18.3, §21)', () => {
    expect(config.vars.DATA_COLLECTION).toBe('off');
    expect(config.previews.vars.DATA_COLLECTION).toBe('off');
  });

  it('runs the Worker first for /api/*, so the API answers even where a file matches (SPEC §18.2)', () => {
    expect(config.assets.run_worker_first).toContain('/api/*');
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
    // Once siteUrl is real, the launch PR sets API_HOSTS to its host too (SPEC §18.3).
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
// (add its hash below once it is applied anywhere remote).
const APPLIED_MIGRATIONS = {
  '0001_init.sql': 'aa5201b2ccadc89219a58fce2d79c4992331c70e748b5e75b4f499f97e9e2ccb',
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
    expect(pkg.scripts.dev).not.toContain('DATA_COLLECTION');
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

  it('marks every workers.dev address noindex: production before launch, and preview and version URLs', () => {
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
