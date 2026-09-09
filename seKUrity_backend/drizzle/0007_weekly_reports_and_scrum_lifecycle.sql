CREATE TABLE "guild_weekly_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"role_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_report_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"content_type" text,
	"size" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "weekly_report_attachments_size_check" CHECK ("weekly_report_attachments"."size" >= 0),
	CONSTRAINT "weekly_report_attachments_position_check" CHECK ("weekly_report_attachments"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "weekly_report_deletions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"week_end" date NOT NULL,
	"deleted_by" text NOT NULL,
	"reason" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_report_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "weekly_report_items_kind_check" CHECK ("weekly_report_items"."kind" IN ('completed', 'extra', 'next', 'pending')),
	CONSTRAINT "weekly_report_items_position_check" CHECK ("weekly_report_items"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "weekly_report_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"url" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "weekly_report_links_position_check" CHECK ("weekly_report_links"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "weekly_report_threads" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_report_threads_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "weekly_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"week_start" date NOT NULL,
	"week_end" date NOT NULL,
	"discord_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guild_channel_settings" DROP CONSTRAINT "guild_channel_settings_type_check";--> statement-breakpoint
ALTER TABLE "scrums" DROP CONSTRAINT "scrums_status_check";--> statement-breakpoint
ALTER TABLE "scrum_entries" ADD COLUMN "discord_message_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "scrums" ADD COLUMN "abandoned_by" text;--> statement-breakpoint
ALTER TABLE "scrums" ADD COLUMN "abandonment_reason" text;--> statement-breakpoint
ALTER TABLE "scrums" ADD COLUMN "abandoned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "weekly_report_attachments" ADD CONSTRAINT "weekly_report_attachments_item_id_weekly_report_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."weekly_report_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_report_items" ADD CONSTRAINT "weekly_report_items_report_id_weekly_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."weekly_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_report_links" ADD CONSTRAINT "weekly_report_links_item_id_weekly_report_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."weekly_report_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_report_attachments_position_unique" ON "weekly_report_attachments" USING btree ("item_id","position");--> statement-breakpoint
CREATE INDEX "weekly_report_deletions_guild_week_idx" ON "weekly_report_deletions" USING btree ("guild_id","week_end");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_report_items_position_unique" ON "weekly_report_items" USING btree ("report_id","position");--> statement-breakpoint
CREATE INDEX "weekly_report_items_report_kind_idx" ON "weekly_report_items" USING btree ("report_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_report_links_position_unique" ON "weekly_report_links" USING btree ("item_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_report_threads_thread_unique" ON "weekly_report_threads" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "weekly_report_threads_guild_channel_idx" ON "weekly_report_threads" USING btree ("guild_id","channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_reports_user_week_unique" ON "weekly_reports" USING btree ("guild_id","user_id","week_end");--> statement-breakpoint
CREATE INDEX "weekly_reports_thread_created_idx" ON "weekly_reports" USING btree ("thread_id","created_at");--> statement-breakpoint
ALTER TABLE "guild_channel_settings" ADD CONSTRAINT "guild_channel_settings_type_check" CHECK ("guild_channel_settings"."type" IN ('logs', 'scrums', 'approve', 'weekly'));--> statement-breakpoint
ALTER TABLE "scrums" ADD CONSTRAINT "scrums_status_check" CHECK ("scrums"."status" IN ('active', 'closed', 'abandoned'));