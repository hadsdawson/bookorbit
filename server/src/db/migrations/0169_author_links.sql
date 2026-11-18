CREATE TABLE "author_links" (
	"author_id" integer PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "author_links" ADD CONSTRAINT "author_links_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "author_links_group_id_idx" ON "author_links" USING btree ("group_id");