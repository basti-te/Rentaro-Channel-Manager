CREATE TYPE "public"."rate_source" AS ENUM('pms', 'pricelabs');--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "rate_source" "rate_source" DEFAULT 'pms' NOT NULL;