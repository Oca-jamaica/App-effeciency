// Runs ASCEND's database tests against a real Postgres (15+).
//   DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run db:test
// Creates a fresh `ascend_test` database, applies the Supabase emulation and every migration in order,
// then runs supabase/tests/*.test.ts with node's test runner.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const adminUrl = process.env.DATABASE_URL ?? 'postgres://postgres@localhost:54329/postgres';
const testDb = 'ascend_test';

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query(`drop database if exists ${testDb} with (force)`);
await admin.query(`create database ${testDb}`);
await admin.end();

const url = new URL(adminUrl);
url.pathname = `/${testDb}`;
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
await db.query(readFileSync(join(here, 'support', 'supabase-emulation.sql'), 'utf8'));
const migrationsDir = join(here, '..', 'migrations');
for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await db.query(readFileSync(join(migrationsDir, file), 'utf8'));
    console.log(`applied ${file}`);
  } catch (err) {
    console.error(`failed to apply ${file}: ${err.message}`);
    process.exit(1);
  }
}
await db.end();

const tests = readdirSync(here).filter((f) => f.endsWith('.test.ts')).map((f) => join(here, f));
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...tests], {
  stdio: 'inherit',
  env: { ...process.env, TEST_DATABASE_URL: url.toString() },
});
process.exit(result.status ?? 1);
