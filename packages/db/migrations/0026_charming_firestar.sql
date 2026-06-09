CREATE TABLE IF NOT EXISTS "teammate_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"teammate_id" uuid,
	"role" text NOT NULL,
	"summary" text NOT NULL,
	"urgency" text,
	"channel" text DEFAULT 'sms' NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "teammates" ADD COLUMN "role" text DEFAULT 'cleaner' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "teammate_dispatches" ADD CONSTRAINT "teammate_dispatches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "teammate_dispatches" ADD CONSTRAINT "teammate_dispatches_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "teammate_dispatches" ADD CONSTRAINT "teammate_dispatches_teammate_id_teammates_id_fk" FOREIGN KEY ("teammate_id") REFERENCES "public"."teammates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teammate_dispatches_booking_idx" ON "teammate_dispatches" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teammate_dispatches_tenant_idx" ON "teammate_dispatches" USING btree ("tenant_id");