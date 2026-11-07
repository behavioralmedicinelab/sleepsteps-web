// What the Worker's source may read and log (SPEC §14.1, §14.3). The Worker
// tests (test/worker/) check behaviour; these check the code itself, so a new
// header read or log line can't slip in untested:
// - the request headers read: Origin, Content-Type and Content-Length, and
//   CF-Connecting-IP in the router alone, for the one route marked
//   `remoteIp` (/api/feedback, which passes it to Siteverify);
//   Cf-Access-Jwt-Assertion in the token check, and Sec-Fetch-Site in the
//   admin route (an export another site started is refused); never
//   User-Agent, request.cf or the whole header list;
// - every console call, each a fixed text (plus a code from a closed list);
// - Siteverify's timeout leaves the browser time to hear the answer;
// - the admin code (SPEC §14.4): the Access token is read from its header
//   alone, never a cookie; no SQL selects or orders by events.id; HTML is
//   built only through the escaping html`` tag; and no way around the
//   Access check can ship.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TIMEOUT_MS } from '../../src/js/api.js';
import * as queries from '../../worker/lib/admin-queries.js';
import * as htmlModule from '../../worker/lib/html.js';
import { SITEVERIFY_TIMEOUT_MS } from '../../worker/lib/turnstile.js';
import { listFiles } from './helpers.js';

const files = listFiles('worker', (f) => f.endsWith('.js') && !f.startsWith('generated'));
const source = Object.fromEntries(files.map((file) => [file, readFileSync(path.join('worker', file), 'utf8')]));

/**
 * The code without its comments: whole-line // comments first (they can
 * hold a "/*", as in "/api/*"), then block comments.
 */
