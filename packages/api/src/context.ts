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
  /** Twilio SMS — optional; messaging test-send / automation degrade gracefully if unset. */
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  /** Sender: an E.164 number or an approved alphanumeric sender id. */
  TWILIO_FROM?: string;
  INNGEST_EVENT_KEY?: string;
  INNGEST_BASE_URL?: string;
  INNGEST_APP_ID?: string;
  /** Public URL of the SPA — used for Stripe Checkout/Portal return URLs. */
  APP_URL?: string;
  /** Stripe SaaS billing — all optional; billing degrades to "not configured" if unset. */
  STRIPE_SECRET_KEY?: string;
  /** Webhook signing secret — used by the worker to verify `stripe-signature`. */
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_BASE_MONTHLY?: string;
  STRIPE_PRICE_BASE_ANNUAL?: string;
  STRIPE_PRICE_PROPERTY_MONTHLY?: string;
  STRIPE_PRICE_PROPERTY_ANNUAL?: string;
  /** Usage-based SMS add-on (optional): metered Price id + Billing Meter event name. */
  STRIPE_PRICE_SMS_METERED?: string;
  STRIPE_SMS_METER_EVENT_NAME?: string;
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
  /**
   * Triggers the global ARI flusher. Carries no data — the dirty-range rows
   * were already written to `ari_pending`; the flusher reads the outbox.
   * Debounced + throttled worker-side so bursts collapse into ~2 Channex
   * calls regardless of property count.
   */
  'ari/changed': {
    data: {
      reason?: string;
    };
  };
  /**
   * Pull unacknowledged booking revisions from the Channex feed. In production
   * this is fired by the global webhook handler; in sandbox the simulator
   * mutation fires it manually because Channex sandbox doesn't deliver
   * webhooks back to us.
   */
  'channex/booking.ingest': {
    data: {
      reason: string;
      hintBookingId?: string;
    };
  };
  /**
   * Full Sync — push 500 days of availability + rates/restrictions for one
   * property to Channex in 2 calls. One event per property; the worker
   * handler is throttled so a "sync all" paces itself.
   */
  'channex/full-sync': {
    data: {
      propertyId: string;
      days?: number;
      reason?: string;
    };
  };
  /**
   * A brand-new tenant just registered. The worker emails the platform owner.
   * Emitted by `me.bootstrap` only when a tenant was actually created.
   */
  'tenant/registered': {
    data: {
      tenantId: string;
      tenantName: string;
      userEmail: string;
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
