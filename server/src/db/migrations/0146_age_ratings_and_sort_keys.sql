CREATE TABLE "user_content_filter_age_ratings" (
	"user_id" integer NOT NULL,
	"filter_type" "content_filter_type" NOT NULL,
	"age_rating" smallint NOT NULL,
	CONSTRAINT "user_content_filter_age_ratings_user_id_filter_type_age_rating_pk" PRIMARY KEY("user_id","filter_type","age_rating"),
	CONSTRAINT "user_content_filter_age_ratings_value_chk" CHECK ("user_content_filter_age_ratings"."age_rating" IN (-1, 0, 10, 13, 16, 18))
);
--> statement-breakpoint
ALTER TABLE "book_series" ADD COLUMN "name_sort_key" text GENERATED ALWAYS AS (NULLIF(regexp_replace(lower(btrim(name)), '^(the|an|a)[[:space:]]+', ''), '')) STORED;--> statement-breakpoint
ALTER TABLE "book_series" ADD COLUMN "age_rating" smallint;--> statement-breakpoint
ALTER TABLE "book_metadata" ADD COLUMN "title_sort_key" text GENERATED ALWAYS AS (NULLIF(regexp_replace(lower(btrim(title)), '^(the|an|a)[[:space:]]+', ''), '')) STORED;--> statement-breakpoint
ALTER TABLE "book_metadata" ADD COLUMN "series_name_sort_key" text GENERATED ALWAYS AS (NULLIF(regexp_replace(lower(btrim(series_name)), '^(the|an|a)[[:space:]]+', ''), '')) STORED;--> statement-breakpoint
ALTER TABLE "book_metadata" ADD COLUMN "age_rating" smallint;--> statement-breakpoint
ALTER TABLE "user_content_filter_age_ratings" ADD CONSTRAINT "user_content_filter_age_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_series_name_sort_key_idx" ON "book_series" USING btree ("name_sort_key");--> statement-breakpoint
CREATE INDEX "bm_title_sort_key_book_id_idx" ON "book_metadata" USING btree ("title_sort_key","book_id");--> statement-breakpoint
CREATE INDEX "bm_series_name_sort_key_idx" ON "book_metadata" USING btree ("series_name_sort_key");--> statement-breakpoint
CREATE INDEX "bm_age_rating_idx" ON "book_metadata" USING btree ("age_rating");--> statement-breakpoint
ALTER TABLE "book_series" ADD CONSTRAINT "book_series_age_rating_chk" CHECK ("book_series"."age_rating" IS NULL OR "book_series"."age_rating" IN (0, 10, 13, 16, 18));--> statement-breakpoint
ALTER TABLE "book_metadata" ADD CONSTRAINT "bm_age_rating_chk" CHECK ("book_metadata"."age_rating" IS NULL OR "book_metadata"."age_rating" IN (0, 10, 13, 16, 18));