CREATE TABLE "author_pen_names" (
	"pen_name_author_id" integer NOT NULL,
	"author_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "author_pen_names_pen_name_author_id_author_id_pk" PRIMARY KEY("pen_name_author_id","author_id")
);
--> statement-breakpoint
ALTER TABLE "author_pen_names" ADD CONSTRAINT "author_pen_names_pen_name_author_id_authors_id_fk" FOREIGN KEY ("pen_name_author_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "author_pen_names" ADD CONSTRAINT "author_pen_names_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "author_pen_names_author_id_idx" ON "author_pen_names" USING btree ("author_id");