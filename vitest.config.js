import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

// Two Vitest projects (SPEC §18.1, §22):
// - "worker": Worker tests, run inside the Workers runtime (workerd) with the
//   bindings from wrangler.jsonc. The plugin is scoped to this project so it
//   doesn't switch the Node tests to the Workers pool.
// - "node": build scripts and checks on the built site. global-setup.js
//   builds the site with Eleventy into a fresh temporary directory first, so
//   these tests never read a stale dist/.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
        test: {
          name: 'worker',
          include: ['test/worker/**/*.test.js'],
        },
      },
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/node/**/*.test.js'],
          globalSetup: ['test/node/global-setup.js'],
        },
      },
    ],
  },
});
