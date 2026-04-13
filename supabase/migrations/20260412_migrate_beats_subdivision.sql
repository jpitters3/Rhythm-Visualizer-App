-- ============================================================
-- Migration: beats/subdivision model — Phase 1 (safe batch)
--
-- Only migrates patterns that:
--   1. Belong to the invoking user (RLS already enforces this,
--      but the WHERE clause makes it explicit for manual runs)
--   2. Are NOT referenced by name in any lessons row
--      (lessons.pattern_name is a soft FK to patterns.name)
--
-- Patterns used by courses are intentionally left untouched so
-- that live course content continues to work while the JS shim
-- (migratePatternState) is still in place.
--
-- Run Phase 2 (course patterns) separately once:
--   a) lessons.pattern_json has been verified / migrated, and
--   b) the course editor has been updated to write the new format.
--
-- Conversion rules:
--   beats       = numerator of old timeSignature   (default 4)
--   base        = 16 if mode='16', else 8
--   subdivision = ROUND(base / denominator)         (default 2)
--   Minimum subdivision = 1
--
-- Examples:
--   mode='8',  ts='4/4' → beats=4, sub=2
--   mode='16', ts='4/4' → beats=4, sub=4
--   mode='8',  ts='3/4' → beats=3, sub=2
--   mode='8',  ts='6/8' → beats=6, sub=1
-- ============================================================

-- ── Helper ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _migrate_pattern_jsonb(data jsonb)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  ts     text;
  num    int;
  den    int;
  base   int;
  sub    int;
  result jsonb;
  gb     jsonb;
BEGIN
  IF data IS NULL OR data ? 'subdivision' THEN
    RETURN data;
  END IF;

  ts   := COALESCE(data->>'timeSignature', '4/4');
  num  := COALESCE(NULLIF(split_part(ts, '/', 1), '')::int, 4);
  den  := COALESCE(NULLIF(split_part(ts, '/', 2), '')::int, 4);
  base := CASE WHEN data->>'mode' = '16' THEN 16 ELSE 8 END;
  sub  := GREATEST(1, ROUND(base::numeric / NULLIF(den, 0)));

  result := data
    || jsonb_build_object('beats', num, 'subdivision', sub)
    - 'mode'
    - 'timeSignature';

  -- Migrate nested gridB state if present
  IF result ? 'gridB' THEN
    gb := result->'gridB';
    IF NOT (gb ? 'subdivision') THEN
      ts   := COALESCE(gb->>'timeSignature', '4/4');
      num  := COALESCE(NULLIF(split_part(ts, '/', 1), '')::int, 4);
      den  := COALESCE(NULLIF(split_part(ts, '/', 2), '')::int, 4);
      base := CASE WHEN gb->>'mode' = '16' THEN 16 ELSE 8 END;
      sub  := GREATEST(1, ROUND(base::numeric / NULLIF(den, 0)));
      gb   := gb || jsonb_build_object('beats', num, 'subdivision', sub) - 'mode' - 'timeSignature';
      result := jsonb_set(result, '{gridB}', gb);
    END IF;
  END IF;

  RETURN result;
END;
$$;

-- ── Phase 1: patterns NOT referenced by any lesson ───────────────────────────
UPDATE public.patterns
SET    data = _migrate_pattern_jsonb(data)
WHERE  data IS NOT NULL
  AND  NOT (data ? 'subdivision')           -- legacy format only
  AND  name NOT IN (                        -- exclude course-linked patterns
         SELECT pattern_name
         FROM   public.lessons
         WHERE  pattern_name IS NOT NULL
       );

-- ── Phase 1: composition_sections.pattern_snapshot (same exclusion) ──────────
--
-- Snapshots whose phrase_name is referenced by a lesson are excluded.
-- Snapshots with no phrase_name (anonymous sections) are safe to migrate.
UPDATE public.composition_sections
SET    pattern_snapshot = _migrate_pattern_jsonb(pattern_snapshot)
WHERE  pattern_snapshot IS NOT NULL
  AND  NOT (pattern_snapshot ? 'subdivision')
  AND  (
         phrase_name IS NULL
         OR phrase_name NOT IN (
              SELECT pattern_name
              FROM   public.lessons
              WHERE  pattern_name IS NOT NULL
            )
       );

-- ── Cleanup ──────────────────────────────────────────────────────────────────
DROP FUNCTION _migrate_pattern_jsonb(jsonb);

-- ── Verification query (run manually to check results) ───────────────────────
-- SELECT name, data->>'beats', data->>'subdivision', data->>'mode'
-- FROM public.patterns
-- ORDER BY updated_at DESC
-- LIMIT 50;
