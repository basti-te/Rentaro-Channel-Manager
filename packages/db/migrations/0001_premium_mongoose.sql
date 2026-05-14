ALTER TABLE "properties" ADD COLUMN "default_rate_cents" bigint;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "default_min_stay" integer DEFAULT 1 NOT NULL;