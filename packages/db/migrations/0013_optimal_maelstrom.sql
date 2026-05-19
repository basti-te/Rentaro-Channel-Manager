CREATE TYPE "public"."billing_interval" AS ENUM('monthly', 'annual');--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "billing_interval" "billing_interval";--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "latest_invoice_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_exempt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- One-time backfill: grandfather all tenants existing at migration time
-- into the billing-exempt bypass. New tenants created after this migration
-- get the column default (false) and go through the trial → Checkout flow.
UPDATE "tenants" SET "billing_exempt" = true;