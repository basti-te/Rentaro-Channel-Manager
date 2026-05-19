CREATE TABLE IF NOT EXISTS "cleaning_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"checklist_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cleaning_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cleaning_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule_id" uuid,
	"booking_id" uuid,
	"teammate_id" uuid,
	"body" text NOT NULL,
	"to_address" text,
	"from_address" text,
	"status" "message_status" DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"external_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cleaning_rule_listings" (
	"rule_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	CONSTRAINT "cleaning_rule_listings_rule_id_property_id_pk" PRIMARY KEY("rule_id","property_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cleaning_rule_teammates" (
	"rule_id" uuid NOT NULL,
	"teammate_id" uuid NOT NULL,
	CONSTRAINT "cleaning_rule_teammates_rule_id_teammate_id_pk" PRIMARY KEY("rule_id","teammate_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cleaning_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"body" text NOT NULL,
	"checklist_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teammates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cleaning_checklist_items" ADD CONSTRAINT "cleaning_checklist_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cleaning_checklist_items" ADD CONSTRAINT "cleaning_checklist_items_checklist_id_cleaning_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."cleaning_checklists"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cleaning_checklists" ADD CONSTRAINT "cleaning_checklists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cleaning_messages" ADD CONSTRAINT "cleaning_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cleaning_messages" ADD CONSTRAINT "cleaning_messages_rule_id_cleaning_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."cleaning_rules"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cleaning_messages" ADD CONSTRAINT "cleaning_messages_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cleaning_messages" ADD CONSTRAINT "cleaning_messages_teammate_id_teammates_id_fk" FOREIGN KEY ("teammate_id") REFERENCES "public"."teammates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cleaning_rule_listings" ADD CONSTRAINT "cleaning_rule_listings_rule_id_cleaning_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."cleaning_rules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cleaning_rule_listings" ADD CONSTRAINT "cleaning_rule_listings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cleaning_rule_teammates" ADD CONSTRAINT "cleaning_rule_teammates_rule_id_cleaning_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."cleaning_rules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cleaning_rule_teammates" ADD CONSTRAINT "cleaning_rule_teammates_teammate_id_teammates_id_fk" FOREIGN KEY ("teammate_id") REFERENCES "public"."teammates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cleaning_rules" ADD CONSTRAINT "cleaning_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cleaning_rules" ADD CONSTRAINT "cleaning_rules_checklist_id_cleaning_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."cleaning_checklists"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "teammates" ADD CONSTRAINT "teammates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cleaning_checklist_items_checklist_idx" ON "cleaning_checklist_items" USING btree ("checklist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cleaning_checklist_items_tenant_idx" ON "cleaning_checklist_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cleaning_checklists_tenant_idx" ON "cleaning_checklists" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cleaning_messages_booking_idx" ON "cleaning_messages" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cleaning_messages_scheduled_idx" ON "cleaning_messages" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cleaning_messages_tenant_idx" ON "cleaning_messages" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cleaning_messages_external_idx" ON "cleaning_messages" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cleaning_messages_rule_booking_teammate_uq" ON "cleaning_messages" USING btree ("rule_id","booking_id","teammate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crl_property_idx" ON "cleaning_rule_listings" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crt_teammate_idx" ON "cleaning_rule_teammates" USING btree ("teammate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cleaning_rules_tenant_idx" ON "cleaning_rules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teammates_tenant_idx" ON "teammates" USING btree ("tenant_id");