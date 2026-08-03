


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."accept_teacher_invitation"("p_invitation_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_inv public.teacher_invitations%rowtype;
begin
  select * into v_inv
  from public.teacher_invitations
  where id = p_invitation_id
    and student_id = auth.uid()
    and status = 'pending';

  if not found then
    raise exception 'Invitation not found or already processed';
  end if;

  update public.teacher_invitations
  set status = 'accepted', updated_at = now()
  where id = p_invitation_id;

  insert into public.teacher_students (teacher_id, student_id)
  values (v_inv.teacher_id, auth.uid())
  on conflict do nothing;

  -- Notify teacher
  insert into public.notifications (user_id, type, title, body, data)
  select
    v_inv.teacher_id,
    'invitation_accepted',
    'Student accepted your invitation',
    coalesce(
      nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
      p.username,
      'A student'
    ) || ' accepted your invitation.',
    jsonb_build_object('student_id', auth.uid(), 'invitation_id', p_invitation_id)
  from public.profiles p
  where p.user_id = auth.uid();
end;
$$;


ALTER FUNCTION "public"."accept_teacher_invitation"("p_invitation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_teacher_invitation_by_token"("p_token" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_inv        teacher_invitations%ROWTYPE;
  v_course_id  uuid;
  v_asgn_id    uuid;
BEGIN
  SELECT * INTO v_inv
  FROM teacher_invitations
  WHERE token = p_token AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired invitation token';
  END IF;

  UPDATE teacher_invitations
  SET status = 'accepted', student_id = auth.uid(), updated_at = now()
  WHERE id = v_inv.id;

  INSERT INTO teacher_students (teacher_id, student_id)
  VALUES (v_inv.teacher_id, auth.uid())
  ON CONFLICT DO NOTHING;

  -- Notify teacher
  INSERT INTO notifications (user_id, type, title, body, data)
  SELECT
    v_inv.teacher_id,
    'invitation_accepted',
    'Student accepted your invitation',
    coalesce(
      nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
      p.username,
      'A student'
    ) || ' accepted your invitation.',
    jsonb_build_object('student_id', auth.uid(), 'invitation_id', v_inv.id)
  FROM profiles p
  WHERE p.user_id = auth.uid();

  -- Auto-enroll + auto-assign for each pre-selected course
  FOREACH v_course_id IN ARRAY COALESCE(v_inv.course_ids, '{}') LOOP

    INSERT INTO user_courses (user_id, course_id)
    VALUES (auth.uid(), v_course_id)
    ON CONFLICT DO NOTHING;

    -- First lesson in the course that has a linked assignment
    SELECT a.id INTO v_asgn_id
    FROM assignments a
    JOIN lessons  l ON l.id = a.lesson_id
    JOIN sections s ON s.id = l.section_id
    WHERE s.course_id    = v_course_id
      AND a.is_published = true
    ORDER BY s.order_index ASC, l.order_index ASC
    LIMIT 1;

    IF v_asgn_id IS NOT NULL THEN
      INSERT INTO student_assignments (student_id, assignment_id, assigned_by, status)
      VALUES (auth.uid(), v_asgn_id, v_inv.teacher_id, 'pending')
      ON CONFLICT DO NOTHING;
    END IF;

  END LOOP;
END;
$$;


ALTER FUNCTION "public"."accept_teacher_invitation_by_token"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_email_exists"("p_email" "text") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users WHERE email = lower(trim(p_email))
  );
$$;


ALTER FUNCTION "public"."check_email_exists"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."copy_course_sections"("source_course_id" "uuid", "target_course_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_new_section_id UUID;
  v_section_record RECORD;
BEGIN
  -- Ensure both courses exist (optional safety check)
  IF NOT EXISTS (SELECT 1 FROM courses WHERE id = source_course_id) THEN
    RAISE EXCEPTION 'Source course with ID % does not exist.', source_course_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM courses WHERE id = target_course_id) THEN
    RAISE EXCEPTION 'Target course with ID % does not exist.', target_course_id;
  END IF;

  -- Loop through all sections of the source course
  FOR v_section_record IN 
    SELECT * FROM sections WHERE course_id = source_course_id ORDER BY order_index
  LOOP
    -- Insert the copied section into the target course, returning the new ID
    INSERT INTO sections (course_id, title, order_index, is_published)
    VALUES (
      target_course_id, 
      v_section_record.title, 
      v_section_record.order_index, 
      v_section_record.is_published
    ) RETURNING id INTO v_new_section_id;

    -- Copy all lessons belonging to this section, linking them to the new section ID
    INSERT INTO lessons (
      section_id, 
      title, 
      description, 
      video_url, 
      pattern_json, 
      pattern_name, 
      order_index
    )
    SELECT 
      v_new_section_id, 
      title, 
      description, 
      video_url, 
      pattern_json, 
      pattern_name, 
      order_index
    FROM lessons
    WHERE section_id = v_section_record.id;
    
  END LOOP;
  
  RAISE NOTICE 'Successfully copied sections and lessons from course % to course %', source_course_id, target_course_id;
END;
$$;


ALTER FUNCTION "public"."copy_course_sections"("source_course_id" "uuid", "target_course_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_teacher_invitation"("p_student_email" "text") RETURNS TABLE("invitation_id" "uuid", "token" "text", "student_exists" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_student_id uuid;
  v_inv_id     uuid;
  v_token      text;
begin
  if public.current_user_role() not in ('teacher', 'admin') then
    raise exception 'Not authorized';
  end if;

  -- Look up student by email in auth.users
  select id into v_student_id
  from auth.users
  where lower(email) = lower(p_student_email)
  limit 1;

  -- Upsert: if invite already exists, reset it to pending
  insert into public.teacher_invitations (teacher_id, student_email, student_id)
  values (auth.uid(), lower(p_student_email), v_student_id)
  on conflict (teacher_id, student_email) do update
    set status = 'pending', student_id = v_student_id, updated_at = now()
  returning id, public.teacher_invitations.token into v_inv_id, v_token;

  return query select v_inv_id, v_token, (v_student_id is not null);
end;
$$;


ALTER FUNCTION "public"."create_teacher_invitation"("p_student_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_teacher_invitation"("p_student_email" "text", "p_course_ids" "uuid"[] DEFAULT '{}'::"uuid"[]) RETURNS TABLE("invitation_id" "uuid", "token" "text", "student_exists" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_teacher_id  uuid := auth.uid();
  v_student_id  uuid;
  v_token       text;
  v_inv_id      uuid;
BEGIN
  -- Resolve student by email (may not exist yet)
  SELECT id INTO v_student_id
  FROM auth.users
  WHERE email = lower(trim(p_student_email))
  LIMIT 1;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');

  INSERT INTO teacher_invitations (teacher_id, student_email, student_id, token, course_ids)
  VALUES (v_teacher_id, lower(trim(p_student_email)), v_student_id, v_token, COALESCE(p_course_ids, '{}'))
  RETURNING id INTO v_inv_id;

  -- In-app notification for existing users
  IF v_student_id IS NOT NULL THEN
    INSERT INTO notifications (user_id, type, title, body, data)
    VALUES (
      v_student_id,
      'teacher_invitation',
      'Teacher Invitation',
      'A teacher has invited you to connect on Panafide.',
      jsonb_build_object('invitation_id', v_inv_id, 'teacher_id', v_teacher_id)
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN QUERY SELECT v_inv_id, v_token, (v_student_id IS NOT NULL);
END;
$$;


ALTER FUNCTION "public"."create_teacher_invitation"("p_student_email" "text", "p_course_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role from public.profiles where user_id = auth.uid();
$$;


ALTER FUNCTION "public"."current_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_role_for"("p_user_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT role FROM public.profiles WHERE user_id = p_user_id LIMIT 1;
$$;


ALTER FUNCTION "public"."current_user_role_for"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decline_teacher_invitation"("p_invitation_id" "uuid") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update public.teacher_invitations
  set status = 'declined', updated_at = now()
  where id = p_invitation_id
    and student_id = auth.uid()
    and status = 'pending';
$$;


ALTER FUNCTION "public"."decline_teacher_invitation"("p_invitation_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."assignment_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "assignment_id" "uuid" NOT NULL,
    "item_type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "instructions" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "required" boolean DEFAULT true NOT NULL,
    "config" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "assignment_items_item_type_check" CHECK (("item_type" = ANY (ARRAY['mark_complete'::"text", 'quiz'::"text", 'audio'::"text", 'video'::"text", 'link'::"text", 'composition_reference'::"text", 'phrase'::"text"])))
);


ALTER TABLE "public"."assignment_items" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_assignment_items_for_student"("p_assignment_id" "uuid") RETURNS SETOF "public"."assignment_items"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select ai.*
  from public.assignment_items ai
  join public.student_assignments sa on sa.assignment_id = ai.assignment_id
  join public.assignments a on a.id = ai.assignment_id
  where ai.assignment_id = p_assignment_id
    and sa.student_id = auth.uid()
    and a.is_published = true;
$$;


ALTER FUNCTION "public"."get_assignment_items_for_student"("p_assignment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_student_exercise_progress"("p_student_id" "uuid") RETURNS TABLE("exercise_id" "uuid", "category" "text", "name" "text", "description" "text", "sort_order" integer, "status" "text", "started_at" timestamp with time zone, "completed_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."get_student_exercise_progress"("p_student_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_students_for_teacher"() RETURNS TABLE("user_id" "uuid", "first_name" "text", "last_name" "text", "username" "text", "last_seen_at" timestamp with time zone, "joined_at" timestamp with time zone, "last_assignment_update" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    p.user_id,
    p.first_name,
    p.last_name,
    p.username,
    p.last_seen_at,
    u.created_at                as joined_at,
    max(sa.updated_at)          as last_assignment_update
  from public.teacher_students ts
  join public.profiles p         on p.user_id   = ts.student_id
  join auth.users u              on u.id         = ts.student_id
  left join public.student_assignments sa
    on sa.student_id = ts.student_id and sa.assigned_by = auth.uid()
  where ts.teacher_id = auth.uid()
  group by p.user_id, p.first_name, p.last_name, p.username, p.last_seen_at, u.created_at;
$$;


ALTER FUNCTION "public"."get_students_for_teacher"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_exercise_progress_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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


ALTER FUNCTION "public"."handle_exercise_progress_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_student_on_assignment"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_assignment_title text;
  v_assigner_name    text;
begin
  select title into v_assignment_title
  from public.assignments
  where id = new.assignment_id;

  select coalesce(
    nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''),
    username,
    new.assigned_by::text
  ) into v_assigner_name
  from public.profiles
  where user_id = new.assigned_by;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    new.student_id,
    'assignment_assigned',
    'New assignment',
    coalesce(v_assigner_name, 'Your teacher') || ' assigned you "' || coalesce(v_assignment_title, 'a new assignment') || '".',
    jsonb_build_object(
      'student_assignment_id', new.id,
      'assignment_id',         new.assignment_id,
      'assigned_by',           new.assigned_by,
      'assignment_title',      v_assignment_title,
      'due_date',              new.due_date
    )
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."notify_student_on_assignment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_student_on_invitation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_teacher_name text;
begin
  if new.student_id is null then return new; end if;

  select coalesce(
    nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''),
    username,
    new.teacher_id::text
  ) into v_teacher_name
  from public.profiles
  where user_id = new.teacher_id;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    new.student_id,
    'teacher_invitation',
    'Teacher invitation',
    coalesce(v_teacher_name, 'A teacher') || ' has invited you to be their student.',
    jsonb_build_object(
      'invitation_id', new.id,
      'teacher_id',    new.teacher_id,
      'teacher_name',  v_teacher_name
    )
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."notify_student_on_invitation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_student_on_review"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_student_id       uuid;
  v_assignment_title text;
  v_reviewer_name    text;
begin
  if new.reviewed_at is not null and old.reviewed_at is null then

    -- Look up student and assignment info via student_assignments
    select sa.student_id, a.title
    into v_student_id, v_assignment_title
    from public.student_assignments sa
    join public.assignments a on a.id = sa.assignment_id
    where sa.id = new.student_assignment_id;

    select coalesce(
      nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''),
      username,
      new.reviewed_by::text
    ) into v_reviewer_name
    from public.profiles
    where user_id = new.reviewed_by;

    insert into public.notifications (user_id, type, title, body, data)
    values (
      v_student_id,
      'assignment_reviewed',
      'Assignment reviewed',
      coalesce(v_reviewer_name, 'Your teacher') || ' reviewed your submission for "' || coalesce(v_assignment_title, 'an assignment') || '".',
      jsonb_build_object(
        'student_assignment_id', new.student_assignment_id,
        'submission_id',         new.id,
        'assignment_title',      v_assignment_title,
        'reviewed_by',           new.reviewed_by,
        'has_feedback',          (new.feedback is not null)
      )
    );

  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."notify_student_on_review"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_teacher_on_submission"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_assignment_title text;
  v_student_name     text;
begin
  if new.status = 'submitted' and old.status is distinct from 'submitted' then

    select title into v_assignment_title
    from public.assignments
    where id = new.assignment_id;

    select coalesce(
      nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''),
      username,
      new.student_id::text
    ) into v_student_name
    from public.profiles
    where user_id = new.student_id;

    insert into public.notifications (user_id, type, title, body, data)
    values (
      new.assigned_by,
      'assignment_submitted',
      'Assignment submitted',
      coalesce(v_student_name, 'A student') || ' submitted "' || coalesce(v_assignment_title, 'an assignment') || '".',
      jsonb_build_object(
        'student_assignment_id', new.id,
        'assignment_id',         new.assignment_id,
        'student_id',            new.student_id,
        'assignment_title',      v_assignment_title,
        'student_name',          v_student_name
      )
    );

  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."notify_teacher_on_submission"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_pending_invitations"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_email text;
  v_inv   public.teacher_invitations%rowtype;
  v_count int := 0;
begin
  select lower(email) into v_email from auth.users where id = auth.uid();

  for v_inv in
    select * from public.teacher_invitations
    where lower(student_email) = v_email
      and student_id is null
      and status = 'pending'
  loop
    update public.teacher_invitations
    set status = 'accepted', student_id = auth.uid(), updated_at = now()
    where id = v_inv.id;

    insert into public.teacher_students (teacher_id, student_id)
    values (v_inv.teacher_id, auth.uid())
    on conflict do nothing;

    insert into public.notifications (user_id, type, title, body, data)
    select
      v_inv.teacher_id,
      'invitation_accepted',
      'Student accepted your invitation',
      coalesce(
        nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
        p.username,
        'A student'
      ) || ' accepted your invitation.',
      jsonb_build_object('student_id', auth.uid(), 'invitation_id', v_inv.id)
    from public.profiles p
    where p.user_id = auth.uid();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


ALTER FUNCTION "public"."process_pending_invitations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_likes_count"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.shared_patterns
    SET likes_count = likes_count + 1
    WHERE id = NEW.pattern_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.shared_patterns
    SET likes_count = likes_count - 1
    WHERE id = OLD.pattern_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."update_likes_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_modified_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


ALTER FUNCTION "public"."update_modified_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_post_likes_count"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE community_posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE community_posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."update_post_likes_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_config" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL
);


ALTER TABLE "public"."app_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assignment_folders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."assignment_folders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assignment_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "student_assignment_id" "uuid" NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"(),
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "feedback" "text"
);


ALTER TABLE "public"."assignment_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    "course_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "default_due_date" timestamp with time zone,
    "is_published" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "video_url" "text",
    "folder_id" "uuid",
    "is_archived" boolean DEFAULT false NOT NULL,
    "sort_order" integer,
    "phrase_name" "text",
    "phrase_json" "jsonb",
    "lesson_id" "uuid"
);


ALTER TABLE "public"."assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clips" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" DEFAULT 'New Recording'::"text" NOT NULL,
    "audio_url" "text",
    "duration_secs" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."clips" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."coaching_sessions" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "pattern_name" "text",
    "bpm" integer,
    "total_notes" integer,
    "correct_notes" integer,
    "note_accuracy" integer,
    "timing_accuracy" integer,
    "overall_score" integer,
    "note_results" "jsonb",
    "problem_measures" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."coaching_sessions" OWNER TO "postgres";


ALTER TABLE "public"."coaching_sessions" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."coaching_sessions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."comment_likes" (
    "user_id" "uuid" NOT NULL,
    "comment_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."comment_likes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."community_posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "content" "text",
    "media_url" "text",
    "media_type" "text",
    "shared_pattern_id" "uuid",
    "likes_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."community_posts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."composition_sections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "composition_id" "uuid" NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "type" "text" NOT NULL,
    "title" "text",
    "phrase_name" "text",
    "audio_url" "text",
    "note_text" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "color" "text",
    "trim_start" double precision DEFAULT 0,
    "trim_end" double precision,
    "pattern_snapshot" "jsonb",
    CONSTRAINT "composition_sections_type_check" CHECK (("type" = ANY (ARRAY['phrase'::"text", 'recording'::"text", 'note'::"text"])))
);


ALTER TABLE "public"."composition_sections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."compositions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" DEFAULT 'Untitled Composition'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "share_token" "text",
    "is_snapshot" boolean DEFAULT false NOT NULL,
    "folder_id" "uuid",
    "archived" boolean DEFAULT false
);


ALTER TABLE "public"."compositions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."courses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "is_paid" boolean DEFAULT false,
    "price" numeric(10,2) DEFAULT 0.00,
    "thumbnail_url" "text",
    "is_published" boolean DEFAULT false,
    "progression_id" "uuid",
    "category" "text",
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "intended_scale" "text",
    "level" integer,
    "preview_lesson_id" "uuid"
);


ALTER TABLE "public"."courses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exercise_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."exercise_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exercises" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "video_url" "text",
    "studio_pattern_json" "jsonb",
    "created_by" "uuid"
);


