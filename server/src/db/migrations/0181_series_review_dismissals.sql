CREATE TABLE "series_review_dismissals" (
	"series_id" integer PRIMARY KEY NOT NULL,
	"dismissed_by" integer,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "series_review_dismissals" ADD CONSTRAINT "series_review_dismissals_series_id_book_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."book_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_review_dismissals" ADD CONSTRAINT "series_review_dismissals_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;