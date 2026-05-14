CREATE TABLE `hedgemony_feedback_event` (
	`id` text PRIMARY KEY NOT NULL,
	`nest_id` text,
	`hoglet_task_id` text NOT NULL,
	`source` text NOT NULL,
	`payload_hash` text NOT NULL,
	`payload_ref` text NOT NULL,
	`trust_tier` text DEFAULT 'external' NOT NULL,
	`routed_outcome` text NOT NULL,
	`injected_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`nest_id`) REFERENCES `hedgemony_nest`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hedgemony_feedback_event_dedupe_idx` ON `hedgemony_feedback_event` (`hoglet_task_id`,`source`,`payload_hash`);--> statement-breakpoint
CREATE INDEX `hedgemony_feedback_event_nest_idx` ON `hedgemony_feedback_event` (`nest_id`,`injected_at`);--> statement-breakpoint
CREATE TABLE `hedgemony_pr_dependency` (
	`id` text PRIMARY KEY NOT NULL,
	`nest_id` text NOT NULL,
	`parent_task_id` text NOT NULL,
	`child_task_id` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`nest_id`) REFERENCES `hedgemony_nest`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `hedgemony_pr_dependency_nest_idx` ON `hedgemony_pr_dependency` (`nest_id`);--> statement-breakpoint
CREATE INDEX `hedgemony_pr_dependency_child_idx` ON `hedgemony_pr_dependency` (`child_task_id`);
