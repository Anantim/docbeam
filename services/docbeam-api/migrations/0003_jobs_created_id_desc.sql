DROP INDEX "idx_jobs_created";--> statement-breakpoint
CREATE INDEX "idx_jobs_created" ON "jobs" USING btree ("created_at" DESC,"id" DESC);