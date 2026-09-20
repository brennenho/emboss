DROP INDEX `resource_slug`;--> statement-breakpoint
CREATE UNIQUE INDEX `resource_slug` ON `resources` (`kind`,`slug`) WHERE "resources"."deleted_at" IS NULL;