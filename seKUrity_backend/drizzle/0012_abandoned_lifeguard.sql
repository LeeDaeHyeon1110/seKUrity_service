CREATE TABLE "weekly_miss_count_resets" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"count_after" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