ALTER TABLE "public"."exercises" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."glossary_terms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "term" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "definition" "text" NOT NULL,
    "video_url" "text",
    "related_course_ids" "uuid"[] DEFAULT '{}'::"uuid"[],
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."glossary_terms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lessons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "section_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "video_url" "text",
    "pattern_json" "jsonb" NOT NULL,
    "order_index" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "pattern_name" "text"
);


ALTER TABLE "public"."lessons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."library_folders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "tab" "text" NOT NULL,
    "parent_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "library_folders_tab_check" CHECK (("tab" = ANY (ARRAY['phrases'::"text", 'compositions'::"text"])))
);


ALTER TABLE "public"."library_folders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."method_rhythms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "subtitle" "text",
    "description" "text",
    "badge_emoji" "text",
    "badge_text" "text",
    "pattern_json" "jsonb",
    "order_index" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."method_rhythms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_preferences" (
    "user_id" "uuid" NOT NULL,
    "notif_type" "text" NOT NULL,
    "in_app" boolean DEFAULT true NOT NULL,
    "email" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."notification_preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "data" "jsonb" DEFAULT '{}'::"jsonb",
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pattern_likes" (
    "user_id" "uuid" NOT NULL,
    "pattern_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."pattern_likes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."patterns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" NOT NULL,
    "data" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "folder_id" "uuid",
    "archived" boolean DEFAULT false
);


