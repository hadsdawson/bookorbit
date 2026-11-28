CREATE TABLE "release_unfollows" (
	"user_id" integer NOT NULL,
	"kind" varchar(10) NOT NULL,
	"name" varchar(500) NOT NULL,
	"name_key" varchar(500) NOT NULL,
	"author_id" integer,
	"series_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_unfollows_user_id_kind_name_key_pk" PRIMARY KEY("user_id","kind","name_key"),
	CONSTRAINT "release_unfollows_kind_chk" CHECK ("release_unfollows"."kind" IN ('author', 'series'))
);
--> statement-breakpoint
ALTER TABLE "release_unfollows" ADD CONSTRAINT "release_unfollows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_unfollows" ADD CONSTRAINT "release_unfollows_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_unfollows" ADD CONSTRAINT "release_unfollows_series_id_book_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."book_series"("id") ON DELETE set null ON UPDATE no action;