-- ================================================================
-- Migration: lesson-assignment link + invite course pre-selection
-- Run in the Supabase SQL editor
-- ================================================================

-- 1. Direct lesson → assignment link
ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS lesson_id uuid REFERENCES lessons(id) ON DELETE SET NULL;

-- 2. Course pre-selection on invitations
ALTER TABLE teacher_invitations
  ADD COLUMN IF NOT EXISTS course_ids uuid[] DEFAULT '{}';


-- ================================================================
-- Updated RPC: create_teacher_invitation
-- Adds optional p_course_ids parameter.
-- NOTE: This is a CREATE OR REPLACE — check your existing body for
--       any notification/trigger logic and fold it in if needed.
-- ================================================================
CREATE OR REPLACE FUNCTION create_teacher_invitation(
  p_student_email text,
  p_course_ids     uuid[] DEFAULT '{}'
)
RETURNS TABLE(invitation_id uuid, token text, student_exists boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    INSERT INTO notifications (user_id, type, data)
    VALUES (
      v_student_id,
      'teacher_invitation',
      jsonb_build_object('invitation_id', v_inv_id, 'teacher_id', v_teacher_id)
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN QUERY SELECT v_inv_id, v_token, (v_student_id IS NOT NULL);
END;
$$;


-- ================================================================
-- Updated RPC: accept_teacher_invitation_by_token
-- Adds auto-enrollment + auto-assignment after linking teacher↔student.
-- ================================================================
CREATE OR REPLACE FUNCTION accept_teacher_invitation_by_token(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv         teacher_invitations%ROWTYPE;
  v_student_id  uuid := auth.uid();
  v_course_id   uuid;
  v_asgn_id     uuid;
BEGIN
  -- Fetch unaccepted invitation
  SELECT * INTO v_inv
  FROM teacher_invitations
  WHERE token = p_token
    AND accepted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found or already accepted';
  END IF;

  -- Link teacher ↔ student
  INSERT INTO teacher_students (teacher_id, student_id)
  VALUES (v_inv.teacher_id, v_student_id)
  ON CONFLICT DO NOTHING;

  -- Mark accepted
  UPDATE teacher_invitations
  SET accepted_at = now(), student_id = v_student_id
  WHERE id = v_inv.id;

  -- Auto-enroll + auto-assign for each pre-selected course
  FOREACH v_course_id IN ARRAY COALESCE(v_inv.course_ids, '{}') LOOP

    INSERT INTO user_courses (user_id, course_id)
    VALUES (v_student_id, v_course_id)
    ON CONFLICT DO NOTHING;

    -- First lesson in the course that has a linked assignment
    SELECT a.id INTO v_asgn_id
    FROM assignments a
    JOIN lessons   l ON l.id = a.lesson_id
    JOIN sections  s ON s.id = l.section_id
    WHERE s.course_id  = v_course_id
      AND a.is_published = true
    ORDER BY s.order_index ASC, l.order_index ASC
    LIMIT 1;

    IF v_asgn_id IS NOT NULL THEN
      INSERT INTO student_assignments (student_id, assignment_id, assigned_by, status)
      VALUES (v_student_id, v_asgn_id, v_inv.teacher_id, 'assigned')
      ON CONFLICT DO NOTHING;
    END IF;

  END LOOP;
END;
$$;
