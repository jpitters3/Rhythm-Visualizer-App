-- Attempt to insert a single test pattern into weekly_patterns
-- We pick the first available pattern from the patterns table.
INSERT INTO public.weekly_patterns (pattern_id, launch_date, difficulty, description)
SELECT id, now(), 5, 'Debug Test Pattern'
FROM public.patterns
LIMIT 1;
