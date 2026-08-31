-- SQL Script to copy all sections and lessons from one course to another by value.
-- Run this in your Supabase or PostgreSQL SQL Editor.

CREATE OR REPLACE FUNCTION copy_course_sections(
  source_course_id UUID,
  target_course_id UUID
) RETURNS void AS $$
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
$$ LANGUAGE plpgsql;

/*
================================================================================
EXAMPLE USAGE:
================================================================================

1. Run the above CREATE FUNCTION block to save the function to your database.
2. Call the function with your specific UUIDs:

SELECT copy_course_sections(
  'e2d3c1a4-9b8a-7f6e-5d4c-3b2a1a0b9c8d', -- ID of the course to COPY FROM
  '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d'  -- ID of the course to PASTE TO
);

*/
