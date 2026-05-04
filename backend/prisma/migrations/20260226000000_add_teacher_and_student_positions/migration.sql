-- SQL migration for adding teacher_position and student_position fields
-- Execute this file on your MySQL server

-- Add teacher_position column to users table
ALTER TABLE users ADD COLUMN teacher_position VARCHAR(32) NULL AFTER last_login_at;

-- Add student_position column to student_profiles table
ALTER TABLE student_profiles ADD COLUMN student_position VARCHAR(32) NULL AFTER emergency_contact_mobile;

-- Create index for faster queries (optional)
CREATE INDEX idx_users_teacher_position ON users(teacher_position);
CREATE INDEX idx_student_profiles_student_position ON student_profiles(student_position);
