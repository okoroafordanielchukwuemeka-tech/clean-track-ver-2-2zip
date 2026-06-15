CREATE TABLE "laundries" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_name" text NOT NULL,
	"owner_email" text NOT NULL,
	"password_hash" text NOT NULL,
	"phone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"subscription_tier" text DEFAULT 'free' NOT NULL,
	"subscription_status" text DEFAULT 'trial' NOT NULL,
	"trial_started_at" timestamp,
	"trial_ends_at" timestamp,
	"trial_duration_days" integer DEFAULT 14 NOT NULL,
	"converted_at" timestamp,
	"subscription_renews_at" timestamp,
	"standard_turnaround_hours" integer DEFAULT 72 NOT NULL,
	"express_turnaround_hours" integer DEFAULT 24 NOT NULL,
	"premium_turnaround_hours" integer DEFAULT 48 NOT NULL,
	"business_profile" jsonb DEFAULT '{}'::jsonb,
	"branding_settings" jsonb DEFAULT '{}'::jsonb,
	"operational_settings" jsonb DEFAULT '{}'::jsonb,
	"automation_settings" jsonb DEFAULT '{}'::jsonb,
	"dashboard_preferences" jsonb DEFAULT '{}'::jsonb,
	"discount_settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "laundries_owner_email_unique" UNIQUE("owner_email")
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by_id" integer,
	"deleted_by_type" text,
	"deleted_by_name" text
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"branch_id" integer,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"address" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by_id" integer,
	"deleted_by_type" text,
	"deleted_by_name" text
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer,
	"branch_id" integer,
	"customer_id" integer,
	"order_id" text NOT NULL,
	"customer_name" text NOT NULL,
	"phone" text NOT NULL,
	"address" text,
	"service_type" text DEFAULT 'standard' NOT NULL,
	"shirts" integer DEFAULT 0 NOT NULL,
	"trousers" integer DEFAULT 0 NOT NULL,
	"shirts_picked_up" integer DEFAULT 0 NOT NULL,
	"trousers_picked_up" integer DEFAULT 0 NOT NULL,
	"additional_notes" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"price" numeric(10, 2),
	"extra_charge" numeric(10, 2),
	"discount" numeric(10, 2),
	"amount_paid" numeric(10, 2) DEFAULT '0' NOT NULL,
	"verified_shirts" integer,
	"verified_trousers" integer,
	"is_verified" boolean DEFAULT false NOT NULL,
	"batch_id" integer,
	"assigned_worker_id" integer,
	"processing_due_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"service_id" integer,
	"service_type" text NOT NULL,
	"name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"quantity_picked_up" integer DEFAULT 0 NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"total_price" numeric(10, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"laundry_id" integer,
	"branch_id" integer,
	"receipt_number" text,
	"amount" numeric(10, 2) NOT NULL,
	"method" text DEFAULT 'cash' NOT NULL,
	"notes" text,
	"remaining_balance" numeric(10, 2) NOT NULL,
	"recorded_by" text,
	"worker_id" integer,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by_id" integer,
	"deleted_by_type" text,
	"deleted_by_name" text,
	"deletion_reason" text,
	CONSTRAINT "payment_records_receipt_number_unique" UNIQUE("receipt_number")
);
--> statement-breakpoint
CREATE TABLE "pickup_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer,
	"order_id" integer NOT NULL,
	"shirts_picked_up" integer DEFAULT 0 NOT NULL,
	"trousers_picked_up" integer DEFAULT 0 NOT NULL,
	"item_pickups" json,
	"notes" text,
	"processed_by" integer,
	"recorded_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"standard_price" numeric(10, 2) NOT NULL,
	"express_price" numeric(10, 2),
	"premium_price" numeric(10, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer,
	"batch_code" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"order_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "batches_batch_code_unique" UNIQUE("batch_code")
);
--> statement-breakpoint
CREATE TABLE "workers" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer,
	"branch_id" integer,
	"name" text NOT NULL,
	"phone" text,
	"role" text DEFAULT 'worker' NOT NULL,
	"pin" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by_id" integer,
	"deleted_by_type" text,
	"deleted_by_name" text
);
--> statement-breakpoint
CREATE TABLE "worker_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"worker_id" integer NOT NULL,
	"laundry_id" integer NOT NULL,
	"can_view_customers" boolean DEFAULT true NOT NULL,
	"can_create_customers" boolean DEFAULT false NOT NULL,
	"can_view_customer_balances" boolean DEFAULT false NOT NULL,
	"can_record_payments" boolean DEFAULT false NOT NULL,
	"can_record_pickups" boolean DEFAULT true NOT NULL,
	"can_view_orders" boolean DEFAULT true NOT NULL,
	"can_process_orders" boolean DEFAULT true NOT NULL,
	"can_assign_orders" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "worker_permissions_worker_id_unique" UNIQUE("worker_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"target_type" text DEFAULT 'owner' NOT NULL,
	"target_worker_id" integer,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"related_order_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenditures" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"category" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"notes" text,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"name" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"laundry_id" integer,
	"type" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"reason" text NOT NULL,
	"applied_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discount_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer,
	"order_id" integer NOT NULL,
	"requested_by" integer,
	"requested_by_name" text NOT NULL,
	"original_amount" numeric(10, 2) NOT NULL,
	"requested_discount" numeric(10, 2) NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer,
	"actor_id" integer,
	"actor_type" text NOT NULL,
	"actor_name" text NOT NULL,
	"action" text NOT NULL,
	"order_id" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"status_code" integer DEFAULT 0 NOT NULL,
	"response_body" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_number_counters" (
	"date_part" text PRIMARY KEY NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_heartbeats" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"branch_id" integer,
	"worker_id" integer,
	"actor_type" text DEFAULT 'worker' NOT NULL,
	"worker_name" text,
	"device_id" text NOT NULL,
	"pending_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"conflict_count" integer DEFAULT 0 NOT NULL,
	"recovery_count" integer DEFAULT 0 NOT NULL,
	"is_online" boolean DEFAULT true NOT NULL,
	"app_version" text,
	"last_synced_at" timestamp,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schema_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_type" text NOT NULL,
	"triggered_by" text,
	"table_count" integer,
	"index_count" integer,
	"db_size_bytes" bigint,
	"table_list" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer,
	"branch_id" integer,
	"device_id" text,
	"severity" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"fingerprint" text,
	"acknowledged_by" text,
	"acknowledged_at" timestamp,
	"resolved_by" text,
	"resolved_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"branch_id" integer,
	"event_trigger" text NOT NULL,
	"channel" text NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"branch_id" integer,
	"event_type" text NOT NULL,
	"order_id" integer,
	"customer_id" integer,
	"customer_phone" text,
	"customer_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"skip_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"event_id" integer,
	"template_id" integer,
	"channel" text NOT NULL,
	"recipient_phone" text NOT NULL,
	"recipient_name" text,
	"rendered_body" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"queued_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"read_at" timestamp,
	"failed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"laundry_id" integer NOT NULL,
	"direction" text NOT NULL,
	"body" text NOT NULL,
	"status" text,
	"provider_message_id" text,
	"sender_type" text,
	"sender_id" integer,
	"sender_name" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"worker_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"branch_id" integer,
	"customer_id" integer,
	"channel" text NOT NULL,
	"customer_phone" text NOT NULL,
	"customer_name" text,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_worker_id" integer,
	"last_message_at" timestamp,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"provider" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"last_tested_at" timestamp,
	"last_test_result" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"laundry_id" integer NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"from_plan" text,
	"to_plan" text,
	"reason" text,
	"changed_by" text DEFAULT 'system' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_assigned_worker_id_workers_id_fk" FOREIGN KEY ("assigned_worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_records" ADD CONSTRAINT "pickup_records_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_records" ADD CONSTRAINT "pickup_records_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_records" ADD CONSTRAINT "pickup_records_processed_by_workers_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_permissions" ADD CONSTRAINT "worker_permissions_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_permissions" ADD CONSTRAINT "worker_permissions_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenditures" ADD CONSTRAINT "expenditures_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_adjustments" ADD CONSTRAINT "price_adjustments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_adjustments" ADD CONSTRAINT "price_adjustments_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_approvals" ADD CONSTRAINT "discount_approvals_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_approvals" ADD CONSTRAINT "discount_approvals_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_approvals" ADD CONSTRAINT "discount_approvals_requested_by_workers_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_heartbeats" ADD CONSTRAINT "device_heartbeats_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_heartbeats" ADD CONSTRAINT "device_heartbeats_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_heartbeats" ADD CONSTRAINT "device_heartbeats_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_messages" ADD CONSTRAINT "notification_messages_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_messages" ADD CONSTRAINT "notification_messages_event_id_notification_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."notification_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_messages" ADD CONSTRAINT "notification_messages_template_id_notification_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."notification_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_worker_id_workers_id_fk" FOREIGN KEY ("assigned_worker_id") REFERENCES "public"."workers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_configs" ADD CONSTRAINT "provider_configs_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_logs" ADD CONSTRAINT "subscription_logs_laundry_id_laundries_id_fk" FOREIGN KEY ("laundry_id") REFERENCES "public"."laundries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_laundry_id_idx" ON "customers" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "customers_branch_id_idx" ON "customers" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "customers_deleted_at_idx" ON "customers" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "orders_laundry_id_idx" ON "orders" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "orders_branch_id_idx" ON "orders" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "orders_customer_id_idx" ON "orders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_payment_status_idx" ON "orders" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "orders_laundry_status_idx" ON "orders" USING btree ("laundry_id","status");--> statement-breakpoint
CREATE INDEX "orders_laundry_branch_idx" ON "orders" USING btree ("laundry_id","branch_id");--> statement-breakpoint
CREATE INDEX "orders_processing_due_idx" ON "orders" USING btree ("processing_due_at");--> statement-breakpoint
CREATE INDEX "payment_records_order_id_idx" ON "payment_records" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payment_records_laundry_id_idx" ON "payment_records" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "payment_records_recorded_at_idx" ON "payment_records" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "payment_records_deleted_at_idx" ON "payment_records" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "pickup_records_order_id_idx" ON "pickup_records" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "pickup_records_laundry_id_idx" ON "pickup_records" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "workers_laundry_id_idx" ON "workers" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "workers_branch_id_idx" ON "workers" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "workers_phone_idx" ON "workers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "workers_deleted_at_idx" ON "workers" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "expenditures_laundry_id_idx" ON "expenditures" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "expenditures_created_at_idx" ON "expenditures" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_laundry_id_idx" ON "audit_log" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_log_order_id_idx" ON "audit_log" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_at_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "device_heartbeats_laundry_device_uniq" ON "device_heartbeats" USING btree ("laundry_id","device_id");--> statement-breakpoint
CREATE INDEX "alerts_laundry_id_idx" ON "alerts" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "alerts_status_idx" ON "alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "alerts_severity_idx" ON "alerts" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "alerts_category_idx" ON "alerts" USING btree ("category");--> statement-breakpoint
CREATE INDEX "alerts_created_at_idx" ON "alerts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "alerts_fingerprint_idx" ON "alerts" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "notif_templates_laundry_idx" ON "notification_templates" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "notif_templates_trigger_idx" ON "notification_templates" USING btree ("event_trigger");--> statement-breakpoint
CREATE INDEX "notif_templates_channel_idx" ON "notification_templates" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "notif_templates_active_idx" ON "notification_templates" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "notif_events_laundry_idx" ON "notification_events" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "notif_events_event_type_idx" ON "notification_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "notif_events_order_id_idx" ON "notification_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "notif_events_customer_id_idx" ON "notification_events" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "notif_events_status_idx" ON "notification_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notif_events_created_at_idx" ON "notification_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notif_messages_laundry_idx" ON "notification_messages" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "notif_messages_event_id_idx" ON "notification_messages" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "notif_messages_template_id_idx" ON "notification_messages" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "notif_messages_status_idx" ON "notification_messages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notif_messages_channel_idx" ON "notification_messages" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "notif_messages_recipient_idx" ON "notification_messages" USING btree ("recipient_phone");--> statement-breakpoint
CREATE INDEX "notif_messages_queued_at_idx" ON "notification_messages" USING btree ("queued_at");--> statement-breakpoint
CREATE INDEX "notif_messages_provider_msg_id_idx" ON "notification_messages" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "conv_messages_conversation_idx" ON "conversation_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conv_messages_laundry_idx" ON "conversation_messages" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "conv_messages_created_at_idx" ON "conversation_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "conv_messages_direction_idx" ON "conversation_messages" USING btree ("direction");--> statement-breakpoint
CREATE INDEX "conv_participants_conv_idx" ON "conversation_participants" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conv_participants_worker_idx" ON "conversation_participants" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX "conversations_laundry_idx" ON "conversations" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "conversations_customer_id_idx" ON "conversations" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "conversations_phone_idx" ON "conversations" USING btree ("customer_phone");--> statement-breakpoint
CREATE INDEX "conversations_status_idx" ON "conversations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "conversations_assigned_idx" ON "conversations" USING btree ("assigned_worker_id");--> statement-breakpoint
CREATE INDEX "conversations_last_msg_idx" ON "conversations" USING btree ("last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_configs_laundry_provider_uidx" ON "provider_configs" USING btree ("laundry_id","provider");--> statement-breakpoint
CREATE INDEX "provider_configs_laundry_idx" ON "provider_configs" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "sub_logs_laundry_id_idx" ON "subscription_logs" USING btree ("laundry_id");--> statement-breakpoint
CREATE INDEX "sub_logs_created_at_idx" ON "subscription_logs" USING btree ("created_at");