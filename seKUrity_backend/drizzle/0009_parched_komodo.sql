CREATE TABLE "weekly_report_misses" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"week_end" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_report_misses_guild_id_user_id_week_end_pk" PRIMARY KEY("guild_id","user_id","week_end")
);
--> statement-breakpoint
ALTER TABLE "weekly_report_threads" ADD COLUMN "missed_report_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "weekly_report_misses_guild_week_idx" ON "weekly_report_misses" USING btree ("guild_id","week_end");