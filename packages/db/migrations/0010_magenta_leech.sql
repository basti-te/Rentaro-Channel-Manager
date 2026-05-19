CREATE TABLE IF NOT EXISTS "message_booking_overrides" (
	"booking_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_booking_overrides_booking_id_template_id_pk" PRIMARY KEY("booking_id","template_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_template_listings" (
	"template_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	CONSTRAINT "message_template_listings_template_id_property_id_pk" PRIMARY KEY("template_id","property_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_booking_overrides" ADD CONSTRAINT "message_booking_overrides_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_booking_overrides" ADD CONSTRAINT "message_booking_overrides_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_template_listings" ADD CONSTRAINT "message_template_listings_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_template_listings" ADD CONSTRAINT "message_template_listings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mbo_booking_idx" ON "message_booking_overrides" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mtl_property_idx" ON "message_template_listings" USING btree ("property_id");