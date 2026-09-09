ALTER TABLE "scrums" ADD COLUMN "completed_by" text;--> statement-breakpoint
ALTER TABLE "scrums" ADD COLUMN "completion_summary" text;--> statement-breakpoint
ALTER TABLE "scrums" ADD COLUMN "completed_at" timestamp with time zone;