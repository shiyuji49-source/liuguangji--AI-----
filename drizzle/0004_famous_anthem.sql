CREATE TABLE "shots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"script_id" uuid NOT NULL,
	"episode_no" integer NOT NULL,
	"shot_no" integer NOT NULL,
	"scene_label" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"shot_type" text DEFAULT '' NOT NULL,
	"camera_move" text DEFAULT '' NOT NULL,
	"dialogue" text DEFAULT '' NOT NULL,
	"duration_sec" integer,
	"asset_refs" jsonb,
	"need_still" boolean DEFAULT true NOT NULL,
	"still_prompt" text,
	"still_state" text DEFAULT 'empty' NOT NULL,
	"still_error" text,
	"video_prompt" text,
	"video_state" text DEFAULT 'empty' NOT NULL,
	"video_error" text,
	"params" jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shot_scope_idx" ON "shots" USING btree ("project_id","script_id","episode_no","shot_no");