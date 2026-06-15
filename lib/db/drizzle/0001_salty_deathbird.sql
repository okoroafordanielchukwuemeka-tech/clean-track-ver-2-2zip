CREATE TABLE "message_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"template_name" text NOT NULL,
	"recipient_phone" text NOT NULL,
	"recipient_name" text,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rendered_body" text NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"last_attempt_at" timestamp,
	"next_retry_at" timestamp,
	"last_error" text,
	"provider_message_id" text,
	"notification_event_id" integer,
	"notification_message_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_queue" ADD CONSTRAINT "message_queue_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_queue" ADD CONSTRAINT "message_queue_notification_event_id_notification_events_id_fk" FOREIGN KEY ("notification_event_id") REFERENCES "public"."notification_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "msg_queue_laundry_idx" ON "message_queue" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "msg_queue_status_idx" ON "message_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "msg_queue_next_retry_idx" ON "message_queue" USING btree ("next_retry_at");--> statement-breakpoint
CREATE INDEX "msg_queue_laundry_status_idx" ON "message_queue" USING btree ("laundry_id","status");--> statement-breakpoint
CREATE INDEX "msg_queue_created_at_idx" ON "message_queue" USING btree ("created_at");