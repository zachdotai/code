CREATE TABLE `hedgemony_nest` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`goal_prompt` text NOT NULL,
	`map_x` integer NOT NULL,
	`map_y` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`health` text DEFAULT 'ok' NOT NULL,
	`target_metric_id` text,
	`loadout_json` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `hedgemony_nest_status_idx` ON `hedgemony_nest` (`status`);