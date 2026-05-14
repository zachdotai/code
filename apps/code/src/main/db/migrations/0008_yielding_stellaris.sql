CREATE TABLE `hedgemony_hoglet` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`nest_id` text,
	`signal_report_id` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`nest_id`) REFERENCES `hedgemony_nest`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hedgemony_hoglet_taskId_unique` ON `hedgemony_hoglet` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `hedgemony_hoglet_signalReportId_unique` ON `hedgemony_hoglet` (`signal_report_id`);--> statement-breakpoint
CREATE INDEX `hedgemony_hoglet_nest_id_idx` ON `hedgemony_hoglet` (`nest_id`);