ALTER TABLE "public"."patterns" OWNER TO "postgres";


COMMENT ON COLUMN "public"."patterns"."source" IS 'Origin of the pattern: manual (user-created), composition (exported from Song Composer), midi_import, etc.';



CREATE TABLE IF NOT EXISTS "public"."post_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "content" "text",
    "media_url" "text",
    "media_type" "text",
    "shared_pattern_id" "uuid",
    "likes_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."post_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."post_likes" (
    "user_id" "uuid" NOT NULL,
    "post_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."post_likes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."practice_history" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "pattern_name" "text",
    "bpm" integer,
    "total_notes" integer,
    "correct_notes" integer,
    "note_accuracy" integer,
    "timing_accuracy" integer,
    "overall_score" integer,
    "note_results" "jsonb",
    "problem_measures" integer[],
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."practice_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."practice_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "item_type" "text" NOT NULL,
    "reference_id" "uuid" NOT NULL,
    "title" "text",
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "category" "text" DEFAULT 'other'::"text" NOT NULL,
    CONSTRAINT "practice_items_category_check" CHECK (("category" = ANY (ARRAY['daily'::"text", 'other'::"text"]))),
    CONSTRAINT "practice_items_item_type_check" CHECK (("item_type" = ANY (ARRAY['lesson'::"text", 'pattern'::"text", 'exercise'::"text"])))
);


ALTER TABLE "public"."practice_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."practice_reminders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "frequency" "text" NOT NULL,
    "days_of_week" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
    "time_of_day" time without time zone NOT NULL,
    "timezone" "text" DEFAULT 'UTC'::"text" NOT NULL,
    "lead_minutes" integer DEFAULT 0 NOT NULL,
    "notify_email" boolean DEFAULT true NOT NULL,
    "notify_push" boolean DEFAULT false NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_sent_date" "date",
    CONSTRAINT "practice_reminders_frequency_check" CHECK (("frequency" = ANY (ARRAY['daily'::"text", 'weekly'::"text"]))),
    CONSTRAINT "practice_reminders_lead_minutes_check" CHECK (("lead_minutes" >= 0)),
    CONSTRAINT "practice_reminders_time_15min_grid" CHECK ((((EXTRACT(minute FROM "time_of_day"))::integer % 15) = 0))
);


ALTER TABLE "public"."practice_reminders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "handpan_scale" "text" DEFAULT 'd_kurd'::"text" NOT NULL,
    "username" "text",
    "bio" "text",
    "avatar_url" "text",
    "updated_at" timestamp with time zone,
    "current_course_id" "uuid",
    "first_name" "text",
    "last_name" "text",
    "label_preference" "text" DEFAULT 'Numbers'::"text",
    "grid_label_notation" "text" DEFAULT 'musical'::"text",
    "role" "text" DEFAULT 'student'::"text",
    "subscription_tier" "text" DEFAULT 'player'::"text",
    "stripe_customer_id" "text",
    "subscription_status" "text",
    "last_seen_at" timestamp with time zone,
    "dashboard_mute" boolean DEFAULT false NOT NULL,
    "subscription_expires_at" timestamp with time zone,
    "subscription_source" "text",
    "dream_goal" "text",
    "short_term_goal" "text",
    "accent_color" "text" DEFAULT 'blue'::"text" NOT NULL,
    CONSTRAINT "username_length" CHECK (("char_length"("username") >= 3)),
    CONSTRAINT "valid_grid_notation" CHECK (("grid_label_notation" = ANY (ARRAY['musical'::"text", 'numeric'::"text"]))),
    CONSTRAINT "valid_user_roles" CHECK (("role" = ANY (ARRAY['admin'::"text", 'student'::"text", 'teacher'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."subscription_tier" IS 'Billing tier: player (free), player_plus (paid individual), teacher (paid with classroom access)';



COMMENT ON COLUMN "public"."profiles"."stripe_customer_id" IS 'The Stripe customer ID for billing management';



COMMENT ON COLUMN "public"."profiles"."subscription_status" IS 'The status of the Stripe subscription, e.g., active, trailing, canceled';



CREATE TABLE IF NOT EXISTS "public"."progression_phrases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "progression_id" "uuid" NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "phrase_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."progression_phrases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."progressions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" DEFAULT 'Untitled Progression'::"text" NOT NULL,
    "level" integer,
    "intended_scale" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "category" "text",
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "preview_phrase_name" "text"
);


ALTER TABLE "public"."progressions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scale_calibrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "scale_id" "text" NOT NULL,
    "frequency_map" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."scale_calibrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "order_index" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_published" boolean DEFAULT false
);


ALTER TABLE "public"."sections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shared_patterns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "share_id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "pattern_json" "jsonb" NOT NULL,
    "is_public" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "profile_id" "uuid",
    "description" "text",
    "likes_count" integer DEFAULT 0
);


ALTER TABLE "public"."shared_patterns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."songs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "pattern_json" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."songs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "assignment_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "assigned_by" "uuid" NOT NULL,
    "due_date" timestamp with time zone,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "student_assignments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'in_progress'::"text", 'submitted'::"text", 'sent_back'::"text", 'reviewed'::"text"])))
);


ALTER TABLE "public"."student_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_exercise_progress" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "exercise_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'working_on_it'::"text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "current_bpm" integer DEFAULT 90 NOT NULL,
    CONSTRAINT "student_exercise_progress_status_check" CHECK (("status" = ANY (ARRAY['working_on_it'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."student_exercise_progress" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."student_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "count" integer NOT NULL,
    "completed" boolean[] NOT NULL,
    CONSTRAINT "student_sessions_count_check" CHECK ((("count" >= 1) AND ("count" <= 12)))
);


ALTER TABLE "public"."student_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."submission_item_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "submission_id" "uuid" NOT NULL,
    "item_id" "uuid" NOT NULL,
    "response_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "responded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."submission_item_responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teacher_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "teacher_id" "uuid" NOT NULL,
    "student_email" "text" NOT NULL,
    "student_id" "uuid",
    "token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(32), 'hex'::"text"),
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "course_ids" "uuid"[] DEFAULT '{}'::"uuid"[],
    CONSTRAINT "teacher_invitations_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'declined'::"text"])))
);


ALTER TABLE "public"."teacher_invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."teacher_students" (
    "teacher_id" "uuid" NOT NULL,
    "student_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."teacher_students" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."technique_flash_cards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category" "text" NOT NULL,
    "name" "text" NOT NULL,
    "is_default_enabled" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."technique_flash_cards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_courses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "course_id" "uuid" NOT NULL,
    "enrolled_at" timestamp with time zone DEFAULT "now"(),
    "is_archived" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."user_courses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_handpans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "builder" "text",
    "scale_name" "text",
    "top_image_url" "text" NOT NULL,
    "bottom_image_url" "text",
    "note_map" "jsonb" DEFAULT '[]'::"jsonb",
    "is_active" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "image_rotation" numeric DEFAULT 0,
    "sort_order" integer DEFAULT 0,
    "bottom_image_rotation" integer DEFAULT 0
);


ALTER TABLE "public"."user_handpans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_lesson_progress" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "lesson_id" "uuid" NOT NULL,
    "completed_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_lesson_progress" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."weekly_patterns" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "pattern_id" "uuid" NOT NULL,
    "launch_date" timestamp with time zone NOT NULL,
    "difficulty" integer,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."weekly_patterns" OWNER TO "postgres";


ALTER TABLE ONLY "public"."app_config"
    ADD CONSTRAINT "app_config_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."assignment_folders"
    ADD CONSTRAINT "assignment_folders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assignment_items"
    ADD CONSTRAINT "assignment_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assignment_submissions"
    ADD CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assignment_submissions"
    ADD CONSTRAINT "assignment_submissions_student_assignment_id_key" UNIQUE ("student_assignment_id");



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clips"
    ADD CONSTRAINT "clips_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coaching_sessions"
    ADD CONSTRAINT "coaching_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."comment_likes"
    ADD CONSTRAINT "comment_likes_pkey" PRIMARY KEY ("user_id", "comment_id");



ALTER TABLE ONLY "public"."community_posts"
    ADD CONSTRAINT "community_posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."composition_sections"
    ADD CONSTRAINT "composition_sections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."compositions"
    ADD CONSTRAINT "compositions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."compositions"
    ADD CONSTRAINT "compositions_share_token_key" UNIQUE ("share_token");



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exercise_categories"
    ADD CONSTRAINT "exercise_categories_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."exercise_categories"
    ADD CONSTRAINT "exercise_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exercises"
    ADD CONSTRAINT "exercises_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."glossary_terms"
    ADD CONSTRAINT "glossary_terms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."glossary_terms"
    ADD CONSTRAINT "glossary_terms_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."lessons"
    ADD CONSTRAINT "lessons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."library_folders"
    ADD CONSTRAINT "library_folders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."method_rhythms"
    ADD CONSTRAINT "method_rhythms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id", "notif_type");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pattern_likes"
    ADD CONSTRAINT "pattern_likes_pkey" PRIMARY KEY ("user_id", "pattern_id");



ALTER TABLE ONLY "public"."patterns"
    ADD CONSTRAINT "patterns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."patterns"
    ADD CONSTRAINT "patterns_user_id_name_key" UNIQUE ("user_id", "name");



ALTER TABLE ONLY "public"."post_comments"
    ADD CONSTRAINT "post_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."post_likes"
    ADD CONSTRAINT "post_likes_pkey" PRIMARY KEY ("user_id", "post_id");



