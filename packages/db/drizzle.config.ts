import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { resolve } from 'node:path';

// drizzle-kit invokes this script with cwd = packages/db.
// Go up two levels to the monorepo root to find .env.local.
config({ path: resolve(process.cwd(), '../../.env.local') });

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL_DIRECT (preferred) or DATABASE_URL must be set for Drizzle Kit. ' +
      'See .env.example.',
  );
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
