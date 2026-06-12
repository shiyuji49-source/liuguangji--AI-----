ALTER TABLE "prompt_items" ADD COLUMN "episodes" jsonb;--> statement-breakpoint
ALTER TABLE "shots" ADD COLUMN "shot_function" text DEFAULT '' NOT NULL;