ALTER TABLE ONLY "public"."practice_history"
    ADD CONSTRAINT "practice_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."practice_items"
    ADD CONSTRAINT "practice_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."practice_reminders"
    ADD CONSTRAINT "practice_reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."progression_phrases"
    ADD CONSTRAINT "progression_phrases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."progressions"
    ADD CONSTRAINT "progressions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_endpoint_key" UNIQUE ("endpoint");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scale_calibrations"
    ADD CONSTRAINT "scale_calibrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scale_calibrations"
    ADD CONSTRAINT "scale_calibrations_user_id_scale_id_key" UNIQUE ("user_id", "scale_id");



ALTER TABLE ONLY "public"."sections"
    ADD CONSTRAINT "sections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shared_patterns"
    ADD CONSTRAINT "shared_patterns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shared_patterns"
    ADD CONSTRAINT "shared_patterns_share_id_key" UNIQUE ("share_id");



ALTER TABLE ONLY "public"."songs"
    ADD CONSTRAINT "songs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_assignments"
    ADD CONSTRAINT "student_assignments_assignment_id_student_id_key" UNIQUE ("assignment_id", "student_id");



ALTER TABLE ONLY "public"."student_assignments"
    ADD CONSTRAINT "student_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_exercise_progress"
    ADD CONSTRAINT "student_exercise_progress_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."student_exercise_progress"
    ADD CONSTRAINT "student_exercise_progress_user_id_exercise_id_key" UNIQUE ("user_id", "exercise_id");



ALTER TABLE ONLY "public"."student_sessions"
    ADD CONSTRAINT "student_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."submission_item_responses"
    ADD CONSTRAINT "submission_item_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."submission_item_responses"
    ADD CONSTRAINT "submission_item_responses_submission_id_item_id_key" UNIQUE ("submission_id", "item_id");



ALTER TABLE ONLY "public"."teacher_invitations"
    ADD CONSTRAINT "teacher_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."teacher_invitations"
    ADD CONSTRAINT "teacher_invitations_teacher_id_student_email_key" UNIQUE ("teacher_id", "student_email");



ALTER TABLE ONLY "public"."teacher_invitations"
    ADD CONSTRAINT "teacher_invitations_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."teacher_students"
    ADD CONSTRAINT "teacher_students_pkey" PRIMARY KEY ("teacher_id", "student_id");



ALTER TABLE ONLY "public"."technique_flash_cards"
    ADD CONSTRAINT "technique_flash_cards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_handpans"
    ADD CONSTRAINT "unique_user_handpan_name" UNIQUE ("user_id", "name");



ALTER TABLE ONLY "public"."user_courses"
    ADD CONSTRAINT "user_courses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_courses"
    ADD CONSTRAINT "user_courses_user_id_course_id_key" UNIQUE ("user_id", "course_id");



ALTER TABLE ONLY "public"."user_handpans"
    ADD CONSTRAINT "user_handpans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_lesson_progress"
    ADD CONSTRAINT "user_lesson_progress_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_lesson_progress"
    ADD CONSTRAINT "user_lesson_progress_user_id_lesson_id_key" UNIQUE ("user_id", "lesson_id");



ALTER TABLE ONLY "public"."weekly_patterns"
    ADD CONSTRAINT "weekly_patterns_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_assignment_folders_created_by" ON "public"."assignment_folders" USING "btree" ("created_by");



CREATE INDEX "idx_assignment_items_assignment_sort" ON "public"."assignment_items" USING "btree" ("assignment_id", "sort_order");



CREATE INDEX "idx_assignment_submissions_student_assignment_id" ON "public"."assignment_submissions" USING "btree" ("student_assignment_id");



CREATE INDEX "idx_assignments_archived" ON "public"."assignments" USING "btree" ("created_by", "is_archived");



CREATE INDEX "idx_assignments_course_id" ON "public"."assignments" USING "btree" ("course_id");



CREATE INDEX "idx_assignments_created_by" ON "public"."assignments" USING "btree" ("created_by");



CREATE INDEX "idx_assignments_folder_id" ON "public"."assignments" USING "btree" ("folder_id");



CREATE INDEX "idx_assignments_sort_order" ON "public"."assignments" USING "btree" ("created_by", "folder_id", "sort_order");



CREATE INDEX "idx_composition_sections_comp_pos" ON "public"."composition_sections" USING "btree" ("composition_id", "position");



CREATE INDEX "idx_compositions_is_snapshot" ON "public"."compositions" USING "btree" ("user_id", "is_snapshot");



CREATE INDEX "idx_compositions_user_id" ON "public"."compositions" USING "btree" ("user_id");



CREATE INDEX "idx_courses_progression_id" ON "public"."courses" USING "btree" ("progression_id") WHERE ("progression_id" IS NOT NULL);



CREATE INDEX "idx_lessons_section_id" ON "public"."lessons" USING "btree" ("section_id");



CREATE INDEX "idx_notifications_user_unread" ON "public"."notifications" USING "btree" ("user_id", "created_at" DESC) WHERE ("read_at" IS NULL);



CREATE INDEX "idx_progression_phrases_prog_pos" ON "public"."progression_phrases" USING "btree" ("progression_id", "position");



CREATE INDEX "idx_progressions_user_id" ON "public"."progressions" USING "btree" ("user_id");



CREATE INDEX "idx_sections_course_id" ON "public"."sections" USING "btree" ("course_id");



CREATE INDEX "idx_student_assignments_assigned_by" ON "public"."student_assignments" USING "btree" ("assigned_by");



CREATE INDEX "idx_student_assignments_assignment_id" ON "public"."student_assignments" USING "btree" ("assignment_id");



CREATE INDEX "idx_student_assignments_status" ON "public"."student_assignments" USING "btree" ("status");



CREATE INDEX "idx_student_assignments_student_id" ON "public"."student_assignments" USING "btree" ("student_id");



CREATE INDEX "idx_submission_item_responses_submission_id" ON "public"."submission_item_responses" USING "btree" ("submission_id");



CREATE INDEX "practice_history_user_id_idx" ON "public"."practice_history" USING "btree" ("user_id");



CREATE INDEX "practice_reminders_user_id_idx" ON "public"."practice_reminders" USING "btree" ("user_id");



CREATE INDEX "push_subscriptions_user_id_idx" ON "public"."push_subscriptions" USING "btree" ("user_id");



CREATE UNIQUE INDEX "shared_patterns_owner_name_unique" ON "public"."shared_patterns" USING "btree" ("user_id", "name");



CREATE INDEX "shared_patterns_share_id_idx" ON "public"."shared_patterns" USING "btree" ("share_id");



CREATE INDEX "student_sessions_teacher_student_idx" ON "public"."student_sessions" USING "btree" ("teacher_id", "student_id");



CREATE OR REPLACE TRIGGER "assignments_set_updated_at" BEFORE UPDATE ON "public"."assignments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "on_like_change" AFTER INSERT OR DELETE ON "public"."pattern_likes" FOR EACH ROW EXECUTE FUNCTION "public"."update_likes_count"();



CREATE OR REPLACE TRIGGER "post_likes_count_trigger" AFTER INSERT OR DELETE ON "public"."post_likes" FOR EACH ROW EXECUTE FUNCTION "public"."update_post_likes_count"();



CREATE OR REPLACE TRIGGER "practice_reminders_set_updated_at" BEFORE UPDATE ON "public"."practice_reminders" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "student_assignments_set_updated_at" BEFORE UPDATE ON "public"."student_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_exercise_progress_update" BEFORE UPDATE ON "public"."student_exercise_progress" FOR EACH ROW EXECUTE FUNCTION "public"."handle_exercise_progress_update"();



CREATE OR REPLACE TRIGGER "trg_notify_student_on_assignment" AFTER INSERT ON "public"."student_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."notify_student_on_assignment"();



CREATE OR REPLACE TRIGGER "trg_notify_student_on_invitation" AFTER INSERT ON "public"."teacher_invitations" FOR EACH ROW EXECUTE FUNCTION "public"."notify_student_on_invitation"();



CREATE OR REPLACE TRIGGER "trg_notify_student_on_review" AFTER UPDATE ON "public"."assignment_submissions" FOR EACH ROW EXECUTE FUNCTION "public"."notify_student_on_review"();



CREATE OR REPLACE TRIGGER "trg_notify_teacher_on_submission" AFTER UPDATE ON "public"."student_assignments" FOR EACH ROW EXECUTE FUNCTION "public"."notify_teacher_on_submission"();



CREATE OR REPLACE TRIGGER "trg_shared_patterns_updated_at" BEFORE UPDATE ON "public"."shared_patterns" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "update_glossary_terms_modtime" BEFORE UPDATE ON "public"."glossary_terms" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();