const code = (text) => text.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('worker/ source (SPEC §14.1)', () => {
  it('has the files these checks expect', () => {
    const expected = [
      'index.js', 'router.js', 'lib/http.js', 'lib/turnstile.js', 'routes/feedback.js',
      'lib/access-jwt.js', 'lib/csv.js', 'lib/html.js', 'lib/date-range.js', 'lib/admin-queries.js', 'lib/admin-data.js', 'lib/admin-page.js', 'routes/admin.js',
    ];
    for (const file of expected) expect(files).toContain(file);
  });

  it('reads request headers only by name, and only Origin, Content-Type, Content-Length, CF-Connecting-IP, Cf-Access-Jwt-Assertion and Sec-Fetch-Site', () => {
    const read = {};
    for (const [file, text] of Object.entries(source)) {
      const body = code(text);
      // Every .get( on headers names its header in a string literal.
      expect(body.match(/headers\.get\((?!\s*'[^']+'\s*\))/g), `${file}: headers.get without a literal name`).toBeNull();
      for (const [, name] of body.matchAll(/headers\.get\(\s*'([^']+)'\s*\)/g)) (read[file] ??= []).push(name.toLowerCase());
      expect(body, file).not.toMatch(/headers\.(entries|keys|values|forEach|has)\b|\.\.\.\s*request\.headers|fromEntries\(\s*request\.headers/);
    }
    expect(read).toEqual({
      'router.js': ['origin', 'cf-connecting-ip'],
      'lib/http.js': ['content-type', 'content-length'],
      'lib/access-jwt.js': ['cf-access-jwt-assertion'],
      'routes/admin.js': ['sec-fetch-site'],
    });
  });

  it('never reads the Access cookie: the token comes from the Cf-Access-Jwt-Assertion header only', () => {
    for (const [file, text] of Object.entries(source)) {
      expect(code(text), file).not.toMatch(/CF_Authorization|headers\.get\(\s*'cookie'/i);
    }
  });

  it('never reads User-Agent, Referer, X-Forwarded-For or request.cf', () => {
    for (const [file, text] of Object.entries(source)) {
      const body = code(text);
      expect(body, file).not.toMatch(/user-agent|referer|x-forwarded-for|x-real-ip|true-client-ip/i);
      expect(body, file).not.toMatch(/\.cf\b|\[\s*'cf'\s*\]/);
    }
  });

  it('passes CF-Connecting-IP only to a route marked remoteIp, and marks only /api/feedback', () => {
    const router = code(source['router.js']);
    expect(router.match(/CF-Connecting-IP/g)).toHaveLength(1);
    expect(router).toMatch(
      /if \(route\.remoteIp === true\) \{\s*return await route\.handle\(body, env, index, \{ remoteIp: request\.headers\.get\('CF-Connecting-IP'\) \|\| null \}\);\s*\}\s*return await route\.handle\(body, env, index\);/,
    );
    expect(router.match(/remoteIp: true/g)).toHaveLength(1);
    expect(router).toMatch(/'\/api\/feedback',\s*\{[^}]*remoteIp: true[^}]*\}/);
  });

  it('logs only these fixed lines: a route name, a fixed text and at most a code from a closed list', () => {
    const calls = [];
    for (const [file, text] of Object.entries(source)) {
      for (const [call] of code(text).matchAll(/console\.\w+\([^;]*\);/g)) calls.push(`${file}: ${call}`);
    }
    expect(calls.sort()).toEqual([
      "lib/access-jwt.js: console.error('/admin: access certs unavailable', failure);",
      'lib/d1.js: console.error(`${label}: database write failed`, d1Code(error));',
      'router.js: console.error(`${route.log}: unexpected error`);',
      "routes/admin.js: console.error('/admin: access denied', code);",
      "routes/admin.js: console.error('/admin: database read failed', d1Code(error));",
      "routes/admin.js: console.error('/admin: unexpected error');",
      'routes/feedback.js: console.error(`${LOG}: ${check.log}`, check.code);',
      'routes/feedback.js: console.error(`${LOG}: TURNSTILE_SECRET missing`);',
    ].sort());
  });
});

describe('stored times (SPEC §14.1)', () => {
  // Project lead, 2026-11-07: every stored time is rounded down to the hour,
  // and no exact time is stored anywhere.
  it('writes every row with ts first, from hourTimestamp(now), and reads no other clock', () => {
    const inserts = {};
    for (const [file, text] of Object.entries(source)) {
      const body = code(text);
      for (const match of body.matchAll(/INSERT INTO (\w+) \(([^)]*)\)[^']*', \[\s*([^,\]]+)/g)) {
        (inserts[file] ??= []).push([match[1], match[2].split(', ')[0], match[3].trim()]);
      }
      // The API routes (routes/admin.js only reads, and needs today's date).
      if (/^routes\/(event|rate|feedback)\.js$/.test(file)) expect(body, file).not.toMatch(/toISOString|Date\.now|getTime|Date\.parse/);
    }
    expect(inserts).toEqual({
      'routes/event.js': [['events', 'ts', 'hourTimestamp(now)']],
      'routes/feedback.js': [['feedback', 'ts', 'hourTimestamp(now)']],
      'routes/rate.js': [['ratings', 'ts', 'hourTimestamp(now)']],
    });
    // No other statement writes: the admin queries only read.
    for (const [file, text] of Object.entries(source)) {
      if (!inserts[file]) expect(code(text), file).not.toMatch(/\b(INSERT|UPDATE|REPLACE INTO|DELETE FROM)\b/);
    }
  });
});

describe('the admin code (SPEC §14.4, §20 M6)', () => {
  const ADMIN_FILES = ['routes/admin.js', 'lib/admin-page.js', 'lib/admin-queries.js', 'lib/admin-data.js'];
  const statements = Object.entries(queries).filter(([, value]) => typeof value === 'string' && /\bSELECT\b/.test(value));

  it('has its SQL in lib/admin-queries.js only, never SELECT *', () => {
    expect(statements.length).toBeGreaterThanOrEqual(15);
    for (const [file, text] of Object.entries(source)) {
      if (file !== 'lib/admin-queries.js') expect(code(text), file).not.toMatch(/\bSELECT\b/);
      expect(code(text), file).not.toMatch(/SELECT\s+\*/i);
    }
  });

  it('never names events.id: no statement that reads events mentions an id', () => {
    for (const [name, sql] of statements) {
      if (/\bFROM\s+events\b/i.test(sql)) expect(sql, name).not.toMatch(/\bid\b|rowid|_rowid_|\boid\b/i);
    }
  });

  it('orders by id only in the ratings and feedback statements', () => {
    for (const [name, sql] of statements) {
      const order = /\bORDER BY\b(.*?)(?:\bLIMIT\b|$)/is.exec(sql)?.[1] ?? '';
      if (/\bid\b/i.test(order)) expect(sql, name).toMatch(/\bFROM (ratings|feedback)\b/);
      const aggregate = /^SELECT COUNT\(/.test(sql) || /\bGROUP BY\b/.test(sql);
      if (/\bFROM\s+events\b/i.test(sql) && !aggregate) {
        // A list of events rows has a complete order on content.
        expect(order, name).toMatch(/ts, page, session_id, detail/);
      }
    }
  });

  it('builds HTML only through html``: no unquoted interpolated attribute, no innerHTML', () => {
    for (const file of ADMIN_FILES) {
      const body = code(source[file]);
      expect(body, file).not.toMatch(/=\$\{/);
      expect(body, file).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
      expect(body, file).not.toMatch(/console\.\w+\([^;]*JSON\.stringify/);
    }
  });

  it('exports no helper from lib/html.js that skips escaping', () => {
    expect(Object.keys(htmlModule).sort()).toEqual(['Html', 'escapeHtml', 'html']);
    expect(code(source['lib/html.js'])).not.toMatch(/\braw\b|unsafe/i);
  });

  it('builds the deployed Worker with the real Access check: index.js passes only pages and site', () => {
    const index = code(source['index.js']);
    expect(index.match(/createRouter\(/g)).toHaveLength(1);
    expect(index).toMatch(/export default createRouter\(\{ pages, site \}\);/);
  });

  it('has no switch that skips the Access check anywhere in worker/', () => {
    for (const [file, text] of Object.entries(source)) {
      expect(text, file).not.toMatch(/ADMIN_DEV|bypass|skipAccess|noAccess|DISABLE_ACCESS/i);
    }
  });
});

describe('Siteverify and the browser (SPEC §11, §14.3)', () => {
  it("answers within the browser's 5 seconds, with time to spare", () => {
    // Otherwise api.js gives up first, shows a stored message as failed, and
    // the visitor sends it again.
    expect(SITEVERIFY_TIMEOUT_MS + 1500).toBeLessThanOrEqual(TIMEOUT_MS);
  });
});
