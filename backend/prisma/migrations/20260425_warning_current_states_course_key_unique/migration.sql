-- Align warning_current_states uniqueness with course_key-based semantics.
-- This migration assumes the database has already been backed up.

ALTER TABLE `warning_current_states`
  DROP INDEX `warning_current_states_student_id_metric_window_period_start_key`,
  ADD UNIQUE INDEX `uq_warn_cur_state_course`
    (`student_id`, `metric`, `window`, `period_start`, `period_end`, `course_key`);
