import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@cm/db';
import { createDb } from '@cm/db';
import { EventSchemas, Inngest } from 'inngest';

export interface AppContextEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;
  DATABASE_URL: string;
  CHANNEX_API_URL: string;
  CHANNEX_API_KEY: string;
  CHANNEX_WEBHOOK_SECRET: string;
  INNGEST_EVENT_KEY?: string;
  INNGEST_BASE_URL?: string;
  INNGEST_APP_ID?: string;
}

/**
 * Type contract shared with apps/worker/src/inngest/events.ts. Kept here to
 * avoid a workspace dependency from packages/api → apps/worker (apps must
 * depend on packages, not the other way around).
 *
 * `type` (not `interface`) so the shape satisfies Inngest's
 * `Record<string, EventPayload>` constraint.
 */
export type AppEvents = {
  'apartment/availability.sync': {
    data: {
      tenantId: string;
      propertyId: string;
      from: string;
      to: string;
      reason?: string;
    };
  };
  'apartment/rates.sync': {
    data: {
      tenantId: string;
      propertyId: string;
      from: string;
      to: string;
      reason?: string;
    };
  };
};

type AppInngest = ReturnType<typeof getInngest>;

export interface AppContext {
  env: AppContextEnv;
  /** The user's bearer token (Supabase JWT), if present. */
  bearer: string | null;
  /** Supabase admin client (service role — bypasses RLS). Server-side only. */
  supabaseAdmin: SupabaseClient;
  /** Drizzle DB client. */
  db: Database;
  /** Inngest client — emit-only (no functions registered here). */
  inngest: AppInngest;
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

let _inngest: ReturnType<typeof buildInngest> | null = null;

function buildInngest(env: AppContextEnv) {
  return new Inngest({
    id: env.INNGEST_APP_ID ?? 'channel-manager',
    eventKey: env.INNGEST_EVENT_KEY || undefined,
    ...(env.INNGEST_BASE_URL ? { baseUrl: env.INNGEST_BASE_URL } : {}),
    schemas: new EventSchemas().fromRecord<AppEvents>(),
  });
}

function getInngest(env: AppContextEnv) {
  if (_inngest) return _inngest;
  _inngest = buildInngest(env);
  return _inngest;
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
    inngest: getInngest(opts.env),
    userId: null,
    userEmail: null,
    tenantId: null,
    role: null,
  };
}
