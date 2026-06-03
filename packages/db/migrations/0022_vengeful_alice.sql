ALTER TABLE "tenants" ADD COLUMN "sms_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill: existing tenants were already using SMS before the opt-in gate, so
-- keep them ON. New tenants get the column default (false) = opt-in add-on.
UPDATE "tenants" SET "sms_enabled" = true;