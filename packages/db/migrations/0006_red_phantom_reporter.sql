CREATE TABLE IF NOT EXISTS "rate_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"date" date NOT NULL,
	"rate_cents" bigint,
	"min_stay" integer,
	"max_stay" integer,
	"closed_to_arrival" boolean,
	"closed_to_departure" boolean,
	"stop_sell" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rate_overrides" ADD CONSTRAINT "rate_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rate_overrides" ADD CONSTRAINT "rate_overrides_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rate_overrides_property_date_uq" ON "rate_overrides" USING btree ("property_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_overrides_tenant_idx" ON "rate_overrides" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_overrides_property_date_idx" ON "rate_overrides" USING btree ("property_id","date");