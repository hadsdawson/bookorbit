CREATE TABLE "scan_job_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_job_id" integer NOT NULL,
	"book_id" integer,
	"title" varchar(1000),
	"authors" text,
	"folder_path" varchar(4096),
	"change_type" varchar(20) NOT NULL,
	"field_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_job_changes_type_chk" CHECK ("scan_job_changes"."change_type" in ('added', 'updated', 'missing', 'restored'))
);
--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD COLUMN "changes_truncated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_job_changes" ADD CONSTRAINT "scan_job_changes_scan_job_id_scan_jobs_id_fk" FOREIGN KEY ("scan_job_id") REFERENCES "public"."scan_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_job_changes" ADD CONSTRAINT "scan_job_changes_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scan_job_changes_job_idx" ON "scan_job_changes" USING btree ("scan_job_id","id");--> statement-breakpoint
CREATE INDEX "scan_job_changes_book_idx" ON "scan_job_changes" USING btree ("book_id");