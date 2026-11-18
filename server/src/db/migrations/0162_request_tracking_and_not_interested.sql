ALTER TABLE "user_book_status" DROP CONSTRAINT "user_book_status_status_chk";--> statement-breakpoint
ALTER TABLE "book_requests" ADD COLUMN "tracking_status" varchar(30);--> statement-breakpoint
ALTER TABLE "book_requests" ADD COLUMN "published_date" date;--> statement-breakpoint
CREATE INDEX "book_requests_tracking_status_idx" ON "book_requests" USING btree ("tracking_status");--> statement-breakpoint
ALTER TABLE "user_book_status" ADD CONSTRAINT "user_book_status_status_chk" CHECK ("user_book_status"."status" in ('unread', 'want_to_read', 'reading', 'on_hold', 'rereading', 'read', 'skimmed', 'abandoned', 'not_interested'));--> statement-breakpoint
ALTER TABLE "book_requests" ADD CONSTRAINT "book_requests_tracking_status_chk" CHECK ("book_requests"."tracking_status" is null or "book_requests"."tracking_status" in ('format_not_available', 'not_yet_released', 'missing'));