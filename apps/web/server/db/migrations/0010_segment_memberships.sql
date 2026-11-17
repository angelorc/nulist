CREATE TABLE "segment_memberships" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"contact_id" uuid,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exited_at" timestamp with time zone,
	"baseline" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "segments" ADD COLUMN "membership_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "segments" ADD COLUMN "member_count" integer;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "schedule_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN "drain_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN "drain_lease_owner" uuid;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN "drain_sleep_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "segment_memberships" ADD CONSTRAINT "segment_memberships_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_memberships" ADD CONSTRAINT "segment_memberships_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_memberships" ADD CONSTRAINT "segment_memberships_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "segment_memberships_open_uq" ON "segment_memberships" USING btree ("segment_id","contact_id") WHERE "segment_memberships"."exited_at" is null;--> statement-breakpoint
CREATE INDEX "segment_memberships_entered_idx" ON "segment_memberships" USING btree ("segment_id","entered_at");--> statement-breakpoint
CREATE INDEX "segment_memberships_exited_idx" ON "segment_memberships" USING btree ("segment_id","exited_at");--> statement-breakpoint
CREATE INDEX "segment_memberships_contact_idx" ON "segment_memberships" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("endpoint_id","next_attempt_at") WHERE "webhook_deliveries"."status" = 'pending';