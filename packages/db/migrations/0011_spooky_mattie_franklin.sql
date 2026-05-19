CREATE TABLE IF NOT EXISTS "message_variable_values" (
	"variable_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_variable_values_variable_id_property_id_pk" PRIMARY KEY("variable_id","property_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_variables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_variable_values" ADD CONSTRAINT "message_variable_values_variable_id_message_variables_id_fk" FOREIGN KEY ("variable_id") REFERENCES "public"."message_variables"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_variable_values" ADD CONSTRAINT "message_variable_values_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message_variables" ADD CONSTRAINT "message_variables_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mvv_property_idx" ON "message_variable_values" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_variables_tenant_idx" ON "message_variables" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_variables_tenant_key_uq" ON "message_variables" USING btree ("tenant_id","key");