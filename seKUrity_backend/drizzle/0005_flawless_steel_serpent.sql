ALTER TABLE "scrum_requests" DROP CONSTRAINT "scrum_requests_duration_weeks_check";--> statement-breakpoint
ALTER TABLE "scrums" DROP CONSTRAINT "scrums_duration_weeks_check";--> statement-breakpoint
ALTER TABLE "scrum_requests" ADD COLUMN "planning_document_id" text;--> statement-breakpoint
ALTER TABLE "scrum_requests" ADD COLUMN "planning_document_name" text;--> statement-breakpoint
ALTER TABLE "scrum_requests" ADD COLUMN "planning_document_url" text;--> statement-breakpoint
ALTER TABLE "scrum_requests" ADD COLUMN "planning_document_content_type" text;--> statement-breakpoint
ALTER TABLE "scrum_requests" ADD COLUMN "planning_document_size" integer;--> statement-breakpoint
ALTER TABLE "scrums" ADD COLUMN "planning_document_id" text;--> statement-breakpoint
ALTER TABLE "scrums" ADD COLUMN "planning_document_name" text;--> statement-breakpoint
ALTER TABLE "scrums" ADD COLUMN "planning_document_url" text;--> statement-breakpoint
ALTER TABLE "scrums" ADD COLUMN "planning_document_content_type" text;--> statement-breakpoint
ALTER TABLE "scrums" ADD COLUMN "planning_document_size" integer;--> statement-breakpoint
ALTER TABLE "scrum_requests" DROP COLUMN "duration_weeks";--> statement-breakpoint
ALTER TABLE "scrums" DROP COLUMN "duration_weeks";--> statement-breakpoint
ALTER TABLE "scrum_requests" ADD CONSTRAINT "scrum_requests_planning_document_size_check" CHECK ("scrum_requests"."planning_document_size" IS NULL OR "scrum_requests"."planning_document_size" >= 0);--> statement-breakpoint
ALTER TABLE "scrums" ADD CONSTRAINT "scrums_planning_document_size_check" CHECK ("scrums"."planning_document_size" IS NULL OR "scrums"."planning_document_size" >= 0);