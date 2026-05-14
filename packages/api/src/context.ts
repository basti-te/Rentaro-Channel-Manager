import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@cm/db';
import { createDb } from '@cm/db';

export interface AppContextEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;
  DATABASE_URL: string;
  CHANNEX_API_URL: string;
  CHANNEX_API_KEY: string;
  CHANNEX_WEBHOOK_SECRET: string;
}

export interface AppContext {
  env: AppContextEnv;
  /** The user's bearer token (Supabase JWT), if present. */
  bearer: string | null;
  /** Supabase admin client (service role — bypasses RLS). Server-side only. */
  supabaseAdmin: SupabaseClient;
  /** Drizzle DB client. */
  db: Database;
  /**
   * Resolved user from Supabase Auth. Null on public routes.
   * Set by the auth middleware.
   */
  userId: string | null;
  userEmail: string | null;
  /** Resolved tenant for the current request. Set by tenant middleware. */
  tenantId: string | null;
  /** Membership role within tenantId. Set by tenant middleware. */
  role: 'owner' | 'admin' | 'manager' | 'viewer' | null;
}

/**
 * Build the per-request context. The Hono adapter calls this on every request.
 */
export async function createContext(opts: {
  bearer: string | null;
  env: AppContextEnv;
}): Promise<AppContext> {
  const supabaseAdmin = createClient(opts.env.SUPABASE_URL, opts.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    env: opts.env,
    bearer: opts.bearer,
    supabaseAdmin,
    db: createDb(opts.env.DATABASE_URL),
    userId: null,
    userEmail: null,
    tenantId: null,
    role: null,
  };
}
