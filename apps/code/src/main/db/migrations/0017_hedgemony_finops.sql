-- Add rolling totals to existing hedgemony tables for fast UI reads.
ALTER TABLE `hedgemony_nest` ADD COLUMN `total_input_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hedgemony_nest` ADD COLUMN `total_output_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hedgemony_nest` ADD COLUMN `total_cache_read_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hedgemony_nest` ADD COLUMN `total_cache_creation_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hedgemony_nest` ADD COLUMN `total_cost_usd` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hedgemony_nest` ADD COLUMN `last_usage_at` text;--> statement-breakpoint

ALTER TABLE `hedgemony_hoglet` ADD COLUMN `model` text;--> statement-breakpoint
ALTER TABLE `hedgemony_hoglet` ADD COLUMN `total_input_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hedgemony_hoglet` ADD COLUMN `total_output_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hedgemony_hoglet` ADD COLUMN `total_cache_read_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hedgemony_hoglet` ADD COLUMN `total_cache_creation_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hedgemony_hoglet` ADD COLUMN `total_cost_usd` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hedgemony_hoglet` ADD COLUMN `last_usage_at` text;--> statement-breakpoint

-- Append-only usage event log. Carries FinOps tags (team / product / environment /
-- system / workload / purpose) per the FinOps tagging RFC so spend can be
-- attributed in the same dimensions as cloud infrastructure.
CREATE TABLE `hedgemony_usage_event` (
	`id` text PRIMARY KEY NOT NULL,
	`nest_id` text,
	`hoglet_id` text,
	`task_id` text,
	`task_run_id` text,
	`turn_index` integer,
	`team` text DEFAULT 'posthog-code' NOT NULL,
	`product` text DEFAULT 'hedgemony' NOT NULL,
	`environment` text NOT NULL,
	`system` text DEFAULT 'hedgemony' NOT NULL,
	`workload` text NOT NULL,
	`purpose` text,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_creation_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`cost_source` text NOT NULL,
	`occurred_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`nest_id`) REFERENCES `hedgemony_nest`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`hoglet_id`) REFERENCES `hedgemony_hoglet`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
CREATE INDEX `hedgemony_usage_event_nest_idx` ON `hedgemony_usage_event` (`nest_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `hedgemony_usage_event_hoglet_idx` ON `hedgemony_usage_event` (`hoglet_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `hedgemony_usage_event_occurred_at_idx` ON `hedgemony_usage_event` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `hedgemony_usage_event_workload_idx` ON `hedgemony_usage_event` (`workload`,`occurred_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `hedgemony_usage_event_dedupe_idx` ON `hedgemony_usage_event` (`task_run_id`,`turn_index`);
