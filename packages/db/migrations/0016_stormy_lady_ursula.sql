ALTER TABLE "bookings" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "imported_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_external_id_unique" ON "bookings" ("tenant_id", "external_id") WHERE "external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "bookings_imported_at_idx" ON "bookings" ("imported_at") WHERE "imported_at" IS NOT NULL;