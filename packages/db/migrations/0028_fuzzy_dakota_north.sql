CREATE TABLE IF NOT EXISTS "guest_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"token" text NOT NULL,
	"issue_date" date NOT NULL,
	"service_date" date NOT NULL,
	"stay_from" date NOT NULL,
	"stay_to" date NOT NULL,
	"nights" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"apartment_name" text NOT NULL,
	"lodging_gross_cents" bigint NOT NULL,
	"lodging_net_cents" bigint NOT NULL,
	"lodging_vat_cents" bigint NOT NULL,
	"cleaning_gross_cents" bigint NOT NULL,
	"cleaning_net_cents" bigint NOT NULL,
	"cleaning_vat_cents" bigint NOT NULL,
	"city_tax_cents" bigint NOT NULL,
	"total_net_cents" bigint NOT NULL,
	"total_vat_cents" bigint NOT NULL,
	"total_gross_cents" bigint NOT NULL,
	"vat_rate_bp" integer NOT NULL,
	"city_tax_rate_bp" integer NOT NULL,
	"recipient_company" text,
	"recipient_name" text NOT NULL,
	"recipient_street" text NOT NULL,
	"recipient_zip" text NOT NULL,
	"recipient_city" text NOT NULL,
	"recipient_country" text DEFAULT 'Deutschland' NOT NULL,
	"recipient_vat_id" text,
	"recipient_email" text,
	"issuer_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_invoices_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "guest_invoices_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_invoice_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"issuer_name" text,
	"issuer_address" text,
	"sender_line" text,
	"logo_text" text,
	"contact_person" text,
	"tax_id" text,
	"tax_number" text,
	"vat_mode" text DEFAULT 'regular' NOT NULL,
	"vat_rate_bp" integer DEFAULT 700 NOT NULL,
	"city_tax_rate_bp" integer DEFAULT 500 NOT NULL,
	"lodging_label" text DEFAULT 'Übernachtung' NOT NULL,
	"city_tax_label" text DEFAULT 'Übernachtungssteuer' NOT NULL,
	"cleaning_label" text DEFAULT 'Endreinigung' NOT NULL,
	"number_prefix" text DEFAULT 'RE-' NOT NULL,
	"next_seq" integer DEFAULT 1 NOT NULL,
	"footer_contact" text,
	"footer_registry" text,
	"footer_bank" text,
	"closing_note" text DEFAULT 'Der Rechnungsbetrag wurde bereits bezahlt.
Vielen Dank.' NOT NULL,
	"public_slug" text,
	"lookup_require_code" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_invoice_settings_public_slug_unique" UNIQUE("public_slug")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "guest_invoices" ADD CONSTRAINT "guest_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "guest_invoices" ADD CONSTRAINT "guest_invoices_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_invoice_settings" ADD CONSTRAINT "tenant_invoice_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guest_invoices_tenant_idx" ON "guest_invoices" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "guest_invoices_number_idx" ON "guest_invoices" USING btree ("tenant_id","number");