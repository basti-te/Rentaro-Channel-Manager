CREATE TYPE "public"."ari_kind" AS ENUM('availability', 'rates');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ari_pending" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"kind" "ari_kind" NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"reason" text,
	"batch_id" uuid,
	"flushed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ari_pending" ADD CONSTRAINT "ari_pending_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ari_pending" ADD CONSTRAINT "ari_pending_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ari_pending_unflushed_idx" ON "ari_pending" USING btree ("flushed_at","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ari_pending_batch_idx" ON "ari_pending" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ari_pending_property_idx" ON "ari_pending" USING btree ("property_id");