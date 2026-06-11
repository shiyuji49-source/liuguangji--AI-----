ALTER TABLE "projects" ADD COLUMN "aspect" text DEFAULT '9:16' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "production_type" text DEFAULT '真人' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "style_genre" text;