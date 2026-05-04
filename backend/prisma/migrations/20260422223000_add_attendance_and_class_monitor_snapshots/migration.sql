CREATE TABLE `class_monitor_snapshots` (
  `class_id` BIGINT NOT NULL,
  `org_id` BIGINT NOT NULL,
  `total_students` INTEGER NOT NULL DEFAULT 0,
  `warning_count` INTEGER NOT NULL DEFAULT 0,
  `red_warning_count` INTEGER NOT NULL DEFAULT 0,
  `leave_count` INTEGER NOT NULL DEFAULT 0,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`class_id`),
  INDEX `class_monitor_snapshots_org_id_idx`(`org_id`),
  CONSTRAINT `class_monitor_snapshots_class_id_fkey`
    FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE `class_session_snapshots` (
  `session_id` BIGINT NOT NULL,
  `class_id` BIGINT NOT NULL,
  `org_id` BIGINT NOT NULL,
  `course_id` BIGINT NOT NULL,
  `total_students` INTEGER NOT NULL DEFAULT 0,
  `checked_in_count` INTEGER NOT NULL DEFAULT 0,
  `on_time_count` INTEGER NOT NULL DEFAULT 0,
  `late_count` INTEGER NOT NULL DEFAULT 0,
  `leave_count` INTEGER NOT NULL DEFAULT 0,
  `absent_count` INTEGER NOT NULL DEFAULT 0,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`session_id`),
  INDEX `class_session_snapshots_class_id_idx`(`class_id`),
  INDEX `class_session_snapshots_org_id_idx`(`org_id`),
  INDEX `class_session_snapshots_course_id_idx`(`course_id`),
  CONSTRAINT `class_session_snapshots_session_id_fkey`
    FOREIGN KEY (`session_id`) REFERENCES `class_sessions`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
);
