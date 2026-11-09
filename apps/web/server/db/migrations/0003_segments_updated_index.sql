DROP INDEX "segments_org_created_idx";--> statement-breakpoint
CREATE INDEX "segments_org_updated_idx" ON "segments" USING btree ("organization_id","updated_at");