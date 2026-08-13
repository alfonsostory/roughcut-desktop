CREATE TABLE `human_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_cut_id` text NOT NULL,
	`ai_start` real NOT NULL,
	`ai_end` real NOT NULL,
	`human_start` real NOT NULL,
	`human_end` real NOT NULL,
	`human_action` text NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_human_corrections_candidate_cut_id` ON `human_corrections` (`candidate_cut_id`);