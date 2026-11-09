CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."import_subscription" AS ENUM('confirmed', 'send_opt_in');--> statement-breakpoint
ALTER TABLE "imports" ADD COLUMN "subscription" "import_subscription" DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
UPDATE "imports" SET "subscription" = 'send_opt_in' WHERE "mapping"->>'$mlist:subscription' = 'send_opt_in';--> statement-breakpoint
UPDATE "imports" SET "mapping" = "mapping" - '$mlist:subscription' WHERE "mapping" ? '$mlist:subscription';--> statement-breakpoint
CREATE INDEX "contacts_search_trgm_idx" ON "contacts" USING gin ((email || ' ' || coalesce(first_name, '') || ' ' || coalesce(last_name, '')) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "email_events_contact_time_idx" ON "email_events" USING btree ("contact_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "email_events_contact_type_idx" ON "email_events" USING btree ("contact_id","type","occurred_at");