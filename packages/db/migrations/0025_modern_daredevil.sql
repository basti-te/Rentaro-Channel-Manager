CREATE TABLE IF NOT EXISTS "guest_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"channex_message_id" text,
	"direction" text NOT NULL,
	"sender" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"error" text,
	"ota_created_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "ai_knowledge" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ai_replies_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ai_auto_send" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "ai_usage_reported_through" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "guest_messages" ADD CONSTRAINT "guest_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "guest_messages" ADD CONSTRAINT "guest_messages_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guest_messages_booking_idx" ON "guest_messages" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guest_messages_tenant_idx" ON "guest_messages" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "guest_messages_channex_uq" ON "guest_messages" USING btree ("channex_message_id");