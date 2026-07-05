alter table public.student_exercise_progress
  add column if not exists current_bpm int not null default 90;
