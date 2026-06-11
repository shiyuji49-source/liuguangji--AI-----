CREATE TABLE "video_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"script_id" uuid NOT NULL,
	"episode_no" integer NOT NULL,
	"segment_no" integer NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"shot_nos" jsonb NOT NULL,
	"duration_sec" integer,
	"prompt" text,
	"state" text DEFAULT 'empty' NOT NULL,
	"error" text,
	"params" jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_segments" ADD CONSTRAINT "video_segments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_segments" ADD CONSTRAINT "video_segments_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_segments" ADD CONSTRAINT "video_segments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "segment_scope_idx" ON "video_segments" USING btree ("project_id","script_id","episode_no","segment_no");