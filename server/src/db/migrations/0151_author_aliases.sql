CREATE TABLE "author_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"author_id" integer NOT NULL,
	"name" varchar(500) NOT NULL,
	"name_key" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "author_aliases_name_key_unique" UNIQUE("name_key")
);
--> statement-breakpoint
DROP TABLE "author_links" CASCADE;--> statement-breakpoint
ALTER TABLE "author_aliases" ADD CONSTRAINT "author_aliases_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "author_aliases_author_id_idx" ON "author_aliases" USING btree ("author_id");