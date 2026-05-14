import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export * from './schema';
export { schema };

/**
 * Server-side Drizzle client.
 *
 * Use the pooled DATABASE_URL (port 6543) for runtime queries.
 * Migrations and Drizzle Studio use DATABASE_URL_DIRECT (port 5432).
 */
export function createDb(connectionString: string) {
  const client = postgres(connectionString, {
    prepare: false, // Required for Supabase transaction pooler
    max: 10,
  });
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;
