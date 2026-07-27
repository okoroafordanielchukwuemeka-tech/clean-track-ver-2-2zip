CREATE TABLE "service_branches" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_branches_service_id_branch_id_unique" UNIQUE("service_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "error_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer,
	"request_id" text,
	"severity" text DEFAULT 'error' NOT NULL,
	"message" text NOT NULL,
	"endpoint" text,
	"method" text,
	"status_code" integer,
	"stack" text,
	"context" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activation_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"event_name" varchar(60) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activation_events_laundry_event_uniq" UNIQUE("laundry_id","event_name")
);
--> statement-breakpoint
CREATE TABLE "nudge_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"owner_email" varchar(255) NOT NULL,
	"business_name" varchar(255) NOT NULL,
	"stuck_stage" varchar(100) NOT NULL,
	"nudge_type" varchar(20) NOT NULL,
	"tracking_token" varchar(64) NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"activated_after" boolean DEFAULT false NOT NULL,
	CONSTRAINT "nudge_log_uniq" UNIQUE("laundry_id","stuck_stage","nudge_type")
);
--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_id" integer NOT NULL,
	"admin_name" text NOT NULL,
	"admin_email" text NOT NULL,
	"action" text NOT NULL,
	"target_laundry_id" integer,
	"target_laundry_name" text,
	"metadata" jsonb,
	"ip_address" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"whatsapp_business_account_id" text NOT NULL,
	"phone_number_id" text NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"display_phone_number" text,
	"business_name" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"disconnected_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_activity_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"conversation_id" integer,
	"actor_type" text NOT NULL,
	"actor_id" integer,
	"actor_name" text NOT NULL,
	"action" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"name" text NOT NULL,
	"trigger_event" text NOT NULL,
	"message_template" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "automation_rules_laundry_trigger_uniq" UNIQUE("laundry_id","trigger_event")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"tier" text NOT NULL,
	"display_name" text NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"monthly_price_ngn" integer DEFAULT 0 NOT NULL,
	"annual_price_ngn" integer DEFAULT 0 NOT NULL,
	"max_branches" integer,
	"max_workers" integer,
	"max_orders_per_month" integer,
	"max_customers" integer,
	"max_storage_mb" integer,
	"max_whatsapp_messages_per_month" integer,
	"max_ai_credits_per_month" integer,
	"features" jsonb DEFAULT '{}'::jsonb,
	"marketing_features" jsonb DEFAULT '[]'::jsonb,
	"is_highlighted" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plans_tier_unique" UNIQUE("tier")
);
--> statement-breakpoint
CREATE TABLE "lifecycle_email_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"email_type" text NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"to_email" text NOT NULL,
	"meta" text,
	CONSTRAINT "lifecycle_email_log_laundry_type_unique" UNIQUE("laundry_id","email_type")
);
--> statement-breakpoint
CREATE TABLE "subscription_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"amount_ngn" integer NOT NULL,
	"plan" text NOT NULL,
	"billing_period" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"payment_method" text DEFAULT 'bank_transfer' NOT NULL,
	"reference" text,
	"recorded_by" text,
	"notes" text,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"customer_id" integer,
	"customer_name" text NOT NULL,
	"phone" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"failed_at" timestamp,
	"error_message" text,
	"retries" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"branch_id" integer,
	"name" text NOT NULL,
	"type" text DEFAULT 'promotion' NOT NULL,
	"audience_type" text DEFAULT 'all' NOT NULL,
	"audience_filter" text,
	"message_title" text,
	"message_body" text NOT NULL,
	"schedule_type" text DEFAULT 'now' NOT NULL,
	"scheduled_at" timestamp,
	"timezone" text DEFAULT 'Africa/Lagos',
	"status" text DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp,
	"completed_at" timestamp,
	"total_recipients" integer DEFAULT 0 NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"cancelled" integer DEFAULT 0 NOT NULL,
	"created_by_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_type" text NOT NULL,
	"event_key" text NOT NULL,
	"laundry_id" integer,
	"reference" text,
	"status" text DEFAULT 'received' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"error" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	CONSTRAINT "webhook_events_provider_key_unique" UNIQUE("provider","event_key")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_number" text NOT NULL,
	"laundry_id" integer NOT NULL,
	"subscription_payment_id" integer,
	"type" text NOT NULL,
	"business_name" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"plan" text NOT NULL,
	"plan_display_name" text NOT NULL,
	"billing_period" text,
	"subtotal_ngn" integer NOT NULL,
	"tax_ngn" integer DEFAULT 0 NOT NULL,
	"total_ngn" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payment_method" text DEFAULT 'paystack' NOT NULL,
	"transaction_reference" text,
	"issue_date" timestamp DEFAULT now() NOT NULL,
	"due_date" timestamp NOT NULL,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "payment_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"provider" text DEFAULT 'paystack' NOT NULL,
	"customer_code" text,
	"authorization_code" text,
	"card_last4" text,
	"card_bank" text,
	"card_type" text,
	"reusable" boolean DEFAULT false NOT NULL,
	"plan" text NOT NULL,
	"billing_period" text DEFAULT 'monthly' NOT NULL,
	"amount_ngn" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"next_charge_at" timestamp,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_charge_at" timestamp,
	"last_charge_status" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "payment_subscriptions_laundry_id_unique" UNIQUE("laundry_id")
);
--> statement-breakpoint
ALTER TABLE "laundries" ADD COLUMN "failed_login_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "laundries" ADD COLUMN "locked_until" timestamp;--> statement-breakpoint
ALTER TABLE "laundries" ADD COLUMN "password_changed_at" timestamp;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "tags" text;--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "attachment_url" text;--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "provider" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "provider_transaction_id" text;--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "provider_reference" text;--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "reconciliation_status" text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "confidence_score" text;--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "confidence_reasons" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "refund_amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "refund_reason" text;--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "refund_reference" text;--> statement-breakpoint
ALTER TABLE "payment_records" ADD COLUMN "refunded_at" timestamp;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "display_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "thumbnail_url" text;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "failed_pin_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "pin_locked_until" timestamp;--> statement-breakpoint
ALTER TABLE "workers" ADD COLUMN "pin_changed_at" timestamp;--> statement-breakpoint
ALTER TABLE "worker_permissions" ADD COLUMN "can_view_whatsapp" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "worker_permissions" ADD COLUMN "can_reply_whatsapp" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "worker_permissions" ADD COLUMN "can_manage_whatsapp" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "related_conversation_id" integer;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD COLUMN "role" text DEFAULT 'super_admin' NOT NULL;--> statement-breakpoint
ALTER TABLE "service_branches" ADD CONSTRAINT "service_branches_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_branches" ADD CONSTRAINT "service_branches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_events" ADD CONSTRAINT "activation_events_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nudge_log" ADD CONSTRAINT "nudge_log_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_activity_logs" ADD CONSTRAINT "whatsapp_activity_logs_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_activity_logs" ADD CONSTRAINT "whatsapp_activity_logs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lifecycle_email_log" ADD CONSTRAINT "lifecycle_email_log_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_payment_id_subscription_payments_id_fk" FOREIGN KEY ("subscription_payment_id") REFERENCES "public"."subscription_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_subscriptions" ADD CONSTRAINT "payment_subscriptions_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_branches_service_id_idx" ON "service_branches" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "service_branches_branch_id_idx" ON "service_branches" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "prt_laundry_id_idx" ON "password_reset_tokens" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "prt_token_hash_idx" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "prt_expires_at_idx" ON "password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "error_log_laundry_id_idx" ON "error_log" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "error_log_severity_idx" ON "error_log" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "error_log_created_at_idx" ON "error_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "activation_events_laundry_id_idx" ON "activation_events" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "activation_events_event_name_idx" ON "activation_events" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "activation_events_created_at_idx" ON "activation_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "nudge_log_laundry_id_idx" ON "nudge_log" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "nudge_log_sent_at_idx" ON "nudge_log" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "nudge_log_tracking_token_idx" ON "nudge_log" USING btree ("tracking_token");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_connections_laundry_uidx" ON "whatsapp_connections" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "wa_connections_laundry_idx" ON "whatsapp_connections" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "wa_activity_laundry_idx" ON "whatsapp_activity_logs" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "wa_activity_conv_idx" ON "whatsapp_activity_logs" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "wa_activity_actor_idx" ON "whatsapp_activity_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "wa_activity_created_at_idx" ON "whatsapp_activity_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "automation_rules_laundry_idx" ON "automation_rules" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "camp_recipients_campaign_idx" ON "campaign_recipients" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "camp_recipients_status_idx" ON "campaign_recipients" USING btree ("status");--> statement-breakpoint
CREATE INDEX "camp_recipients_phone_idx" ON "campaign_recipients" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "campaigns_laundry_id_idx" ON "campaigns" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "campaigns_scheduled_at_idx" ON "campaigns" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "campaigns_laundry_status_idx" ON "campaigns" USING btree ("laundry_id","status");--> statement-breakpoint
CREATE INDEX "webhook_events_laundry_id_idx" ON "webhook_events" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "webhook_events_received_at_idx" ON "webhook_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "invoices_laundry_id_idx" ON "invoices" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoices_issue_date_idx" ON "invoices" USING btree ("issue_date");--> statement-breakpoint
CREATE INDEX "payment_subscriptions_status_idx" ON "payment_subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_subscriptions_next_charge_idx" ON "payment_subscriptions" USING btree ("next_charge_at");--> statement-breakpoint
CREATE INDEX "payment_records_reference_idx" ON "payment_records" USING btree ("reference");