CREATE TABLE IF NOT EXISTS "tenant_sms_countries" (
	"tenant_id" uuid NOT NULL,
	"country_code" text NOT NULL,
	CONSTRAINT "tenant_sms_countries_tenant_id_country_code_pk" PRIMARY KEY("tenant_id","country_code")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_sms_countries" ADD CONSTRAINT "tenant_sms_countries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
