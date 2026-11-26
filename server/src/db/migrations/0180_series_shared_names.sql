CREATE TABLE "book_series_pending" (
	"book_id" integer NOT NULL,
	"series_name" varchar(500) NOT NULL,
	"series_index" varchar(20),
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_series_pending_book_id_display_order_pk" PRIMARY KEY("book_id","display_order")
);
--> statement-breakpoint
DROP INDEX "book_series_normalized_name_uidx";--> statement-breakpoint
ALTER TABLE "book_series" ADD COLUMN "name_variant" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "book_series_pending" ADD CONSTRAINT "book_series_pending_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "book_series_normalized_name_variant_uidx" ON "book_series" USING btree ("normalized_name","name_variant");--> statement-breakpoint
CREATE INDEX "book_series_normalized_name_idx" ON "book_series" USING btree ("normalized_name");