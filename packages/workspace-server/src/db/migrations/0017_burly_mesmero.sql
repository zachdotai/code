ALTER TABLE `browser_windows` ADD `account_scope` text;--> statement-breakpoint
CREATE INDEX `browser_windows_account_scope_idx` ON `browser_windows` (`account_scope`);