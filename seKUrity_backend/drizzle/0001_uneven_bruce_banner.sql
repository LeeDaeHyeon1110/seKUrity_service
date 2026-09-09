CREATE TABLE "guild_approver_roles" (
	"guild_id" text NOT NULL,
	"role_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_approver_roles_guild_id_role_id_pk" PRIMARY KEY("guild_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "scrum_request_todos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"content" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "scrum_request_todos_position_check" CHECK ("scrum_request_todos"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "scrum_request_weekly_deliverable_formats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"week_number" integer NOT NULL,
	"format" text NOT NULL,
	CONSTRAINT "scrum_request_weekly_formats_week_check" CHECK ("scrum_request_weekly_deliverable_formats"."week_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "scrum_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"approval_channel_id" text NOT NULL,
	"approval_thread_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"project_name" text NOT NULL,
	"overview" text NOT NULL,
	"category" text NOT NULL,
	"duration_weeks" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"scrum_id" uuid,
	"reviewed_by" text,
	"rejection_reason" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scrum_requests_category_check" CHECK ("scrum_requests"."category" IN ('project', 'study', 'personal')),
	CONSTRAINT "scrum_requests_duration_weeks_check" CHECK ("scrum_requests"."duration_weeks" BETWEEN 1 AND 52),
	CONSTRAINT "scrum_requests_status_check" CHECK ("scrum_requests"."status" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "scrum_requests_review_state_check" CHECK (
        (
          "scrum_requests"."status" = 'pending'
          AND "scrum_requests"."scrum_id" IS NULL
          AND "scrum_requests"."reviewed_by" IS NULL
          AND "scrum_requests"."rejection_reason" IS NULL
          AND "scrum_requests"."reviewed_at" IS NULL
        )
        OR (
          "scrum_requests"."status" = 'approved'
          AND "scrum_requests"."scrum_id" IS NOT NULL
          AND "scrum_requests"."reviewed_by" IS NOT NULL
          AND "scrum_requests"."rejection_reason" IS NULL
          AND "scrum_requests"."reviewed_at" IS NOT NULL
        )
        OR (
          "scrum_requests"."status" = 'rejected'
          AND "scrum_requests"."scrum_id" IS NULL
          AND "scrum_requests"."reviewed_by" IS NOT NULL
          AND "scrum_requests"."rejection_reason" IS NOT NULL
          AND "scrum_requests"."reviewed_at" IS NOT NULL
        )
      )
);
--> statement-breakpoint
CREATE TABLE "scrum_weekly_deliverable_formats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scrum_id" uuid NOT NULL,
	"week_number" integer NOT NULL,
	"format" text NOT NULL,
	CONSTRAINT "scrum_weekly_formats_week_check" CHECK ("scrum_weekly_deliverable_formats"."week_number" >= 1)
);
--> statement-breakpoint
ALTER TABLE "guild_channel_settings" DROP CONSTRAINT "guild_channel_settings_type_check";--> statement-breakpoint
ALTER TABLE "scrums" ADD COLUMN "category" text DEFAULT 'project' NOT NULL;--> statement-breakpoint
ALTER TABLE "scrum_request_todos" ADD CONSTRAINT "scrum_request_todos_request_id_scrum_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."scrum_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrum_request_weekly_deliverable_formats" ADD CONSTRAINT "scrum_request_weekly_deliverable_formats_request_id_scrum_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."scrum_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrum_requests" ADD CONSTRAINT "scrum_requests_scrum_id_scrums_id_fk" FOREIGN KEY ("scrum_id") REFERENCES "public"."scrums"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrum_weekly_deliverable_formats" ADD CONSTRAINT "scrum_weekly_deliverable_formats_scrum_id_scrums_id_fk" FOREIGN KEY ("scrum_id") REFERENCES "public"."scrums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scrum_request_todos_position_unique" ON "scrum_request_todos" USING btree ("request_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "scrum_request_weekly_formats_week_unique" ON "scrum_request_weekly_deliverable_formats" USING btree ("request_id","week_number");--> statement-breakpoint
CREATE UNIQUE INDEX "scrum_requests_approval_thread_unique" ON "scrum_requests" USING btree ("approval_thread_id");--> statement-breakpoint
CREATE INDEX "scrum_requests_guild_status_idx" ON "scrum_requests" USING btree ("guild_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "scrum_weekly_formats_week_unique" ON "scrum_weekly_deliverable_formats" USING btree ("scrum_id","week_number");--> statement-breakpoint
ALTER TABLE "guild_channel_settings" ADD CONSTRAINT "guild_channel_settings_type_check" CHECK ("guild_channel_settings"."type" IN ('logs', 'scrums', 'approve'));--> statement-breakpoint
ALTER TABLE "scrums" ADD CONSTRAINT "scrums_category_check" CHECK ("scrums"."category" IN ('project', 'study', 'personal'));