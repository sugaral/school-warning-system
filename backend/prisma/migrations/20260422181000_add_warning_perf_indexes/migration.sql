CREATE INDEX `class_sessions_status_session_end_idx`
  ON `class_sessions`(`status`, `session_end`);

CREATE INDEX `class_sessions_status_qr_expire_at_idx`
  ON `class_sessions`(`status`, `qr_expire_at`);

CREATE INDEX `attendance_records_session_id_attendance_status_idx`
  ON `attendance_records`(`session_id`, `attendance_status`);

CREATE INDEX `attendance_records_student_id_attendance_status_session_id_idx`
  ON `attendance_records`(`student_id`, `attendance_status`, `session_id`);

CREATE INDEX `warnings_student_id_status_created_at_idx`
  ON `warnings`(`student_id`, `status`, `created_at`);

CREATE INDEX `warnings_student_id_metric_window_status_period_start_period_end_idx`
  ON `warnings`(`student_id`, `metric`, `window`, `status`, `period_start`, `period_end`);

CREATE INDEX `notification_jobs_status_schedule_at_idx`
  ON `notification_jobs`(`status`, `schedule_at`);

CREATE INDEX `notification_jobs_warning_id_channel_idx`
  ON `notification_jobs`(`warning_id`, `channel`);
