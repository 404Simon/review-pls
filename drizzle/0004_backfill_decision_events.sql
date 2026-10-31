INSERT INTO `review_decision_event` (
	`id`,
	`batch_id`,
	`paper_id`,
	`item_kind`,
	`item_ref`,
	`user_id`,
	`status`,
	`payload`,
	`item_hash`,
	`manifest_sha256`,
	`created_at`
)
SELECT
	'backfill-' || `d`.`id`,
	`d`.`batch_id`,
	`d`.`paper_id`,
	`d`.`item_kind`,
	`d`.`item_ref`,
	`d`.`user_id`,
	`d`.`status`,
	`d`.`payload`,
	`d`.`item_hash`,
	`d`.`manifest_sha256`,
	`d`.`updated_at`
FROM `review_decision` AS `d`
WHERE `d`.`status` IN ('closed', 'unsure')
	AND NOT EXISTS (
		SELECT 1
		FROM `review_decision_event` AS `e`
		WHERE `e`.`batch_id` = `d`.`batch_id`
			AND `e`.`paper_id` = `d`.`paper_id`
			AND `e`.`item_kind` = `d`.`item_kind`
			AND `e`.`item_ref` = `d`.`item_ref`
			AND `e`.`user_id` = `d`.`user_id`
			AND `e`.`status` = `d`.`status`
			AND `e`.`created_at` = `d`.`updated_at`
	);
