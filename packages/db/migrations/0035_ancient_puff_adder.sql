CREATE TYPE "public"."tier" AS ENUM('free', 'basic', 'premium');--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "tier" "tier" DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "tier" "tier" DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "free_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "free_converts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "default_payment_method_id" text;--> statement-breakpoint
-- Backfill tier from existing state: owner/comped workspaces → premium;
-- any legacy paying subscriber (plan='starter') → basic; everyone else stays free.
UPDATE "tenants" SET "tier" = 'premium' WHERE "billing_exempt" = true;--> statement-breakpoint
UPDATE "subscriptions" SET "tier" = 'basic' WHERE "plan" = 'starter';--> statement-breakpoint
UPDATE "tenants" SET "tier" = 'basic' WHERE "billing_exempt" = false AND "id" IN (SELECT "tenant_id" FROM "subscriptions" WHERE "plan" = 'starter' AND "status" IN ('active','trialing','past_due'));