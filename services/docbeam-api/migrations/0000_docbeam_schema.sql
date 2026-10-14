CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"job_id" uuid,
	"task_id" uuid,
	"team_id" uuid,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"job_id" uuid,
	"original_name" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"content_type" text NOT NULL,
	"checksum_sha256" text NOT NULL,
	"s3_key" text NOT NULL,
	"multipart_upload_id" text,
	"s3_checksum" text,
	"uploaded_at" timestamp with time zone,
	"scan_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_scan_status_check" CHECK ("files"."scan_status" IN ('pending','clean','infected','failed'))
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"submitted_by_name" text NOT NULL,
	"task_count" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fanned_out_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"first_completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"binder_id" uuid NOT NULL,
	"folder_id" uuid,
	"destination_path" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"failure_code" text,
	"failure_reason" text,
	"last_error" text,
	"platform_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_status_check" CHECK ("tasks"."status" IN ('pending','in_progress','completed','failed'))
);
--> statement-breakpoint
CREATE TABLE "ws_connections" (
	"connection_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid,
	"team_ids" uuid[] DEFAULT '{}' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_job" ON "audit_events" USING btree ("job_id","occurred_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_audit_time" ON "audit_events" USING btree ("occurred_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_files_owner" ON "files" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_files_unsubmitted" ON "files" USING btree ("created_at") WHERE "files"."job_id" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_jobs_user" ON "jobs" USING btree ("submitted_by_user_id","created_at" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_jobs_idem" ON "jobs" USING btree ("submitted_by_user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_jobs_unstarted" ON "jobs" USING btree ("queued_at") WHERE "jobs"."fanned_out_at" IS NULL AND "jobs"."completed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tasks_dest" ON "tasks" USING btree ("file_id","binder_id","folder_id") WHERE "tasks"."folder_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tasks_dest_root" ON "tasks" USING btree ("file_id","binder_id") WHERE "tasks"."folder_id" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_tasks_job_status" ON "tasks" USING btree ("job_id","status");--> statement-breakpoint
CREATE INDEX "idx_tasks_team" ON "tasks" USING btree ("team_id","job_id");--> statement-breakpoint
CREATE INDEX "idx_ws_job" ON "ws_connections" USING btree ("job_id");