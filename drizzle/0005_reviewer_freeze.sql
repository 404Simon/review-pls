CREATE TABLE `reviewer_freeze` (
	`user_id` text PRIMARY KEY NOT NULL,
	`frozen_at` integer NOT NULL,
	`frozen_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`frozen_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