CREATE OR REPLACE TRIGGER "update_scale_calibrations_updated_at" BEFORE UPDATE ON "public"."scale_calibrations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."assignment_folders"
    ADD CONSTRAINT "assignment_folders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assignment_items"
    ADD CONSTRAINT "assignment_items_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assignment_submissions"
    ADD CONSTRAINT "assignment_submissions_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."assignment_submissions"
    ADD CONSTRAINT "assignment_submissions_student_assignment_id_fkey" FOREIGN KEY ("student_assignment_id") REFERENCES "public"."student_assignments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."assignment_folders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."assignments"
    ADD CONSTRAINT "assignments_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clips"
    ADD CONSTRAINT "clips_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."coaching_sessions"
    ADD CONSTRAINT "coaching_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."comment_likes"
    ADD CONSTRAINT "comment_likes_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."post_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."comment_likes"
    ADD CONSTRAINT "comment_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."community_posts"
    ADD CONSTRAINT "community_posts_shared_pattern_id_fkey" FOREIGN KEY ("shared_pattern_id") REFERENCES "public"."shared_patterns"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."community_posts"
    ADD CONSTRAINT "community_posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."composition_sections"
    ADD CONSTRAINT "composition_sections_composition_id_fkey" FOREIGN KEY ("composition_id") REFERENCES "public"."compositions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."compositions"
    ADD CONSTRAINT "compositions_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."library_folders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."compositions"
    ADD CONSTRAINT "compositions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_preview_lesson_id_fkey" FOREIGN KEY ("preview_lesson_id") REFERENCES "public"."lessons"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_progression_id_fkey" FOREIGN KEY ("progression_id") REFERENCES "public"."progressions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."exercises"
    ADD CONSTRAINT "exercises_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."lessons"
    ADD CONSTRAINT "lessons_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."library_folders"
    ADD CONSTRAINT "library_folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."library_folders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."library_folders"
    ADD CONSTRAINT "library_folders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pattern_likes"
    ADD CONSTRAINT "pattern_likes_pattern_id_fkey" FOREIGN KEY ("pattern_id") REFERENCES "public"."shared_patterns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pattern_likes"
    ADD CONSTRAINT "pattern_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."patterns"
    ADD CONSTRAINT "patterns_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."library_folders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."patterns"
    ADD CONSTRAINT "patterns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."post_comments"
    ADD CONSTRAINT "post_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."community_posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."post_comments"
    ADD CONSTRAINT "post_comments_shared_pattern_id_fkey" FOREIGN KEY ("shared_pattern_id") REFERENCES "public"."shared_patterns"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."post_comments"
    ADD CONSTRAINT "post_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."post_likes"
    ADD CONSTRAINT "post_likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."community_posts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."post_likes"
    ADD CONSTRAINT "post_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."practice_history"
    ADD CONSTRAINT "practice_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."practice_items"
    ADD CONSTRAINT "practice_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."practice_reminders"
    ADD CONSTRAINT "practice_reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_current_course_id_fkey" FOREIGN KEY ("current_course_id") REFERENCES "public"."courses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."progression_phrases"
    ADD CONSTRAINT "progression_phrases_progression_id_fkey" FOREIGN KEY ("progression_id") REFERENCES "public"."progressions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."progressions"
    ADD CONSTRAINT "progressions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."scale_calibrations"
    ADD CONSTRAINT "scale_calibrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sections"
    ADD CONSTRAINT "sections_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shared_patterns"
    ADD CONSTRAINT "shared_patterns_owner_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shared_patterns"
    ADD CONSTRAINT "shared_patterns_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("user_id");



ALTER TABLE ONLY "public"."songs"
    ADD CONSTRAINT "songs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."student_assignments"
    ADD CONSTRAINT "student_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_assignments"
    ADD CONSTRAINT "student_assignments_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_assignments"
    ADD CONSTRAINT "student_assignments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_exercise_progress"
    ADD CONSTRAINT "student_exercise_progress_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_exercise_progress"
    ADD CONSTRAINT "student_exercise_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_sessions"
    ADD CONSTRAINT "student_sessions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."student_sessions"
    ADD CONSTRAINT "student_sessions_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submission_item_responses"
    ADD CONSTRAINT "submission_item_responses_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."assignment_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submission_item_responses"
    ADD CONSTRAINT "submission_item_responses_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."assignment_submissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teacher_invitations"
    ADD CONSTRAINT "teacher_invitations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teacher_invitations"
    ADD CONSTRAINT "teacher_invitations_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teacher_students"
    ADD CONSTRAINT "teacher_students_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."teacher_students"
    ADD CONSTRAINT "teacher_students_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_courses"
    ADD CONSTRAINT "user_courses_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_courses"
    ADD CONSTRAINT "user_courses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_handpans"
    ADD CONSTRAINT "user_handpans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_lesson_progress"
    ADD CONSTRAINT "user_lesson_progress_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_lesson_progress"
    ADD CONSTRAINT "user_lesson_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weekly_patterns"
    ADD CONSTRAINT "weekly_patterns_pattern_id_fkey" FOREIGN KEY ("pattern_id") REFERENCES "public"."patterns"("id") ON DELETE CASCADE;



CREATE POLICY "Admin and owner teacher can delete assignment_items" ON "public"."assignment_items" FOR DELETE USING ((("public"."current_user_role"() = 'admin'::"text") OR (("public"."current_user_role"() = 'teacher'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."assignments" "a"
  WHERE (("a"."id" = "assignment_items"."assignment_id") AND ("a"."created_by" = "auth"."uid"())))))));



CREATE POLICY "Admin and owner teacher can insert assignment_items" ON "public"."assignment_items" FOR INSERT WITH CHECK ((("public"."current_user_role"() = 'admin'::"text") OR (("public"."current_user_role"() = 'teacher'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."assignments" "a"
  WHERE (("a"."id" = "assignment_items"."assignment_id") AND ("a"."created_by" = "auth"."uid"())))))));



CREATE POLICY "Admin and owner teacher can update assignment_items" ON "public"."assignment_items" FOR UPDATE USING ((("public"."current_user_role"() = 'admin'::"text") OR (("public"."current_user_role"() = 'teacher'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."assignments" "a"
  WHERE (("a"."id" = "assignment_items"."assignment_id") AND ("a"."created_by" = "auth"."uid"())))))));



CREATE POLICY "Admin and teacher can assign students" ON "public"."student_assignments" FOR INSERT WITH CHECK ((("public"."current_user_role"() = ANY (ARRAY['admin'::"text", 'teacher'::"text"])) AND ("assigned_by" = "auth"."uid"())));



CREATE POLICY "Admin and teacher can create assignments" ON "public"."assignments" FOR INSERT WITH CHECK ((("public"."current_user_role"() = ANY (ARRAY['admin'::"text", 'teacher'::"text"])) AND ("created_by" = "auth"."uid"())));



CREATE POLICY "Admin and teacher can insert notifications" ON "public"."notifications" FOR INSERT WITH CHECK (("public"."current_user_role"() = ANY (ARRAY['admin'::"text", 'teacher'::"text"])));



