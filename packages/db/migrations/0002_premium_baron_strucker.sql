ALTER TABLE "bookings" ADD COLUMN "checkin_time" text DEFAULT '15:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "checkout_time" text DEFAULT '11:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "guest_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "nightly_rate_cents" bigint;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cleaning_fee_cents" bigint;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "city_tax_rate_bp" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "city_tax_cents" bigint;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "default_cleaning_fee_cents" bigint;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "default_city_tax_rate_bp" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "default_checkin_time" text DEFAULT '15:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "default_checkout_time" text DEFAULT '11:00' NOT NULL;