import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

// Tests run inside the Workers runtime (workerd) with the bindings from
// wrangler.jsonc. Build-script tests that need Node APIs will get their own
// Vitest project when those scripts land (M1/M2).
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: {
    include: ['test/**/*.test.js'],
  },
});
