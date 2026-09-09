ALTER TABLE "scrum_requests" DROP CONSTRAINT "scrum_requests_category_check";--> statement-breakpoint
ALTER TABLE "scrums" DROP CONSTRAINT "scrums_category_check";--> statement-breakpoint
ALTER TABLE "scrum_requests" ADD CONSTRAINT "scrum_requests_category_check" CHECK ("scrum_requests"."category" IN ('project', 'study', 'personal_study', 'personal'));--> statement-breakpoint
ALTER TABLE "scrums" ADD CONSTRAINT "scrums_category_check" CHECK ("scrums"."category" IN ('project', 'study', 'personal_study', 'personal'));