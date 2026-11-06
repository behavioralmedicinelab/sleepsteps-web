import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

// Two Vitest projects (SPEC §18.1, §22):
// - "worker": Worker tests, run inside the Workers runtime (workerd) with the
//   bindings from wrangler.jsonc's top level. The plugin is scoped to this
//   project so it doesn't switch the Node tests to the Workers pool. Each
//   test file gets an empty D1 of its own, and setupFiles applies
//   migrations/ to it (SPEC §17).
// - "node": build scripts and checks on the built site.
// test/global-setup.js, in the root config so that it runs before both,
// builds the site into a fresh temporary directory first, so the tests never
// read a stale dist/, and writes the worker/generated/pages.json the Worker
// imports.
export default defineConfig({
  test: {
    globalSetup: ['test/global-setup.js'],
    projects: [
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations('./migrations') } },
          })),
        ],
        test: {
          name: 'worker',
          include: ['test/worker/**/*.test.js'],
          setupFiles: ['test/worker/apply-migrations.js'],
        },
      },
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/node/**/*.test.js'],
        },
      },
    ],
  },
});
