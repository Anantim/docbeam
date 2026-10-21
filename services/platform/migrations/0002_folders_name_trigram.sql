-- pg_trgm is a trusted extension: the database owner may create it, on RDS as well (D-F1-67).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "idx_folders_name_trgm" ON "folders" USING gin ("name" gin_trgm_ops);