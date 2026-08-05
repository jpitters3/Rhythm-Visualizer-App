-- =============================================================================
-- Exercises & Student Progress
-- Migration: 20260704_exercises.sql
-- =============================================================================


-- ---------------------------------------------------------------------------
-- TABLE: exercises
-- Teacher-managed catalog of practice exercises.
-- ---------------------------------------------------------------------------
create table if not exists public.exercises (
  id          uuid        default gen_random_uuid() primary key,
  category    text        not null,
  name        text        not null,
  description text,
  sort_order  int         not null default 0,
  created_at  timestamptz default now()
);

alter table public.exercises enable row level security;

-- Everyone authenticated can read exercises
create policy "Authenticated users can view exercises"
  on public.exercises for select
  using (auth.uid() is not null);

-- Only teachers/admins can manage exercises
create policy "Teachers can insert exercises"
  on public.exercises for insert
  with check (public.current_user_role() in ('teacher', 'admin'));

create policy "Teachers can update exercises"
  on public.exercises for update
  using (public.current_user_role() in ('teacher', 'admin'));

create policy "Teachers can delete exercises"
  on public.exercises for delete
  using (public.current_user_role() in ('teacher', 'admin'));


-- ---------------------------------------------------------------------------
-- SEED: initial exercise catalog
-- ---------------------------------------------------------------------------
insert into public.exercises (category, name, description, sort_order) values
  ('Scale Runs', 'Single-Stroke',           null,                                                                                                                                                                              10),
  ('Scale Runs', 'Double-Stroke',           null,                                                                                                                                                                              20),
  ('Scale Runs', 'Queen''s Wave',           null,                                                                                                                                                                              30),
  ('Scale Runs', 'Thumb Thumb Index Index', null,                                                                                                                                                                              40),
  ('Rhythm',     'Run to Rhythm',           'Choose a scale run and integrate it into rhythmic play in this fun and dynamic exercise.',                                                                                        10),
  ('Rhythm',     'Ding Articulation',       'Practice articulating between all of the different sounds of the ding, including open strikes, closed strikes, taks, fist pounds, wrist thumps, ding bends, and more.',          20);


-- ---------------------------------------------------------------------------
-- TABLE: student_exercise_progress
-- Tracks which exercises each student is working on or has completed.
-- ---------------------------------------------------------------------------
create table if not exists public.student_exercise_progress (
  id           uuid        default gen_random_uuid() primary key,
  user_id      uuid        not null references auth.users(id) on delete cascade,
  exercise_id  uuid        not null references public.exercises(id) on delete cascade,
  status       text        not null default 'working_on_it'
                           check (status in ('working_on_it', 'completed')),
  started_at   timestamptz default now(),
  completed_at timestamptz,
  updated_at   timestamptz default now(),
  unique (user_id, exercise_id)
);

alter table public.student_exercise_progress enable row level security;

-- Students can manage their own progress
create policy "Students can view own progress"
  on public.student_exercise_progress for select
  using (user_id = auth.uid());

create policy "Students can insert own progress"
  on public.student_exercise_progress for insert
  with check (user_id = auth.uid());

create policy "Students can update own progress"
  on public.student_exercise_progress for update
  using (user_id = auth.uid());

create policy "Students can delete own progress"
  on public.student_exercise_progress for delete
  using (user_id = auth.uid());

-- Trigger: auto-set completed_at and updated_at
create or replace function public.handle_exercise_progress_update()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  if new.status = 'completed' and old.status <> 'completed' then
    new.completed_at := now();
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger trg_exercise_progress_update
  before update on public.student_exercise_progress
  for each row execute function public.handle_exercise_progress_update();


-- ---------------------------------------------------------------------------
-- RPC: get_student_exercise_progress(p_student_id)
-- Called by teacher to view a specific student's exercise activity.
-- Returns all exercises with the student's status (null if untouched).
-- ---------------------------------------------------------------------------
create or replace function public.get_student_exercise_progress(p_student_id uuid)
returns table (
  exercise_id  uuid,
  category     text,
  name         text,
  description  text,
  sort_order   int,
  status       text,
  started_at   timestamptz,
  completed_at timestamptz,
  updated_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id          as exercise_id,
    e.category,
    e.name,
    e.description,
    e.sort_order,
    sep.status,
    sep.started_at,
    sep.completed_at,
    sep.updated_at
  from public.exercises e
  left join public.student_exercise_progress sep
    on sep.exercise_id = e.id and sep.user_id = p_student_id
  where
    -- caller must be the student themselves, their teacher, or an admin
    p_student_id = auth.uid()
    or public.current_user_role() = 'admin'
    or exists (
      select 1 from public.teacher_students ts
      where ts.teacher_id = auth.uid()
        and ts.student_id = p_student_id
    )
  order by e.category, e.sort_order;
$$;
