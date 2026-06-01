import { config } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

config({ path: resolve(process.cwd(), '../../.env.local') });

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  CHANNEX_API_URL: z.string().url(),
  CHANNEX_API_KEY: z.string().min(1),
  CHANNEX_WEBHOOK_SECRET: z.string().min(1),
  APP_URL: z.string().url().default('http://localhost:5173'),

  // Resend transactional email (operator notifications) — optional; if unset,
  // notifications degrade to "not configured" and are silently skipped.
  RESEND_API_KEY: z.string().optional().transform((v) => v || undefined),
  /** From header, e.g. `Rentaro <alerts@rentaro.cloud>`. Domain must be
   *  verified in Resend. Without both this and RESEND_API_KEY, no mail sends. */
  RESEND_FROM: z.string().optional().transform((v) => v || undefined),
  /** Platform owner address — receives an alert when a NEW account registers
   *  at Rentaro. Unset → the registration alert is silently skipped. */
  OWNER_NOTIFICATION_EMAIL: z
    .string()
    .optional()
    .transform((v) => v || undefined)
    .pipe(z.string().email().optional()),

  // Twilio SMS — optional; test-send / automation degrade gracefully if unset.
  TWILIO_ACCOUNT_SID: z.string().optional().transform((v) => v || undefined),
  TWILIO_AUTH_TOKEN: z.string().optional().transform((v) => v || undefined),
  TWILIO_FROM: z.string().optional().transform((v) => v || undefined),
  /** Secret path segment for the Twilio delivery-status webhook. */
  TWILIO_STATUS_SECRET: z.string().optional().transform((v) => v || undefined),
  /** Public base URL (no trailing slash) for inbound webhooks. Unset in
   *  local dev → Twilio status callbacks are skipped. */
  PUBLIC_WEBHOOK_BASE_URL: z
    .string()
    .optional()
    .transform((v) => v || undefined)
    .pipe(z.string().url().optional()),

  // Inngest — all optional in dev (cli auto-detects local mode).
  // Coerce empty strings to undefined so a placeholder `KEY=` line in
  // .env.local doesn't trip the url() validator.
  INNGEST_EVENT_KEY: z.string().optional().transform((v) => v || undefined),
  INNGEST_SIGNING_KEY: z.string().optional().transform((v) => v || undefined),
  INNGEST_BASE_URL: z
    .string()
    .optional()
    .transform((v) => v || undefined)
    .pipe(z.string().url().optional()),
  INNGEST_APP_ID: z.string().optional().transform((v) => v || undefined),

  // Stripe SaaS billing — all optional; billing degrades to "not configured" if unset.
  STRIPE_SECRET_KEY: z.string().optional().transform((v) => v || undefined),
  /** Stripe Webhook signing secret. Server-side webhook verification only. */
  STRIPE_WEBHOOK_SECRET: z.string().optional().transform((v) => v || undefined),
  /** The 4 Stripe Price IDs for the hybrid base + per-property × monthly/annual model. */
  STRIPE_PRICE_BASE_MONTHLY: z.string().optional().transform((v) => v || undefined),
  STRIPE_PRICE_BASE_ANNUAL: z.string().optional().transform((v) => v || undefined),
  STRIPE_PRICE_PROPERTY_MONTHLY: z.string().optional().transform((v) => v || undefined),
  STRIPE_PRICE_PROPERTY_ANNUAL: z.string().optional().transform((v) => v || undefined),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
