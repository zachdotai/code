CREATE TABLE `rts_feedback_event` (
	`id` text PRIMARY KEY NOT NULL,
	`nest_id` text,
	`hoglet_task_id` text NOT NULL,
	`source` text NOT NULL,
	`payload_hash` text NOT NULL,
	`payload_ref` text NOT NULL,
	`trust_tier` text DEFAULT 'external' NOT NULL,
	`routed_outcome` text NOT NULL,
	`processed` text DEFAULT 'unknown' NOT NULL,
	`injected_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`nest_id`) REFERENCES `rts_nest`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rts_feedback_event_dedupe_idx` ON `rts_feedback_event` (`hoglet_task_id`,`source`,`payload_hash`);--> statement-breakpoint
CREATE INDEX `rts_feedback_event_nest_idx` ON `rts_feedback_event` (`nest_id`,`injected_at`);--> statement-breakpoint
CREATE TABLE `rts_hedgehog_state` (
	`nest_id` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'idle' NOT NULL,
	`last_tick_at` text,
	`serialized_state_json` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`nest_id`) REFERENCES `rts_nest`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rts_hoglet` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`task_id` text NOT NULL,
	`nest_id` text,
	`signal_report_id` text,
	`affinity_score` real,
	`model` text,
	`total_input_tokens` integer DEFAULT 0 NOT NULL,
	`total_output_tokens` integer DEFAULT 0 NOT NULL,
	`total_cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`total_cache_creation_tokens` integer DEFAULT 0 NOT NULL,
	`total_cost_usd` real DEFAULT 0 NOT NULL,
	`last_usage_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`nest_id`) REFERENCES `rts_nest`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rts_hoglet_taskId_unique` ON `rts_hoglet` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `rts_hoglet_signalReportId_unique` ON `rts_hoglet` (`signal_report_id`);--> statement-breakpoint
CREATE INDEX `rts_hoglet_nest_id_idx` ON `rts_hoglet` (`nest_id`);--> statement-breakpoint
CREATE TABLE `rts_nest_message` (
	`id` text PRIMARY KEY NOT NULL,
	`nest_id` text NOT NULL,
	`kind` text NOT NULL,
	`visibility` text DEFAULT 'summary' NOT NULL,
	`source_task_id` text,
	`body` text NOT NULL,
	`payload_json` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`nest_id`) REFERENCES `rts_nest`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rts_nest_message_nest_id_idx` ON `rts_nest_message` (`nest_id`);--> statement-breakpoint
CREATE INDEX `rts_nest_message_created_at_idx` ON `rts_nest_message` (`created_at`);--> statement-breakpoint
CREATE TABLE `rts_nest` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`goal_prompt` text NOT NULL,
	`definition_of_done` text,
	`map_x` integer NOT NULL,
	`map_y` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`health` text DEFAULT 'ok' NOT NULL,
	`target_metric_id` text,
	`loadout_json` text,
	`primary_repository` text,
	`total_input_tokens` integer DEFAULT 0 NOT NULL,
	`total_output_tokens` integer DEFAULT 0 NOT NULL,
	`total_cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`total_cache_creation_tokens` integer DEFAULT 0 NOT NULL,
	`total_cost_usd` real DEFAULT 0 NOT NULL,
	`last_usage_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rts_nest_status_idx` ON `rts_nest` (`status`);--> statement-breakpoint
CREATE TABLE `rts_operator_decision` (
	`id` text PRIMARY KEY NOT NULL,
	`nest_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_key` text NOT NULL,
	`reason` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`nest_id`) REFERENCES `rts_nest`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rts_operator_decision_nest_idx` ON `rts_operator_decision` (`nest_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `rts_operator_decision_subject_idx` ON `rts_operator_decision` (`nest_id`,`kind`,`subject_key`);--> statement-breakpoint
CREATE TABLE `rts_pr_dependency` (
	`id` text PRIMARY KEY NOT NULL,
	`nest_id` text NOT NULL,
	`parent_task_id` text NOT NULL,
	`child_task_id` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`nest_id`) REFERENCES `rts_nest`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rts_pr_dependency_nest_idx` ON `rts_pr_dependency` (`nest_id`);--> statement-breakpoint
CREATE INDEX `rts_pr_dependency_child_idx` ON `rts_pr_dependency` (`child_task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `rts_pr_dependency_triple_idx` ON `rts_pr_dependency` (`nest_id`,`parent_task_id`,`child_task_id`);--> statement-breakpoint
CREATE TABLE `rts_tick_log` (
	`id` text PRIMARY KEY NOT NULL,
	`nest_id` text NOT NULL,
	`ticked_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`outcome` text NOT NULL,
	FOREIGN KEY (`nest_id`) REFERENCES `rts_nest`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rts_tick_log_window_idx` ON `rts_tick_log` (`nest_id`,`ticked_at`);--> statement-breakpoint
CREATE TABLE `rts_usage_event` (
	`id` text PRIMARY KEY NOT NULL,
	`nest_id` text,
	`hoglet_id` text,
	`task_id` text,
	`task_run_id` text,
	`turn_index` integer,
	`team` text DEFAULT 'posthog-code' NOT NULL,
	`product` text DEFAULT 'rts' NOT NULL,
	`environment` text NOT NULL,
	`system` text DEFAULT 'rts' NOT NULL,
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
	FOREIGN KEY (`nest_id`) REFERENCES `rts_nest`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`hoglet_id`) REFERENCES `rts_hoglet`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `rts_usage_event_nest_idx` ON `rts_usage_event` (`nest_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `rts_usage_event_hoglet_idx` ON `rts_usage_event` (`hoglet_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `rts_usage_event_occurred_at_idx` ON `rts_usage_event` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `rts_usage_event_workload_idx` ON `rts_usage_event` (`workload`,`occurred_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `rts_usage_event_dedupe_idx` ON `rts_usage_event` (`task_run_id`,`turn_index`);