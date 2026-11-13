CREATE TABLE "release_checks" (
	"kind" varchar(10) NOT NULL,
	"name_key" varchar(500) NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"found" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "release_checks_kind_name_key_pk" PRIMARY KEY("kind","name_key")
);
--> statement-breakpoint
CREATE TABLE "release_follows" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" varchar(10) NOT NULL,
	"name" varchar(500) NOT NULL,
	"name_key" varchar(500) NOT NULL,
	"author_id" integer,
	"series_id" integer,
	"author_hint" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_follows_kind_chk" CHECK ("release_follows"."kind" IN ('author', 'series'))
);
--> statement-breakpoint
CREATE TABLE "release_user_settings" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"delivery" varchar(10),
	"retention_days" smallint DEFAULT 30 NOT NULL,
	CONSTRAINT "release_user_settings_delivery_chk" CHECK ("release_user_settings"."delivery" IS NULL OR "release_user_settings"."delivery" IN ('suggest', 'request')),
	CONSTRAINT "release_user_settings_retention_chk" CHECK ("release_user_settings"."retention_days" IN (15, 30, 60, 90))
);
--> statement-breakpoint
CREATE TABLE "release_user_states" (
	"user_id" integer NOT NULL,
	"release_id" integer NOT NULL,
	"state" varchar(12) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_user_states_user_id_release_id_pk" PRIMARY KEY("user_id","release_id"),
	CONSTRAINT "release_user_states_state_chk" CHECK ("release_user_states"."state" IN ('requested', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "upcoming_releases" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_key" varchar(600) NOT NULL,
	"title" varchar(500) NOT NULL,
	"authors" text[] NOT NULL,
	"author_keys" text[] NOT NULL,
	"series_name" varchar(500),
	"series_key" varchar(500),
	"series_index" real,
	"cover_url" varchar(2048),
	"isbn13" varchar(13),
	"asin" varchar(20),
	"ebook_date" date,
	"audiobook_date" date,
	"release_date" date,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"owned_book_id" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "release_follows" ADD CONSTRAINT "release_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_follows" ADD CONSTRAINT "release_follows_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_follows" ADD CONSTRAINT "release_follows_series_id_book_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."book_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_user_settings" ADD CONSTRAINT "release_user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_user_states" ADD CONSTRAINT "release_user_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_user_states" ADD CONSTRAINT "release_user_states_release_id_upcoming_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."upcoming_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upcoming_releases" ADD CONSTRAINT "upcoming_releases_owned_book_id_books_id_fk" FOREIGN KEY ("owned_book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "release_checks_checked_at_idx" ON "release_checks" USING btree ("checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "release_follows_user_kind_key_uidx" ON "release_follows" USING btree ("user_id","kind","name_key");--> statement-breakpoint
CREATE INDEX "release_follows_kind_key_idx" ON "release_follows" USING btree ("kind","name_key");--> statement-breakpoint
CREATE UNIQUE INDEX "upcoming_releases_work_key_uidx" ON "upcoming_releases" USING btree ("work_key");--> statement-breakpoint
CREATE INDEX "upcoming_releases_series_key_idx" ON "upcoming_releases" USING btree ("series_key");--> statement-breakpoint
CREATE INDEX "upcoming_releases_author_keys_idx" ON "upcoming_releases" USING gin ("author_keys");--> statement-breakpoint
CREATE INDEX "upcoming_releases_release_date_idx" ON "upcoming_releases" USING btree ("release_date");