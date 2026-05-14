import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema';

export * from './schema';
export { schema };

export type Database = ReturnType<typeof buildDb>;

/**
 * Process-level singletons keyed on the connection string. Without this,
 * each tRPC request and each Inngest function invocation opens a fresh
 * `max: N` pool and never closes it, exhausting Postgres connection slots
 * (Supabase Free is ~60).
 *
 * Stays correct in dev (long-lived node process) and acceptable in serverless
 * deploys where the lambda boots fresh anyway.
 */
const sqlCache = new Map<string, Sql>();
const dbCache = new Map<string, Database>();

function buildDb(client: Sql) {
  return drizzle(client, { schema });
}

/**
 * Returns a Drizzle client for the given DATABASE_URL, reusing the underlying
 * postgres-js pool across calls in the same process.
 *
 * Use the Transaction-Pooler URL (port 6543 on Supabase) for runtime queries
 * — it multiplexes connections so we don't burn a real Postgres backend per
 * client. The Direct URL (port 5432) is for `drizzle-kit migrate` and
 * `studio` only.
 */
export function createDb(connectionString: string): Database {
  const cached = dbCache.get(connectionString);
  if (cached) return cached;

  const client = postgres(connectionString, {
    prepare: false, // required for Supabase transaction pooler
    max: 4,
    idle_timeout: 20, // seconds — return idle conns to the pooler
    max_lifetime: 60 * 30, // recycle long-lived conns every 30 minutes
  });
  const db = buildDb(client);
  sqlCache.set(connectionString, client);
  dbCache.set(connectionString, db);
  return db;
}

/** Close every cached pool. Tests / graceful shutdown only. */
export async function closeAllDbConnections() {
  await Promise.all(Array.from(sqlCache.values(), (c) => c.end({ timeout: 5 })));
  sqlCache.clear();
  dbCache.clear();
}
