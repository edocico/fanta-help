CREATE TABLE `app_instance` (
	`id` integer PRIMARY KEY NOT NULL,
	`uuid` text NOT NULL,
	`label` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "app_instance_single_row" CHECK("app_instance"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `auction_log` (
	`id` integer PRIMARY KEY NOT NULL,
	`league_id` integer NOT NULL,
	`phase` text NOT NULL,
	`action` text NOT NULL,
	`payload` text NOT NULL,
	`actor_uuid` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `league`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auction_log_phase" CHECK("auction_log"."phase" in ('auction','review'))
);
--> statement-breakpoint
CREATE INDEX `idx_log_league` ON `auction_log` (`league_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `fanta_team` (
	`id` integer PRIMARY KEY NOT NULL,
	`uuid` text NOT NULL,
	`league_id` integer NOT NULL,
	`name` text NOT NULL,
	`manager` text,
	`is_mine` integer DEFAULT 0 NOT NULL,
	`order_index` integer NOT NULL,
	`color` text,
	FOREIGN KEY (`league_id`) REFERENCES `league`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fanta_team_uuid_unique` ON `fanta_team` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_one_mine` ON `fanta_team` (`league_id`) WHERE "fanta_team"."is_mine" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `fanta_team_league_id_name_unique` ON `fanta_team` (`league_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `fanta_team_league_id_order_index_unique` ON `fanta_team` (`league_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `league` (
	`id` integer PRIMARY KEY NOT NULL,
	`uuid` text NOT NULL,
	`name` text NOT NULL,
	`season_id` text NOT NULL,
	`mode` text NOT NULL,
	`auction_format` text NOT NULL,
	`budget` integer DEFAULT 500 NOT NULL,
	`min_bid` integer DEFAULT 1 NOT NULL,
	`defense_modifier` integer DEFAULT 0 NOT NULL,
	`scoring_weights` text,
	`instance_role` text DEFAULT 'admin' NOT NULL,
	`status` text DEFAULT 'setup' NOT NULL,
	`current_turn_team_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`season_id`) REFERENCES `season`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_turn_team_id`) REFERENCES `fanta_team`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "league_mode" CHECK("league"."mode" in ('classic','mantra')),
	CONSTRAINT "league_auction_format" CHECK("league"."auction_format" in ('call','draft')),
	CONSTRAINT "league_instance_role" CHECK("league"."instance_role" in ('admin','participant')),
	CONSTRAINT "league_status" CHECK("league"."status" in ('setup','pre_auction','auction','review','closed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `league_uuid_unique` ON `league` (`uuid`);--> statement-breakpoint
CREATE TABLE `league_slot` (
	`league_id` integer NOT NULL,
	`role_code` text NOT NULL,
	`slots` integer NOT NULL,
	PRIMARY KEY(`league_id`, `role_code`),
	FOREIGN KEY (`league_id`) REFERENCES `league`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "league_slot_role_code" CHECK("league_slot"."role_code" in ('P','D','C','A')),
	CONSTRAINT "league_slot_slots" CHECK("league_slot"."slots" >= 0)
);
--> statement-breakpoint
CREATE TABLE `league_snapshot` (
	`id` integer PRIMARY KEY NOT NULL,
	`uuid` text NOT NULL,
	`league_id` integer NOT NULL,
	`version` integer NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`produced_by` text NOT NULL,
	`produced_role` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `league`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "league_snapshot_produced_role" CHECK("league_snapshot"."produced_role" in ('admin','participant'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `league_snapshot_uuid_unique` ON `league_snapshot` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `league_snapshot_league_id_version_unique` ON `league_snapshot` (`league_id`,`version`);--> statement-breakpoint
CREATE TABLE `plan` (
	`id` integer PRIMARY KEY NOT NULL,
	`league_id` integer NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `league`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `plan_item` (
	`plan_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`est_price` integer NOT NULL,
	`slot_role` text NOT NULL,
	PRIMARY KEY(`plan_id`, `player_id`),
	FOREIGN KEY (`plan_id`) REFERENCES `plan`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "plan_item_est_price" CHECK("plan_item"."est_price" >= 0),
	CONSTRAINT "plan_item_slot_role" CHECK("plan_item"."slot_role" in ('P','D','C','A'))
);
--> statement-breakpoint
CREATE TABLE `player` (
	`id` integer PRIMARY KEY NOT NULL,
	`season_id` text NOT NULL,
	`source_id` integer NOT NULL,
	`identity_key` text NOT NULL,
	`name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`serie_a_team_id` integer NOT NULL,
	`role_classic` text NOT NULL,
	`qt_classic_initial` real,
	`qt_classic_current` real,
	`qt_mantra_initial` real,
	`qt_mantra_current` real,
	`fvm_classic` real,
	`fvm_mantra` real,
	`birth_date` text,
	`penalty_taker` integer DEFAULT 0 NOT NULL,
	`penalty_taker_source` text,
	`delisted_at` integer,
	FOREIGN KEY (`season_id`) REFERENCES `season`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`serie_a_team_id`) REFERENCES `serie_a_team`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "player_role_classic" CHECK("player"."role_classic" in ('P','D','C','A')),
	CONSTRAINT "player_penalty_taker_source" CHECK("player"."penalty_taker_source" is null or "player"."penalty_taker_source" in ('derived','manual'))
);
--> statement-breakpoint
CREATE INDEX `idx_player_season_role` ON `player` (`season_id`,`role_classic`);--> statement-breakpoint
CREATE INDEX `idx_player_team` ON `player` (`serie_a_team_id`);--> statement-breakpoint
CREATE INDEX `idx_player_identity` ON `player` (`identity_key`);--> statement-breakpoint
CREATE INDEX `idx_player_name_norm` ON `player` (`name_normalized`);--> statement-breakpoint
CREATE UNIQUE INDEX `player_season_id_source_id_unique` ON `player` (`season_id`,`source_id`);--> statement-breakpoint
CREATE TABLE `player_availability` (
	`player_id` integer PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`expected_return` text,
	`source` text NOT NULL,
	`fetched_at` integer NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "player_availability_status" CHECK("player_availability"."status" in ('available','injured','suspended','doubtful'))
);
--> statement-breakpoint
CREATE TABLE `player_external_id` (
	`player_id` integer NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	PRIMARY KEY(`player_id`, `source`),
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "player_external_id_source" CHECK("player_external_id"."source" in ('fbref','apiFootball'))
);
--> statement-breakpoint
CREATE INDEX `idx_ext_lookup` ON `player_external_id` (`source`,`external_id`);--> statement-breakpoint
CREATE TABLE `player_mantra_role` (
	`player_id` integer NOT NULL,
	`role_code` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`player_id`, `role_code`),
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_mantra_role` ON `player_mantra_role` (`role_code`);--> statement-breakpoint
CREATE TABLE `player_season_stat` (
	`id` integer PRIMARY KEY NOT NULL,
	`identity_key` text NOT NULL,
	`season_id` text NOT NULL,
	`team_name` text,
	`role_classic` text,
	`matches_rated` integer,
	`avg_vote` real,
	`fanta_avg` real,
	`goals` integer,
	`goals_conceded` integer,
	`assists` integer,
	`penalties_taken` integer,
	`penalties_scored` integer,
	`penalties_missed` integer,
	`penalties_saved` integer,
	`yellow_cards` integer,
	`red_cards` integer,
	`own_goals` integer,
	`matches_played` integer,
	`starts` integer,
	`minutes` integer,
	`clean_sheets` integer
);
--> statement-breakpoint
CREATE INDEX `idx_stat_identity` ON `player_season_stat` (`identity_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `player_season_stat_identity_key_season_id_unique` ON `player_season_stat` (`identity_key`,`season_id`);--> statement-breakpoint
CREATE TABLE `purchase` (
	`id` integer PRIMARY KEY NOT NULL,
	`uuid` text NOT NULL,
	`league_id` integer NOT NULL,
	`fanta_team_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`price` integer NOT NULL,
	`slot_role` text NOT NULL,
	`sequence` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `league`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fanta_team_id`) REFERENCES `fanta_team`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "purchase_price" CHECK("purchase"."price" >= 0),
	CONSTRAINT "purchase_slot_role" CHECK("purchase"."slot_role" in ('P','D','C','A'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_uuid_unique` ON `purchase` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_purchase_player` ON `purchase` (`league_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_team` ON `purchase` (`fanta_team_id`);--> statement-breakpoint
CREATE INDEX `idx_purchase_sequence` ON `purchase` (`league_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `season` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`dataset_version` text NOT NULL,
	`source` text NOT NULL,
	`has_fbref` integer DEFAULT 0 NOT NULL,
	`imported_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `serie_a_team` (
	`id` integer PRIMARY KEY NOT NULL,
	`season_id` text NOT NULL,
	`name` text NOT NULL,
	`code` text,
	FOREIGN KEY (`season_id`) REFERENCES `season`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `serie_a_team_season_id_name_unique` ON `serie_a_team` (`season_id`,`name`);--> statement-breakpoint
CREATE TABLE `target` (
	`id` integer PRIMARY KEY NOT NULL,
	`league_id` integer NOT NULL,
	`player_id` integer NOT NULL,
	`tier` integer,
	`max_price` integer,
	`rating` integer,
	`note` text,
	`priority` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`league_id`) REFERENCES `league`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "target_tier" CHECK("target"."tier" is null or "target"."tier" between 1 and 5),
	CONSTRAINT "target_max_price" CHECK("target"."max_price" is null or "target"."max_price" >= 0),
	CONSTRAINT "target_rating" CHECK("target"."rating" is null or "target"."rating" between 1 and 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `target_league_id_player_id_unique` ON `target` (`league_id`,`player_id`);--> statement-breakpoint
--- Hand-written from here down: drizzle-kit cannot express either statement,
--- and neither appears in meta/0000_snapshot.json. That is deliberate — the
--- snapshot only tracks what schema.ts declares, so a later `generate` diffs
--- against it and leaves both of these alone.
---
--- DO NOT APPEND ANYTHING ELSE TO THIS FILE. The migrator only compares the
--- timestamp of the newest row in __drizzle_migrations; it writes each file's
--- hash but never reads it back. Once this migration has run somewhere, edits
--- to it are a silent no-op there, and the change would appear to work only on
--- a fresh database. Any further hand-written SQL goes in a new numbered file
--- with its own entry in meta/_journal.json.

--- Contentless FTS5 index, populated at import time with rowid = player.id.
--- No triggers: reference data only changes during an import, so the index is
--- rebuilt there.
CREATE VIRTUAL TABLE `player_fts` USING fts5 (
	name,
	team_name,
	content = '',
	tokenize = "unicode61 remove_diacritics 2"
);--> statement-breakpoint
--- Leftover from the T1 packaging spike. Databases created before T3 carry it
--- and no migrations table; this removes it wherever it survived, on either
--- machine, without anyone having to remember.
DROP TABLE IF EXISTS `spike_boot`;