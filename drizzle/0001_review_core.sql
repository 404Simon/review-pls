CREATE TABLE `item_claim` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`paper_id` text NOT NULL,
	`item_kind` text NOT NULL,
	`item_ref` text NOT NULL,
	`user_id` text NOT NULL,
	`claimed_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `item_claim_item_unique` ON `item_claim` (`batch_id`,`paper_id`,`item_kind`,`item_ref`);--> statement-breakpoint
CREATE INDEX `item_claim_user_expires_idx` ON `item_claim` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `review_decision` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`paper_id` text NOT NULL,
	`item_kind` text NOT NULL,
	`item_ref` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`item_hash` text NOT NULL,
	`manifest_sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_decision_item_user_unique` ON `review_decision` (`batch_id`,`paper_id`,`item_kind`,`item_ref`,`user_id`);--> statement-breakpoint
CREATE INDEX `review_decision_item_idx` ON `review_decision` (`batch_id`,`paper_id`,`item_kind`,`item_ref`);--> statement-breakpoint
CREATE INDEX `review_decision_batch_status_idx` ON `review_decision` (`batch_id`,`status`);--> statement-breakpoint
CREATE TABLE `reviewer_role` (
	`user_id` text PRIMARY KEY NOT NULL,
	`role` text DEFAULT 'reviewer' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
