ALTER TABLE "user_content_filter_age_ratings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "user_content_filter_age_ratings" CASCADE;--> statement-breakpoint
ALTER TABLE "book_series" DROP CONSTRAINT "book_series_age_rating_chk";--> statement-breakpoint
ALTER TABLE "book_metadata" DROP CONSTRAINT "bm_age_rating_chk";--> statement-breakpoint
DROP INDEX "bm_age_rating_idx";--> statement-breakpoint
ALTER TABLE "book_series" DROP COLUMN "age_rating";--> statement-breakpoint
ALTER TABLE "book_metadata" DROP COLUMN "age_rating";