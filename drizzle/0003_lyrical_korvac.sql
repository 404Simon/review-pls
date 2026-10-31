CREATE TABLE `review_decision_event` (
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
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_decision_event_item_idx` ON `review_decision_event` (`batch_id`,`paper_id`,`item_kind`,`item_ref`);--> statement-breakpoint
CREATE INDEX `review_decision_event_user_idx` ON `review_decision_event` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `review_decision_event_batch_status_idx` ON `review_decision_event` (`batch_id`,`status`);