CREATE TABLE "weekly_report_reminders" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"week_end" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_report_reminders_guild_id_user_id_week_end_pk" PRIMARY KEY("guild_id","user_id","week_end")
);
--> statement-breakpoint
ALTER TABLE "scrum_requests" ADD COLUMN "project_score_document_id" text;--> statement-breakpoint
ALTER TABLE "scrum_requests" ADD COLUMN "project_score_document_name" text;--> statement-breakpoint
ALTER TABLE "scrum_requests" ADD COLUMN "project_score_document_url" text;--> statement-breakpoint
ALTER TABLE "scrum_requests" ADD COLUMN "project_score_document_content_type" text;--> statement-breakpoint
ALTER TABLE "scrum_requests" ADD COLUMN "project_score_document_size" integer;--> statement-breakpoint
ALTER TABLE "scrums" ADD COLUMN "project_score_document_id" text;--> statement-breakpoint
ALTER TABLE "scrums" ADD COLUMN "project_score_document_name" text;--> statement-breakpoint
ALTER TABLE "scrums" ADD COLUMN "project_score_document_url" text;--> statement-breakpoint
ALTER TABLE "scrums" ADD COLUMN "project_score_document_content_type" text;--> statement-breakpoint
ALTER TABLE "scrums" ADD COLUMN "project_score_document_size" integer;--> statement-breakpoint
CREATE INDEX "weekly_report_reminders_guild_week_idx" ON "weekly_report_reminders" USING btree ("guild_id","week_end");--> statement-breakpoint
ALTER TABLE "scrum_requests" ADD CONSTRAINT "scrum_requests_project_score_document_size_check" CHECK ("scrum_requests"."project_score_document_size" IS NULL OR "scrum_requests"."project_score_document_size" >= 0);--> statement-breakpoint
ALTER TABLE "scrums" ADD CONSTRAINT "scrums_project_score_document_size_check" CHECK ("scrums"."project_score_document_size" IS NULL OR "scrums"."project_score_document_size" >= 0);