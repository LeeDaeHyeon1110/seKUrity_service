CREATE TABLE "web_guild_memberships" (
	"user_id" uuid NOT NULL,
	"guild_id" text NOT NULL,
	"guild_nickname" text,
	"role_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_guild_member" boolean DEFAULT false NOT NULL,
	"is_active_member" boolean DEFAULT false NOT NULL,
	"is_board_member" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "web_guild_memberships_user_id_guild_id_pk" PRIMARY KEY("user_id","guild_id")
);
--> statement-breakpoint
CREATE TABLE "web_oauth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"return_to" text DEFAULT '/' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "web_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"discord_user_id" text NOT NULL,
	"username" text NOT NULL,
	"global_name" text,
	"avatar_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "web_guild_memberships" ADD CONSTRAINT "web_guild_memberships_user_id_web_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."web_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_sessions" ADD CONSTRAINT "web_sessions_user_id_web_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."web_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "web_guild_memberships_guild_active_idx" ON "web_guild_memberships" USING btree ("guild_id","is_active_member");--> statement-breakpoint
CREATE INDEX "web_oauth_states_expires_idx" ON "web_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "web_sessions_token_hash_unique" ON "web_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "web_sessions_user_active_idx" ON "web_sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "web_users_discord_user_id_unique" ON "web_users" USING btree ("discord_user_id");