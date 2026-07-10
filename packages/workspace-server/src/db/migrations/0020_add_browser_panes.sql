CREATE TABLE `browser_panes` (
	`id` text PRIMARY KEY NOT NULL,
	`window_id` text NOT NULL,
	`active_tab_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`window_id`) REFERENCES `browser_windows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `browser_panes_window_idx` ON `browser_panes` (`window_id`);--> statement-breakpoint
ALTER TABLE `browser_tabs` ADD `pane_id` text;--> statement-breakpoint
CREATE INDEX `browser_tabs_pane_idx` ON `browser_tabs` (`pane_id`);--> statement-breakpoint
ALTER TABLE `browser_windows` ADD `layout` text;--> statement-breakpoint
ALTER TABLE `browser_windows` ADD `focused_pane_id` text;--> statement-breakpoint
INSERT INTO `browser_panes` (`id`, `window_id`, `active_tab_id`, `created_at`, `updated_at`)
	SELECT `id` || '-root', `id`, `active_tab_id`, `created_at`, `updated_at` FROM `browser_windows`;--> statement-breakpoint
UPDATE `browser_tabs` SET `pane_id` = `window_id` || '-root';--> statement-breakpoint
UPDATE `browser_windows` SET
	`layout` = json_object('type', 'leaf', 'paneId', `id` || '-root'),
	`focused_pane_id` = `id` || '-root';--> statement-breakpoint
ALTER TABLE `browser_windows` DROP COLUMN `active_tab_id`;