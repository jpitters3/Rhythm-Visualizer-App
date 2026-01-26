-- Refined SQL Script to Generate Comprehensive Handpan Curriculum
-- Run this in the Supabase SQL Editor
DO $$
DECLARE
  v_owner_id uuid;
  c1_id uuid;
  c2_id uuid;
  c3_id uuid;
BEGIN
  -- 1. GET USER ID
  v_owner_id := '70e1b0b1-9b92-4be0-aae7-af79e5866279';
  
  -- Fallback: Replace 'your-uuid-here' with your actual UUID if running manually as admin
  -- v_owner_id := 'your-uuid-here'; 
  
  IF v_owner_id IS NULL THEN
     RAISE EXCEPTION 'User ID is null. Please ensure you are logged in or manually set v_owner_id in the script.';
  END IF;
  -- ==================================================================================
  -- COURSE 1: BASICS (Foundations)
  -- ==================================================================================
  
  INSERT INTO courses (title, description, owner_id, is_published)
  VALUES (
    'Course 1: Basics', 
    'Establish your foundations: posture, ergonomics, sound production, and the heartbeat of the Ding.',
    v_owner_id,
    false -- Draft
  ) RETURNING id INTO c1_id;
  INSERT INTO sections (course_id, title, order_index, is_published) VALUES
  (c1_id, 'Posture & Ergonomics', 0, false),
  (c1_id, 'Mapping your Pan (Scale Navigation)', 1, false),
  (c1_id, 'Sound Production (Best Touch)', 2, false),
  (c1_id, 'Hand to Hand (R L R L)', 3, false),
  (c1_id, 'Simple Meditative Patterns', 4, false),
  (c1_id, 'The Ding (Home / Pulse)', 5, false),
  (c1_id, 'Accents & Groove', 6, false),
  (c1_id, 'Standard Rhythms & Grooves', 7, false);
  -- ==================================================================================
  -- COURSE 2: GROWTH (Flow & Independence)
  -- ==================================================================================
  INSERT INTO courses (title, description, owner_id, is_published)
  VALUES (
    'Course 2: Growth', 
    'Develop the "glue" of your playing with ghost notes, explore odd meters, and master hand independence.',
    v_owner_id,
    false
  ) RETURNING id INTO c2_id;
  INSERT INTO sections (course_id, title, order_index, is_published) VALUES
  (c2_id, 'Dynamics & Emotion', 0, false),
  (c2_id, 'Ghost Notes (The Glue)', 1, false),
  (c2_id, 'Hand Independence (Polyphony)', 2, false),
  (c2_id, 'Harmonics & Flages (Bells)', 3, false),
  (c2_id, 'Odd Meters (5/4, 7/8)', 4, false);
  -- ==================================================================================
  -- COURSE 3: MUSICIANSHIP (Artistry & Storytelling)
  -- ==================================================================================
  INSERT INTO courses (title, description, owner_id, is_published)
  VALUES (
    'Course 3: Musicianship', 
    'Move beyond patterns into composition: structure, story, music theory, and motif variation.',
    v_owner_id,
    false
  ) RETURNING id INTO c3_id;
  INSERT INTO sections (course_id, title, order_index, is_published) VALUES
  (c3_id, 'Musical Structure', 0, false),
  (c3_id, 'Applied Music Theory (Chords/Melody)', 1, false),
  (c3_id, 'Motif Variation (Creative Bridge)', 2, false),
  (c3_id, 'The Power of Silence (Space)', 3, false),
  (c3_id, 'Mastery & Storytelling', 4, false);
  RAISE NOTICE 'Comprehensive curriculum generated successfully for user %', v_owner_id;
END $$;