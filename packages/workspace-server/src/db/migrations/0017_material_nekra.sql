ALTER TABLE `browser_windows` ADD `account_key` text;--> statement-breakpoint
ALTER TABLE `browser_windows` ADD `cloud_region` text;--> statement-breakpoint
CREATE INDEX `browser_windows_account_region_idx` ON `browser_windows` (`account_key`,`cloud_region`);