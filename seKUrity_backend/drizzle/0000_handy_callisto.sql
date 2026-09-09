CREATE TABLE "guild_channel_settings" (
	"guild_id" text NOT NULL,
	"type" text NOT NULL,
	"channel_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guild_channel_settings_guild_id_type_pk" PRIMARY KEY("guild_id","type"),
	CONSTRAINT "guild_channel_settings_type_check" CHECK ("guild_channel_settings"."type" IN ('logs', 'scrums'))
);
--> statement-breakpoint
CREATE TABLE "scrum_current_todos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scrum_id" uuid NOT NULL,
	"content" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "scrum_current_todos_position_check" CHECK ("scrum_current_todos"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "scrum_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scrum_id" uuid NOT NULL,
	"author_id" text NOT NULL,
	"scrum_date" date NOT NULL,
	"next_scrum_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrum_entry_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"content_type" text,
	"size" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "scrum_entry_attachments_size_check" CHECK ("scrum_entry_attachments"."size" >= 0),
	CONSTRAINT "scrum_entry_attachments_position_check" CHECK ("scrum_entry_attachments"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "scrum_entry_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entry_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "scrum_entry_items_kind_check" CHECK ("scrum_entry_items"."kind" IN ('completed', 'extra')),
	CONSTRAINT "scrum_entry_items_position_check" CHECK ("scrum_entry_items"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "scrum_entry_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"url" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "scrum_entry_links_position_check" CHECK ("scrum_entry_links"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "scrum_entry_next_todos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entry_id" uuid NOT NULL,
	"content" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "scrum_entry_next_todos_position_check" CHECK ("scrum_entry_next_todos"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "scrum_members" (
	"scrum_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "scrum_members_scrum_id_user_id_pk" PRIMARY KEY("scrum_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "scrums" (
	"id" uuid PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"scrum_channel_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"project_name" text NOT NULL,
	"overview" text NOT NULL,
	"duration_weeks" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"next_scrum_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scrums_status_check" CHECK ("scrums"."status" IN ('active', 'closed')),
	CONSTRAINT "scrums_duration_weeks_check" CHECK ("scrums"."duration_weeks" BETWEEN 1 AND 52)
);
--> statement-breakpoint
ALTER TABLE "scrum_current_todos" ADD CONSTRAINT "scrum_current_todos_scrum_id_scrums_id_fk" FOREIGN KEY ("scrum_id") REFERENCES "public"."scrums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrum_entries" ADD CONSTRAINT "scrum_entries_scrum_id_scrums_id_fk" FOREIGN KEY ("scrum_id") REFERENCES "public"."scrums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrum_entry_attachments" ADD CONSTRAINT "scrum_entry_attachments_item_id_scrum_entry_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."scrum_entry_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrum_entry_items" ADD CONSTRAINT "scrum_entry_items_entry_id_scrum_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."scrum_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrum_entry_links" ADD CONSTRAINT "scrum_entry_links_item_id_scrum_entry_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."scrum_entry_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrum_entry_next_todos" ADD CONSTRAINT "scrum_entry_next_todos_entry_id_scrum_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."scrum_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrum_members" ADD CONSTRAINT "scrum_members_scrum_id_scrums_id_fk" FOREIGN KEY ("scrum_id") REFERENCES "public"."scrums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scrum_current_todos_position_unique" ON "scrum_current_todos" USING btree ("scrum_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "scrum_entries_scrum_date_unique" ON "scrum_entries" USING btree ("scrum_id","scrum_date");--> statement-breakpoint
CREATE INDEX "scrum_entries_scrum_created_idx" ON "scrum_entries" USING btree ("scrum_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scrum_entry_attachments_position_unique" ON "scrum_entry_attachments" USING btree ("item_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "scrum_entry_items_position_unique" ON "scrum_entry_items" USING btree ("entry_id","position");--> statement-breakpoint
CREATE INDEX "scrum_entry_items_entry_kind_idx" ON "scrum_entry_items" USING btree ("entry_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "scrum_entry_links_position_unique" ON "scrum_entry_links" USING btree ("item_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "scrum_entry_next_todos_position_unique" ON "scrum_entry_next_todos" USING btree ("entry_id","position");--> statement-breakpoint
CREATE INDEX "scrum_members_user_idx" ON "scrum_members" USING btree ("user_id","scrum_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scrums_thread_id_unique" ON "scrums" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "scrums_guild_status_idx" ON "scrums" USING btree ("guild_id","status");--> statement-breakpoint
CREATE INDEX "scrums_next_date_active_idx" ON "scrums" USING btree ("next_scrum_date") WHERE "scrums"."status" = 'active';