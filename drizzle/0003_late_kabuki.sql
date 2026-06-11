CREATE TABLE "prompt_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"workspace" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"brief" text DEFAULT '' NOT NULL,
	"episode_no" integer,
	"script_id" uuid,
	"prompt_text" text,
	"params" jsonb,
	"state" text DEFAULT 'empty' NOT NULL,
	"error" text,
	"sort_index" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prompt_items" ADD CONSTRAINT "prompt_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_items" ADD CONSTRAINT "prompt_items_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_items" ADD CONSTRAINT "prompt_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prompt_item_idx" ON "prompt_items" USING btree ("project_id","workspace","episode_no");