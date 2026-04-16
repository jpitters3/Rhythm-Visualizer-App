-- Student session tracking: teacher-managed lesson session groups per student.
-- Each row is one group of N sessions, with a boolean array tracking completion.

CREATE TABLE student_sessions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id  uuid        NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  student_id  uuid        NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  count       integer     NOT NULL CHECK (count BETWEEN 1 AND 12),
  completed   boolean[]   NOT NULL
);

CREATE INDEX student_sessions_teacher_student_idx
  ON student_sessions (teacher_id, student_id);

ALTER TABLE student_sessions ENABLE ROW LEVEL SECURITY;

-- Teachers can manage their own students' sessions
CREATE POLICY "teacher_select_sessions" ON student_sessions
  FOR SELECT USING (teacher_id = auth.uid());

CREATE POLICY "teacher_insert_sessions" ON student_sessions
  FOR INSERT WITH CHECK (teacher_id = auth.uid());

CREATE POLICY "teacher_update_sessions" ON student_sessions
  FOR UPDATE USING (teacher_id = auth.uid());

CREATE POLICY "teacher_delete_sessions" ON student_sessions
  FOR DELETE USING (teacher_id = auth.uid());
