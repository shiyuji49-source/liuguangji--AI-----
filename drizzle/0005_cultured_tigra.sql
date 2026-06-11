DROP INDEX "shot_scope_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "shot_scope_idx" ON "shots" USING btree ("project_id","script_id","episode_no","shot_no");