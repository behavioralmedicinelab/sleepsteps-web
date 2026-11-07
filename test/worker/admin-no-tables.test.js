// /admin/ on a database with no tables (SPEC §14.4, §17): a preview or
// production database before its migrations are applied. A file of its own,
// since it drops this file's tables.
import { createExecutionContext } from 'cloudflare:test';
import { env as testEnv } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createRouter } from '../../worker/router.js';
import { AUD, TEAM } from './access-tokens.js';

const router = createRouter({
  pages: {},
  site: { features: {} },
  admin: { access: { verify: async () => ({ ok: true }) }, now: () => Date.parse('2026-11-06T13:30:00.000Z') },
});
const env = () => ({ DB: testEnv.DB, API_HOSTS: 'example.com', ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD });

let logged;
beforeAll(async () => {
  await testEnv.DB.batch(['DROP TABLE events', 'DROP TABLE ratings', 'DROP TABLE feedback'].map((sql) => testEnv.DB.prepare(sql)));
});
beforeEach(() => {
  logged = [];
  vi.spyOn(console, 'error').mockImplementation((...args) => logged.push(args.map(String)));
});
afterEach(() => vi.restoreAllMocks());

it("shows 'isn't set up here yet' with 500, logging only the D1 code", async () => {
  const res = await router.fetch(new Request('https://example.com/admin/'), env(), createExecutionContext());
  expect(res.status).toBe(500);
  const body = await res.text();
  expect(body).toContain("The database isn't set up here yet");
  expect(body).toMatch(/<title>Error: /);
  expect(logged).toEqual([['/admin: database read failed', 'D1_ERROR']]);
});

it('answers an export with a plain 500', async () => {
  const res = await router.fetch(new Request('https://example.com/admin/export?table=events'), env(), createExecutionContext());
  expect(res.status).toBe(500);
  expect(await res.text()).toBe('Server error');
  expect(logged).toEqual([['/admin: database read failed', 'D1_ERROR']]);
});
