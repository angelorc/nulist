DROP INDEX "list_subscriptions_status_idx";--> statement-breakpoint
CREATE INDEX "list_subscriptions_list_created_idx" ON "list_subscriptions" USING btree ("list_id","created_at","contact_id");--> statement-breakpoint
CREATE INDEX "list_subscriptions_status_idx" ON "list_subscriptions" USING btree ("list_id","status","created_at","contact_id");