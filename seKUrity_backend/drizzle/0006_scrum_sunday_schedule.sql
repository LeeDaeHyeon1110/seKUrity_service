WITH "kst_date" AS (
	SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date AS "today"
)
UPDATE "scrums"
SET
	"next_scrum_date" = "kst_date"."today"
		+ (7 - EXTRACT(DOW FROM "kst_date"."today")::integer),
	"updated_at" = CURRENT_TIMESTAMP
FROM "kst_date"
WHERE "scrums"."status" = 'active';
