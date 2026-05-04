CREATE TABLE `student_warning_snapshots` (
  `student_id` BIGINT NOT NULL,
  `class_id` BIGINT NOT NULL,
  `org_id` BIGINT NOT NULL,
  `today_warning_total` INTEGER NOT NULL DEFAULT 0,
  `week_warning_total` INTEGER NOT NULL DEFAULT 0,
  `month_warning_total` INTEGER NOT NULL DEFAULT 0,
  `active_warning_count` INTEGER NOT NULL DEFAULT 0,
  `closed_warning_count` INTEGER NOT NULL DEFAULT 0,
  `all_warning_count` INTEGER NOT NULL DEFAULT 0,
  `active_highest_level` VARCHAR(16) NULL,
  `closed_highest_level` VARCHAR(16) NULL,
  `all_highest_level` VARCHAR(16) NULL,
  `active_last_warning_at` DATETIME(3) NULL,
  `closed_last_warning_at` DATETIME(3) NULL,
  `all_last_warning_at` DATETIME(3) NULL,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`student_id`),
  INDEX `student_warning_snapshots_class_id_idx`(`class_id`),
  INDEX `student_warning_snapshots_org_id_idx`(`org_id`),
  CONSTRAINT `student_warning_snapshots_student_id_fkey`
    FOREIGN KEY (`student_id`) REFERENCES `student_profiles`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
);
