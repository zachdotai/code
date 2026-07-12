-- Tab-owned panes (v2 split-pane model): tabs gain a `layout` tree +
-- `focused_pane_id`; identity columns move onto new `browser_panes` rows (one
-- backfilled per tab).
--
-- The first two statements heal dev profiles that dogfooded the pre-merge v1
-- split-pane branch (window-owned panes): v1 created its own `browser_panes`
-- shape (window_id/active_tab_id) and DROPPED `browser_windows.active_tab_id`.
-- The ADD fails with "duplicate column name" on healthy v0 DBs, which the
-- migration runner tolerates globally; the DROP TABLE IF EXISTS is a no-op
-- there. v1 pane rows are dev-only data and are discarded (v1's extra
-- `browser_tabs.pane_id` / `browser_windows.layout|focused_pane_id` columns
-- are left behind as inert cruft — SQLite has no DROP COLUMN IF EXISTS, and
-- drizzle only reads declared columns).
ALTER TABLE `browser_windows` ADD `active_tab_id` text;--> statement-breakpoint
DROP TABLE IF EXISTS `browser_panes`;--> statement-breakpoint
CREATE TABLE `browser_panes` (
	`id` text PRIMARY KEY NOT NULL,
	`tab_id` text NOT NULL,
	`window_id` text NOT NULL,
	`dashboard_id` text,
	`task_id` text,
	`channel_id` text,
	`channel_section` text,
	`app_view` text,
	`scroll_state` text,
	`created_at` integer NOT NULL,
	`last_active_at` integer NOT NULL,
	FOREIGN KEY (`tab_id`) REFERENCES `browser_tabs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `browser_panes_tab_idx` ON `browser_panes` (`tab_id`);--> statement-breakpoint
ALTER TABLE `browser_tabs` ADD `layout` text;--> statement-breakpoint
ALTER TABLE `browser_tabs` ADD `focused_pane_id` text;--> statement-breakpoint
INSERT INTO `browser_panes` (`id`, `tab_id`, `window_id`, `dashboard_id`, `task_id`, `channel_id`, `channel_section`, `app_view`, `scroll_state`, `created_at`, `last_active_at`)
	SELECT `id` || '-pane', `id`, `window_id`, `dashboard_id`, `task_id`, `channel_id`, `channel_section`, `app_view`, `scroll_state`, `created_at`, `last_active_at` FROM `browser_tabs`;--> statement-breakpoint
UPDATE `browser_tabs` SET
	`layout` = json_object('type', 'leaf', 'paneId', `id` || '-pane'),
	`focused_pane_id` = `id` || '-pane';--> statement-breakpoint
ALTER TABLE `browser_tabs` DROP COLUMN `dashboard_id`;--> statement-breakpoint
ALTER TABLE `browser_tabs` DROP COLUMN `task_id`;--> statement-breakpoint
ALTER TABLE `browser_tabs` DROP COLUMN `channel_id`;--> statement-breakpoint
ALTER TABLE `browser_tabs` DROP COLUMN `channel_section`;--> statement-breakpoint
ALTER TABLE `browser_tabs` DROP COLUMN `scroll_state`;--> statement-breakpoint
ALTER TABLE `browser_tabs` DROP COLUMN `app_view`;