CREATE POLICY "Admin can delete any assignment" ON "public"."assignments" FOR DELETE USING (("public"."current_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin can delete any response" ON "public"."submission_item_responses" FOR DELETE USING (("public"."current_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin can delete any submission" ON "public"."assignment_submissions" FOR DELETE USING (("public"."current_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin can delete student_assignments" ON "public"."student_assignments" FOR DELETE USING (("public"."current_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin can read all notifications" ON "public"."notifications" FOR SELECT USING (("public"."current_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin can update any assignment" ON "public"."assignments" FOR UPDATE USING (("public"."current_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin can update any student_assignment" ON "public"."student_assignments" FOR UPDATE USING (("public"."current_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin can update any submission" ON "public"."assignment_submissions" FOR UPDATE USING (("public"."current_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin can view all lesson progress" ON "public"."user_lesson_progress" FOR SELECT USING (("public"."current_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin delete courses" ON "public"."courses" FOR DELETE USING ((("auth"."uid"() = "owner_id") OR ("lower"(("auth"."jwt"() ->> 'email'::"text")) = 'jpitters3@gmail.com'::"text")));



CREATE POLICY "Admin full access" ON "public"."weekly_patterns" USING (("lower"(("auth"."jwt"() ->> 'email'::"text")) = 'jpitters3@gmail.com'::"text"));



CREATE POLICY "Admin full select on assignment_items" ON "public"."assignment_items" FOR SELECT USING (("public"."current_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin full select on assignment_submissions" ON "public"."assignment_submissions" FOR SELECT USING (("public"."current_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin full select on assignments" ON "public"."assignments" FOR SELECT USING (("public"."current_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin full select on student_assignments" ON "public"."student_assignments" FOR SELECT USING (("public"."current_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin full select on submission_item_responses" ON "public"."submission_item_responses" FOR SELECT USING (("public"."current_user_role"() = 'admin'::"text"));



CREATE POLICY "Admins can delete glossary terms" ON "public"."glossary_terms" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."user_id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can insert glossary terms" ON "public"."glossary_terms" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."user_id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins can update glossary terms" ON "public"."glossary_terms" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."user_id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Admins manage all folders" ON "public"."assignment_folders" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."user_id" = "auth"."uid"()) AND ("profiles"."role" = 'admin'::"text")))));



CREATE POLICY "Allow authenticated read access" ON "public"."app_config" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Anyone can read categories" ON "public"."exercise_categories" FOR SELECT USING (true);



CREATE POLICY "Authenticated users can view technique flash cards" ON "public"."technique_flash_cards" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Comment likes are viewable by everyone" ON "public"."comment_likes" FOR SELECT USING (true);



CREATE POLICY "Course owners can manage lessons" ON "public"."lessons" USING ((EXISTS ( SELECT 1
   FROM ("public"."sections"
     JOIN "public"."courses" ON (("sections"."course_id" = "courses"."id")))
  WHERE (("sections"."id" = "lessons"."section_id") AND ("courses"."owner_id" = "auth"."uid"())))));



CREATE POLICY "Course owners can manage sections" ON "public"."sections" USING ((EXISTS ( SELECT 1
   FROM "public"."courses"
  WHERE (("courses"."id" = "sections"."course_id") AND ("courses"."owner_id" = "auth"."uid"())))));



CREATE POLICY "Courses are viewable by everyone" ON "public"."courses" FOR SELECT USING (true);



CREATE POLICY "Enable delete for users based on user_id" ON "public"."shared_patterns" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Enable delete for users based on user_id" ON "public"."songs" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Enable insert for authenticated users" ON "public"."songs" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Enable insert for users based on user_id" ON "public"."shared_patterns" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Enable read access for all users" ON "public"."shared_patterns" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."songs" FOR SELECT USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Enable update for users based on user_id" ON "public"."shared_patterns" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Lessons are viewable by everyone" ON "public"."lessons" FOR SELECT USING (true);



CREATE POLICY "Likes are public" ON "public"."pattern_likes" FOR SELECT USING (true);



CREATE POLICY "Likes are viewable by everyone" ON "public"."post_likes" FOR SELECT USING (true);



CREATE POLICY "Owners can manage their own courses" ON "public"."courses" USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "Public comments are viewable by everyone" ON "public"."post_comments" FOR SELECT USING (true);



CREATE POLICY "Public posts are viewable by everyone" ON "public"."community_posts" FOR SELECT USING (true);



CREATE POLICY "Public profiles are viewable by everyone." ON "public"."glossary_terms" FOR SELECT USING (true);



CREATE POLICY "Public profiles are viewable by everyone." ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "Public read active" ON "public"."weekly_patterns" FOR SELECT USING (("launch_date" <= "now"()));



CREATE POLICY "Sections are viewable by everyone" ON "public"."sections" FOR SELECT USING (true);



CREATE POLICY "Shared Patterns are public" ON "public"."shared_patterns" FOR SELECT USING (("is_public" = true));



CREATE POLICY "Student can create their own submission" ON "public"."assignment_submissions" FOR INSERT WITH CHECK ((("public"."current_user_role"() = 'student'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."student_assignments" "sa"
  WHERE (("sa"."id" = "assignment_submissions"."student_assignment_id") AND ("sa"."student_id" = "auth"."uid"()))))));



CREATE POLICY "Student can insert their own responses" ON "public"."submission_item_responses" FOR INSERT WITH CHECK ((("public"."current_user_role"() = 'student'::"text") AND (EXISTS ( SELECT 1
   FROM ("public"."assignment_submissions" "asub"
     JOIN "public"."student_assignments" "sa" ON (("sa"."id" = "asub"."student_assignment_id")))
  WHERE (("asub"."id" = "submission_item_responses"."submission_id") AND ("sa"."student_id" = "auth"."uid"()))))));



CREATE POLICY "Student can update own assignment status" ON "public"."student_assignments" FOR UPDATE USING ((("public"."current_user_role"() = 'student'::"text") AND ("student_id" = "auth"."uid"()))) WITH CHECK ((("student_id" = "auth"."uid"()) AND ("status" = ANY (ARRAY['in_progress'::"text", 'submitted'::"text"]))));



CREATE POLICY "Student can update responses before submission" ON "public"."submission_item_responses" FOR UPDATE USING ((("public"."current_user_role"() = 'student'::"text") AND (EXISTS ( SELECT 1
   FROM ("public"."assignment_submissions" "asub"
     JOIN "public"."student_assignments" "sa" ON (("sa"."id" = "asub"."student_assignment_id")))
  WHERE (("asub"."id" = "submission_item_responses"."submission_id") AND ("sa"."student_id" = "auth"."uid"()) AND ("sa"."status" <> ALL (ARRAY['submitted'::"text", 'reviewed'::"text"])))))));



CREATE POLICY "Student can view own invitations" ON "public"."teacher_invitations" FOR SELECT USING (("student_id" = "auth"."uid"()));



CREATE POLICY "Student can view their teachers" ON "public"."teacher_students" FOR SELECT USING (("student_id" = "auth"."uid"()));



CREATE POLICY "Student sees their own responses" ON "public"."submission_item_responses" FOR SELECT USING ((("public"."current_user_role"() = 'student'::"text") AND (EXISTS ( SELECT 1
   FROM ("public"."assignment_submissions" "asub"
     JOIN "public"."student_assignments" "sa" ON (("sa"."id" = "asub"."student_assignment_id")))
  WHERE (("asub"."id" = "submission_item_responses"."submission_id") AND ("sa"."student_id" = "auth"."uid"()))))));



CREATE POLICY "Student sees their own student_assignments" ON "public"."student_assignments" FOR SELECT USING ((("public"."current_user_role"() = 'student'::"text") AND ("student_id" = "auth"."uid"())));



CREATE POLICY "Student sees their own submissions" ON "public"."assignment_submissions" FOR SELECT USING ((("public"."current_user_role"() = 'student'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."student_assignments" "sa"
  WHERE (("sa"."id" = "assignment_submissions"."student_assignment_id") AND ("sa"."student_id" = "auth"."uid"()))))));



CREATE POLICY "Student selects items for their assigned assignments" ON "public"."assignment_items" FOR SELECT USING ((("public"."current_user_role"() = 'student'::"text") AND (EXISTS ( SELECT 1
   FROM ("public"."student_assignments" "sa"
     JOIN "public"."assignments" "a" ON (("a"."id" = "sa"."assignment_id")))
  WHERE (("sa"."assignment_id" = "assignment_items"."assignment_id") AND ("sa"."student_id" = "auth"."uid"()) AND ("a"."is_published" = true))))));



CREATE POLICY "Student selects their assigned published assignments" ON "public"."assignments" FOR SELECT USING ((("public"."current_user_role"() = 'student'::"text") AND ("is_published" = true) AND (EXISTS ( SELECT 1
   FROM "public"."student_assignments" "sa"
  WHERE (("sa"."assignment_id" = "assignments"."id") AND ("sa"."student_id" = "auth"."uid"()))))));



CREATE POLICY "Students can delete own progress" ON "public"."student_exercise_progress" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Students can insert own progress" ON "public"."student_exercise_progress" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Students can update own progress" ON "public"."student_exercise_progress" FOR UPDATE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Students can view own progress" ON "public"."student_exercise_progress" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Teacher can create invitations" ON "public"."teacher_invitations" FOR INSERT WITH CHECK ((("public"."current_user_role"() = ANY (ARRAY['teacher'::"text", 'admin'::"text"])) AND ("teacher_id" = "auth"."uid"())));



CREATE POLICY "Teacher can delete own assignments" ON "public"."assignments" FOR DELETE USING ((("public"."current_user_role"() = 'teacher'::"text") AND ("created_by" = "auth"."uid"())));



CREATE POLICY "Teacher can delete their student_assignments" ON "public"."student_assignments" FOR DELETE USING ((("public"."current_user_role"() = 'teacher'::"text") AND ("assigned_by" = "auth"."uid"())));



CREATE POLICY "Teacher can remove their students" ON "public"."teacher_students" FOR DELETE USING (("teacher_id" = "auth"."uid"()));



CREATE POLICY "Teacher can update own assignments" ON "public"."assignments" FOR UPDATE USING ((("public"."current_user_role"() = 'teacher'::"text") AND ("created_by" = "auth"."uid"())));



CREATE POLICY "Teacher can update submissions for their students" ON "public"."assignment_submissions" FOR UPDATE USING ((("public"."current_user_role"() = 'teacher'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."student_assignments" "sa"
  WHERE (("sa"."id" = "assignment_submissions"."student_assignment_id") AND ("sa"."assigned_by" = "auth"."uid"()))))));



CREATE POLICY "Teacher can update their student_assignments" ON "public"."student_assignments" FOR UPDATE USING ((("public"."current_user_role"() = 'teacher'::"text") AND ("assigned_by" = "auth"."uid"())));



CREATE POLICY "Teacher can view own invitations" ON "public"."teacher_invitations" FOR SELECT USING (("teacher_id" = "auth"."uid"()));



CREATE POLICY "Teacher can view their students" ON "public"."teacher_students" FOR SELECT USING (("teacher_id" = "auth"."uid"()));



CREATE POLICY "Teacher can view their students courses" ON "public"."user_courses" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."teacher_students" "ts"
  WHERE (("ts"."teacher_id" = "auth"."uid"()) AND ("ts"."student_id" = "user_courses"."user_id")))));



CREATE POLICY "Teacher can view their students lesson progress" ON "public"."user_lesson_progress" FOR SELECT USING ((("public"."current_user_role"() = 'teacher'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."student_assignments" "sa"
  WHERE (("sa"."student_id" = "user_lesson_progress"."user_id") AND ("sa"."assigned_by" = "auth"."uid"()))))));



CREATE POLICY "Teacher can view their students practice items" ON "public"."practice_items" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."teacher_students" "ts"
  WHERE (("ts"."teacher_id" = "auth"."uid"()) AND ("ts"."student_id" = "practice_items"."user_id")))));



CREATE POLICY "Teacher sees responses for their students" ON "public"."submission_item_responses" FOR SELECT USING ((("public"."current_user_role"() = 'teacher'::"text") AND (EXISTS ( SELECT 1
   FROM ("public"."assignment_submissions" "asub"
     JOIN "public"."student_assignments" "sa" ON (("sa"."id" = "asub"."student_assignment_id")))
  WHERE (("asub"."id" = "submission_item_responses"."submission_id") AND ("sa"."assigned_by" = "auth"."uid"()))))));



CREATE POLICY "Teacher sees submissions for their students" ON "public"."assignment_submissions" FOR SELECT USING ((("public"."current_user_role"() = 'teacher'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."student_assignments" "sa"
  WHERE (("sa"."id" = "assignment_submissions"."student_assignment_id") AND ("sa"."assigned_by" = "auth"."uid"()))))));



CREATE POLICY "Teacher sees their assigned student_assignments" ON "public"."student_assignments" FOR SELECT USING ((("public"."current_user_role"() = 'teacher'::"text") AND ("assigned_by" = "auth"."uid"())));



CREATE POLICY "Teacher selects items for own or published assignments" ON "public"."assignment_items" FOR SELECT USING ((("public"."current_user_role"() = 'teacher'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."assignments" "a"
  WHERE (("a"."id" = "assignment_items"."assignment_id") AND (("a"."created_by" = "auth"."uid"()) OR ("a"."is_published" = true)))))));



CREATE POLICY "Teacher selects own and published assignments" ON "public"."assignments" FOR SELECT USING ((("public"."current_user_role"() = 'teacher'::"text") AND (("created_by" = "auth"."uid"()) OR ("is_published" = true))));



CREATE POLICY "Teachers and admins can manage categories" ON "public"."exercise_categories" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."user_id" = "auth"."uid"()) AND ("profiles"."role" = ANY (ARRAY['teacher'::"text", 'admin'::"text"]))))));



CREATE POLICY "Teachers can manage technique flash cards" ON "public"."technique_flash_cards" USING (("public"."current_user_role"() = ANY (ARRAY['teacher'::"text", 'admin'::"text"])));



CREATE POLICY "Teachers manage own folders" ON "public"."assignment_folders" USING (("created_by" = "auth"."uid"())) WITH CHECK (("created_by" = "auth"."uid"()));



CREATE POLICY "User can delete own notification preferences" ON "public"."notification_preferences" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "User can delete own notifications" ON "public"."notifications" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "User can insert own notification preferences" ON "public"."notification_preferences" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "User can mark own notifications as read" ON "public"."notifications" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "User can read own notification preferences" ON "public"."notification_preferences" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "User can update own notification preferences" ON "public"."notification_preferences" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "User sees own notifications" ON "public"."notifications" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own patterns" ON "public"."patterns" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can delete own progress" ON "public"."user_lesson_progress" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own calibrations" ON "public"."scale_calibrations" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own comments" ON "public"."post_comments" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own handpans" ON "public"."user_handpans" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own posts" ON "public"."community_posts" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own practice items" ON "public"."practice_items" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own push subscriptions" ON "public"."push_subscriptions" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own reminders" ON "public"."practice_reminders" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own shared patterns" ON "public"."shared_patterns" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own patterns" ON "public"."patterns" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can insert their own calibrations" ON "public"."scale_calibrations" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own coaching sessions" ON "public"."coaching_sessions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own comments" ON "public"."post_comments" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own handpans" ON "public"."user_handpans" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own posts" ON "public"."community_posts" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own practice history" ON "public"."practice_history" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own practice items" ON "public"."practice_items" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own profile." ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own push subscriptions" ON "public"."push_subscriptions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own reminders" ON "public"."practice_reminders" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can like comments" ON "public"."comment_likes" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can like patterns" ON "public"."pattern_likes" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can like posts" ON "public"."post_likes" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own patterns" ON "public"."patterns" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can share patterns" ON "public"."shared_patterns" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can unlike comments" ON "public"."comment_likes" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can unlike patterns" ON "public"."pattern_likes" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can unlike posts" ON "public"."post_likes" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own patterns" ON "public"."patterns" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Users can update own practice items" ON "public"."practice_items" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile." ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own progress" ON "public"."user_lesson_progress" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own calibrations" ON "public"."scale_calibrations" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own handpans" ON "public"."user_handpans" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own posts" ON "public"."community_posts" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own practice items" ON "public"."practice_items" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own reminders" ON "public"."practice_reminders" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own progress" ON "public"."user_lesson_progress" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own calibrations" ON "public"."scale_calibrations" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own coaching sessions" ON "public"."coaching_sessions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own handpans" ON "public"."user_handpans" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own practice history" ON "public"."practice_history" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own practice items" ON "public"."practice_items" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own push subscriptions" ON "public"."push_subscriptions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own reminders" ON "public"."practice_reminders" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users manage own folders" ON "public"."library_folders" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."app_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."assignment_folders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."assignment_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."assignment_submissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clips" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clips_own" ON "public"."clips" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."coaching_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."comment_likes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."community_posts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."composition_sections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "composition_sections_shared_read" ON "public"."composition_sections" FOR SELECT TO "authenticated", "anon" USING (("composition_id" IN ( SELECT "compositions"."id"
   FROM "public"."compositions"
  WHERE ("compositions"."share_token" IS NOT NULL))));



CREATE POLICY "composition_sections_user_all" ON "public"."composition_sections" TO "authenticated" USING (("composition_id" IN ( SELECT "compositions"."id"
   FROM "public"."compositions"
  WHERE ("compositions"."user_id" = "auth"."uid"())))) WITH CHECK (("composition_id" IN ( SELECT "compositions"."id"
   FROM "public"."compositions"
  WHERE ("compositions"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."compositions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "compositions_shared_read" ON "public"."compositions" FOR SELECT TO "authenticated", "anon" USING (("share_token" IS NOT NULL));



CREATE POLICY "compositions_user_all" ON "public"."compositions" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."courses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exercise_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exercises" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "exercises_delete" ON "public"."exercises" FOR DELETE USING ((("created_by" = "auth"."uid"()) OR ("public"."current_user_role"() = 'admin'::"text")));



CREATE POLICY "exercises_insert" ON "public"."exercises" FOR INSERT WITH CHECK ((("created_by" = "auth"."uid"()) AND ("public"."current_user_role"() = ANY (ARRAY['teacher'::"text", 'admin'::"text"]))));



CREATE POLICY "exercises_select" ON "public"."exercises" FOR SELECT USING ((("created_by" IS NULL) OR ("public"."current_user_role_for"("created_by") = 'admin'::"text") OR ("created_by" = "auth"."uid"())));



CREATE POLICY "exercises_update" ON "public"."exercises" FOR UPDATE USING ((("created_by" = "auth"."uid"()) OR ("public"."current_user_role"() = 'admin'::"text")));



ALTER TABLE "public"."glossary_terms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lessons" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."library_folders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."method_rhythms" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "method_rhythms_admin_update" ON "public"."method_rhythms" FOR UPDATE USING ((("auth"."jwt"() ->> 'email'::"text") = 'jpitters3@gmail.com'::"text"));



CREATE POLICY "method_rhythms_read" ON "public"."method_rhythms" FOR SELECT USING (("active" = true));



ALTER TABLE "public"."notification_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "owner can delete shares" ON "public"."shared_patterns" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "owner can insert shares" ON "public"."shared_patterns" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "owner can update shares" ON "public"."shared_patterns" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."pattern_likes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."patterns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "patterns_shared_read" ON "public"."patterns" FOR SELECT TO "authenticated", "anon" USING (("name" IN ( SELECT "cs"."phrase_name"
   FROM ("public"."composition_sections" "cs"
     JOIN "public"."compositions" "c" ON (("c"."id" = "cs"."composition_id")))
  WHERE (("c"."share_token" IS NOT NULL) AND ("cs"."phrase_name" IS NOT NULL)))));



ALTER TABLE "public"."post_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."post_likes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."practice_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."practice_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."practice_reminders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."progression_phrases" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "progression_phrases_user_all" ON "public"."progression_phrases" TO "authenticated" USING (("progression_id" IN ( SELECT "progressions"."id"
   FROM "public"."progressions"
  WHERE ("progressions"."user_id" = "auth"."uid"())))) WITH CHECK (("progression_id" IN ( SELECT "progressions"."id"
   FROM "public"."progressions"
  WHERE ("progressions"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."progressions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "progressions_user_all" ON "public"."progressions" TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "public can read public shares" ON "public"."shared_patterns" FOR SELECT USING (("is_public" = true));



ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scale_calibrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shared_patterns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."songs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."student_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."student_exercise_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."student_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."submission_item_responses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "teacher_delete_sessions" ON "public"."student_sessions" FOR DELETE USING (("teacher_id" = "auth"."uid"()));



CREATE POLICY "teacher_insert_sessions" ON "public"."student_sessions" FOR INSERT WITH CHECK (("teacher_id" = "auth"."uid"()));



ALTER TABLE "public"."teacher_invitations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "teacher_select_sessions" ON "public"."student_sessions" FOR SELECT USING (("teacher_id" = "auth"."uid"()));



ALTER TABLE "public"."teacher_students" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "teacher_update_sessions" ON "public"."student_sessions" FOR UPDATE USING (("teacher_id" = "auth"."uid"()));



ALTER TABLE "public"."technique_flash_cards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_courses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_courses_delete_owner" ON "public"."user_courses" FOR DELETE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "user_courses_insert_owner" ON "public"."user_courses" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "user_courses_select_owner" ON "public"."user_courses" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "user_courses_update_owner" ON "public"."user_courses" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."user_handpans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_lesson_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."weekly_patterns" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."accept_teacher_invitation"("p_invitation_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."accept_teacher_invitation"("p_invitation_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_teacher_invitation"("p_invitation_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."accept_teacher_invitation_by_token"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."accept_teacher_invitation_by_token"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_teacher_invitation_by_token"("p_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_email_exists"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_email_exists"("p_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_email_exists"("p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_email_exists"("p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."copy_course_sections"("source_course_id" "uuid", "target_course_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."copy_course_sections"("source_course_id" "uuid", "target_course_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."copy_course_sections"("source_course_id" "uuid", "target_course_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_teacher_invitation"("p_student_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_teacher_invitation"("p_student_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_teacher_invitation"("p_student_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_teacher_invitation"("p_student_email" "text", "p_course_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."create_teacher_invitation"("p_student_email" "text", "p_course_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_teacher_invitation"("p_student_email" "text", "p_course_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."current_user_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_user_role_for"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_role_for"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_role_for"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."decline_teacher_invitation"("p_invitation_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."decline_teacher_invitation"("p_invitation_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."decline_teacher_invitation"("p_invitation_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."assignment_items" TO "anon";
GRANT ALL ON TABLE "public"."assignment_items" TO "authenticated";
GRANT ALL ON TABLE "public"."assignment_items" TO "service_role";



GRANT ALL ON FUNCTION "public"."get_assignment_items_for_student"("p_assignment_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_assignment_items_for_student"("p_assignment_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_assignment_items_for_student"("p_assignment_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_student_exercise_progress"("p_student_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_student_exercise_progress"("p_student_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_student_exercise_progress"("p_student_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_students_for_teacher"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_students_for_teacher"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_students_for_teacher"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_exercise_progress_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_exercise_progress_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_exercise_progress_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_student_on_assignment"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_student_on_assignment"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_student_on_assignment"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_student_on_invitation"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_student_on_invitation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_student_on_invitation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_student_on_review"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_student_on_review"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_student_on_review"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_teacher_on_submission"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_teacher_on_submission"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_teacher_on_submission"() TO "service_role";



GRANT ALL ON FUNCTION "public"."process_pending_invitations"() TO "anon";
GRANT ALL ON FUNCTION "public"."process_pending_invitations"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_pending_invitations"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_likes_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_likes_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_likes_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_modified_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_modified_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_modified_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_post_likes_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_post_likes_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_post_likes_count"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON TABLE "public"."app_config" TO "anon";
GRANT ALL ON TABLE "public"."app_config" TO "authenticated";
GRANT ALL ON TABLE "public"."app_config" TO "service_role";



GRANT ALL ON TABLE "public"."assignment_folders" TO "anon";
GRANT ALL ON TABLE "public"."assignment_folders" TO "authenticated";
GRANT ALL ON TABLE "public"."assignment_folders" TO "service_role";



GRANT ALL ON TABLE "public"."assignment_submissions" TO "anon";
GRANT ALL ON TABLE "public"."assignment_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."assignment_submissions" TO "service_role";



GRANT ALL ON TABLE "public"."assignments" TO "anon";
GRANT ALL ON TABLE "public"."assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."assignments" TO "service_role";



GRANT ALL ON TABLE "public"."clips" TO "anon";
GRANT ALL ON TABLE "public"."clips" TO "authenticated";
GRANT ALL ON TABLE "public"."clips" TO "service_role";



GRANT ALL ON TABLE "public"."coaching_sessions" TO "anon";
GRANT ALL ON TABLE "public"."coaching_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."coaching_sessions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."coaching_sessions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."coaching_sessions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."coaching_sessions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."comment_likes" TO "anon";
GRANT ALL ON TABLE "public"."comment_likes" TO "authenticated";
GRANT ALL ON TABLE "public"."comment_likes" TO "service_role";



GRANT ALL ON TABLE "public"."community_posts" TO "anon";
GRANT ALL ON TABLE "public"."community_posts" TO "authenticated";
GRANT ALL ON TABLE "public"."community_posts" TO "service_role";



GRANT ALL ON TABLE "public"."composition_sections" TO "anon";
GRANT ALL ON TABLE "public"."composition_sections" TO "authenticated";
GRANT ALL ON TABLE "public"."composition_sections" TO "service_role";



GRANT ALL ON TABLE "public"."compositions" TO "anon";
GRANT ALL ON TABLE "public"."compositions" TO "authenticated";
GRANT ALL ON TABLE "public"."compositions" TO "service_role";



GRANT ALL ON TABLE "public"."courses" TO "anon";
GRANT ALL ON TABLE "public"."courses" TO "authenticated";
GRANT ALL ON TABLE "public"."courses" TO "service_role";



GRANT ALL ON TABLE "public"."exercise_categories" TO "anon";
GRANT ALL ON TABLE "public"."exercise_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."exercise_categories" TO "service_role";



GRANT ALL ON TABLE "public"."exercises" TO "anon";
GRANT ALL ON TABLE "public"."exercises" TO "authenticated";
GRANT ALL ON TABLE "public"."exercises" TO "service_role";



GRANT ALL ON TABLE "public"."glossary_terms" TO "anon";
GRANT ALL ON TABLE "public"."glossary_terms" TO "authenticated";
GRANT ALL ON TABLE "public"."glossary_terms" TO "service_role";



GRANT ALL ON TABLE "public"."lessons" TO "anon";
GRANT ALL ON TABLE "public"."lessons" TO "authenticated";
GRANT ALL ON TABLE "public"."lessons" TO "service_role";



GRANT ALL ON TABLE "public"."library_folders" TO "anon";
GRANT ALL ON TABLE "public"."library_folders" TO "authenticated";
GRANT ALL ON TABLE "public"."library_folders" TO "service_role";



GRANT ALL ON TABLE "public"."method_rhythms" TO "anon";
GRANT ALL ON TABLE "public"."method_rhythms" TO "authenticated";
GRANT ALL ON TABLE "public"."method_rhythms" TO "service_role";



GRANT ALL ON TABLE "public"."notification_preferences" TO "anon";
GRANT ALL ON TABLE "public"."notification_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."pattern_likes" TO "anon";
GRANT ALL ON TABLE "public"."pattern_likes" TO "authenticated";
GRANT ALL ON TABLE "public"."pattern_likes" TO "service_role";



GRANT ALL ON TABLE "public"."patterns" TO "anon";
GRANT ALL ON TABLE "public"."patterns" TO "authenticated";
GRANT ALL ON TABLE "public"."patterns" TO "service_role";



GRANT ALL ON TABLE "public"."post_comments" TO "anon";
GRANT ALL ON TABLE "public"."post_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."post_comments" TO "service_role";



GRANT ALL ON TABLE "public"."post_likes" TO "anon";
GRANT ALL ON TABLE "public"."post_likes" TO "authenticated";
GRANT ALL ON TABLE "public"."post_likes" TO "service_role";



GRANT ALL ON TABLE "public"."practice_history" TO "anon";
GRANT ALL ON TABLE "public"."practice_history" TO "authenticated";
GRANT ALL ON TABLE "public"."practice_history" TO "service_role";



GRANT ALL ON TABLE "public"."practice_items" TO "anon";
GRANT ALL ON TABLE "public"."practice_items" TO "authenticated";
GRANT ALL ON TABLE "public"."practice_items" TO "service_role";



GRANT ALL ON TABLE "public"."practice_reminders" TO "anon";
GRANT ALL ON TABLE "public"."practice_reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."practice_reminders" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."progression_phrases" TO "anon";
GRANT ALL ON TABLE "public"."progression_phrases" TO "authenticated";
GRANT ALL ON TABLE "public"."progression_phrases" TO "service_role";



GRANT ALL ON TABLE "public"."progressions" TO "anon";
GRANT ALL ON TABLE "public"."progressions" TO "authenticated";
GRANT ALL ON TABLE "public"."progressions" TO "service_role";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."scale_calibrations" TO "anon";
GRANT ALL ON TABLE "public"."scale_calibrations" TO "authenticated";
GRANT ALL ON TABLE "public"."scale_calibrations" TO "service_role";



GRANT ALL ON TABLE "public"."sections" TO "anon";
GRANT ALL ON TABLE "public"."sections" TO "authenticated";
GRANT ALL ON TABLE "public"."sections" TO "service_role";



GRANT ALL ON TABLE "public"."shared_patterns" TO "anon";
GRANT ALL ON TABLE "public"."shared_patterns" TO "authenticated";
GRANT ALL ON TABLE "public"."shared_patterns" TO "service_role";



GRANT ALL ON TABLE "public"."songs" TO "anon";
GRANT ALL ON TABLE "public"."songs" TO "authenticated";
GRANT ALL ON TABLE "public"."songs" TO "service_role";



GRANT ALL ON TABLE "public"."student_assignments" TO "anon";
GRANT ALL ON TABLE "public"."student_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."student_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."student_exercise_progress" TO "anon";
GRANT ALL ON TABLE "public"."student_exercise_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."student_exercise_progress" TO "service_role";



GRANT ALL ON TABLE "public"."student_sessions" TO "anon";
GRANT ALL ON TABLE "public"."student_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."student_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."submission_item_responses" TO "anon";
GRANT ALL ON TABLE "public"."submission_item_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."submission_item_responses" TO "service_role";



GRANT ALL ON TABLE "public"."teacher_invitations" TO "anon";
GRANT ALL ON TABLE "public"."teacher_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."teacher_invitations" TO "service_role";



GRANT ALL ON TABLE "public"."teacher_students" TO "anon";
GRANT ALL ON TABLE "public"."teacher_students" TO "authenticated";
GRANT ALL ON TABLE "public"."teacher_students" TO "service_role";



GRANT ALL ON TABLE "public"."technique_flash_cards" TO "anon";
GRANT ALL ON TABLE "public"."technique_flash_cards" TO "authenticated";
GRANT ALL ON TABLE "public"."technique_flash_cards" TO "service_role";



GRANT ALL ON TABLE "public"."user_courses" TO "anon";
GRANT ALL ON TABLE "public"."user_courses" TO "authenticated";
GRANT ALL ON TABLE "public"."user_courses" TO "service_role";



GRANT ALL ON TABLE "public"."user_handpans" TO "anon";
GRANT ALL ON TABLE "public"."user_handpans" TO "authenticated";
GRANT ALL ON TABLE "public"."user_handpans" TO "service_role";



GRANT ALL ON TABLE "public"."user_lesson_progress" TO "anon";
GRANT ALL ON TABLE "public"."user_lesson_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."user_lesson_progress" TO "service_role";



GRANT ALL ON TABLE "public"."weekly_patterns" TO "anon";
GRANT ALL ON TABLE "public"."weekly_patterns" TO "authenticated";
GRANT ALL ON TABLE "public"."weekly_patterns" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







