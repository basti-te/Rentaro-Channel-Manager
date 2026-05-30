ALTER TABLE "tenants" ADD COLUMN "notify_email" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "notify_new_booking" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "notify_cancellation" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "notify_modification" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "notify_sync_error" boolean DEFAULT true NOT NULL;