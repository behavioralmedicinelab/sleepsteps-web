// Applies migrations/ to this test file's own empty D1 before its tests run
// (SPEC §17). vitest.config.js reads the files in Node (readD1Migrations) and
// passes them in as the TEST_MIGRATIONS binding. Already-applied migrations
// are skipped, so this is safe in every file. Tests clear rows with DELETE,
// never reset(), which would also drop the schema.
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
