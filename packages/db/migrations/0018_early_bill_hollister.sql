CREATE TABLE IF NOT EXISTS "cleaning_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"property_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"show_guest_name" boolean DEFAULT true NOT NULL,
	"show_guest_count" boolean DEFAULT false NOT NULL,
	"show_guest_phone" boolean DEFAULT false NOT NULL,
	"show_guest_email" boolean DEFAULT false NOT NULL,
	"show_notes" boolean DEFAULT false NOT NULL,
	"show_host_notes" boolean DEFAULT false NOT NULL,
	"show_price" boolean DEFAULT false NOT NULL,
	"show_booking_code" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cleaning_calendars_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cleaning_calendars" ADD CONSTRAINT "cleaning_calendars_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cleaning_calendars_tenant_idx" ON "cleaning_calendars" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cleaning_calendars_slug_idx" ON "cleaning_calendars" USING btree ("slug");