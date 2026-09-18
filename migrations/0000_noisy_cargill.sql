CREATE TABLE `admin_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`credential_id` text NOT NULL,
	`session_generation` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_expiry` ON `admin_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `auth_state` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`active_credential_id` text NOT NULL,
	`session_generation` text NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "auth_singleton" CHECK("auth_state"."id"=1)
);
--> statement-breakpoint
CREATE TABLE `blobs` (
	`id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`purpose` text NOT NULL,
	`state` text NOT NULL,
	`expected_bytes` integer NOT NULL,
	`stored_bytes` integer DEFAULT 0 NOT NULL,
	`detected_type` text,
	`width` integer,
	`height` integer,
	`etag` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`lease_expires_at` integer NOT NULL,
	`purge_after` integer,
	`claim_id` text,
	CONSTRAINT "blob_state" CHECK("blobs"."state" IN ('reserved','uploading','ready','pending_delete','purged')),
	CONSTRAINT "blob_purpose" CHECK("blobs"."purpose" IN ('file','avatar')),
	CONSTRAINT "blob_bytes" CHECK("blobs"."expected_bytes">0 AND "blobs"."stored_bytes">=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blobs_object_key_unique` ON `blobs` (`object_key`);--> statement-breakpoint
CREATE INDEX `blob_cleanup` ON `blobs` (`state`,`purge_after`);--> statement-breakpoint
CREATE INDEX `blob_lease` ON `blobs` (`state`,`lease_expires_at`);--> statement-breakpoint
CREATE TABLE `business_card` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`published` integer DEFAULT false NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`organization` text DEFAULT '' NOT NULL,
	`intro` text DEFAULT '' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`public_email` text DEFAULT '' NOT NULL,
	`public_phone` text DEFAULT '' NOT NULL,
	`avatar_blob_id` text,
	`show_scheduling` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`avatar_blob_id`) REFERENCES `blobs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "card_singleton" CHECK("business_card"."id"=1)
);
--> statement-breakpoint
CREATE TABLE `business_card_links` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` integer NOT NULL,
	`label` text NOT NULL,
	`url` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `business_card`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `card_link_position` ON `business_card_links` (`card_id`,`position`);--> statement-breakpoint
CREATE TABLE `files` (
	`resource_id` text PRIMARY KEY NOT NULL,
	`blob_id` text NOT NULL,
	`original_filename` text NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blob_id`) REFERENCES `blobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_blob_id_unique` ON `files` (`blob_id`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`key` text PRIMARY KEY NOT NULL,
	`operation` text NOT NULL,
	`request_hash` text NOT NULL,
	`result_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idempotency_expiry` ON `idempotency_keys` (`expires_at`);--> statement-breakpoint
CREATE TABLE `installation` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`label` text DEFAULT 'Emboss' NOT NULL,
	`website_url` text DEFAULT '' NOT NULL,
	`accent` text DEFAULT 'oxide' NOT NULL,
	`show_powered_by` integer DEFAULT false NOT NULL,
	`upload_max_bytes` integer DEFAULT 26214400 NOT NULL,
	`quota_bytes` integer DEFAULT 1073741824 NOT NULL,
	`paste_max_bytes` integer DEFAULT 262144 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "installation_singleton" CHECK("installation"."id"=1),
	CONSTRAINT "installation_accent" CHECK("installation"."accent" IN ('oxide','blue','green')),
	CONSTRAINT "installation_limits" CHECK("installation"."upload_max_bytes">0 AND "installation"."quota_bytes">0 AND "installation"."paste_max_bytes">0)
);
--> statement-breakpoint
CREATE TABLE `links` (
	`resource_id` text PRIMARY KEY NOT NULL,
	`destination_url` text NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pastes` (
	`resource_id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`format` text NOT NULL,
	`language` text DEFAULT 'text' NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "paste_format" CHECK("pastes"."format" IN ('text','code','markdown'))
);
--> statement-breakpoint
CREATE TABLE `resources` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`expires_at` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "resource_kind" CHECK("resources"."kind" IN ('link','paste','file')),
	CONSTRAINT "resource_state" CHECK("resources"."state" IN ('draft','active','disabled','deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resource_slug` ON `resources` (`kind`,`slug`);--> statement-breakpoint
CREATE INDEX `resource_list` ON `resources` (`kind`,`state`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `resource_expiry` ON `resources` (`expires_at`);--> statement-breakpoint
CREATE TABLE `scheduling` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`provider_label` text DEFAULT '' NOT NULL,
	`destination_url` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "scheduling_singleton" CHECK("scheduling"."id"=1)
);
--> statement-breakpoint
INSERT INTO installation(id) VALUES(1);
--> statement-breakpoint
INSERT INTO scheduling(id) VALUES(1);
--> statement-breakpoint
INSERT INTO business_card(id) VALUES(1);
--> statement-breakpoint
CREATE TRIGGER immutable_resource_address BEFORE UPDATE OF kind,slug ON resources WHEN NEW.kind != OLD.kind OR NEW.slug != OLD.slug BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_ADDRESS'); END;
--> statement-breakpoint
CREATE TRIGGER link_kind BEFORE INSERT ON links WHEN (SELECT kind FROM resources WHERE id=NEW.resource_id) != 'link' BEGIN SELECT RAISE(ABORT, 'INVALID_KIND'); END;
--> statement-breakpoint
CREATE TRIGGER paste_kind BEFORE INSERT ON pastes WHEN (SELECT kind FROM resources WHERE id=NEW.resource_id) != 'paste' BEGIN SELECT RAISE(ABORT, 'INVALID_KIND'); END;
--> statement-breakpoint
CREATE TRIGGER file_kind BEFORE INSERT ON files WHEN (SELECT kind FROM resources WHERE id=NEW.resource_id) != 'file' BEGIN SELECT RAISE(ABORT, 'INVALID_KIND'); END;
--> statement-breakpoint
CREATE TRIGGER publish_ready_file BEFORE UPDATE OF state ON resources WHEN NEW.kind='file' AND NEW.state='active' AND NOT EXISTS(SELECT 1 FROM files JOIN blobs ON files.blob_id=blobs.id WHERE files.resource_id=NEW.id AND blobs.state='ready') BEGIN SELECT RAISE(ABORT, 'UPLOAD_NOT_READY'); END;
