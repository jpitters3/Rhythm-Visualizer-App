-- Allow a lesson to have no linked phrase.
--
-- pattern_json was NOT NULL, so every lesson had to carry *some* pattern
-- data. js/course-creator.js worked around that by silently defaulting
-- every new lesson's pattern_json to a snapshot of whatever was in the
-- Studio grid at the time (`serializePattern()`) — so lessons the teacher
-- never intended to link to a phrase loaded one anyway. NULL now means
-- "no phrase", matching the new "None" option in the ASSOCIATED PATTERN
-- dropdown (js/course-creator.js) and js/courses.js's loadLesson(), which
-- clears the Studio grid when pattern_json is null.
ALTER TABLE public.lessons
  ALTER COLUMN pattern_json DROP NOT NULL;
