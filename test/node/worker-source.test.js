// What the Worker's source may read and log (SPEC §14.1, §14.3). The Worker
// tests (test/worker/) check behaviour; these check the code itself, so a new
// header read or log line can't slip in untested:
// - the request headers read: Origin, Content-Type and Content-Length, and
//   CF-Connecting-IP in the router alone, for the one route marked
//   `remoteIp` (/api/feedback, which passes it to Siteverify); never
//   User-Agent, request.cf or the whole header list;
// - every console call, each a fixed text (plus a code from a closed list);
// - Siteverify's timeout leaves the browser time to hear the answer.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TIMEOUT_MS } from '../../src/js/api.js';
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
    for (const file of ['index.js', 'router.js', 'lib/http.js', 'lib/turnstile.js', 'routes/feedback.js']) expect(files).toContain(file);
  });

  it('reads request headers only by name, and only Origin, Content-Type, Content-Length and CF-Connecting-IP', () => {
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
    });
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
      'lib/d1.js: console.error(`${label}: database write failed`, d1Code(error));',
      'router.js: console.error(`${route.log}: unexpected error`);',
      'routes/feedback.js: console.error(`${LOG}: ${check.log}`, check.code);',
      'routes/feedback.js: console.error(`${LOG}: TURNSTILE_SECRET missing`);',
    ]);
  });
});

describe('Siteverify and the browser (SPEC §11, §14.3)', () => {
  it("answers within the browser's 5 seconds, with time to spare", () => {
    // Otherwise api.js gives up first, shows a stored message as failed, and
    // the visitor sends it again.
    expect(SITEVERIFY_TIMEOUT_MS + 1500).toBeLessThanOrEqual(TIMEOUT_MS);
  });
});
