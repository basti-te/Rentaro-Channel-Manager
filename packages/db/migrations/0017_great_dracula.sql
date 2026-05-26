ALTER TABLE "tenants" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
-- Backfill: any tenant that already exists at migration time is assumed
-- to have completed onboarding (legacy CITY APARTMENTS ESSEN etc.).
-- New signups will have NULL, triggering the /onboarding wizard.
UPDATE "tenants" SET "onboarded_at" = NOW() WHERE "onboarded_at" IS NULL;