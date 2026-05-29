CREATE TABLE IF NOT EXISTS "outbound_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"property_id" uuid,
	"template_id" uuid,
	"rendered_text" text NOT NULL,
	"star_rating" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"channex_review_id" text,
	"error" text,
	"skipped_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbound_reviews_booking_id_unique" UNIQUE("booking_id")
);
--> statement-breakpoint
ALTER TABLE "review_templates" ADD COLUMN "star_rating" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_templates" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "review_templates" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_reviews" ADD CONSTRAINT "outbound_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_reviews" ADD CONSTRAINT "outbound_reviews_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_reviews" ADD CONSTRAINT "outbound_reviews_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outbound_reviews" ADD CONSTRAINT "outbound_reviews_template_id_review_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."review_templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_reviews_tenant_idx" ON "outbound_reviews" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_reviews_booking_idx" ON "outbound_reviews" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_reviews_due_idx" ON "outbound_reviews" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "review_templates_one_default_idx" ON "review_templates" USING btree ("tenant_id","language") WHERE "review_templates"."is_default" = true;