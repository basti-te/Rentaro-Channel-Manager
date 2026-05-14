/**
 * Apply post-migration SQL files (RLS policies, triggers, etc.)
 *
 * Runs after `drizzle-kit migrate`. Picks up every .sql file under
 * `post-migrate/`, sorted alphabetically, and executes it against the DB.
 *
 * These scripts must be idempotent — they may run more than once.
 *
 * Uses postgres-js `simple()` protocol, which handles multi-statement SQL
 * including `$$ ... $$` PL/pgSQL function bodies natively.
 */

import { config } from 'dotenv';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';

config({ path: resolve(process.cwd(), '../../.env.local') });

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) {
  console.error('✗ DATABASE_URL_DIRECT or DATABASE_URL must be set');
  process.exit(1);
}

const dir = resolve(process.cwd(), 'post-migrate');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  console.log('No post-migrate scripts to apply.');
  process.exit(0);
}

const sql = postgres(url, { onnotice: () => {} });

try {
  for (const file of files) {
    const content = readFileSync(resolve(dir, file), 'utf8');
    process.stdout.write(`Applying ${file}... `);
    await sql.unsafe(content).simple();
    console.log('✓');
  }
  console.log(`\n✓ All ${files.length} post-migrate script(s) applied.`);
} catch (err) {
  console.error('\n✗ Failed:', err);
  process.exit(1);
} finally {
  await sql.end();
}
