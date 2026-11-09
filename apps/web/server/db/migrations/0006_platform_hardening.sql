ALTER TABLE "webhook_endpoints" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN "last_failure_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "api_logs_api_key_idx" ON "api_logs" USING btree ("api_key_id") WHERE "api_logs"."api_key_id" is not null;--> statement-breakpoint
CREATE INDEX "contact_topics_topic_idx" ON "contact_topics" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "list_subscriptions_list_confirmed_idx" ON "list_subscriptions" USING btree ("list_id","confirmed_at");--> statement-breakpoint
CREATE INDEX "list_subscriptions_list_unsubscribed_idx" ON "list_subscriptions" USING btree ("list_id","unsubscribed_at");--> statement-breakpoint
CREATE INDEX "messages_template_idx" ON "messages" USING btree ("template_id") WHERE "messages"."template_id" is not null;--> statement-breakpoint
CREATE INDEX "messages_topic_idx" ON "messages" USING btree ("topic_id") WHERE "messages"."topic_id" is not null;--> statement-breakpoint
CREATE INDEX "messages_to_email_trgm_idx" ON "messages" USING gin ("to_email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "messages_subject_trgm_idx" ON "messages" USING gin ("subject" gin_trgm_ops);