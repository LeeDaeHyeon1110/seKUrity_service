CREATE TABLE "web_attendance_record_audits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"previous_status" text,
	"new_status" text NOT NULL,
	"note" text,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "web_attendance_record_audits_status_check" CHECK ("web_attendance_record_audits"."previous_status" IS NULL OR "web_attendance_record_audits"."previous_status" IN ('present', 'late', 'absent', 'excused')),
	CONSTRAINT "web_attendance_record_audits_new_status_check" CHECK ("web_attendance_record_audits"."new_status" IN ('present', 'late', 'absent', 'excused'))
);
--> statement-breakpoint
CREATE TABLE "web_attendance_records" (
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name_snapshot" text NOT NULL,
	"status" text,
	"note" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone,
	CONSTRAINT "web_attendance_records_session_id_user_id_pk" PRIMARY KEY("session_id","user_id"),
	CONSTRAINT "web_attendance_records_status_check" CHECK ("web_attendance_records"."status" IS NULL OR "web_attendance_records"."status" IN ('present', 'late', 'absent', 'excused'))
);
--> statement-breakpoint
CREATE TABLE "web_attendance_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"attendance_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text,
	CONSTRAINT "web_attendance_sessions_status_check" CHECK ("web_attendance_sessions"."status" IN ('open', 'closed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "web_member_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"introduction" text DEFAULT '' NOT NULL,
	"specialties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"photo_storage_key" text,
	"photo_content_type" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_score_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"granted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"voided_by" uuid,
	CONSTRAINT "web_score_events_amount_positive_check" CHECK ("web_score_events"."amount" > 0),
	CONSTRAINT "web_score_events_void_state_check" CHECK (("web_score_events"."voided_at" IS NULL AND "web_score_events"."void_reason" IS NULL AND "web_score_events"."voided_by" IS NULL)
          OR ("web_score_events"."voided_at" IS NOT NULL AND "web_score_events"."void_reason" IS NOT NULL AND "web_score_events"."voided_by" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "web_attendance_record_audits" ADD CONSTRAINT "web_attendance_record_audits_actor_id_web_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."web_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_attendance_record_audits" ADD CONSTRAINT "web_attendance_record_audits_session_id_user_id_web_attendance_records_session_id_user_id_fk" FOREIGN KEY ("session_id","user_id") REFERENCES "public"."web_attendance_records"("session_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_attendance_records" ADD CONSTRAINT "web_attendance_records_session_id_web_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."web_attendance_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_attendance_records" ADD CONSTRAINT "web_attendance_records_user_id_web_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."web_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_attendance_records" ADD CONSTRAINT "web_attendance_records_updated_by_web_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."web_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_attendance_sessions" ADD CONSTRAINT "web_attendance_sessions_created_by_web_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."web_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_attendance_sessions" ADD CONSTRAINT "web_attendance_sessions_closed_by_web_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."web_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_attendance_sessions" ADD CONSTRAINT "web_attendance_sessions_cancelled_by_web_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."web_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_member_profiles" ADD CONSTRAINT "web_member_profiles_user_id_web_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."web_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_score_events" ADD CONSTRAINT "web_score_events_user_id_web_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."web_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_score_events" ADD CONSTRAINT "web_score_events_granted_by_web_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."web_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_score_events" ADD CONSTRAINT "web_score_events_voided_by_web_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."web_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "web_attendance_record_audits_record_idx" ON "web_attendance_record_audits" USING btree ("session_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "web_attendance_records_user_idx" ON "web_attendance_records" USING btree ("user_id","session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "web_attendance_sessions_date_unique" ON "web_attendance_sessions" USING btree ("attendance_date");--> statement-breakpoint
CREATE INDEX "web_score_events_user_created_idx" ON "web_score_events" USING btree ("user_id","created_at");